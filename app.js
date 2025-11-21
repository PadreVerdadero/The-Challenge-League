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

let players = {};
let championId = null;
let matches = [];
let defeated = new Set();
let playersOrderArr = [];
let timerEnd = null;
let timerInterval = null;
let isSweep = false;

const $ = id => document.getElementById(id);

// --- Timer helpers ---
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
  if (!el) return;
  if (isSweep || !championId) {
    el.textContent = isSweep ? 'Group sweep recorded — group challenge pending' : 'New group challenge pending';
    return;
  }
  if (!timerEnd) { el.textContent = 'No active challenge'; return; }
  const remaining = timerEnd - Date.now();
  el.textContent = remaining > 0 ? `Time left: ${formatDuration(remaining)}` : `Time left: 00:00:00:00 — expired`;
}
function startLocalCountdown(){
  if (timerInterval) clearInterval(timerInterval);
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

// --- Confetti ---
function triggerConfetti(){
  const canvas = $('confetti-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d'); canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const parts = []; const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<80;i++){ parts.push({x: Math.random()*canvas.width, y: -50 - Math.random()*200, vx:(Math.random()-0.5)*6, vy:2+Math.random()*6, size:6+Math.random()*8, c: colors[Math.floor(Math.random()*colors.length)], life:0}); }
  let frame = 0;
  function draw(){
    frame++; ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.vy+=0.06; ctx.fillStyle=p.c; ctx.fillRect(p.x,p.y,p.size,p.size*0.6); });
    if (frame < 120) requestAnimationFrame(draw); else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// --- Sweep helper ---
function computeSweep(){
  if (!championId) return false;
  const allIds = Object.keys(players || {});
  const challengers = allIds.filter(id => id !== championId);
  if (challengers.length === 0) return false;
  return challengers.every(id => defeated.has(id));
}
// --- Champion rendering ---
function renderChampion(){
  const el = $('champion-card'); if (!el) return;
  el.innerHTML = `<h2>Champion</h2>`;
  const wrap = document.createElement('div');
  if (championId && players[championId]) {
    wrap.innerHTML = `<span class="champ-name">👑 ${players[championId].name}</span> <span id="champion-actions-area"></span>`;
  } else {
    wrap.innerHTML = `<span class="champ-name no-champ">No champion yet</span> <span id="champion-actions-area"></span>`;
  }
  el.appendChild(wrap);
  renderChampionActions();
}

function renderChampionActions(){
  const area = $('champion-actions-area'); if (!area) return;
  area.innerHTML = '';

  // Show Clear Champion only when sweep is true
  if (isSweep && championId){
    const btn = document.createElement('button');
    btn.textContent = 'Clear Champion (end sweep)';
    btn.addEventListener('click', async ()=>{
      await set(ref(db,'championId'), null);
      await remove(ref(db,'defeats'));
      await remove(ref(db,'timer/endTimestamp'));
      isSweep = false;
      renderAll();
    });
    area.appendChild(btn);
  } else if (!championId){
    // Show Lock in Order when no champion
    const btn = document.createElement('button');
    btn.textContent = 'Lock in Order';
    btn.addEventListener('click', async ()=>{
      const ordered = playersOrderArr.length ? playersOrderArr : Object.keys(players).sort();
      const pick = ordered.find(id => id && players[id]) || null;
      if (!pick) { alert('No players to select as champion'); return; }
      await set(ref(db, 'championId'), pick);
      await set(ref(db, 'timer/endTimestamp'), Date.now() + WEEK_MS);
      isSweep = false;
      renderAll();
    });
    area.appendChild(btn);
  }
}

