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
let matches = []; // array of match objects (driven from DB)
let defeated = new Set();
let playersOrderArr = [];
let timerEnd = null; // ms timestamp or null
let timerInterval = null;
let processingExpiry = false;

// pending mode flags
let isPendingState = false; // true when "New group challenge pending" should show
let pendingAnimPlaying = false; // to avoid replaying animation repeatedly

// champion board local
let championBoard = []; // array of { id, name, timestamp }

// local sweep lock to avoid duplicate local writes
let sweepRecordedFor = null; // prevents double-writing champion board

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// normalize id values to strings used in players keys
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

// writeMatch persists a match to DB (caller should only call when ready)
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
    return snap.val() || null; // { id: 'champId', timestamp: 1234567890 } or null
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

// ---------------------- Champion Board write (durable guard + debounce) ----------------------
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

// ---------------------- Sweep checker ----------------------
async function checkForSweep(triggerContext = 'unknown') {
  try {
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
      playExplosionAnimation(10000);
      log('All challengers defeated — new group challenge pending');
      updateTimerDisplay();
    } else {
      console.log('[checkForSweep] no sweep (allDefeated=false)');
      // reset local lock so future sweeps by the same champion can be recorded
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

// startTimerOneWeek(force) — only acts when force === true
async function startTimerOneWeek(force) {
  if (!force) {
    console.log('[startTimerOneWeek] called without force — ignoring');
    return;
  }
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

  // Persist the match to DB — do NOT push it locally; onValue listener will update matches
  await writeMatch(match);

  renderRoster();
  renderMatchHistory();

  await checkForSweep('handleTimerExpiry');

  const visibleIdsAfter = playersOrderArr.filter(id => id !== championId && players[id]);
  const allDefeatedAfter = visibleIdsAfter.length > 0 && visibleIdsAfter.every(id => defeated.has(id));
  if (!allDefeatedAfter) {
    await startTimerOneWeek(true); // explicit forced restart only after expiry flow
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
  await startTimerOneWeek(true); // explicit forced start when a champion is chosen
  renderChampion();
  renderRoster();
  renderMatchHistory();
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

// Render Champion Board
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
    // Persist match to DB; onValue listener will refresh matches
    await writeMatch(match);

    // Restart timer explicitly because a match was recorded
    await startTimerOneWeek(true);

    if (winnerId === id) {
      const prevChampion = championId;

      // 1) Clear global defeats first so new champion starts fresh
      await clearAllDefeats();

      // 2) Move previous champion to back of queue
      if (prevChampion && prevChampion !== id) {
        const prevIdx = playersOrderArr.indexOf(prevChampion);
        if (prevIdx !== -1) { playersOrderArr.splice(prevIdx, 1); }
        playersOrderArr.push(prevChampion);
        await savePlayersOrder();
      }

      // 3) Explicitly ensure prevChampion is not marked defeated in DB and locally
      if (prevChampion) {
        try {
          await removeDefeat(prevChampion); // removes DB node and updates local 'defeated' via listener
        } catch (e) {
          console.warn('removeDefeat(prevChampion) failed, continuing. Will also clear local state.', e);
        }
        // immediate local defensive fix so UI shows blue without waiting for DB listener
        defeated.delete(prevChampion);
        renderRoster();
      }

      // 4) Ensure the new champion is not marked defeated
      await removeDefeat(id);
      defeated.delete(id);
      renderRoster();

      // 5) Set new champion
      await set(ref(db, 'championId'), id);
      championId = id;
      triggerConfetti();
      log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);

      // 6) Re-run sweep check
      await checkForSweep('dethrone:entered-challenge');
    } else {
      // challenger lost: persist defeat and move them to back of queue
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
  championId = norm(newChampionId);
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

onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val).map(norm));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
  checkForSweep('defeats:db-snapshot');
});

// championBoard listener
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

// Connectivity check
(async function testConn(){
  try { const root = await get(ref(db, '/')); console.log('Initial DB root', root.val()); log('Connected to Firebase'); } catch (e) { console.error('Firebase connectivity test failed', e); log('Firebase connect failed: ' + e.message); }
})();
