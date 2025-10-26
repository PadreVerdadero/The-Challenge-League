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

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ----- helpers -----
async function persistDefeat(id) {
  try { await set(ref(db, `defeats/${id}`), true); console.log('persistDefeat saved for', id); }
  catch(e){ console.error('persistDefeat failed for', id, e); }
}
async function removeDefeat(id) {
  try { await remove(ref(db, `defeats/${id}`)); console.log('removeDefeat removed for', id); }
  catch(e){ console.error('removeDefeat failed for', id, e); }
}
async function clearAllDefeats() {
  try { await remove(ref(db, 'defeats')); console.log('clearAllDefeats removed /defeats'); }
  catch(e){ console.error('clearAllDefeats failed', e); }
}
async function savePlayersOrder() {
  try {
    const obj = {};
    playersOrderArr.forEach((id, idx) => obj[idx] = id);
    await set(ref(db, 'playersOrder'), obj);
    console.log('playersOrder saved', playersOrderArr);
  } catch(e){ console.error('savePlayersOrder failed', e); }
}
async function writeMatch(match) {
  try {
    const mRef = push(ref(db, 'matches')); await set(mRef, match); console.log('match written', match);
  } catch(e){ console.error('writeMatch failed', e); }
}
async function addHistoricalChampion(champId, champName) {
  try { const entry = { id: champId, name: champName, timestamp: Date.now() }; const hRef = push(ref(db, 'historicalChampions')); await set(hRef, entry); console.log('Added historical champion', entry); }
  catch(e){ console.error('addHistoricalChampion failed', e); }
}

