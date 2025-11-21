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

// --- Rendering ---
function renderChampion(){
  const el = $('champion-card'); if (!el) return;
  el.innerHTML = `<h2>Champion</h2>`;
  const wrap = document.createElement('div');
  if (championId && players[championId]) wrap.innerHTML = `<span class="champ-name">👑 ${players[championId].name}</span> <span id="champion-actions-area"></span>`;
  else wrap.innerHTML = `<span class="champ-name no-champ">No champion yet</span> <span id="champion-actions-area"></span>`;
  el.appendChild(wrap);
  renderChampionActions();
}
function renderChampionActions(){
  const area = $('champion-actions-area'); if (!area) return;
  area.innerHTML = '';
  if (isSweep && championId){
    const btn = document.createElement('button'); btn.textContent = 'Clear Champion (end sweep)';
    btn.addEventListener('click', async ()=>{
      await set(ref(db,'championId'), null);
      await remove(ref(db,'defeats'));
      await remove(ref(db,'timer/endTimestamp'));
      isSweep = false;
      renderAll();
    });
    area.appendChild(btn);
  } else if (!championId){
    const btn = document.createElement('button'); btn.textContent = 'Lock in Order';
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
function renderChallengeSection(){
  const el = $('challenge-section'); if (!el) return;
  el.innerHTML = `<h2>Challenger</h2>`;
  const ordered = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = ordered.find(id => id && id !== championId && players[id]) || null;
  const nextUpName = nextUpId ? (players[nextUpId]?.name || 'Unknown') : 'No one';
  const row = document.createElement('div'); row.className = 'next-up-row';
  const name = document.createElement('div'); name.className = 'next-up-name'; name.textContent = nextUpName;
  row.appendChild(name);
  const btn = document.createElement('button'); btn.className='record-btn'; btn.textContent = 'Record Challenge';
  if (!nextUpId || !championId || isSweep) { btn.disabled = true; }
  else { btn.addEventListener('click', ()=>{ openChallengeModal(nextUpId); }); }
  row.appendChild(btn);
  el.appendChild(row);
  const timerWrap = document.createElement('div'); timerWrap.id = 'timer-display'; el.appendChild(timerWrap);
  updateTimerDisplay();
}
function renderRoster(){
  const el = $('roster'); if (!el) return;
  el.innerHTML = `<h2>Roster</h2>`;
  if (!players || Object.keys(players).length === 0) { el.innerHTML += '<p>No players yet</p>'; return; }
  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);
  visibleIds.forEach((id, position)=>{
    const p = players[id]; if (!p) return;
    const row = document.createElement('div'); row.className='roster-row';
    const handle = document.createElement('div'); handle.className='order-handle'; handle.textContent='☰';
    const nameBtn = document.createElement('button'); nameBtn.className='roster-name'; nameBtn.textContent=p.name;
    // Only allow remove when add-player is enabled
    const addBtn = $('add-player-button');
    if (addBtn && !addBtn.disabled){
      nameBtn.addEventListener('click', async ()=>{
        if (confirm(`Remove player ${p.name}?`)){
          await remove(ref(db, `players/${id}`));
        }
      });
    }
    row.append(handle,nameBtn);
    const movesDisabled = Boolean(championId);
    if (visibleIds.length>1){
      const up=document.createElement('button'); up.className='move-btn'; up.textContent='↑'; up.disabled=movesDisabled||(position===0);
      up.addEventListener('click',async(e)=>{e.stopPropagation(); if(movesDisabled)return; const idx=playersOrderArr.indexOf(id); if(idx>0){[playersOrderArr[idx-1],playersOrderArr[idx]]=[playersOrderArr[idx],playersOrderArr[idx-1]]; await set(ref(db,'playersOrder'),Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));}});
      const down=document.createElement('button'); down.className='move-btn'; down.textContent='↓'; down.disabled=movesDisabled||(position===visibleIds.length-1);
      down.addEventListener('click',async(e)=>{e.stopPropagation(); if(movesDisabled)return; const idx=playersOrderArr
