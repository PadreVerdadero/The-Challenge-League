import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

console.log('app.js loaded');

const firebaseConfig = {
  apiKey: "AIzaSyBSCn8-SpgtrJz3SRBWfiLL-WXylProWqU",
  authDomain: "challengeleague-ec503.firebaseapp.com",
  databaseURL: "https://challengeleague-ec503-default-rtdb.firebaseio.com",
  projectId: "challengeleague-ec503",
  storageBucket: "challengeleague-ec503.appspot.com",
  messagingSenderId: "120184354429",
  appId: "1:120184354429:web:e28ea3cd8c177b3cd72314"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// App state
let players = {};
let championId = null;
let matches = [];
let defeated = new Set();
let playersOrderArr = [];
let timerEnd = null; // mirrored from DB at /timer/endTimestamp (ms)
let timerInterval = null;
let processingExpiry = false;

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ----- helpers (update local defeated for immediate UI feedback) -----
async function persistDefeat(id) {
  try {
    await set(ref(db, `defeats/${id}`), true);
    defeated.add(id); // update local set immediately
    console.log('persistDefeat saved for', id, 'and added to local set');
    renderRoster();
  } catch (e) {
    console.error('persistDefeat failed for', id, e);
  }
}

async function removeDefeat(id) {
  try {
    await remove(ref(db, `defeats/${id}`));
    defeated.delete(id);
    console.log('removeDefeat removed for', id, 'and removed from local set');
    renderRoster();
  } catch (e) {
    console.error('removeDefeat failed for', id, e);
  }
}

async function clearAllDefeats() {
  try {
    await remove(ref(db, 'defeats'));
    defeated = new Set();
    console.log('clearAllDefeats removed /defeats and cleared local set');
    renderRoster();
  } catch (e) {
    console.error('clearAllDefeats failed', e);
  }
}

async function savePlayersOrder() {
  try {
    const obj = {};
    playersOrderArr.forEach((id, idx) => obj[idx] = id);
    await set(ref(db, 'playersOrder'), obj);
    console.log('playersOrder saved', playersOrderArr);
  } catch (e) {
    console.error('savePlayersOrder failed', e);
  }
}

async function writeMatch(match) {
  try {
    const mRef = push(ref(db, 'matches'));
    await set(mRef, match);
    console.log('match written', match);
  } catch (e) {
    console.error('writeMatch failed', e);
  }
}

async function addHistoricalChampion(champId, champName) {
  try {
    const entry = { id: champId, name: champName, timestamp: Date.now() };
    const hRef = push(ref(db, 'historicalChampions'));
    await set(hRef, entry);
    console.log('Added historical champion', entry);
  } catch (e) {
    console.error('addHistoricalChampion failed', e);
  }
}

// ----- timer helpers -----
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function setTimerEnd(msTimestamp) {
  try {
    if (msTimestamp === null) {
      await remove(ref(db, 'timer/endTimestamp'));
      console.log('Timer end cleared in DB');
    } else {
      await set(ref(db, 'timer/endTimestamp'), msTimestamp);
      console.log('Timer end set in DB to', msTimestamp);
    }
  } catch (e) {
    console.error('setTimerEnd failed', e);
  }
}

async function startTimerOneWeek() {
  const end = Date.now() + WEEK_MS;
  await setTimerEnd(end);
}

function clearLocalInterval() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function startLocalCountdown() {
  clearLocalInterval();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function formatDuration(ms) {
  if (ms <= 0) return '00:00:00:00';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hrs = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(days).padStart(2,'0')}:${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTimerDisplay() {
  const el = $('timer-display');
  if (!el) return;
  if (!timerEnd) { el.textContent = 'No active challenge'; el.classList.remove('expired'); return; }
  const remaining = timerEnd - Date.now();
  if (remaining > 0) {
    el.textContent = `Time left: ${formatDuration(remaining)}`;
    el.classList.remove('expired');
  } else {
    el.textContent = `Time left: 00:00:00:00 — expired`;
    el.classList.add('expired');
    if (!processingExpiry) {
      processingExpiry = true;
      handleTimerExpiry().finally(() => { processingExpiry = false; });
    }
  }
}

// ----- expiry behaviour -----
// When timer expires, penalize first visible roster member and move them to end.
// If this produces a sweep (all visible defeated), record champion into historicalChampions and STOP the timer (clear DB timer).
async function handleTimerExpiry() {
  console.log('Timer expired — processing penalty');
  const firstId = playersOrderArr.find(id => id !== championId && players[id]);
  if (!firstId) {
    console.log('No eligible roster member to penalize');
    // still clear timer to avoid repeated expiries
    await setTimerEnd(null);
    return;
  }

  // mark them defeated and move to end
  await persistDefeat(firstId);
  const idx = playersOrderArr.indexOf(firstId);
  if (idx !== -1) {
    playersOrderArr.splice(idx, 1);
    playersOrderArr.push(firstId);
    await savePlayersOrder();
  } else {
    playersOrderArr.push(firstId);
    await savePlayersOrder();
  }

  // write synthetic match for history with description
  const match = {
    challengerId: firstId,
    challengerName: players[firstId]?.name || 'Unknown',
    championId,
    championName: players[championId]?.name || 'Champion',
    winnerId: championId,
    winnerName: players[championId]?.name || 'Champion',
    description: 'Auto-loss: timer expired',
    timestamp: Date.now()
  };
  await writeMatch(match);

  renderRoster();
  renderMatchHistory();

  // Check sweep: are all visible (non-champion) players defeated?
  const visibleIds = playersOrderArr.filter(id => id !== championId && players[id]);
  const allDefeated = visibleIds.length > 0 && visibleIds.every(id => defeated.has(id));

  if (allDefeated) {
    const champName = players[championId]?.name || 'Champion';
    // Add champion to history with date
    await addHistoricalChampion(championId, champName);
    alert(`Congratulations ${champName}! All challengers are defeated.`);

    // STOP the timer until a human assigns the next champion
    await setTimerEnd(null); // clears DB timer; timerEnd listener will stop local countdown

    // Inform user to use the Assign Champion control (UI shows button next to champion)
    log('Timer stopped: all challengers defeated. Use Assign Champion to pick the next champion.');
  } else {
    // restart timer for the next week automatically
    await startTimerOneWeek();
  }
}

// ----- rendering -----
function renderChampion() {
  const el = $('champion-card');
  if (!el) return;
  const champ = players[championId];
  el.innerHTML = `
    <h2>Champion</h2>
    <div>
      ${champ ? `<span class="champ-name">👑 ${escapeHtml(champ.name)}</span>` : `<span class="champ-name">No champion yet</span>`}
      <span class="champion-actions" id="champion-actions-area"></span>
    </div>
  `;
  renderChampionActions();
}

function renderChampionActions() {
  const area = $('champion-actions-area');
  if (!area) return;
  area.innerHTML = '';
  const btn = document.createElement('button');
  btn.textContent = championId ? 'Assign Champion' : 'Pick First Champion';
  btn.addEventListener('click', () => openChampionChooser(area));
  area.appendChild(btn);
}

function openChampionChooser(parent) {
  if (!parent) return;
  const existing = parent.querySelector('.champion-chooser');
  if (existing) { parent.removeChild(existing); return; }

  const chooser = document.createElement('span');
  chooser.className = 'champion-chooser';

  const select = document.createElement('select');

  const keepOpt = document.createElement('option');
  keepOpt.value = 'keep';
  keepOpt.textContent = 'Keep current champion';
  select.appendChild(keepOpt);

  if (!championId) {
    const pickFirst = document.createElement('option');
    pickFirst.value = 'pick-first';
    pickFirst.textContent = 'Select first player as champion';
    select.appendChild(pickFirst);
  }

  const ordered = playersOrderArr.length ? playersOrderArr : Object.keys(players).sort();
  ordered.forEach(id => {
    if (!players[id]) return;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = players[id].name;
    select.appendChild(opt);
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const val = select.value;
    if (val === 'keep') { parent.removeChild(chooser); return; }
    let newChampionId = null;
    if (val === 'pick-first') {
      newChampionId = (ordered.find(id => id && players[id])) || null;
      if (!newChampionId) { alert('No players to select as champion'); parent.removeChild(chooser); return; }
    } else {
      newChampionId = val;
    }
    await assignNewChampionFromUI(newChampionId);
    parent.removeChild(chooser);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => { if (parent.contains(chooser)) parent.removeChild(chooser); });

  chooser.appendChild(select);
  chooser.appendChild(saveBtn);
  chooser.appendChild(cancelBtn);
  parent.appendChild(chooser);
}

// assignNewChampionFromUI clears defeats and sets champion, and restarts the timer
async function assignNewChampionFromUI(newChampionId) {
  if (!newChampionId) return;
  // Clear all defeat flags so everyone turns blue locally and in DB
  await clearAllDefeats();
  // Ensure the selected champion is not marked defeated
  await removeDefeat(newChampionId);
  // Persist champion change
  await set(ref(db, 'championId'), newChampionId);
  // Restart the week timer when champion assigned
  await startTimerOneWeek();
  renderChampion();
  renderRoster();
}

// Render roster
function renderRoster() {
  const roster = $('roster');
  if (!roster) return;
  roster.innerHTML = '<h2>Roster</h2>';
  if (!players || Object.keys(players).length === 0) { roster.innerHTML += '<p>No players yet</p>'; return; }

  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);

  visibleIds.forEach((id, position) => {
    const p = players[id];
    if (!p) return;

    const row = document.createElement('div'); row.className = 'roster-row';
    const handle = document.createElement('div'); handle.className = 'order-handle'; handle.textContent = '☰';
    const nameBtn = document.createElement('button'); nameBtn.className = 'roster-name'; nameBtn.textContent = p.name; nameBtn.dataset.id = id;
    if (defeated.has(id)) nameBtn.classList.add('lost'); else nameBtn.classList.remove('lost');
    nameBtn.addEventListener('click', () => handleRosterClick(id));

    row.append(handle, nameBtn);

    if (visibleIds.length > 1) {
      const up = document.createElement('button'); up.className = 'move-btn'; up.textContent = '↑'; up.disabled = (position === 0);
      up.addEventListener('click', async (e) => { e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx > 0) { [playersOrderArr[idx-1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx-1]]; await savePlayersOrder(); renderRoster(); } });
      const down = document.createElement('button'); down.className = 'move-btn'; down.textContent = '↓'; down.disabled = (position === visibleIds.length - 1);
      down.addEventListener('click', async (e) => { e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx >= 0 && idx < playersOrderArr.length - 1) { [playersOrderArr[idx+1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx+1]]; await savePlayersOrder(); renderRoster(); } });
      row.append(up, down);
    }

    roster.appendChild(row);
  });
}

// Render match history: includes challenge descriptions
function renderMatchHistory() {
  const list = $('match-list');
  if (!list) return;
  list.innerHTML = '';
  // preserve order newest first
  matches.slice().reverse().forEach(m => {
    const time = new Date(m.timestamp).toLocaleString();
    const div = document.createElement('div');
    div.innerHTML = `🏁 <strong>${escapeHtml(m.challengerName)}</strong> vs <strong>${escapeHtml(m.championName)}</strong> — Winner: <strong>${escapeHtml(m.winnerName)}</strong> (${time})`;
    list.appendChild(div);
    if (m.description) {
      const desc = document.createElement('div');
      desc.className = 'match-desc';
      desc.textContent = m.description;
      list.appendChild(desc);
    }
  });
}

// Render historical champions list
function renderHistoricalChamps(arr) {
  const el = $('historical-list');
  if (!el) return;
  el.innerHTML = '';
  arr.forEach(entry => {
    const d = new Date(entry.timestamp).toLocaleString();
    const div = document.createElement('div');
    div.textContent = `${entry.name} — ${d}`;
    el.appendChild(div);
  });
}

// ----- challenge flow -----
async function handleRosterClick(id) {
  const p = players[id]; if (!p) return;

  // restart timer when challenge begins (user intent)
  await startTimerOneWeek();

  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id);
      log(`Champion set to ${p.name}`);
      renderChampion();
    }
    return;
  }

  const desc = prompt(`Describe the challenge between ${p.name} and ${players[championId].name}:`);
  if (desc === null) return;
  const winnerName = prompt(`Who won? Type exactly: "${p.name}" or "${players[championId].name}"`);
  if (winnerName === null) return;

  const winnerId = (winnerName === p.name) ? id : championId;
  const winnerDisplay = (winnerName === p.name) ? p.name : players[championId].name;

  const match = {
    challengerId: id,
    challengerName: p.name,
    championId,
    championName: players[championId].name,
    winnerId,
    winnerName: winnerDisplay,
    description: desc || '',
    timestamp: Date.now()
  };

  try {
    await writeMatch(match);
    // push match locally will be handled by DB listener, but update local matches for immediate UI
    matches.push(match);

    if (winnerId === id) {
      // Challenger won: dethrone previous champion
      const prevChampion = championId;
      // Clear all defeats (everyone turns blue) locally and in DB
      await clearAllDefeats();
      // Previous champion becomes defeated and moves to end if different
      if (prevChampion && prevChampion !== id) {
        await persistDefeat(prevChampion);
        const prevIdx = playersOrderArr.indexOf(prevChampion);
        if (prevIdx !== -1) { playersOrderArr.splice(prevIdx, 1); playersOrderArr.push(prevChampion); } else playersOrderArr.push(prevChampion);
        await savePlayersOrder();
      }
      // Ensure new champion not defeated
      await removeDefeat(id);
      // Set new champion
      await set(ref(db, 'championId'), id);
      triggerConfetti();
      log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
    } else {
      // Challenger lost: persist defeat and move them to bottom
      await persistDefeat(id);
      const idx = playersOrderArr.indexOf(id);
      if (idx !== -1) { playersOrderArr.splice(idx,1); playersOrderArr.push(id); } else playersOrderArr.push(id);
      await savePlayersOrder();
      log(`${p.name} lost to ${players[championId].name}`);
    }

    if (!playersOrderArr.includes(id)) { playersOrderArr.push(id); await savePlayersOrder(); }

    renderChampion();
    renderRoster();
    renderMatchHistory();
  } catch (err) {
    console.error('Error recording match', err);
    log('Error saving match: ' + err.message);
  }
}