// --- Challenge section ---
function renderChallengeSection(){
  const el = $('challenge-section'); if (!el) return;
  el.innerHTML = `<h2>Challenger</h2>`;

  const ordered = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = ordered.find(id => id && id !== championId && players[id]) || null;
  const nextUpName = nextUpId ? (players[nextUpId]?.name || 'Unknown') : 'No one';

  const row = document.createElement('div'); row.className = 'next-up-row';
  const name = document.createElement('div'); name.className = 'next-up-name'; name.textContent = nextUpName;
  row.appendChild(name);

  // Record Challenge button (red)
  const btn = document.createElement('button');
  btn.className = 'record-btn';
  btn.textContent = 'Record Challenge';
  if (!nextUpId || !championId || isSweep) {
    btn.disabled = true;
  } else {
    btn.addEventListener('click', ()=>{ openChallengeModal(nextUpId); });
  }
  row.appendChild(btn);

  el.appendChild(row);

  const timerWrap = document.createElement('div');
  timerWrap.id = 'timer-display';
  el.appendChild(timerWrap);
  updateTimerDisplay();
}
// --- Roster rendering ---
function renderRoster(){
  const el = $('roster'); if (!el) return;
  el.innerHTML = `<h2>Roster</h2>`;
  if (!players || Object.keys(players).length === 0) {
    el.innerHTML += '<p>No players yet</p>';
    return;
  }

  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);

  visibleIds.forEach((id, position)=>{
    const p = players[id]; if (!p) return;

    const row = document.createElement('div'); row.className='roster-row';
    const handle = document.createElement('div'); handle.className='order-handle'; handle.textContent='☰';

    const nameBtn = document.createElement('button');
    nameBtn.className='roster-name';
    nameBtn.textContent = p.name;

    // color by defeat status
    if (defeated.has(id)) {
      nameBtn.classList.add('defeated');   // red
    } else {
      nameBtn.classList.add('active');     // blue
    }

    // Only allow remove when Add Player button is enabled
    const addBtn = $('add-player-button');
    if (addBtn && !addBtn.disabled){
      nameBtn.addEventListener('click', async ()=>{
        if (confirm(`Remove player ${p.name}?`)){
          await remove(ref(db, `players/${id}`));
        }
      });
    }

    row.append(handle,nameBtn);

    // Disable move buttons while champion is locked in
    const movesDisabled = Boolean(championId);

    if (visibleIds.length>1){
      const up=document.createElement('button');
      up.className='move-btn';
      up.textContent='↑';
      up.disabled=movesDisabled||(position===0);
      up.addEventListener('click',async(e)=>{
        e.stopPropagation();
        if(movesDisabled) return;
        const idx=playersOrderArr.indexOf(id);
        if(idx>0){
          [playersOrderArr[idx-1],playersOrderArr[idx]]=[playersOrderArr[idx],playersOrderArr[idx-1]];
          await set(ref(db,'playersOrder'),Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        }
      });

      const down=document.createElement('button');
      down.className='move-btn';
      down.textContent='↓';
      down.disabled=movesDisabled||(position===visibleIds.length-1);
      down.addEventListener('click',async(e)=>{
        e.stopPropagation();
        if(movesDisabled) return;
        const idx=playersOrderArr.indexOf(id);
        if(idx>=0 && idx<playersOrderArr.length-1){
          [playersOrderArr[idx+1],playersOrderArr[idx]]=[playersOrderArr[idx],playersOrderArr[idx+1]];
          await set(ref(db,'playersOrder'),Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        }
      });

      row.append(up, down);
    }

    el.appendChild(row);
  });
}
// --- Match History rendering ---
function renderMatchHistory(){
  const el = $('match-list'); if (!el) return;
  el.innerHTML = `<h2>Match History</h2>`;

  // If sweep occurred, record it as a permanent match entry
  if (isSweep && championId && players[championId]) {
    const sweepMatch = {
      type: 'sweep',
      winnerName: players[championId].name,
      timestamp: Date.now()
    };
    // Push sweep record into DB if not already present
    const alreadyLogged = matches.some(m => m.type === 'sweep' && m.winnerName === sweepMatch.winnerName);
    if (!alreadyLogged) {
      const mRef = push(ref(db, 'matches'));
      set(mRef, sweepMatch);
    }
  }

  const sorted = matches.slice().sort((a,b)=> (b.timestamp||0)-(a.timestamp||0));
  sorted.forEach(m=>{
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
    const div = document.createElement('div');
    if (m.type === 'sweep') {
      div.innerHTML = `🏆 Winner - ${m.winnerName} (Sweep) ${time ? `(${time})` : ''}`;
    } else {
      div.innerHTML = `🏁 <strong>${m.challengerName||'Unknown'}</strong> vs <strong>${m.championName||'Unknown'}</strong> — Winner: <strong>${m.winnerName||'Unknown'}</strong> ${time ? `(${time})` : ''}`;
      if (m.description){ 
        const d = document.createElement('div'); 
        d.className='match-desc'; 
        d.textContent = m.description; 
        el.appendChild(d); 
      }
    }
    el.appendChild(div);
  });
}

// --- Challenge modal ---
function openChallengeModal(challengerId){
  if (!championId) return;
  if (isSweep) return; // disable during sweep
  if ($('challenge-modal')) return;

  const challenger = players[challengerId];
  const modal = document.createElement('div'); modal.id='challenge-modal';
  modal.style.position='fixed'; modal.style.left=0; modal.style.top=0;
  modal.style.width='100%'; modal.style.height='100%';
  modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center';
  modal.style.background='rgba(0,0,0,0.45)'; modal.style.zIndex=10000;

  const panel = document.createElement('div');
  panel.style.background='#0b1220'; panel.style.padding='16px'; panel.style.borderRadius='10px';
  panel.style.minWidth='320px'; panel.style.maxWidth='560px';
  panel.style.boxShadow='0 8px 30px rgba(0,0,0,0.6)'; panel.style.color='#e6eef8';

  const header = document.createElement('h3');
  header.textContent = `Record Challenge: ${challenger.name} vs ${players[championId].name}`;
  panel.appendChild(header);

  const desc = document.createElement('textarea');
  desc.rows=4; desc.style.width='100%'; desc.placeholder='Description (optional)';
  panel.appendChild(desc);

  const row = document.createElement('div');
  row.style.display='flex'; row.style.gap='8px'; row.style.marginTop='12px';

  const challengerBtn = document.createElement('button');
  challengerBtn.textContent = `${challenger.name} wins`;
  challengerBtn.style.background='#2b8a3e'; challengerBtn.style.color='#fff';
  challengerBtn.addEventListener('click', async ()=>{
    await submitChallenge(challengerId, desc.value||'', challengerId);
    closeModal();
  });

  const champBtn = document.createElement('button');
  champBtn.textContent = `${players[championId].name} wins`;
  champBtn.style.background='#1f6feb'; champBtn.style.color='#fff';
  champBtn.addEventListener('click', async ()=>{
    await submitChallenge(challengerId, desc.value||'', championId);
    closeModal();
  });

  const cancel = document.createElement('button');
  cancel.textContent='Cancel';
  cancel.addEventListener('click', closeModal);

  row.append(challengerBtn, champBtn, cancel);
  panel.appendChild(row);
  modal.appendChild(panel);
  document.body.appendChild(modal);

  function closeModal(){ const m=$('challenge-modal'); if(m) m.remove(); }
}
// --- Challenge submission ---
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
      // Challenger dethrones champion
      const previousChampion = championId;
      await set(ref(db, 'championId'), challengerId);

      // Move previous champion to end of roster
      if (previousChampion && playersOrderArr.includes(previousChampion)) {
        const idx = playersOrderArr.indexOf(previousChampion);
        if (idx !== -1) {
          playersOrderArr.splice(idx,1);
          playersOrderArr.push(previousChampion);
          await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        }
      }

      await remove(ref(db, 'defeats'));
      await set(ref(db, 'timer/endTimestamp'), Date.now() + WEEK_MS);
      isSweep = false;
      triggerConfetti();
    } else {
      // Champion defended
      await set(ref(db, `defeats/${challengerId}`), true);
      const idx = playersOrderArr.indexOf(challengerId);
      if (idx !== -1) {
        playersOrderArr.splice(idx,1);
        playersOrderArr.push(challengerId);
        await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
      }
    }

    // recompute sweep after each match
    isSweep = computeSweep();
    renderAll();
  } catch (e) {
    console.error('submitChallenge error', e);
  }
}