// ----- timer -----
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
async function setTimerEnd(msTimestamp) { try { await set(ref(db, 'timer/endTimestamp'), msTimestamp); console.log('Timer end set to', msTimestamp); } catch(e){ console.error('setTimerEnd failed', e); } }
async function startTimerOneWeek() { const end = Date.now() + WEEK_MS; await setTimerEnd(end); }
function clearLocalInterval() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }
function startLocalCountdown() { clearLocalInterval(); updateTimerDisplay(); timerInterval = setInterval(updateTimerDisplay, 1000); }
function formatDuration(ms) { if (ms <= 0) return '00:00:00:00'; const sec = Math.floor(ms/1000); const days = Math.floor(sec/86400); const hrs = Math.floor((sec%86400)/3600); const mins = Math.floor((sec%3600)/60); const s = sec%60; return `${String(days).padStart(2,'0')}:${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function updateTimerDisplay() {
  const el = $('timer-display');
  if (!timerEnd) { el.textContent = 'No active challenge'; el.classList.remove('expired'); return; }
  const remaining = timerEnd - Date.now();
  if (remaining > 0) { el.textContent = `Time left: ${formatDuration(remaining)}`; el.classList.remove('expired'); }
  else {
    el.textContent = `Time left: 00:00:00:00 — expired`; el.classList.add('expired');
    if (!processingExpiry) { processingExpiry = true; handleTimerExpiry().finally(()=>{ processingExpiry = false; }); }
  }
}

// ----- modal handling -----
const modal = $('new-champion-modal');
const modalChampionSelect = $('modal-champion-select');
const modalOrderText = $('modal-order-text');
const modalSubmit = $('modal-submit');
const modalCancel = $('modal-cancel');

function openNewChampionModal() {
  // populate select with player names
  modalChampionSelect.innerHTML = '';
  Object.entries(players).forEach(([id,p]) => {
    const opt = document.createElement('option'); opt.value = id; opt.textContent = p.name;
    modalChampionSelect.appendChild(opt);
  });
  // prefill textarea with current order (names except chosen default will be replaced)
  const visible = playersOrderArr.filter(id => id !== modalChampionSelect.value && players[id]);
  modalOrderText.value = visible.map(id => players[id]?.name || '').join(', ');
  modal.classList.remove('hidden');
}
function closeNewChampionModal() { modal.classList.add('hidden'); }

// Modal submit handler
modalSubmit.addEventListener('click', async () => {
  const newChampionId = modalChampionSelect.value;
  const orderText = modalOrderText.value || '';
  const names = orderText.split(',').map(s => s.trim()).filter(Boolean);
  // Map names to ids in the order given
  const nameToId = Object.fromEntries(Object.entries(players).map(([id,p])=>[p.name, id]));
  const newOrderIds = [];
  names.forEach(n => { if (nameToId[n] && nameToId[n] !== newChampionId) newOrderIds.push(nameToId[n]); });
  // Append any remaining players not in list (excluding new champion)
  Object.keys(players).forEach(id => { if (id !== newChampionId && !newOrderIds.includes(id)) newOrderIds.push(id); });

  // Persist new order and champion, clear defeats except keep dethroned player (handled earlier)
  playersOrderArr = newOrderIds;
  await savePlayersOrder();
  // clear defeats entirely then remove defeat for new champion
  await clearAllDefeats();
  await removeDefeat(newChampionId);
  await set(ref(db, 'championId'), newChampionId);

  closeNewChampionModal();
});

// Modal cancel
modalCancel.addEventListener('click', () => {
  closeNewChampionModal();
});

// ----- expiry behaviour -----
async function handleTimerExpiry() {
  console.log('Timer expired — processing penalty');
  const firstId = playersOrderArr.find(id => id !== championId && players[id]);
  if (!firstId) { console.log('No eligible roster member to penalize'); return; }

  // Mark them defeated and move to end
  await persistDefeat(firstId);
  const idx = playersOrderArr.indexOf(firstId);
  if (idx !== -1) { playersOrderArr.splice(idx,1); playersOrderArr.push(firstId); await savePlayersOrder(); }
  else { playersOrderArr.push(firstId); await savePlayersOrder(); }

  // Record synthetic match
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

  // Check sweep
  const visibleIds = playersOrderArr.filter(id => id !== championId && players[id]);
  const allDefeated = visibleIds.length > 0 && visibleIds.every(id => defeated.has(id));
  if (allDefeated) {
    // Congratulate champion and add historical record
    const champName = players[championId]?.name || 'Champion';
    alert(`Congratulations ${champName}! All challengers are defeated.`);
    await addHistoricalChampion(championId, champName);

    // Open modal to assign new champion and order instead of prompts
    openNewChampionModal();
    // restart timer will be handled when new champion is set via modal
  } else {
    // Restart timer automatically for next week
    await startTimerOneWeek();
  }
}

// ----- rendering -----
function renderChampion() {
  const champ = players[championId];
  $('champion-card').innerHTML = champ
    ? `<h2>Champion</h2><div class="champ-name">👑 ${escapeHtml(champ.name)}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

function renderRoster() {
  const roster = $('roster');
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
  const list = $('match-list'); list.innerHTML = '';
  matches.slice().reverse().forEach(m => { const time = new Date(m.timestamp).toLocaleString(); const div = document.createElement('div'); div.textContent = `🏁 ${m.challengerName} vs ${m.championName} — Winner: ${m.winnerName} (${time})`; list.appendChild(div); });
}

function renderHistoricalChamps(arr) {
  const el = $('historical-list'); el.innerHTML = '';
  arr.forEach(entry => { const d = new Date(entry.timestamp).toLocaleString(); const div = document.createElement('div'); div.textContent = `${entry.name} — ${d}`; el.appendChild(div); });
}

// ----- challenge flow -----
async function handleRosterClick(id) {
  const p = players[id]; if (!p) return;
  // restart timer each time a challenge begins
  await startTimerOneWeek();

  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id); log(`Champion set to ${p.name}`); renderChampion();
    }
    return;
  }

  const desc = prompt(`Describe the challenge between ${p.name} and ${players[championId].name}:`);
  if (desc === null) return;
  const winnerName = prompt(`Who won? Type exactly: "${p.name}" or "${players[championId].name}"`);
  if (winnerName === null) return;

  const winnerId = (winnerName === p.name) ? id : championId;
  const winnerDisplay = (winnerName === p.name) ? p.name : players[championId].name;
  const match = { challengerId: id, challengerName: p.name, championId, championName: players[championId].name, winnerId, winnerName: winnerDisplay, description: desc, timestamp: Date.now() };

  try {
    await writeMatch(match);

    if (winnerId === id) {
      // Challenger won: dethrone previous champion
      const prevChampion = championId;
      // CLEAR all defeats first (everyone turns blue)
      await clearAllDefeats();
      // persist defeat for previous champion only (old champion becomes red)
      if (prevChampion && prevChampion !== id) {
        await persistDefeat(prevChampion);
      }
      // move previous champion to end of order
      if (prevChampion) {
        const prevIdx = playersOrderArr.indexOf(prevChampion);
        if (prevIdx !== -1) { playersOrderArr.splice(prevIdx,1); playersOrderArr.push(prevChampion); }
        else playersOrderArr.push(prevChampion);
        await savePlayersOrder();
      }
      // remove defeat flag for the new champion
      await removeDefeat(id);
      // set new champion
      await set(ref(db, 'championId'), id);
      triggerConfetti();
      log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
    } else {
      // Challenger lost: persist defeat and move them to bottom
      await persistDefeat(id);
      const idx = playersOrderArr.indexOf(id);
      if (idx !== -1) { playersOrderArr.splice(idx,1); playersOrderArr.push(id); }
      else playersOrderArr.push(id);
      await savePlayersOrder();
      log(`${p.name} lost to ${players[championId].name}`);
    }

    // ensure id present in order
    if (!playersOrderArr.includes(id)) { playersOrderArr.push(id); await savePlayersOrder(); }

    renderChampion(); renderRoster(); renderMatchHistory();
  } catch(err) { console.error('Error recording match', err); log('Error saving match: ' + err.message); }
}