// ----- confetti -----
function triggerConfetti() {
  const canvas = $('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const parts = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<100;i++){
    parts.push({ x: Math.random()*canvas.width, y: -50 - Math.random()*100, vx: (Math.random()-0.5)*6, vy: 2 + Math.random()*5, size: 6 + Math.random()*8, c: colors[Math.floor(Math.random()*colors.length)] });
  }
  let frame = 0;
  function draw() {
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, p.size, p.size*0.6);
    });
    if (frame < 140) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// ----- add player -----
async function addPlayer() {
  const input = $('new-player-name');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { log('Enter a name'); return; }
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try {
    await set(ref(db, `players/${id}`), { name });
    input.value = '';
    if (!playersOrderArr.includes(id)) { playersOrderArr.push(id); await savePlayersOrder(); }
    log(`Added ${name}`);
  } catch (err) {
    console.error('Add player failed', err);
    log('Add player failed: ' + err.message);
  }
}
$('add-player-button')?.addEventListener('click', addPlayer);

// ----- Firebase listeners -----

// players
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  console.log('players snapshot', players);
  // ensure order includes any new players
  const allIds = Object.keys(players);
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

// playersOrder
onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) {
    playersOrderArr = [];
    console.log('playersOrder empty in DB');
  } else {
    playersOrderArr = Object.entries(val)
      .map(([k, id]) => ({ idx: Number(k), id }))
      .sort((a, b) => a.idx - b.idx)
      .map(e => e.id);
    console.log('playersOrder loaded', playersOrderArr);
  }
  // append missing players
  const allIds = Object.keys(players || {});
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

