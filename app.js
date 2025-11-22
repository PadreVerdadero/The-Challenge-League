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
let currentChallengerId = null;
window._currentChallengerId = () => currentChallengerId;

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
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const parts = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];

  for (let i=0;i<80;i++){
    parts.push({
      x: Math.random()*canvas.width,
      y: -50 - Math.random()*200,
      vx:(Math.random()-0.5)*6,
      vy:2+Math.random()*6,
      size:6+Math.random()*8,
      c: colors[Math.floor(Math.random()*colors.length)],
      life:0
    });
  }

  let frame = 0;
  function draw(){
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p=>{
      p.x+=p.vx;
      p.y+=p.vy;
      p.vy+=0.06;
      ctx.fillStyle=p.c;
      ctx.fillRect(p.x,p.y,p.size,p.size*0.6);
    });
    if (frame < 120) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0,0,canvas.width,canvas.height);
    }
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

if (typeof computeSweep === 'function') window.computeSweep = computeSweep;

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

  if (isSweep && championId){
    const btn = document.createElement('button');
    btn.textContent = 'Clear Champion (end sweep)';
    btn.addEventListener('click', async ()=>{
      await set(ref(db,'championId'), null);
      await remove(ref(db,'defeats'));
      await remove(ref(db,'timer/endTimestamp'));
      isSweep = false;
      currentChallengerId = null;

      const allIds = Object.keys(players || {});
      playersOrderArr = allIds.slice();
      await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));

      renderAll();
    });
    area.appendChild(btn);
  } else if (!championId){
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

  const countdownActive = Boolean(timerEnd && (timerEnd - Date.now()) > 0);

  // Only set currentChallengerId when there is an active countdown, a champion, not a sweep, and a next-up exists
  if (championId && !isSweep && nextUpId && countdownActive) {
    currentChallengerId = nextUpId;
  } else {
    currentChallengerId = null;
  }
  window._currentChallengerId = () => currentChallengerId;

  const row = document.createElement('div'); row.className = 'next-up-row';
  const name = document.createElement('div'); name.className = 'next-up-name';

  // Show challenger name only when countdown is active and not a sweep; otherwise show "No active challenge"
  if (countdownActive && nextUpId && !isSweep) {
    name.textContent = players[nextUpId]?.name || 'Unknown';
  } else {
    name.textContent = 'No active challenge';
  }
  row.appendChild(name);

  const btn = document.createElement('button');
  btn.className = 'record-btn';
  btn.textContent = 'Record Challenge';

  if (!countdownActive || !nextUpId || !championId || isSweep) {
    btn.disabled = true;
  } else {
    btn.disabled = false;
    btn.onclick = () => {
      currentChallengerId = nextUpId;
      window._currentChallengerId = () => currentChallengerId;
      openChallengeModal(nextUpId);
      renderAll();
    };
  }
  row.appendChild(btn);

  el.appendChild(row);

  const timerWrap = document.createElement('div');
  timerWrap.id = 'timer-display';
  el.appendChild(timerWrap);
  updateTimerDisplay();
}
// Instead of an anchored flame, implement a simple CSS glow toggle
function triggerChampionGlow(duration = 1200){
  const champEl = document.querySelector('.champ-name');
  if (!champEl) return;
  champEl.classList.add('champ-glow');
  setTimeout(()=> {
    champEl.classList.remove('champ-glow');
  }, duration);
}

function triggerChampionFire(){
  triggerChampionGlow(1800);
}

// Explosion animation for sweep: flash + particle burst
function triggerSweepExplosion() {
  const overlay = document.createElement('div');
  overlay.className = 'explosion-overlay';

  const flash = document.createElement('div');
  flash.className = 'explosion-flash';
  overlay.appendChild(flash);

  const particleCount = 22;
  for (let i=0;i<particleCount;i++){
    const p = document.createElement('div');
    p.className = 'explosion-particle';
    const angle = (Math.PI*2) * (i/particleCount + (Math.random()-0.5)*0.06);
    const dist = 120 + Math.random()*260;
    const dx = Math.cos(angle) * dist + 'px';
    const dy = Math.sin(angle) * dist + 'px';
    p.style.setProperty('--dx', dx);
    p.style.setProperty('--dy', dy);
    const s = 6 + Math.random()*10;
    p.style.width = `${s}px`;
    p.style.height = `${s}px`;
    p.style.left = `calc(50% + ${(Math.random()-0.5)*40}px)`;
    p.style.top = `calc(40% + ${(Math.random()-0.5)*40}px)`;
    p.style.animationDelay = `${Math.random()*120}ms`;
    overlay.appendChild(p);
  }

  document.body.appendChild(overlay);
  setTimeout(()=> overlay.remove(), 900);
}

// --- Trophy badge helpers ---
function ensureLiveAnnounce(){
  let live = document.getElementById('site-live-announce');
  if (!live){
    live = document.createElement('div');
    live.id = 'site-live-announce';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    Object.assign(live.style, {
      position: 'absolute',
      left: '-9999px',
      width: '1px',
      height: '1px',
      overflow: 'hidden'
    });
    document.body.appendChild(live);
  }
  return live;
}

