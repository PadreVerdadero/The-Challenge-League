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

// Rendering and listeners omitted here for brevity — use the same render and listener logic you already have
// (renderChampion, renderRoster, renderChallengeSection, openChallengeModal, submitChallengeForm, Firebase onValue listeners, etc.)
// Paste your existing rendering/listener functions from your working app.js under this point, unchanged.

document.addEventListener('DOMContentLoaded', () => {
  // call initial render functions that exist in your app.js
  try { renderChampion(); renderRoster(); renderChallengeSection(); renderMatchHistory(); renderChampionBoard(); } catch(e){ console.warn('initial renders failed', e); }
});
