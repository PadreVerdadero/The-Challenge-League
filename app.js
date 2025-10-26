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
let matches = []; // array of match objects
let defeated = new Set();
let playersOrderArr = [];
let timerEnd = null; // ms timestamp or null
let timerInterval = null;
let processingExpiry = false;

// pending mode flags
let isPendingState = false; // true when "New group challenge pending" should show
let pendingAnimPlaying = false; // to avoid replaying animation repeatedly

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ----- helpers (immediate local updates) -----
async function persistDefeat(id) {
  try {
    await set(ref(db, `defeats/${id}`), true);
    defeated.add(id);
    renderRoster();
  } catch (e) {
    console.error('persistDefeat failed for', id, e);
  }
}

async function removeDefeat(id) {
  try {
    await remove(ref(db, `defeats/${id}`));
    defeated.delete(id);
    renderRoster();
  } catch (e) {
    console.error('removeDefeat failed for', id, e);
  }
}

async function clearAllDefeats() {
  try {
    await remove(ref(db, 'defeats'));
    defeated = new Set();
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
  } catch (e) {
    console.error('savePlayersOrder failed', e);
  }
}

async function writeMatch(match) {
  try {
    const mRef = push(ref(db, 'matches'));
    await set(mRef, match);
  } catch (e) {
    console.error('writeMatch failed', e);
  }
}