function getDefenseCount(champId){
  if (!champId) return 0;
  try {
    return Number(localStorage.getItem(`cl:defenses:${champId}`) || 0);
  } catch (e) { return 0; }
}
function setDefenseCount(champId, n){
  if (!champId) return;
  try { localStorage.setItem(`cl:defenses:${champId}`, String(n)); } catch(e){}
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function showTrophyBadge(champName, champId){
  ensureLiveAnnounce();

  const newCount = getDefenseCount(champId) + 1;
  setDefenseCount(champId, newCount);

  const badge = document.createElement('div');
  badge.className = 'trophy-badge';
  badge.innerHTML = `
    <div class="trophy-emoji">🏆</div>
    <div class="trophy-text"><strong>${escapeHtml(champName)}</strong>
      <div class="trophy-count">Defenses: <span class="trophy-count-num">${newCount}</span></div>
    </div>
  `;
  badge.style.position = 'fixed';
  badge.style.top = '24px';
  badge.style.right = '24px';
  badge.style.zIndex = 20000;
  badge.style.pointerEvents = 'none';
  document.body.appendChild(badge);

  const live = ensureLiveAnnounce();
  live.textContent = `${champName} defended the title. Defenses: ${newCount}`;

  requestAnimationFrame(()=> badge.classList.add('trophy-badge--enter'));
  setTimeout(()=> {
    badge.classList.remove('trophy-badge--enter');
    setTimeout(()=> badge.remove(), 360);
  }, 2800);
}

function resetDefenseCount(champId){
  if (!champId) return;
  try { localStorage.removeItem(`cl:defenses:${champId}`); } catch(e){}
}
// --- Challenge modal ---
function openChallengeModal(challengerId){
  if (!championId) return;
  if (isSweep) return;
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

  function closeModal(){
    const m=$('challenge-modal'); if(m) m.remove();
    currentChallengerId = null;
    window._currentChallengerId = () => currentChallengerId;
    renderAll();
  }
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
      const previousChampion = championId;
      try { resetDefenseCount(previousChampion); } catch(e){}
      await set(ref(db, 'championId'), challengerId);

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

      setTimeout(()=> {
        try { triggerChampionGlow(1200); } catch (e) { console.error('triggerChampionGlow error', e); }
      }, 60);

    } else {
      await set(ref(db, `defeats/${challengerId}`), true);
      const idx = playersOrderArr.indexOf(challengerId);
      if (idx !== -1) {
        playersOrderArr.splice(idx,1);
        playersOrderArr.push(challengerId);
        await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
      }

      // Visual glow and trophy badge
      setTimeout(()=> {
        try { triggerChampionGlow(1000); } catch (e) { console.error('triggerChampionGlow error', e); }
      }, 60);

      try {
        const champName = players[championId]?.name || 'Champion';
        showTrophyBadge(champName, championId);
      } catch (e) { console.error('showTrophyBadge error', e); }
    }

    isSweep = computeSweep();
    currentChallengerId = null;
    renderAll();
  } catch (e) {
    console.error('submitChallenge error', e);
  }
}
// --- Add Player ---
async function addPlayer(){
  const input = $('new-player-name'); if (!input) return;
  const name = input.value.trim(); if (!name) return alert('Enter a name');
  const id = name.toLowerCase().trim().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,'');
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
  isSweep = computeSweep();
  renderAll();
});

onValue(ref(db, 'playersOrder'), snap=>{
  const val = snap.val();
  if (!val) playersOrderArr = [];
  else playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id}))
    .filter(x => x.id)
    .sort((a,b)=>a.idx-b.idx).map(e=>e.id);
  renderAll();
});

onValue(ref(db, 'championId'), snap=>{
  const prevChampion = championId;
  championId = snap.val();
  if (prevChampion && prevChampion !== championId) {
    // previous champion reset handled in submitChallenge when title changes
  }
  isSweep = computeSweep();
  renderAll();
});

onValue(ref(db, 'matches'), snap=>{
  matches = Object.values(snap.val() || {});
  renderMatchHistory();
});

onValue(ref(db, 'defeats'), async snap=>{
  const val = snap.val() || {};
  window._lastDefeatsSnap = val;
  const keys = typeof val === 'object' ? Object.keys(val) : [];
  const prevIsSweep = isSweep;
  defeated = new Set(keys);
  isSweep = computeSweep();

  // If a sweep just occurred (transition false -> true), record it once.
  if (isSweep && !prevIsSweep) {
    try {
      const championSnap = await get(ref(db, 'championId'));
      const currentChampionId = championSnap.exists() ? championSnap.val() : null;

      if (!currentChampionId) {
        console.warn('Sweep detected but no championId available from DB');
      } else {
        const playerSnap = await get(ref(db, `players/${currentChampionId}`));
        const championName = playerSnap.exists() ? (playerSnap.val().name || 'Unknown') : 'Unknown';

        const sweepMatch = {
          type: 'sweep',
          winnerId: currentChampionId,
          winnerName: championName,
          timestamp: Date.now()
        };
        const mRef = push(ref(db, 'matches'));
        await set(mRef, sweepMatch);
        console.log('Recorded sweep match for', currentChampionId, championName);
      }
    } catch (e) {
      console.error('Error recording sweep match', e);
    }

    triggerSweepExplosion();
  }

  renderAll();
});

// UPDATED: timer listener re-renders UI so challenger logic updates with timer changes
onValue(ref(db, 'timer/endTimestamp'), snap=>{
  timerEnd = snap.val() || null;

  if (timerEnd){
    startLocalCountdown();
  } else {
    updateTimerDisplay();
  }

  // Ensure challenger section re-computes with the latest timer state
  renderAll();
});

// --- Helper to render everything ---
function renderAll(){
  renderChampion();
  renderChallengeSection();
  renderRoster();
  renderMatchHistory();

  const addBtn = $('add-player-button');
  if (addBtn){
    addBtn.disabled = Boolean(isSweep || championId);
  }
}

// --- Initial mount ---
document.addEventListener('DOMContentLoaded', ()=>{
  renderAll();
});