// --- Add Player ---
async function addPlayer(){
  const input = $('new-player-name'); if (!input) return;
  const name = input.value.trim(); if (!name) return alert('Enter a name');
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try {
    await set(ref(db, `players/${id}`), { name });
    if (!playersOrderArr.includes(id)){
      playersOrderArr.push(id);
      await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
    }
    input.value='';
  } catch(e){
    console.error('addPlayer error', e);
  }
}
$('add-player-button')?.addEventListener('click', addPlayer);

// --- Firebase listeners ---
onValue(ref(db, 'players'), snap=>{
  players = snap.val() || {};
  const allIds = Object.keys(players);
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  isSweep = computeSweep();   // recompute sweep
  renderAll();
});

onValue(ref(db, 'playersOrder'), snap=>{
  const val = snap.val();
  if (!val) playersOrderArr = [];
  else playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id}))
    .sort((a,b)=>a.idx-b.idx).map(e=>e.id);
  renderAll();
});

onValue(ref(db, 'championId'), snap=>{
  championId = snap.val();
  isSweep = computeSweep();   // recompute sweep
  renderAll();
});

onValue(ref(db, 'matches'), snap=>{
  matches = Object.values(snap.val() || {});
  renderMatchHistory();
});

onValue(ref(db, 'defeats'), snap=>{
  defeated = new Set(Object.keys(snap.val() || {}));
  isSweep = computeSweep();   // recompute sweep
  renderAll();
});

onValue(ref(db, 'timer/endTimestamp'), snap=>{
  timerEnd = snap.val() || null;
  if (timerEnd){ startLocalCountdown(); } else { updateTimerDisplay(); }
});

// --- Helper to render everything ---
function renderAll(){
  renderChampion();
  renderChallengeSection();
  renderRoster();
  renderMatchHistory();

  // Toggle Add Player button state
  const addBtn = $('add-player-button');
  if (addBtn){
    if (isSweep || championId){
      addBtn.disabled = true;
    } else {
      addBtn.disabled = false;
    }
  }
}

// --- Initial mount ---
document.addEventListener('DOMContentLoaded', ()=>{
  renderAll();
});
