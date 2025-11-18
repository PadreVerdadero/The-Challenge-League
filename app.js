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
let timerEnd = null;
let timerInterval = null;
let processingExpiry = false;

let isPendingState = false;
let pendingAnimPlaying = false;

let championBoard = [];
let sweepRecordedFor = null;

let suppressDefeatsListener = false;

// Prevent recording sweeps during initial sync/load
let initialDataLoaded = false;

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function norm(id){ return id == null ? id : String(id); }

// ---------------------- Helpers ----------------------
async function persistDefeat(id) {
  const nid = norm(id);
  try {
    await set(ref(db, `defeats/${nid}`), true);
    defeated.add(nid);
    renderRoster();
    checkForSweep('persistDefeat:' + nid);
    console.log('persistDefeat saved for', nid);
  } catch (e) {
    console.error('persistDefeat failed for', nid, e);
  }
}

async function removeDefeat(id) {
  const nid = norm(id);
  try {
    await remove(ref(db, `defeats/${nid}`));
    defeated.delete(nid);
    renderRoster();
    checkForSweep('removeDefeat:' + nid);
    console.log('removeDefeat removed for', nid);
  } catch (e) {
    console.error('removeDefeat failed for', nid, e);
  }
}

async function clearAllDefeats() {
  try {
    await remove(ref(db, 'defeats'));
    defeated = new Set();
    renderRoster();
    checkForSweep('clearAllDefeats');
    console.log('clearAllDefeats removed /defeats');
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
    console.log('writeMatch persisted', match);
  } catch (e) {
    console.error('writeMatch failed', e);
    throw e;
  }
}

// ---------------------- Durable sweep marker helpers ----------------------
async function getLastSweep() {
  try {
    const snap = await get(ref(db, 'sweep/last'));
    return snap.val() || null;
  } catch (e) {
    console.error('getLastSweep failed', e);
    return null;
  }
}

async function setLastSweep(champId, ts) {
  try {
    await set(ref(db, 'sweep/last'), { id: champId, timestamp: ts });
    console.log('setLastSweep saved', champId, ts);
  } catch (e) {
    console.error('setLastSweep failed', e);
  }
}

const CHAMPION_BOARD_DEBOUNCE_MS = 5000;

async function addChampionBoardEntry(champId, champName) {
  try {
    const now = Date.now();

    // 1) Check durable last-sweep marker in DB
    const last = await getLastSweep();
    if (last && last.id === champId) {
      if ((now - (last.timestamp || 0)) < CHAMPION_BOARD_DEBOUNCE_MS) {
        console.log('addChampionBoardEntry: skipping because sweep/last already records this champion recently', champId);
        return;
      }
    }

    // 2) Read latest championBoard entry (defensive)
    const snap = await get(ref(db, 'championBoard'));
    const val = snap.val() || {};
    const entries = Object.values(val);
    let latest = null;
    if (entries.length) {
      latest = entries.reduce((best, e) => {
        if (!best) return e;
        return ( (e.timestamp || 0) > (best.timestamp || 0) ) ? e : best;
      }, null);
    }

    if (latest && latest.id === champId && ((now - (latest.timestamp || 0)) < CHAMPION_BOARD_DEBOUNCE_MS)) {
      console.log('addChampionBoardEntry: skipping duplicate recent championBoard entry for', champId);
      await setLastSweep(champId, latest.timestamp || now);
      return;
    }

    // 3) Safe to push new entry and set durable marker
    const entry = { id: champId, name: champName, timestamp: now };
    const bRef = push(ref(db, 'championBoard'));
    await set(bRef, entry);
    console.log('Champion Board entry added', entry);

    // 4) Persist durable marker of this sweep
    await setLastSweep(champId, now);
  } catch (e) {
    console.error('addChampionBoardEntry failed', e);
  }
}

// ---------------------- Sweep checker (guarded by initialDataLoaded) ----------------------
async function checkForSweep(triggerContext = 'unknown') {
  try {
    // Don't run sweep logic until after initial sync finishes
    if (!initialDataLoaded) {
      console.log('[checkForSweep] skipped — initial data not loaded yet');
      return false;
    }

    const normalizedOrder = playersOrderArr.map(norm).filter(id => id != null);
    const visibleIds = normalizedOrder.filter(id => id !== norm(championId) && players[id]);
    const defeatedArray = Array.from(defeated).map(norm);

    console.log('[checkForSweep] triggered by:', triggerContext);
    console.log('[checkForSweep] championId:', norm(championId));
    console.log('[checkForSweep] playersOrderArr:', normalizedOrder);
    console.log('[checkForSweep] visibleIds (non-champion):', visibleIds);
    console.log('[checkForSweep] defeated set:', defeatedArray);

    const allDefeated = visibleIds.length > 0 && visibleIds.every(id => defeated.has(id));
    if (allDefeated) {
      if (championId && championId !== sweepRecordedFor) {
        console.log('[checkForSweep] sweep detected — recording champion locally:', championId);
        if (players[championId]) {
          await addChampionBoardEntry(championId, players[championId].name);
        } else {
          await addChampionBoardEntry(championId, String(championId));
        }
        sweepRecordedFor = championId;
      } else {
        console.log('[checkForSweep] sweep already recorded locally for', championId);
      }

      await setTimerEnd(null);
      isPendingState = true;

      // immediate UI update so Assign button appears reliably
      renderChampion();
      renderRoster();

      playExplosionAnimation(10000);
      log('All challengers defeated — new group challenge pending');
      updateTimerDisplay();
    } else {
      console.log('[checkForSweep] no sweep (allDefeated=false)');
      sweepRecordedFor = null;
    }
    return allDefeated;
  } catch (e) {
    console.error('checkForSweep error', e);
    return false;
  }
}

