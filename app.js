import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  get,
  remove,
  update
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
let timerEnd = null; // local mirror of /timer/endTimestamp
let timerInterval = null;
let processingExpiry = false; // avoid double-processing expiry

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ----- helpers for defeats/order/matches/history -----
async function persistDefeat(id) {
  try {
    await set(ref(db, `defeats/${id}`), true);
    console.log('persistDefeat saved for', id);
  } catch (e) { console.error('persistDefeat failed for', id, e); }
}
async function removeDefeat(id) {
  try {
    await remove(ref(db, `defeats/${id}`));
    console.log('removeDefeat removed for', id);
  } catch (e) { console.error('removeDefeat failed for', id, e); }
}
async function savePlayersOrder() {
  try {
    const obj = {};
    playersOrderArr.forEach((id, idx) => obj[idx] = id);
    await set(ref(db, 'playersOrder'), obj);
    console.log('playersOrder saved', playersOrderArr);
  } catch (e) { console.error('savePlayersOrder failed', e); }
}
async function addHistoricalChampion(champId, champName) {
  try {
    const entry = { id: champId, name: champName, timestamp: Date.now() };
    const hRef = push(ref(db, 'historicalChampions'));
    await set(hRef, entry);
    console.log('Added historical champion', entry);
  } catch (e) { console.error('addHistoricalChampion failed', e); }
}
async function writeMatch(match) {
  try {
    const mRef = push(ref(db, 'matches'));
    await set(mRef, match);
    console.log('match written', match);
  } catch (e) { console.error('writeMatch failed', e); }
}

// ----- timer helpers -----
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
async function setTimerEnd(msTimestamp) {
  try {
    await set(ref(db, 'timer/endTimestamp'), msTimestamp);
    console.log('Timer end set to', msTimestamp);
  } catch (e) { console.error('setTimerEnd failed', e); }
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
  updateTimerDisplay(); // immediate update
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
  if (!timerEnd) { el.textContent = 'No active challenge'; el.classList.remove('expired'); return; }
  const remaining = timerEnd - Date.now();
  if (remaining > 0) {
    el.textContent = `Time left: ${formatDuration(remaining)}`;
    el.classList.remove('expired');
  } else {
    el.textContent = `Time left: 00:00:00:00 — expired`;
    el.classList.add('expired');
    // process expiry once
    if (!processingExpiry) {
      processingExpiry = true;
      handleTimerExpiry().finally(()=> { processingExpiry = false; });
    }
  }
}

