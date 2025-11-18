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

// initial load gating nodes
const initialNodes = ['players','playersOrder','championId','defeats','championBoard','timer/endTimestamp'];
const initialLoaded = new Set();
let initialDataLoaded = false;

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function norm(id){ return id == null ? id : String(id); }

function markInitialNodeLoaded(name) {
  if (initialDataLoaded) return;
  initialLoaded.add(name);
  console.log('[init] node loaded:', name, initialLoaded.size, '/', initialNodes.length);
  if (initialLoaded.size >= initialNodes.length) {
    initialDataLoaded = true;
    console.log('[init] initialDataLoaded = true');
  }
}

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
    const last = await getLastSweep();
    if (last && last.id === champId) {
      if ((now - (last.timestamp || 0)) < CHAMPION_BOARD_DEBOUNCE_MS) {
        console.log('addChampionBoardEntry: skipping because sweep/last already records this champion recently', champId);
        return;
      }
    }

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

    const entry = { id: champId, name: champName, timestamp: now };
    const bRef = push(ref(db, 'championBoard'));
    await set(bRef, entry);
    console.log('Champion Board entry added', entry);
    await setLastSweep(champId, now);
  } catch (e) {
    console.error('addChampionBoardEntry failed', e);
  }
}

// ---------------------- Sweep checker ----------------------
async function checkForSweep(triggerContext = 'unknown') {
  try {
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

      renderChallengeSection();
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
      renderChallengeSection();
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
      renderChallengeSection();
      renderChampion();
      renderRoster();
      renderMatchHistory();
    });
    area.appendChild(btn);
  }
}

// New: render the Challenge section (Next Up + timer + button)
function renderChallengeSection() {
  const el = $('challenge-section');
  if (!el) return;

  // Find the Next Up: first in order that is not the champion
  const ordered = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = ordered.find(id => id && id !== championId && players[id]) || null;
  const nextUpName = nextUpId ? (players[nextUpId]?.name || 'Unknown') : 'No one';

  el.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = 'Challenge';
  el.appendChild(title);

  const nextRow = document.createElement('div');
  nextRow.className = 'next-up-row';
  nextRow.style.display = 'flex';
  nextRow.style.alignItems = 'center';
  nextRow.style.gap = '12px';

  const nameWrap = document.createElement('div');
  nameWrap.className = 'next-up-name';
  nameWrap.textContent = nextUpName;
  nameWrap.style.fontSize = '30px';
  nameWrap.style.fontWeight = '800';
  nameWrap.style.color = nextUpId ? '#4da6ff' : 'silver';
  nameWrap.style.display = 'inline-block';

  nextRow.appendChild(nameWrap);

  if (nextUpId) {
    const badge = document.createElement('span');
    badge.className = 'challenger-badge';
    badge.textContent = 'CHALLENGER';
    badge.style.fontSize = '12px';
    badge.style.marginLeft = '6px';
    nextRow.appendChild(badge);
  }

  const btn = document.createElement('button');
  btn.textContent = 'Record Challenge';
  btn.title = 'Record a challenge for the Next Up player';
  btn.disabled = !nextUpId || !championId;
  btn.addEventListener('click', () => {
    if (!nextUpId) return;
    openChallengeModal(nextUpId);
  });
  nextRow.appendChild(btn);

  el.appendChild(nextRow);

  const timerWrap = document.createElement('div');
  timerWrap.className = 'next-up-timer';
  timerWrap.style.marginTop = '8px';
  const timerText = document.createElement('div');
  timerText.id = 'timer-display';
  timerText.style.fontSize = '14px';
  timerText.style.opacity = '0.95';
  timerWrap.appendChild(timerText);
  el.appendChild(timerWrap);

  updateTimerDisplay();
}