// ---------------------- Timer helpers ----------------------
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function setTimerEnd(msTimestamp) {
  try {
    if (msTimestamp === null) {
      await remove(ref(db, 'timer/endTimestamp'));
      timerEnd = null;
      console.log('[setTimerEnd] cleared timer in DB');
    } else {
      await set(ref(db, 'timer/endTimestamp'), msTimestamp);
      timerEnd = msTimestamp;
      console.log('[setTimerEnd] set timer in DB to', msTimestamp);
    }
  } catch (e) {
    console.error('setTimerEnd failed', e);
  }
}

async function startTimerOneWeek(force) {
  if (!force) return;
  const end = Date.now() + WEEK_MS;
  console.log('[startTimerOneWeek] forcing new timer to', end);
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

// ---------------------- Explosion animation ----------------------
function playExplosionAnimation(durationMs = 10000) {
  if (pendingAnimPlaying) return;
  pendingAnimPlaying = true;

  const canvas = $('confetti-canvas');
  if (!canvas) { pendingAnimPlaying = false; return; }
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

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

// ---------------------- Expiry behaviour ----------------------
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

  await checkForSweep('handleTimerExpiry');

  const visibleIdsAfter = playersOrderArr.filter(id => id !== championId && players[id]);
  const allDefeatedAfter = visibleIdsAfter.length > 0 && visibleIdsAfter.every(id => defeated.has(id));
  if (!allDefeatedAfter) {
    await startTimerOneWeek(true);
  }
}

// ---------------------- Rendering ----------------------
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

// Show Assign only when pending AND there is a champion; show Lock in Order when no champion
function renderChampionActions() {
  const area = $('champion-actions-area');
  if (!area) return;
  area.innerHTML = '';

  if (isPendingState && championId) {
    const btn = document.createElement('button');
    btn.textContent = 'Assign Champion';
    btn.title = 'Automatically remove current champion so order can be locked';
    btn.addEventListener('click', async () => {
      const prev = championId;
      if (prev) {
        const prevIdx = playersOrderArr.indexOf(prev);
        if (prevIdx !== -1) { playersOrderArr.splice(prevIdx, 1); }
        playersOrderArr.push(prev);
        await savePlayersOrder();
      }
      await set(ref(db, 'championId'), null);
      championId = null;
      isPendingState = true;
      await setTimerEnd(null);
      playExplosionAnimation(10000);
      renderChampion();
      renderRoster();
    });
    area.appendChild(btn);

  } else if (!championId) {
    const btn = document.createElement('button');
    btn.textContent = 'Lock in Order';
    btn.title = 'Select first player in order as champion (locks order while champion active)';
    btn.addEventListener('click', async () => {
      const ordered = playersOrderArr.length ? playersOrderArr : Object.keys(players).sort();
      const pick = ordered.find(id => id && players[id]) || null;
      if (!pick) { alert('No players to select as champion'); return; }
      await clearAllDefeats();
      await removeDefeat(pick);
      await set(ref(db, 'championId'), pick);
      championId = pick;
      isPendingState = false;
      pendingAnimPlaying = false;
      await startTimerOneWeek(true);
      renderChampion();
      renderRoster();
      renderMatchHistory();
    });
    area.appendChild(btn);
  }
}

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

    const orderEditable = (isPendingState || !championId);

    if (visibleIds.length > 1) {
      const up = document.createElement('button'); up.className = 'move-btn'; up.textContent = '↑'; up.disabled = (position === 0 || !orderEditable);
      up.addEventListener('click', async (e) => { e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx > 0) { [playersOrderArr[idx-1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx-1]]; await savePlayersOrder(); renderRoster(); } });
      const down = document.createElement('button'); down.className = 'move-btn'; down.textContent = '↓'; down.disabled = (position === visibleIds.length - 1 || !orderEditable);
      down.addEventListener('click', async (e) => { e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx >= 0 && idx < playersOrderArr.length - 1) { [playersOrderArr[idx+1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx+1]]; await savePlayersOrder(); renderRoster(); } });
      row.append(up, down);
    }

    roster.appendChild(row);
  });
}

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