// ----- expiry behavior -----
async function handleTimerExpiry() {
  console.log('Timer expired, processing penalty');
  // Determine first visible roster player (first in playersOrderArr that is not champion)
  const firstId = playersOrderArr.find(id => id !== championId && players[id]);
  if (!firstId) {
    console.log('No eligible roster member to penalize');
    return;
  }

  // Mark them defeated and move to end of order
  await persistDefeat(firstId);

  const idx = playersOrderArr.indexOf(firstId);
  if (idx !== -1) {
    playersOrderArr.splice(idx, 1);
    playersOrderArr.push(firstId);
    await savePlayersOrder();
    console.log('Penalized player moved to end:', firstId);
  } else {
    playersOrderArr.push(firstId);
    await savePlayersOrder();
  }

  // Write a synthetic match to record the auto-loss (optional, helpful for history)
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

  // Re-render so defeated styling and order update
  renderRoster();

  // If everyone in visible roster is defeated, celebrate champion and prompt to assign new champion
  const visibleIds = playersOrderArr.filter(id => id !== championId && players[id]);
  const allDefeated = visibleIds.length > 0 && visibleIds.every(id => defeated.has(id));
  if (allDefeated) {
    // Congratulate champion, add to historical champions
    const champName = players[championId]?.name || 'Champion';
    alert(`Congratulations ${champName}! All challengers are defeated.`);
    await addHistoricalChampion(championId, champName);

    // Prompt to set new champion
    const newChampionName = prompt('Who is the new champion? Type exact name of a player from the roster:');
    if (!newChampionName) {
      console.log('No new champion assigned after sweep.');
      return;
    }
    // find id for name
    const pair = Object.entries(players).find(([id,p]) => p.name === newChampionName);
    if (!pair) {
      alert('Name not found in roster. No champion changed.');
      return;
    }
    const newChampionId = pair[0];

    // Prompt for new order of everyone else (comma-separated names)
    const otherIds = Object.keys(players).filter(id => id !== newChampionId);
    const otherNames = otherIds.map(id => players[id].name);
    const supplied = prompt(`Enter the order of the other players (comma-separated), using names from this list:\n${otherNames.join(', ')}`);
    if (!supplied) {
      // fallback: keep existing order but ensure new champion removed from front
      await set(ref(db, 'championId'), newChampionId);
      // ensure new champion has defeat cleared
      await removeDefeat(newChampionId);
      return;
    }
    // parse names into ids, append any missing at the end
    const names = supplied.split(',').map(s => s.trim()).filter(Boolean);
    const newOrder = [];
    names.forEach(n => {
      const found = Object.entries(players).find(([id,p]) => p.name === n);
      if (found) newOrder.push(found[0]);
    });
    // append missing players not included in supplied order (except champion)
    const remaining = Object.keys(players).filter(id => id !== newChampionId && !newOrder.includes(id));
    newOrder.push(...remaining);
    playersOrderArr = newOrder;
    await savePlayersOrder();

    // clear defeat flag for new champion
    await removeDefeat(newChampionId);
    // set champion in DB
    await set(ref(db, 'championId'), newChampionId);

    // restart timer for next week
    await startTimerOneWeek();
    alert(`New champion set: ${players[newChampionId].name}`);
  } else {
    // If sweep didn't occur, restart timer for next week automatically
    await startTimerOneWeek();
  }
}