// Modify roster rendering so clicking names does NOT trigger prompts
function renderRoster() {
  const roster = $('roster');
  if (!roster) return;
  roster.innerHTML = '<h2>Roster</h2>';
  if (!players || Object.keys(players).length === 0) { roster.innerHTML += '<p>No players yet</p>'; return; }

  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = orderedIds.find(id => id && id !== championId && players[id]) || null;
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);

  visibleIds.forEach((id, position) => {
    const p = players[id];
    if (!p) return;

    const row = document.createElement('div'); row.className = 'roster-row';
    const handle = document.createElement('div'); handle.className = 'order-handle'; handle.textContent = '☰';
    const nameBtn = document.createElement('button'); nameBtn.className = 'roster-name'; nameBtn.textContent = p.name; nameBtn.dataset.id = id;

    nameBtn.disabled = true;
    nameBtn.title = 'Use the Challenge panel to record a challenge for Next Up';

    if (defeated.has(id)) nameBtn.classList.add('lost'); else nameBtn.classList.remove('lost');

    // mark Next Up visually in roster
    if (id === nextUpId) {
      nameBtn.classList.add('challenger');
      const smallBadge = document.createElement('span');
      smallBadge.className = 'challenger-badge';
      smallBadge.textContent = 'CHALLENGER';
      smallBadge.style.fontSize = '10px';
      smallBadge.style.marginLeft = '8px';
      row.append(handle, nameBtn, smallBadge);
    } else {
      row.append(handle, nameBtn);
    }

    const orderEditable = (isPendingState || !championId);

    if (visibleIds.length > 1) {
      const up = document.createElement('button'); up.className = 'move-btn'; up.textContent = '↑'; up.disabled = (position === 0 || !orderEditable);
      up.addEventListener('click', async (e) => { e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx > 0) { [playersOrderArr[idx-1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx-1]]; await savePlayersOrder(); renderRoster(); renderChallengeSection(); } });
      const down = document.createElement('button'); down.className = 'move-btn'; down.textContent = '↓'; down.disabled = (position === visibleIds.length - 1 || !orderEditable);
      down.addEventListener('click', async (e) => { e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx >= 0 && idx < playersOrderArr.length - 1) { [playersOrderArr[idx+1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx+1]]; await savePlayersOrder(); renderRoster(); renderChallengeSection(); } });
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

// ---------------------- Challenge modal / entry flow ----------------------

// Creates and shows modal; modal handles description and winner selection via buttons
function openChallengeModal(challengerId) {
  const challenger = players[challengerId];
  if (!challenger || !championId) return;

  if ($('challenge-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'challenge-modal';
  modal.style.position = 'fixed';
  modal.style.left = '0';
  modal.style.top = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.background = 'rgba(0,0,0,0.45)';
  modal.style.zIndex = 10000;

  const panel = document.createElement('div');
  panel.style.background = '#0b1220';
  panel.style.padding = '16px';
  panel.style.borderRadius = '10px';
  panel.style.minWidth = '320px';
  panel.style.maxWidth = '560px';
  panel.style.boxShadow = '0 8px 30px rgba(0,0,0,0.6)';
  panel.style.color = '#e6eef8';

  const header = document.createElement('h3');
  header.textContent = `Record Challenge: ${challenger.name} vs ${players[championId].name}`;
  header.style.marginTop = '0';
  panel.appendChild(header);

  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  descLabel.style.display = 'block';
  descLabel.style.margin = '8px 0 6px';
  panel.appendChild(descLabel);

  const descArea = document.createElement('textarea');
  descArea.id = 'challenge-desc';
  descArea.rows = 4;
  descArea.style.width = '100%';
  descArea.style.boxSizing = 'border-box';
  descArea.style.background = 'rgba(255,255,255,0.02)';
  descArea.style.color = '#e6eef8';
  descArea.style.border = '1px solid rgba(255,255,255,0.04)';
  descArea.style.borderRadius = '6px';
  descArea.placeholder = 'Short description of the match...';
  panel.appendChild(descArea);

  const buttonsRow = document.createElement('div');
  buttonsRow.style.display = 'flex';
  buttonsRow.style.gap = '8px';
  buttonsRow.style.marginTop = '12px';
  buttonsRow.style.justifyContent = 'space-between';
  buttonsRow.style.alignItems = 'center';

  const leftCol = document.createElement('div');
  leftCol.style.display = 'flex';
  leftCol.style.gap = '8px';

  const nextUpBtn = document.createElement('button');
  nextUpBtn.textContent = `${challenger.name} wins`;
  nextUpBtn.style.background = '#2b8a3e';
  nextUpBtn.style.color = '#fff';
  nextUpBtn.style.padding = '8px 12px';
  nextUpBtn.style.border = 'none';
  nextUpBtn.style.borderRadius = '6px';
  nextUpBtn.addEventListener('click', async () => {
    const desc = descArea.value || '';
    await submitChallengeForm(challengerId, challenger.name, desc, challengerId);
    closeChallengeModal();
  });

  const champBtn = document.createElement('button');
  champBtn.textContent = `${players[championId].name} wins`;
  champBtn.style.background = '#1f6feb';
  champBtn.style.color = '#fff';
  champBtn.style.padding = '8px 12px';
  champBtn.style.border = 'none';
  champBtn.style.borderRadius = '6px';
  champBtn.addEventListener('click', async () => {
    const desc = descArea.value || '';
    await submitChallengeForm(challengerId, challenger.name, desc, championId);
    closeChallengeModal();
  });

  leftCol.appendChild(nextUpBtn);
  leftCol.appendChild(champBtn);

  const rightCol = document.createElement('div');
  rightCol.style.display = 'flex';
  rightCol.style.gap = '8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 12px';
  cancelBtn.style.border = '1px solid rgba(255,255,255,0.06)';
  cancelBtn.style.borderRadius = '6px';
  cancelBtn.style.background = 'transparent';
  cancelBtn.style.color = '#e6eef8';
  cancelBtn.addEventListener('click', () => {
    closeChallengeModal();
  });

  rightCol.appendChild(cancelBtn);

  buttonsRow.appendChild(leftCol);
  buttonsRow.appendChild(rightCol);

  panel.appendChild(buttonsRow);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  function closeChallengeModal() {
    const m = $('challenge-modal');
    if (m) m.remove();
  }
}

// Submits the match using the same logic as old prompt flow
async function submitChallengeForm(challengerId, challengerName, description, winnerId) {
  const match = {
    challengerId,
    challengerName,
    championId,
    championName: players[championId]?.name || 'Champion',
    winnerId,
    winnerName: winnerId === challengerId ? challengerName : players[championId]?.name || 'Champion',
    description: description || '',
    timestamp: Date.now()
  };

  try {
    await writeMatch(match);
    await startTimerOneWeek(true);

    if (winnerId === challengerId) {
      const prevChampion = championId;
      suppressDefeatsListener = true;
      try {
        await remove(ref(db, 'defeats'));
        defeated = new Set();
        renderRoster();

        if (prevChampion && prevChampion !== challengerId) {
          const prevIdx = playersOrderArr.indexOf(prevChampion);
          if (prevIdx !== -1) { playersOrderArr.splice(prevIdx, 1); }
          playersOrderArr.push(prevChampion);
          await savePlayersOrder();
        }

        await set(ref(db, 'championId'), challengerId);
        championId = challengerId;

        if (prevChampion) {
          try { await remove(ref(db, `defeats/${prevChampion}`)); } catch (e) { console.warn('remove prev defeat failed', e); }
          defeated.delete(prevChampion);
        }

        try { await remove(ref(db, `defeats/${challengerId}`)); } catch(e){ console.warn('clear new champ defeat failed', e); }
        defeated.delete(challengerId);

        triggerConfetti();
        log(`${players[challengerId].name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
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
      await persistDefeat(challengerId);
      const idx = playersOrderArr.indexOf(challengerId);
      if (idx !== -1) { playersOrderArr.splice(idx,1); playersOrderArr.push(challengerId); } else playersOrderArr.push(challengerId);
      await savePlayersOrder();
      log(`${players[challengerId].name} lost to ${players[championId].name}`);
    }

    if (!playersOrderArr.includes(challengerId)) { playersOrderArr.push(challengerId); await savePlayersOrder(); }

    renderChampion();
    renderRoster();
    renderMatchHistory();
    renderChallengeSection();
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
    renderChallengeSection();
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
  renderChallengeSection();
  markInitialNodeLoaded('players');
});

onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) playersOrderArr = [];
  else playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id})).sort((a,b)=>a.idx-b.idx).map(e=>e.id);
  const allIds = Object.keys(players || {});
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
  renderChallengeSection();
  markInitialNodeLoaded('playersOrder');
});

onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val();
  const normalized = norm(newChampionId);
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
  renderChallengeSection();
  markInitialNodeLoaded('championId');
});

onValue(ref(db, 'matches'), snap => {
  const val = snap.val() || {};
  matches = Object.values(val);
  renderMatchHistory();
});

onValue(ref(db, 'defeats'), async snap => {
  if (suppressDefeatsListener) {
    console.log('[defeats listener] suppressed');
    return;
  }
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val).map(norm));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
  renderChallengeSection();
  markInitialNodeLoaded('defeats');
  checkForSweep('defeats:db-snapshot');
});

onValue(ref(db, 'championBoard'), snap => {
  const val = snap.val() || {};
  championBoard = Object.values(val);
  renderChampionBoard();
  markInitialNodeLoaded('championBoard');
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
  renderChallengeSection();
  markInitialNodeLoaded('timer/endTimestamp');
});

// Connectivity check
(async function testConn(){
  try { const root = await get(ref(db, '/')); console.log('Initial DB root', root.val()); log('Connected to Firebase'); } catch (e) { console.error('Firebase connectivity test failed', e); log('Firebase connect failed: ' + e.message); }
})();

// Wire initial UI mounts
document.addEventListener('DOMContentLoaded', () => {
  renderChampion();
  renderRoster();
  renderChallengeSection();
  renderMatchHistory();
  renderChampionBoard();
});
