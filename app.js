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

// === Your Firebase config (specific to your project) ===
const firebaseConfig = {
  apiKey: "AIzaSyBSCn8-SpgtrJz3SRBWfiLL-WXylProWqU",
  authDomain: "challengeleague-ec503.firebaseapp.com",
  databaseURL: "https://challengeleague-ec503-default-rtdb.firebaseio.com",
  projectId: "challengeleague-ec503",
  storageBucket: "challengeleague-ec503.appspot.com",
  messagingSenderId: "120184354429",
  appId: "1:120184354429:web:e28ea3cd8c177b3cd72314"
};
// ======================================================

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
let isPendingState = false;

const $ = id => document.getElementById(id);
function log(msg){ const el = $('add-player-log'); if(el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }
function norm(id){ return id == null ? id : String(id); }

// ---- Timer utilities ----
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function formatDuration(ms){
  if (ms <= 0) return '00:00:00:00';
  const sec = Math.floor(ms/1000);
  const days = Math.floor(sec/86400);
  const hrs = Math.floor((sec%86400)/3600);
  const mins = Math.floor((sec%3600)/60);
  const s = sec%60;
  return `${String(days).padStart(2,'0')}:${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTimerDisplay(){
  const el = $('timer-display');
  if(!el) return;
  if (isPendingState || !championId) { el.textContent = 'New group challenge pending'; el.classList.add('pending'); el.classList.remove('expired'); return; }
  if (!timerEnd) { el.textContent = 'No active challenge'; el.classList.remove('expired'); el.classList.remove('pending'); return; }
  const remaining = timerEnd - Date.now();
  if (remaining > 0) {
    el.textContent = `Time left: ${formatDuration(remaining)}`;
    el.classList.remove('expired'); el.classList.remove('pending');
  } else {
    el.textContent = `Time left: 00:00:00:00 — expired`;
    el.classList.add('expired'); el.classList.remove('pending');
  }
}

function startLocalCountdown(){
  if (timerInterval) clearInterval(timerInterval);
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

// ---- Confetti / celebration ----
function triggerConfetti(){
  const canvas = $('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const parts = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<80;i++){
    parts.push({x: Math.random()*canvas.width, y: -50 - Math.random()*200, vx:(Math.random()-0.5)*6, vy:2+Math.random()*6, size:6+Math.random()*8, c: colors[Math.floor(Math.random()*colors.length)], life:0});
  }
  let frame = 0;
  function draw(){
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p=>{
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.life++;
      ctx.fillStyle = p.c; ctx.fillRect(p.x,p.y,p.size,p.size*0.6);
    });
    if (frame < 120) requestAnimationFrame(draw); else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// ---- Rendering ----
function renderChampion(){
  const el = $('champion-card'); if(!el) return;
  const champ = players[championId];
  el.innerHTML = `<h2>Champion</h2>`;
  const wrap = document.createElement('div');
  if (champ) wrap.innerHTML = `<span class="champ-name">👑 ${escapeHtml(champ.name)}</span><span id="champion-actions-area"></span>`;
  else wrap.innerHTML = `<span class="champ-name no-champ">No champion yet</span><span id="champion-actions-area"></span>`;
  el.appendChild(wrap);
  renderChampionActions();
}

function renderChampionActions(){
  const area = $('champion-actions-area'); if(!area) return; area.innerHTML='';
  if (!championId){
    const btn = document.createElement('button'); btn.textContent='Lock in Order';
    btn.addEventListener('click', async ()=>{
      const ordered = playersOrderArr.length ? playersOrderArr : Object.keys(players).sort();
      const pick = ordered.find(id=>id && players[id]) || null;
      if (!pick) return alert('No players to select as champion');
      await set(ref(db, 'championId'), pick);
      await set(ref(db, 'timer/endTimestamp'), Date.now() + WEEK_MS);
    });
    area.appendChild(btn);
  } else {
    const btn = document.createElement('button'); btn.textContent='Clear Champion';
    btn.addEventListener('click', async ()=>{ await set(ref(db, 'championId'), null); await remove(ref(db, 'timer/endTimestamp')); });
    area.appendChild(btn);
  }
}

function renderChallengeSection(){
  const el = $('challenge-section'); if(!el) return;
  el.innerHTML = `<h2>Challenge</h2>`;
  const ordered = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = ordered.find(id => id && id !== championId && players[id]) || null;
  const nextUpName = nextUpId ? (players[nextUpId]?.name || 'Unknown') : 'No one';
  const row = document.createElement('div'); row.className='next-up-row';
  const name = document.createElement('div'); name.className='next-up-name'; name.textContent = nextUpName;
  row.appendChild(name);
  if (nextUpId){
    const badge = document.createElement('span'); badge.className='challenger-badge'; badge.textContent='CHALLENGER';
    row.appendChild(badge);
  }
  const btn = document.createElement('button'); btn.textContent='Record Challenge'; btn.disabled = !nextUpId || !championId;
  btn.addEventListener('click', ()=>{ if (nextUpId) openChallengeModal(nextUpId); });
  row.appendChild(btn);
  el.appendChild(row);
  const timerWrap = document.createElement('div'); timerWrap.id='timer-display'; el.appendChild(timerWrap);
  updateTimerDisplay();
}

function renderRoster(){
  const el = $('roster'); if(!el) return;
  el.innerHTML = `<h2>Roster</h2>`;
  if (!players || Object.keys(players).length === 0){ el.innerHTML += '<p>No players yet</p>'; return; }
  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = orderedIds.find(id => id && id !== championId && players[id]) || null;
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);
  visibleIds.forEach((id, position)=>{
    const p = players[id]; if(!p) return;
    const row = document.createElement('div'); row.className='roster-row';
    const handle = document.createElement('div'); handle.className='order-handle'; handle.textContent='☰';
    const nameBtn = document.createElement('button'); nameBtn.className='roster-name'; nameBtn.textContent = p.name;
    nameBtn.dataset.id = id;
    nameBtn.classList.remove('challenger','lost');
    if (id === nextUpId) nameBtn.classList.add('challenger');
    if (defeated.has(id)) nameBtn.classList.add('lost');
    nameBtn.addEventListener('click', ()=>{ if (id === nextUpId) openChallengeModal(id); else alert(`${p.name}\n\nStatus: ${defeated.has(id) ? 'Lost this round' : 'Waiting in queue'}`); });
    row.append(handle, nameBtn);
    if (visibleIds.length > 1){
      const up = document.createElement('button'); up.className='move-btn'; up.textContent='↑'; up.disabled = (position === 0);
      up.addEventListener('click', async (e)=>{ e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx > 0){ [playersOrderArr[idx-1], playersOrderArr[idx]]=[playersOrderArr[idx], playersOrderArr[idx-1]]; await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }});
      const down = document.createElement('button'); down.className='move-btn'; down.textContent='↓'; down.disabled = (position === visibleIds.length-1);
      down.addEventListener('click', async (e)=>{ e.stopPropagation(); const idx = playersOrderArr.indexOf(id); if (idx >=0 && idx < playersOrderArr.length-1){ [playersOrderArr[idx+1], playersOrderArr[idx]]=[playersOrderArr[idx], playersOrderArr[idx+1]]; await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }});
      row.append(up, down);
    }
    el.appendChild(row);
  });
}

function renderMatchHistory(){
  const el = $('match-list'); if(!el) return;
  el.innerHTML = `<h2>Match History</h2>`;
  const sorted = matches.slice().sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
  sorted.forEach(m=>{
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
    const div = document.createElement('div');
    div.innerHTML = `🏁 <strong>${escapeHtml(m.challengerName||'Unknown')}</strong> vs <strong>${escapeHtml(m.championName||'Unknown')}</strong> — Winner: <strong>${escapeHtml(m.winnerName||'Unknown')}</strong> ${time ? `(${time})` : ''}`;
    el.appendChild(div);
    if (m.description){ const d = document.createElement('div'); d.className='match-desc'; d.textContent = m.description; el.appendChild(d); }
  });
}

function renderChampionBoard(){
  const el = $('champion-board-list'); if(!el) return;
  el.innerHTML = `<h2>Champion Board</h2>`;
  // champion board entries handled in DB listener if present
}

// ---- Modal & match submission ----
function openChallengeModal(challengerId){
  if (!championId) return;
  if ($('challenge-modal')) return;
  const challenger = players[challengerId];
  const modal = document.createElement('div'); modal.id='challenge-modal';
  modal.style.position='fixed'; modal.style.left=0; modal.style.top=0; modal.style.width='100%'; modal.style.height='100%'; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center'; modal.style.background='rgba(0,0,0,0.45)'; modal.style.zIndex=10000;
  const panel = document.createElement('div'); panel.style.background='#0b1220'; panel.style.padding='16px'; panel.style.borderRadius='10px'; panel.style.minWidth='320px'; panel.style.maxWidth='560px'; panel.style.boxShadow='0 8px 30px rgba(0,0,0,0.6)'; panel.style.color='#e6eef8';
  const header = document.createElement('h3'); header.textContent = `Record Challenge: ${challenger.name} vs ${players[championId].name}`; panel.appendChild(header);
  const desc = document.createElement('textarea'); desc.rows=4; desc.style.width='100%'; desc.placeholder='Description (optional)'; panel.appendChild(desc);
  const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.marginTop='12px';
  const challengerBtn = document.createElement('button'); challengerBtn.textContent = `${challenger.name} wins`; challengerBtn.style.background='#2b8a3e'; challengerBtn.style.color='#fff';
  challengerBtn.addEventListener('click', async ()=>{ await submitChallenge(challengerId, desc.value||'', challengerId); closeModal(); });
  const champBtn = document.createElement('button'); champBtn.textContent = `${players[championId].name} wins`; champBtn.style.background='#1f6feb'; champBtn.style.color='#fff';
  champBtn.addEventListener('click', async ()=>{ await submitChallenge(challengerId, desc.value||'', championId); closeModal(); });
  const cancel = document.createElement('button'); cancel.textContent='Cancel'; cancel.addEventListener('click', closeModal);
  row.append(challengerBtn, champBtn, cancel); panel.appendChild(row); modal.appendChild(panel); document.body.appendChild(modal);
  function closeModal(){ const m=$('challenge-modal'); if(m) m.remove(); }
}

async function submitChallenge(challengerId, description, winnerId){
  const match = {
    challengerId,
    challengerName: players[challengerId]?.name || 'Unknown',
    championId,
    championName: players[championId]?.name || 'Champion',
    winnerId,
    winnerName: winnerId === challengerId ? players[challengerId]?.name : players[championId]?.name,
    description: description || '',
    timestamp: Date.now()
  };
  try {
    const mRef = push(ref(db, 'matches'));
    await set(mRef, match);

    if (winnerId === challengerId){
      // challenger becomes champion
      await remove(ref(db, 'defeats'));
      await set(ref(db, 'championId'), challengerId);
      await set(ref(db, 'timer/endTimestamp'), Date.now() + WEEK_MS);
      triggerConfetti();
    } else {
      // mark challenger defeated and rotate to end
      await set(ref(db, `defeats/${challengerId}`), true);
      const idx = playersOrderArr.indexOf(challengerId);
      if (idx !== -1){ playersOrderArr.splice(idx,1); playersOrderArr.push(challengerId); await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }
    }
  } catch (e){ console.error('submitChallenge error', e); }
}

// ---- Add player ----
async function addPlayer(){
  const input = $('new-player-name'); if(!input) return;
  const name = input.value.trim(); if(!name) return alert('Enter a name');
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try {
    await set(ref(db, `players/${id}`), { name });
    if (!playersOrderArr.includes(id)){ playersOrderArr.push(id); await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }
    input.value='';
    log(`Added ${name}`);
  } catch(e){ console.error('addPlayer error', e); log('Add player failed'); }
}
$('add-player-button')?.addEventListener('click', addPlayer);

// ---- Firebase listeners ----
onValue(ref(db, 'players'), snap=>{
  players = snap.val() || {};
  const allIds = Object.keys(players);
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster(); renderChallengeSection(); renderChampion();
});

onValue(ref(db, 'playersOrder'), snap=>{
  const val = snap.val();
  if (!val) playersOrderArr = [];
  else playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id})).sort((a,b)=>a.idx-b.idx).map(e=>e.id);
  const allIds = Object.keys(players || {});
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  renderRoster(); renderChallengeSection();
});

onValue(ref(db, 'championId'), snap=>{
  const newChampion = snap.val();
  championId = norm(newChampion);
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderChampion(); renderRoster(); renderChallengeSection();
});

onValue(ref(db, 'matches'), snap=>{
  const val = snap.val() || {};
  matches = Object.values(val);
  renderMatchHistory();
});

onValue(ref(db, 'defeats'), snap=>{
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val || {}));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster(); renderChallengeSection();
});

onValue(ref(db, 'championBoard'), snap=>{
  // optional champion board integration
  renderChampionBoard();
});

onValue(ref(db, 'timer/endTimestamp'), snap=>{
  const val = snap.val();
  timerEnd = val || null;
  if (timerEnd){ isPendingState = false; startLocalCountdown(); } else { isPendingState = true; if (timerInterval){ clearInterval(timerInterval); timerInterval = null; } updateTimerDisplay(); }
});

// Connectivity check (optional)
(async function testConn(){
  try { const root = await get(ref(db, '/')); console.log('Initial DB root', root.val()); log('Connected to Firebase'); } catch (e){ console.error('Firebase connectivity test failed', e); log('Firebase connect failed'); }
})();

// ---- Initial mount ----
document.addEventListener('DOMContentLoaded', ()=>{
  try { renderChampion(); renderRoster(); renderChallengeSection(); renderMatchHistory(); renderChampionBoard(); } catch(e){ console.warn('initial renders failed', e); }
});