// ----- rendering functions -----
function renderChampion() {
  const champ = players[championId];
  $('champion-card').innerHTML = champ
    ? `<h2>Champion</h2><div class="champ-name">👑 ${escapeHtml(champ.name)}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

function renderRoster() {
  const roster = $('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  if (!players || Object.keys(players).length === 0) {
    roster.innerHTML += '<p>No players yet</p>';
    return;
  }

  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);

  visibleIds.forEach((id, position) => {
    const p = players[id];
    if (!p) return;

    const row = document.createElement('div');
    row.className = 'roster-row';

    const handle = document.createElement('div');
    handle.className = 'order-handle';
    handle.textContent = '☰';

    const nameBtn = document.createElement('button');
    nameBtn.className = 'roster-name';
    nameBtn.textContent = p.name;
    nameBtn.dataset.id = id;
    if (defeated.has(id)) nameBtn.classList.add('lost'); else nameBtn.classList.remove('lost');
    nameBtn.addEventListener('click', () => handleRosterClick(id));

    row.appendChild(handle);
    row.appendChild(nameBtn);

    if (visibleIds.length > 1) {
      const up = document.createElement('button');
      up.className = 'move-btn';
      up.textContent = '↑';
      up.disabled = (position === 0);
      up.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = playersOrderArr.indexOf(id);
        if (idx > 0) {
          [playersOrderArr[idx - 1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx - 1]];
          await savePlayersOrder();
          renderRoster();
        }
      });

      const down = document.createElement('button');
      down.className = 'move-btn';
      down.textContent = '↓';
      down.disabled = (position === visibleIds.length - 1);
      down.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = playersOrderArr.indexOf(id);
        if (idx >= 0 && idx < playersOrderArr.length - 1) {
          [playersOrderArr[idx + 1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx + 1]];
          await savePlayersOrder();
          renderRoster();
        }
      });

      row.appendChild(up);
      row.appendChild(down);
    }

    roster.appendChild(row);
  });
}

function renderMatchHistory() {
  const list = $('match-list');
  list.innerHTML = '';
  matches.slice().reverse().forEach(m => {
    const time = new Date(m.timestamp).toLocaleString();
    const div = document.createElement('div');
    div.textContent = `🏁 ${m.challengerName} vs ${m.championName} — Winner: ${m.winnerName} (${time})`;
    list.appendChild(div);
  });
}

function renderHistoricalChamps(snapshotArray) {
  const el = $('historical-list');
  el.innerHTML = '';
  snapshotArray.forEach(entry => {
    const d = new Date(entry.timestamp).toLocaleString();
    const div = document.createElement('div');
    div.textContent = `${entry.name} — ${d}`;
    el.appendChild(div);
  });
}

// ----- challenge flow -----
async function handleRosterClick(id) {
  const p = players[id];
  if (!p) return;

  // restart timer when challenge begins
  await startTimerOneWeek();

  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id);
      log(`Champion set to ${p.name}`);
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
    description: desc,
    timestamp: Date.now()
  };

  try {
    await writeMatch(match);

    if (winnerId === id) {
      // challenger won: dethrone previous champion
      const prevChampion = championId;
      if (prevChampion && prevChampion !== id) {
        // mark previous champion defeated and move them to end
        await persistDefeat(prevChampion);
        const prevIdx = playersOrderArr.indexOf(prevChampion);
        if (prevIdx !== -1) {
          playersOrderArr.splice(prevIdx, 1);
          playersOrderArr.push(prevChampion);
          await savePlayersOrder();
        } else {
          playersOrderArr.push(prevChampion);
          await savePlayersOrder();
        }
      }

      // remove defeat for new champion and set championId
      await removeDefeat(id);
      await set(ref(db, 'championId'), id);

      triggerConfetti();
      log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
    } else {
      // challenger lost: persist defeat and move them to bottom
      await persistDefeat(id);
      const idx = playersOrderArr.indexOf(id);
      if (idx !== -1) {
        playersOrderArr.splice(idx, 1);
        playersOrderArr.push(id);
        await savePlayersOrder();
      } else {
        playersOrderArr.push(id);
        await savePlayersOrder();
      }
      log(`${p.name} lost to ${players[championId].name}`);
    }

    // ensure new player exists in order
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
    parts.push({ x: Math.random()*canvas.width, y:-50-Math.random()*100, vx:(Math.random()-0.5)*6, vy:2+Math.random()*5, size:6+Math.random()*8, c: colors[Math.floor(Math.random()*colors.length)] });
  }
  let frame = 0;
  function draw() {
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06;
      ctx.fillStyle = p.c; ctx.fillRect(p.x,p.y,p.size,p.size*0.6);
    });
    if (frame < 140) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// ----- add player -----
async function addPlayer() {
  const input = $('new-player-name');
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
$('add-player-button').addEventListener('click', addPlayer);

// ----- Firebase listeners -----

// players
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  console.log('players snapshot', players);
  // append missing players to order
  const allIds = Object.keys(players);
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

// playersOrder
onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) { playersOrderArr = []; console.log('playersOrder empty in DB'); }
  else {
    playersOrderArr = Object.entries(val).map(([k,id]) => ({ idx: Number(k), id })).sort((a,b)=>a.idx-b.idx).map(e=>e.id);
    console.log('playersOrder loaded', playersOrderArr);
  }
  // ensure all players present
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

// matches
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

// timer
onValue(ref(db, 'timer/endTimestamp'), snap => {
  const val = snap.val();
  timerEnd = val || null;
  console.log('timer/endTimestamp', timerEnd);
  if (timerEnd) startLocalCountdown(); else { clearLocalInterval(); updateTimerDisplay(); }
});

// historical champions list
onValue(ref(db, 'historicalChampions'), snap => {
  const val = snap.val() || {};
  // convert to array
  const arr = val ? Object.values(val) : [];
  renderHistoricalChamps(arr);
});

// Connectivity check
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