// championId
onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val();
  const prev = championId;
  championId = newChampionId;
  console.log('champion snapshot', { prev, newChampionId });
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderChampion();
  renderRoster();
});

// matches (include descriptions)
onValue(ref(db, 'matches'), snap => {
  const val = snap.val();
  matches = val ? Object.values(val) : [];
  console.log('matches snapshot count', matches.length);
  renderMatchHistory();
});

// defeats
onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val));
  console.log('defeats snapshot loaded', Array.from(defeated));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
});

// timer/endTimestamp
onValue(ref(db, 'timer/endTimestamp'), snap => {
  const val = snap.val();
  timerEnd = val || null;
  console.log('timer/endTimestamp', timerEnd);
  if (timerEnd) startLocalCountdown(); else { clearLocalInterval(); updateTimerDisplay(); }
});

// historicalChampions
onValue(ref(db, 'historicalChampions'), snap => {
  const val = snap.val() || {};
  const arr = val ? Object.values(val) : [];
  renderHistoricalChamps(arr);
});

// Connectivity check (initial)
(async function testConn(){
  try {
    const root = await get(ref(db, '/'));
    console.log('Initial DB root', root.val());
    log('Connected to Firebase');
  } catch (e) {
    console.error('Firebase connectivity test failed', e);
    log('Firebase connect failed: ' + e.message);
  }
})();