// ----- confetti -----
function triggerConfetti() { const canvas = $('confetti-canvas'); if (!canvas) return; const ctx = canvas.getContext('2d'); canvas.width = innerWidth; canvas.height = innerHeight; const parts = []; const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93']; for (let i=0;i<100;i++) parts.push({x:Math.random()*canvas.width,y:-50,vx:(Math.random()-0.5)*6,vy:2+Math.random()*5,size:6+Math.random()*8,c:colors[Math.floor(Math.random()*colors.length)]}); let f=0; function d(){ f++; ctx.clearRect(0,0,canvas.width,canvas.height); parts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=0.06;ctx.fillStyle=p.c;ctx.fillRect(p.x,p.y,p.size,p.size*0.6)}); if (f<140) requestAnimationFrame(d); else ctx.clearRect(0,0,canvas.width,canvas.height);} d(); }

// ----- add player -----
async function addPlayer() {
  const input = $('new-player-name'); const name = input.value.trim(); if (!name) { log('Enter a name'); return; }
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try {
    await set(ref(db, `players/${id}`), { name });
    input.value = '';
    if (!playersOrderArr.includes(id)) { playersOrderArr.push(id); await savePlayersOrder(); }
    log(`Added ${name}`);
  } catch (err) { console.error('Add player failed', err); log('Add player failed: ' + err.message); }
}
$('add-player-button').addEventListener('click', addPlayer);

// ----- Firebase listeners -----
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  console.log('players snapshot', players);
  // ensure order includes new players
  const allIds = Object.keys(players);
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) { playersOrderArr = []; console.log('playersOrder empty in DB'); }
  else { playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id})).sort((a,b)=>a.idx-b.idx).map(e=>e.id); console.log('playersOrder loaded', playersOrderArr); }
  const allIds = Object.keys(players || {});
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val(); const prev = championId; championId = newChampionId; console.log('champion snapshot', { prev, newChampionId });
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderChampion(); renderRoster();
});

onValue(ref(db, 'matches'), snap => {
  const val = snap.val(); matches = val ? Object.values(val) : []; console.log('matches snapshot count', matches.length); renderMatchHistory();
});

onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {}; defeated = new Set(Object.keys(val)); console.log('defeats snapshot loaded', Array.from(defeated)); if (championId && defeated.has(championId)) defeated.delete(championId); renderRoster();
});

onValue(ref(db, 'timer/endTimestamp'), snap => {
  const val = snap.val(); timerEnd = val || null; console.log('timer/endTimestamp', timerEnd); if (timerEnd) startLocalCountdown(); else { clearLocalInterval(); updateTimerDisplay(); }
});

onValue(ref(db, 'historicalChampions'), snap => {
  const val = snap.val() || {}; const arr = val ? Object.values(val) : []; renderHistoricalChamps(arr);
});

// connectivity test
(async function testConn(){
  try { const root = await get(ref(db, '/')); console.log('Initial DB root', root.val()); log('Connected to Firebase'); } catch(e) { console.error('Firebase connectivity test failed', e); log('Firebase connect failed: ' + e.message); }
})();