function renderChampionBoard() {
  const el = $('champion-board-list');
  if (!el) return;
  el.innerHTML = '';
  const sorted = championBoard.slice().sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  sorted.forEach(entry => {
    const d = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';
    const row = document.createElement('div');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'champion-board-name';
    nameSpan.textContent = entry.name || entry.id || 'Unknown';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'champion-board-time';
    timeSpan.textContent = d;
    row.appendChild(nameSpan);
    row.appendChild(timeSpan);
    el.appendChild(row);
  });
}

// ---------------------- Challenge flow ----------------------
async function handleRosterClick(id) {
  const p = players[id]; if (!p) return;

  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id);
      championId = id;
      isPendingState = false;
      pendingAnimPlaying = false;
      await startTimerOneWeek(true);
      renderChampion();
      renderRoster();
    }
    return;
  }

  const desc = prompt(`Describe the challenge between ${p.name} and ${players[championId].name}:`);
  if (desc === null) {
    console.log('Challenge description cancelled; aborting flow, no timer change.');
    return;
  }

  const winnerName = prompt(`Who won? Type exactly: "${p.name}" or "${players[championId].name}"`);
  if (winnerName === null) {
    console.log('Winner prompt cancelled; aborting flow, no timer change.');
    return;
  }

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
    await startTimerOneWeek(true);

    if (winnerId === id) {
      const prevChampion = championId;

      suppressDefeatsListener = true;
      try {
        await remove(ref(db, 'defeats'));
        defeated = new Set();
        renderRoster();

        if (prevChampion && prevChampion !== id) {
          const prevIdx = playersOrderArr.indexOf(prevChampion);
          if (prevIdx !== -1) { playersOrderArr.splice(prevIdx, 1); }
          playersOrderArr.push(prevChampion);
          await savePlayersOrder();
        }

        await set(ref(db, 'championId'), id);
        championId = id;

        if (prevChampion) {
          try { await remove(ref(db, `defeats/${prevChampion}`)); } catch (e) { console.warn('remove prev defeat failed', e); }
          defeated.delete(prevChampion);
        }

        try { await remove(ref(db, `defeats/${id}`)); } catch(e){ console.warn('clear new champ defeat failed', e); }
        defeated.delete(id);

        triggerConfetti();
        log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
        renderChampion();
        renderRoster();

        await checkForSweep('dethrone:entered-challenge');

        const snap = await get(ref(db, 'defeats'));
        const val = snap.val() || {};
        defeated = new Set(Object.keys(val).map(norm));
        if (championId && defeated.has(championId)) defeated.delete(championId);
        renderRoster();
      } finally {
        suppressDefeatsListener = false;
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

// ---------------------- Confetti ----------------------
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

// ---------------------- Add player ----------------------
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

// ---------------------- Firebase listeners ----------------------
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
  const normalized = norm(newChampionId);
  // If champion changed, clear the local recorded-sweep lock so new sweeps can record later
  if (normalized !== championId) {
    sweepRecordedFor = null;
  }
  championId = normalized;
  if (championId && defeated.has(championId)) defeated.delete(championId);
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

// defeats listener respects suppress flag
onValue(ref(db, 'defeats'), async snap => {
  if (suppressDefeatsListener) {
    console.log('[defeats listener] suppressed');
    return;
  }
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val).map(norm));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
  checkForSweep('defeats:db-snapshot');
});

onValue(ref(db, 'championBoard'), snap => {
  const val = snap.val() || {};
  championBoard = Object.values(val);
  renderChampionBoard();
});

onValue(ref(db, 'timer/endTimestamp'), snap => {
  const val = snap.val();
  timerEnd = val || null;
  if (timerEnd) {
    isPendingState = false;
    startLocalCountdown();
  } else {
    clearLocalInterval();
    updateTimerDisplay();
  }
});

// Connectivity check and mark initial data loaded afterward
(async function testConn(){
  try {
    const root = await get(ref(db, '/'));
    console.log('Initial DB root', root.val());
    log('Connected to Firebase');
    // Allow initial snapshot processing to complete before enabling sweep recordings
    // small delay ensures onValue initial handlers run first
    setTimeout(() => { initialDataLoaded = true; console.log('initialDataLoaded = true'); }, 250);
  } catch (e) {
    console.error('Firebase connectivity test failed', e);
    log('Firebase connect failed: ' + e.message);
    setTimeout(() => { initialDataLoaded = true; console.log('initialDataLoaded = true (connect failed fallback)'); }, 250);
  }
})();