// ----- timer helpers -----
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function setTimerEnd(msTimestamp) {
  try {
    if (msTimestamp === null) {
      await remove(ref(db, 'timer/endTimestamp'));
      timerEnd = null;
    } else {
      await set(ref(db, 'timer/endTimestamp'), msTimestamp);
      timerEnd = msTimestamp;
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

  // If in pending state, show the pending message
  if (isPendingState || !championId) {
    el.textContent = 'New group challenge pending';
    el.classList.add('pending');
    el.classList.remove('expired');
    return;
  }

  if (!timerEnd) {
    el.textContent = 'No active challenge';
    el.classList.remove('expired');
    el.classList.remove('pending');
    return;
  }

  const remaining = timerEnd - Date.now();
  if (remaining > 0) {
    el.textContent = `Time left: ${formatDuration(remaining)}`;
    el.classList.remove('expired');
    el.classList.remove('pending');
  } else {
    el.textContent = `Time left: 00:00:00:00 — expired`;
    el.classList.add('expired');
    el.classList.remove('pending');
    if (!processingExpiry) {
      processingExpiry = true;
      handleTimerExpiry().finally(() => { processingExpiry = false; });
    }
  }
}

// ----- explosion animation (10s) -----
function playExplosionAnimation(durationMs = 10000) {
  if (pendingAnimPlaying) return;
  pendingAnimPlaying = true;

  const canvas = $('confetti-canvas');
  if (!canvas) {
    pendingAnimPlaying = false;
    return;
  }
  const ctx = canvas.getContext('2d');
  canvas.classList.add('explosion-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // create particles for explosion + smoke
  const particles = [];
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 3;
  for (let i = 0; i < 200; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 8;
    particles.push({
      x: centerX,
      y: centerY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (Math.random() * 2),
      size: 3 + Math.random() * 6,
      life: 0,
      ttl: 40 + Math.random() * 80,
      color: ['#ff8a00','#ff3b3b','#ffd500','#ff6bcb','#ffffff'][Math.floor(Math.random()*5)]
    });
  }
  // smoke particles
  const smoke = [];
  for (let i = 0; i < 60; i++) {
    smoke.push({
      x: centerX + (Math.random()-0.5)*80,
      y: centerY + (Math.random()-0.5)*40,
      vx: (Math.random()-0.5)*1,
      vy: - (0.2 + Math.random()*1),
      size: 10 + Math.random()*30,
      alpha: 0.15 + Math.random()*0.25,
      life: 0,
      ttl: 120 + Math.random()*80
    });
  }

  let start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // draw particles
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life++;
      const fade = Math.max(0, 1 - p.life / p.ttl);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = fade;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.globalAlpha = 1;
    });

    // draw smoke
    smoke.forEach(s => {
      s.x += s.vx;
      s.y += s.vy;
      s.life++;
      const fade = Math.max(0, 1 - s.life / s.ttl);
      ctx.fillStyle = `rgba(60,60,60,${s.alpha * fade})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.size * fade, (s.size * 0.6) * fade, 0, 0, Math.PI*2);
      ctx.fill();
    });

    if (t < durationMs) requestAnimationFrame(frame);
    else {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      pendingAnimPlaying = false;
    }
  }
  requestAnimationFrame(frame);
}

// ----- expiry behaviour -----
// On expiry: mark first visible defeated, move to end, write synthetic match.
// If this produces a sweep, STOP timer, enter pending state and play explosion animation.
async function handleTimerExpiry() {
  console.log('Timer expired — processing penalty');
  const firstId = playersOrderArr.find(id => id !== championId && players[id]);
  if (!firstId) {
    await setTimerEnd(null);
    return;
  }

  await persistDefeat(firstId);
  const idx = playersOrderArr.indexOf(firstId);
  if (idx !== -1) {
    playersOrderArr.splice(idx,1);
    playersOrderArr.push(firstId);
    await savePlayersOrder();
  } else {
    playersOrderArr.push(firstId);
    await savePlayersOrder();
  }

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

  const visibleIds = playersOrderArr.filter(id => id !== championId && players[id]);
  const allDefeated = visibleIds.length > 0 && visibleIds.every(id => defeated.has(id));

  if (allDefeated) {
    // enter pending state: stop timer DB key, play animation, show pending message
    await setTimerEnd(null);
    isPendingState = true;
    playExplosionAnimation(10000);
    log('All challengers defeated — new group challenge pending');
    // do not automatically assign anything here
  } else {
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

  // changed option: "remove current champion"
  const removeOpt = document.createElement('option');
  removeOpt.value = 'remove-current';
  removeOpt.textContent = 'Remove current champion';
  select.appendChild(removeOpt);

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
    if (val === 'remove-current') {
      // remove current champion: move to roster & vacate champion; set pending
      const prev = championId;
      if (prev) {
        // move previous champion back into order (ensure present and move to end)
        const prevIdx = playersOrderArr.indexOf(prev);
        if (prevIdx !== -1) {
          // ensure not duplicated
          playersOrderArr.splice(prevIdx, 1);
        }
        playersOrderArr.push(prev);
        await savePlayersOrder();
      }
      await set(ref(db, 'championId'), null); // vacate champion
      championId = null;
      // set pending state and stop timer
      isPendingState = true;
      await setTimerEnd(null);
      playExplosionAnimation(10000);
      renderChampion();
      renderRoster();
      renderMatchHistory();
      parent.removeChild(chooser);
      return;
    }

    let newChampionId = null;
    if (val === 'pick-first') {
      newChampionId = (ordered.find(id => id && players[id])) || null;
      if (!newChampionId) { alert('No players to select as champion'); parent.removeChild(chooser); return; }
    } else {
      newChampionId = val;
    }

    // assign the chosen champion (clearing defeats) and restart the timer
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

// assignNewChampionFromUI: clears defeats and sets champion, exits pending mode and starts timer
async function assignNewChampionFromUI(newChampionId) {
  if (!newChampionId) return;
  await clearAllDefeats();
  await removeDefeat(newChampionId);
  await set(ref(db, 'championId'), newChampionId);
  championId = newChampionId;
  isPendingState = false;
  pendingAnimPlaying = false;
  await startTimerOneWeek();
  renderChampion();
  renderRoster();
  renderMatchHistory();
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

// Render match history with descriptions
function renderMatchHistory() {
  const list = $('match-list');
  if (!list) return;
  list.innerHTML = '';
  const sorted = matches.slice().sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  sorted.forEach(m => {
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
    const div = document.createElement('div');
    div.innerHTML = `🏁 <strong>${escapeHtml(m.challengerName || 'Unknown')}</strong> vs <strong>${escapeHtml(m.championName || 'Unknown')}</strong> — Winner: <strong>${escapeHtml(m.winnerName || 'Unknown')}</strong> ${time ? `(${time})` : ''}`;
    list.appendChild(div);
    if (m.description) {
      const desc = document.createElement('div');
      desc.className = 'match-desc';
      desc.textContent = m.description;
      list.appendChild(desc);
    }
  });
}

// ----- challenge flow -----
async function handleRosterClick(id) {
  const p = players[id]; if (!p) return;

  // if we are in pending state, starting a challenge should not auto-start a timer elsewhere; but follow existing behavior: restart timer
  if (!isPendingState) await startTimerOneWeek();

  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id);
      championId = id;
      isPendingState = false;
      pendingAnimPlaying = false;
      await startTimerOneWeek();
      renderChampion();
      renderRoster();
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
    matches.push(match);
    renderMatchHistory();

    if (winnerId === id) {
      const prevChampion = championId;
      await clearAllDefeats();
      if (prevChampion && prevChampion !== id) {
        await persistDefeat(prevChampion);
        const prevIdx = playersOrderArr.indexOf(prevChampion);
        if (prevIdx !== -1) { playersOrderArr.splice(prevIdx, 1); playersOrderArr.push(prevChampion); } else playersOrderArr.push(prevChampion);
        await savePlayersOrder();
      }
      await removeDefeat(id);
      await set(ref(db, 'championId'), id);
      championId = id;
      triggerConfetti();
      log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);

      // Check for sweep after a normal entered challenge (all non-champion defeated)
      const visibleIds = playersOrderArr.filter(x => x !== championId && players[x]);
      const allDefeated = visibleIds.length > 0 && visibleIds.every(x => defeated.has(x));
      if (allDefeated) {
        // enter pending state and stop timer (play explosion)
        await setTimerEnd(null);
        isPendingState = true;
        playExplosionAnimation(10000);
        log(`Champion ${players[championId]?.name} completed sweep. New group challenge pending.`);
      }
    } else {
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

// ----- confetti (short celebratory) -----
function triggerConfetti() {
  const canvas = $('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const parts = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<80;i++) {
    parts.push({x: Math.random()*canvas.width, y: -50 - Math.random()*200, vx: (Math.random()-0.5)*6, vy: 2 + Math.random()*6, size: 6 + Math.random()*8, c: colors[Math.floor(Math.random()*colors.length)], life:0});
  }
  let frame = 0;
  function d() {
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life++;
      ctx.fillStyle = p.c; ctx.fillRect(p.x,p.y,p.size,p.size*0.6);
    });
    if (frame < 120) requestAnimationFrame(d); else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  d();
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
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  const allIds = Object.keys(players);
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) playersOrderArr = [];
  else playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id})).sort((a,b)=>a.idx-b.idx).map(e=>e.id);
  const allIds = Object.keys(players || {});
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val();
  championId = newChampionId;
  if (championId && defeated.has(championId)) defeated.delete(championId);
  // if there is no champion, show pending state
  if (!championId) {
    isPendingState = true;
    playExplosionAnimation(10000);
  }
  renderChampion();
  renderRoster();
});

onValue(ref(db, 'matches'), snap => {
  const val = snap.val() || {};
  matches = Object.values(val);
  renderMatchHistory();
});

onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
});

onValue(ref(db, 'timer/endTimestamp'), snap => {
  const val = snap.val();
  timerEnd = val || null;
  if (timerEnd) {
    isPendingState = false;
    startLocalCountdown();
  } else {
    clearLocalInterval();
    // if DB timer cleared and no champion or sweep occurred, ensure pending state is set elsewhere
    updateTimerDisplay();
  }
});

// Connectivity check
(async function testConn(){
  try { const root = await get(ref(db, '/')); console.log('Initial DB root', root.val()); log('Connected to Firebase'); } catch (e) { console.error('Firebase connectivity test failed', e); log('Firebase connect failed: ' + e.message); }
})();
