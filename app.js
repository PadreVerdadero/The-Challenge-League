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

// ===== Discord webhook helper (DB-aware; client-side) =====
// WARNING: webhook in client is public. Consider server-side for production.
const DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1442702542294356181/1bBnhz9uhaGIFDSvnsvUw6wNFrVLNXyoaciBrc36olR7RCJMd0VZxiYTtGdJkTLUfMB5";
// ===== postToDiscord (re-fetch after optional wait, skip if already notified, clean labels) =====
async function postToDiscord(match, pushKey, opts = { delayMs: 10000 }) {
  if (!DISCORD_WEBHOOK) return;
  const delay = typeof opts.delayMs === 'number' ? opts.delayMs : 10000;

  try {
    // Wait (optional) so DB updates settle
    if (delay > 0) await new Promise(r => setTimeout(r, delay));

    // Fetch authoritative recorded match (prefer pushKey)
    let recordedMatch = null;
    if (pushKey) {
      try {
        const mSnap = await get(ref(db, `matches/${pushKey}`));
        if (mSnap.exists()) recordedMatch = mSnap.val();
      } catch (e) {
        console.warn('postToDiscord: error fetching by pushKey', pushKey, e);
      }
    }

    // fallback: most recent match
    if (!recordedMatch) {
      const allSnap = await get(ref(db, 'matches'));
      const allVal = allSnap.exists() ? allSnap.val() : null;
      if (allVal) {
        const recent = Object.entries(allVal)
          .map(([k,v]) => ({ key: k, val: v }))
          .sort((a,b) => (b.val.timestamp||0) - (a.val.timestamp||0))[0];
        if (recent) recordedMatch = recent.val;
      }
    }

    // final fallback: passed match object
    if (!recordedMatch) recordedMatch = match || {};

    // If this DB record has already been notified, skip posting
    if (recordedMatch.discordNotified) {
      console.log('postToDiscord: skipping already-notified match', pushKey);
      return;
    }

    // Debug log
    console.log('postToDiscord: recordedMatch', { pushKey, recordedMatch });

    // Build recorded fields from authoritative record
    const recChallenger = recordedMatch.challengerName || recordedMatch.challengerId || 'Challenger';
    const recChampion = recordedMatch.championName || recordedMatch.championId || 'Champion';
    const recWinner = recordedMatch.winnerName || recordedMatch.winnerId || 'Winner';
    const recDesc = recordedMatch.description || '';
    const recType = recordedMatch.type || 'match';

    // Read site state to compute Note (next challenger / current champion)
    const [playersSnap, champSnap, orderSnap] = await Promise.all([
      get(ref(db, 'players')),
      get(ref(db, 'championId')),
      get(ref(db, 'playersOrder'))
    ]);
    const playersObj = playersSnap.exists() ? playersSnap.val() : {};
    const championNow = champSnap.exists() ? champSnap.val() : null;

    let orderedArr = [];
    if (orderSnap.exists()){
      const orderVal = orderSnap.val();
      orderedArr = Object.entries(orderVal)
        .map(([k,id])=>({idx: Number(k), id}))
        .filter(x => x.id)
        .sort((a,b)=>a.idx-b.idx)
        .map(e=>e.id);
    } else {
      orderedArr = Object.keys(playersObj || {}).sort();
    }

    const nextUpId = orderedArr.find(id => id && id !== championNow && playersObj[id]) || null;
    const nextChallengerName = nextUpId ? (playersObj[nextUpId]?.name || nextUpId) : null;
    const currentChampionName = championNow && playersObj[championNow] ? playersObj[championNow].name : recChampion;

    // Compose title and note; for sweep use requested wording and title
    let titleText = recType === 'sweep' ? 'Winner!' : '🏁 Match Recorded';
    let noteText;
    if (recType === 'sweep') {
      noteText = `${currentChampionName} now decides how to determine the order.`;
    } else if (nextChallengerName) {
      noteText = `${nextChallengerName} now has one week to challenge ${currentChampionName}.`;
    } else {
      noteText = `${currentChampionName} is the winner.`;
    }

    // Build embed — remove "(recorded)" from labels here
    const embed = {
      title: titleText,
      description: recDesc || undefined,
      color: recType === 'sweep' ? 0xF1C40F : 0x1ABC9C,
      fields: [
        { name: 'Champion', value: String(recChampion), inline: true },
        { name: 'Challenger', value: String(recChallenger), inline: true },
        { name: 'Winner', value: String(recWinner), inline: true },
        { name: 'Note', value: noteText }
      ],
      timestamp: new Date(recordedMatch.timestamp || Date.now()).toISOString()
    };

    const payload = { username: 'Challenge League Bot', embeds: [embed] };
    const res = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error('Discord webhook error', res.status, await res.text());
    } else if (pushKey) {
      try { await set(ref(db, `matches/${pushKey}/discordNotified`), true); } catch(e){}
    }
  } catch (err) {
    console.error('postToDiscord error', err);
  }
}
// Safety stubs to avoid early runtime crashes if listeners fire before full parse
if (typeof renderRoster !== 'function') {
  window.renderRoster = function(){ /* noop until real impl loads */ };
}
if (typeof renderMatchHistory !== 'function') {
  window.renderMatchHistory = function(){ /* noop until real impl loads */ };
}

// --- Section ensure helper (prevents silent render failures) ---
function ensureSection(id, title){
  let el = document.getElementById(id);
  if (!el){
    el = document.createElement('div');
    el.id = id;
    el.className = 'card';
    const h = document.createElement('h2');
    h.textContent = title;
    el.appendChild(h);
    document.body.appendChild(el);
  }
  return el;
}

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
function updateTimerDisplay() {
  const el = $('timer-display');
  if (!el) return;

  if (isSweep || !championId) {
    el.textContent = isSweep
      ? 'Group sweep recorded — group challenge pending'
      : 'New group challenge pending';
    return;
  }

  if (!timerEnd) {
    el.textContent = 'No active challenge';
    return;
  }

  const diff = Date.now() - timerEnd;

  if (diff < 0) {
    // Still time left
    el.textContent = `Time left: ${formatDuration(-diff)}`;
  } else {
    // Past due — show how long overdue
    el.textContent = `Overdue by: ${formatDuration(diff)}`;
  }
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
  const el = ensureSection('champion-card', 'Champion');
  el.innerHTML = `<h2>Champion</h2>`;
  const wrap = document.createElement('div');

  if (championId && players && players[championId]) {
    const champ = players[championId];
    const isSweep = typeof computeSweep === 'function' ? computeSweep() : false;
    const champEmoji = isSweep ? '🏆' : '👑';
    wrap.innerHTML = `
   // inside renderChampion(), replace the HTML that builds the champion display with:
wrap.innerHTML = `
  <span id="champion-name" class="champ-name">${champEmoji} ${escapeHtml(champ.name)}</span>
  <span id="champion-actions-area"></span>
`;
  } else {
    wrap.innerHTML = `<span id="champion-name" class="champ-name no-champ">No champion yet</span><span id="champion-actions-area"></span>`;
  }

  el.appendChild(wrap);
  renderChampionActions();
}

function renderChampionActions(){
  const area = $('champion-actions-area'); if (!area) return; area.innerHTML = '';

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
    return;
  }

  if (!championId){
    const btn = document.createElement('button');
    btn.textContent = 'Lock in Order';
    btn.addEventListener('click', async ()=>{
      const ordered = playersOrderArr.length ? playersOrderArr : Object.keys(players).sort();
      const pick = ordered.find(id => id && players[id]) || null;
      if (!pick) { alert('No players to select as champion'); return; }

      await set(ref(db, 'championId'), pick);
      await set(ref(db, 'timer/endTimestamp'), Date.now() + WEEK_MS);
      isSweep = false;

      // Recompute order on DB to ensure canonical ordering present
      await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));

      renderAll();

      // Immediately post an "Order set" notification that the order has been set and show current challenger/champion
      try {
        const [playersSnap, champSnap, orderSnap] = await Promise.all([
          get(ref(db, 'players')),
          get(ref(db, 'championId')),
          get(ref(db, 'playersOrder'))
        ]);
        const playersObj = playersSnap.exists() ? playersSnap.val() : {};
        const championNow = champSnap.exists() ? champSnap.val() : null;

        let orderedArr = [];
        if (orderSnap.exists()){
          const orderVal = orderSnap.val();
          orderedArr = Object.entries(orderVal)
            .map(([k,id])=>({idx: Number(k), id}))
            .filter(x => x.id)
            .sort((a,b)=>a.idx-b.idx)
            .map(e=>e.id);
        } else {
          orderedArr = Object.keys(playersObj || {}).sort();
        }

        const nextUpId = orderedArr.find(id => id && id !== championNow && playersObj[id]) || null;
        const nextChallengerName = nextUpId ? (playersObj[nextUpId]?.name || nextUpId) : 'No active challenger';
        const currentChampionName = championNow && playersObj[championNow] ? playersObj[championNow].name : 'No champion';

        const embed = {
          title: '🔒 Order Set',
          description: `Order locked in. ${nextChallengerName} now has one week to challenge ${currentChampionName}.`,
          color: 0x6A9AEB,
          fields: [
            { name: 'Current Champion', value: String(currentChampionName), inline: true },
            { name: 'Current Challenger', value: String(nextChallengerName), inline: true },
            { name: 'Note', value: 'Order has been set' }
          ],
          timestamp: new Date().toISOString()
        };

        const payload = { username: 'Challenge League Bot', embeds: [embed] };
        const r = await fetch(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) console.error('Lock-in Discord webhook error', r.status, await r.text());
      } catch (e) {
        console.error('Lock-in notify error', e);
      }
    });
    area.appendChild(btn);
  }
}
// --- Challenge section ---
// --- Challenge section (always show next challenger; allow recording even when overdue) ---
function renderChallengeSection(){
  const el = ensureSection('challenge-section', 'Challenger');
  el.innerHTML = `<h2>Challenger</h2>`;

  // canonical order: prefer playersOrderArr (kept in sync by listeners), fallback to players keys
  const ordered = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  // nextUp is the first id in order that is not the champion and exists in players
  const nextUpId = ordered.find(id => id && id !== championId && players[id]) || null;

  // Always expose the next challenger in the UI (even if timer expired)
  currentChallengerId = nextUpId;
  window._currentChallengerId = () => currentChallengerId;

  const row = document.createElement('div'); row.className = 'next-up-row';
  const name = document.createElement('div');
  name.className = 'next-up-name';
  if (nextUpId && players[nextUpId]) {
    // show star emoji for the challenger
    name.innerHTML = `⭐ ${escapeHtml(players[nextUpId].name || 'Unknown')}`;
    name.title = 'Challenger';
  } else {
    name.textContent = 'No active challenger';
  }
  row.appendChild(name);

  const btn = document.createElement('button');
  btn.className = 'record-btn';
  btn.textContent = 'Record Challenge';

  // Button enabled whenever we have a champion, a next challenger, and not in sweep state
  if (!nextUpId || !championId || isSweep) {
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
// --- Roster rendering ---
function renderRoster(){
  const el = ensureSection('roster', 'Roster');
  el.innerHTML = `<h2>Roster</h2>`;
  if (!players || Object.keys(players).length === 0) {
    el.innerHTML += '<p>No players yet</p>';
    return;
  }

  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const visibleIds = orderedIds.filter(id => id !== championId && id !== currentChallengerId && players[id]);

  visibleIds.forEach((id, position)=>{
    const p = players[id]; if (!p) return;

    const row = document.createElement('div'); row.className='roster-row';
    const handle = document.createElement('div'); handle.className='order-handle'; handle.textContent='☰';

// create name button with medal for top three visible positions
const nameBtn = document.createElement('button');
nameBtn.className = 'roster-name';

const medal = (position === 0) ? '🥇 ' :
              (position === 1) ? '🥈 ' :
              (position === 2) ? '🥉 ' : '';

nameBtn.innerHTML = `${medal}${escapeHtml(p.name)}`;

    if (defeated.has(id)) {
      nameBtn.classList.add('defeated');
    } else {
      nameBtn.classList.add('active');
    }

    const addBtn = $('add-player-button');
    if (addBtn && !addBtn.disabled){
      nameBtn.addEventListener('click', async ()=>{
        if (confirm(`Remove player ${p.name}?`)){
          await remove(ref(db, `players/${id}`));
        }
      });
    }

    row.append(handle, nameBtn);
        const movesDisabled = Boolean(championId);

    if (visibleIds.length > 1){
      const up = document.createElement('button');
      up.className = 'move-btn';
      up.textContent = '↑';
      up.disabled = movesDisabled || (position === 0);
      up.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (movesDisabled) return;
        const idx = playersOrderArr.indexOf(id);
        if (idx > 0){
          [playersOrderArr[idx-1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx-1]];
          await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        }
      });

      const down = document.createElement('button');
      down.className = 'move-btn';
      down.textContent = '↓';
      down.disabled = movesDisabled || (position === visibleIds.length-1);
      down.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (movesDisabled) return;
        const idx = playersOrderArr.indexOf(id);
        if (idx >= 0 && idx < playersOrderArr.length-1){
          [playersOrderArr[idx+1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx+1]];
          await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        }
      });

      row.append(up, down);
    }

    el.appendChild(row);
  });
}
// --- Match History rendering ---
function renderMatchHistory(){
  const el = ensureSection('match-list', 'Match History');
  el.innerHTML = `<h2>Match History</h2>`;

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
        div.appendChild(d);
      }
    }
    el.appendChild(div);
  });
}

// --- Champion glow, trophy badge, and sweep explosion helpers ---
function ensureEffectsContainer(){
  let container = document.getElementById('effects-container');
  if (!container){
    container = document.createElement('div');
    container.id = 'effects-container';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = 9999;
    document.body.appendChild(container);
  }
  return container;
}
function triggerChampionGlow(duration = 1200){
  const champEl = document.querySelector('.champ-name');
  if (!champEl) return;
  champEl.classList.add('champ-glow');
  setTimeout(()=> {
    champEl.classList.remove('champ-glow');
  }, duration);
}
function triggerChampionFire(){ triggerChampionGlow(1800); }

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
// --- Trophy badge helpers (simplified, no counter) ---
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

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function showTrophyBadge(champName){
  ensureEffectsContainer();
  ensureLiveAnnounce();

  const badge = document.createElement('div');
  badge.className = 'trophy-badge';
  badge.innerHTML = `
    <div class="trophy-emoji">🏆</div>
    <div class="trophy-text"><strong>${escapeHtml(champName)}</strong>
      <div class="trophy-sub">Title defended</div>
    </div>
  `;

  badge.style.position = 'fixed';
  badge.style.top = '24px';
  badge.style.right = '24px';
  badge.style.zIndex = 20000;
  badge.style.pointerEvents = 'none';
  document.body.appendChild(badge);

  const live = ensureLiveAnnounce();
  live.textContent = `${champName} defended the title`;

  requestAnimationFrame(()=> badge.classList.add('trophy-badge--enter'));
  setTimeout(()=> {
    badge.classList.remove('trophy-badge--enter');
    setTimeout(()=> badge.remove(), 360);
  }, 2400);
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
// --- Challenge submission (updated: skip original webhook when match causes a sweep) ---
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
    // 1) write the recorded match entry
    const mRef = push(ref(db, 'matches'));
    await set(mRef, match);

    // 2) Apply game-state updates that follow a match result
    if (winnerId === challengerId){
      // challenger won: becomes new champion
      const previousChampion = championId;
      try { /* placeholder for any counters */ } catch(e){}

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
      // champion defended
      await set(ref(db, `defeats/${challengerId}`), true);
      await set(ref(db, 'timer/endTimestamp'), Date.now() + WEEK_MS);

      const idx = playersOrderArr.indexOf(challengerId);
      if (idx !== -1) {
        playersOrderArr.splice(idx,1);
        playersOrderArr.push(challengerId);
        await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
      }

      setTimeout(()=> {
        try { triggerChampionGlow(1000); } catch (e) { console.error('triggerChampionGlow error', e); }
      }, 60);

      try {
        const champName = players[championId]?.name || 'Champion';
        try { triggerConfetti(); } catch (e) { console.error('triggerConfetti error', e); }
        showTrophyBadge(champName);
      } catch (e) { console.error('showTrophyBadge error', e); }
    }

    // 3) After applying updates, determine whether this match caused a sweep.
    //    Read defeats and playersOrder from DB to compute authoritative sweep state.
    try {
      const [defSnap, orderSnap] = await Promise.all([
        get(ref(db, 'defeats')),
        get(ref(db, 'playersOrder'))
      ]);
      const defeatsVal = defSnap.exists() ? defSnap.val() : {};
      const defeatedKeys = typeof defeatsVal === 'object' ? Object.keys(defeatsVal) : [];
      const defeatedSet = new Set(defeatedKeys);

      let orderedArr = [];
      if (orderSnap.exists()){
        const orderVal = orderSnap.val();
        orderedArr = Object.entries(orderVal)
          .map(([k,id])=>({idx: Number(k), id}))
          .filter(x => x.id)
          .sort((a,b)=>a.idx-b.idx)
          .map(e=>e.id);
      } else {
        orderedArr = Object.keys(players || {}).sort();
      }

      // compute whether all challengers (non-champion players) are defeated
      const champNowSnap = await get(ref(db, 'championId'));
      const champNowId = champNowSnap.exists() ? champNowSnap.val() : championId;
      const challengers = Object.keys(players || {}).filter(id => id !== champNowId);
      const causesSweep = challengers.length > 0 && challengers.every(id => defeatedSet.has(id));

      // update local isSweep
      isSweep = causesSweep;
    } catch (e) {
      console.warn('submitChallenge: could not compute sweep state after match', e);
      // fallback keep existing isSweep
    }

    // 4) Post to Discord only if this match did NOT cause a sweep.
    //    If it DID cause a sweep, defeats listener will create the sweep entry and post the Winner! message.
    if (!isSweep) {
      postToDiscord(match, mRef.key).catch(e => console.error('Discord notify failed', e));
    } else {
      // Mark original match as discordNotified to be explicit (prevents accidental re-posts)
      try { await set(ref(db, `matches/${mRef.key}/discordNotified`), true); } catch(e){ /* ignore */ }
    }

    // 5) Update local state and UI
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
    // previous champion reset handled during challenge submission
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

  // Guarded sweep creation + single-post behavior
  if (isSweep && !prevIsSweep) {
    try {
      const championSnap = await get(ref(db, 'championId'));
      const currentChampionId = championSnap.exists() ? championSnap.val() : null;

      if (!currentChampionId) {
        console.warn('Sweep detected but no championId available from DB');
      } else {
        const playerSnap = await get(ref(db, `players/${currentChampionId}`));
        const championName = playerSnap.exists() ? (playerSnap.val().name || 'Unknown') : 'Unknown';

        // Attempt to find the causing (most recent non-sweep) match
        let causing = null;
        try {
          const allSnap = await get(ref(db, 'matches'));
          const allVal = allSnap.exists() ? allSnap.val() : null;
          if (allVal) {
            const sorted = Object.entries(allVal)
              .map(([k,v]) => ({ key: k, val: v }))
              .sort((a,b) => (b.val.timestamp||0) - (a.val.timestamp||0));
            causing = sorted.find(entry => entry.val && entry.val.type !== 'sweep') || null;
          }
        } catch (e) {
          console.warn('Could not fetch matches to find causing match', e);
        }

        // If a causing match exists, check whether we've already created a sweep for it
        if (causing && causing.key) {
          try {
            const allSnap2 = await get(ref(db, 'matches'));
            const allVal2 = allSnap2.exists() ? allSnap2.val() : null;
            if (allVal2) {
              const existingSweepForCausing = Object.entries(allVal2).find(([k,v]) =>
                v && v.type === 'sweep' && (v.causingMatchKey === causing.key || v.causingMatchKey === causing.key)
              );
              if (existingSweepForCausing) {
                console.log('Sweep already exists for causing match', causing.key, '— skipping creation');
                // Ensure the causing match is marked as notified so the original webhook won't post
                try { await set(ref(db, `matches/${causing.key}/discordNotified`), true); } catch(e){}
                triggerSweepExplosion();
                renderAll();
                return;
              }
            }
          } catch (e) {
            console.warn('Could not check existing sweeps', e);
          }
        }

        // Build the sweep entry that includes champion/challenger fields using canonical order (first & second)
        const sweepMatchBase = {
          type: 'sweep',
          winnerId: currentChampionId,
          winnerName: championName,
          timestamp: Date.now()
        };

        try {
          const orderSnap = await get(ref(db, 'playersOrder'));
          if (orderSnap.exists()) {
            const orderedArr = Object.entries(orderSnap.val())
              .map(([k,id])=>({idx: Number(k), id}))
              .filter(x => x.id)
              .sort((a,b)=>a.idx-b.idx)
              .map(e=>e.id);

            const first = orderedArr[0] || Object.keys(players || {})[0] || null;
            const second = orderedArr[1] || Object.keys(players || {})[1] || null;

            if (first) {
              sweepMatchBase.championId = first;
              sweepMatchBase.championName = players[first]?.name || first;
            }
            if (second) {
              sweepMatchBase.challengerId = second;
              sweepMatchBase.challengerName = players[second]?.name || second;
            }
          } else {
            sweepMatchBase.championId = currentChampionId;
            sweepMatchBase.championName = championName;
            const allIds = Object.keys(players || {});
            const challengerCandidate = allIds.find(id => id !== currentChampionId) || null;
            if (challengerCandidate) {
              sweepMatchBase.challengerId = challengerCandidate;
              sweepMatchBase.challengerName = players[challengerCandidate]?.name || challengerCandidate;
            }
          }
        } catch (e) {
          console.warn('Could not read playersOrder for sweep entry', e);
        }

        // Attach causing match metadata if available (helps later checks)
        if (causing && causing.key && causing.val) {
          sweepMatchBase.causingMatchKey = causing.key;
          sweepMatchBase.causingMatchTimestamp = causing.val.timestamp || null;

          // Copy recorded challenger/champion if not already set
          sweepMatchBase.challengerId = sweepMatchBase.challengerId || causing.val.challengerId || null;
          sweepMatchBase.challengerName = sweepMatchBase.challengerName || causing.val.challengerName || causing.val.challengerId || null;
          sweepMatchBase.championId = sweepMatchBase.championId || causing.val.championId || currentChampionId;
          sweepMatchBase.championName = sweepMatchBase.championName || causing.val.championName || championName;
          sweepMatchBase.triggeringWinnerId = causing.val.winnerId || null;
          sweepMatchBase.triggeringWinnerName = causing.val.winnerName || null;
        }

        // Write sweep entry
        const mRef = push(ref(db, 'matches'));
        await set(mRef, sweepMatchBase);
        console.log('Recorded sweep match for', currentChampionId, championName, 'pushKey:', mRef.key);

        // Mark the causing match as notified so submitChallenge (or any other notifier) will not post it
        if (causing && causing.key) {
          try { await set(ref(db, `matches/${causing.key}/discordNotified`), true); } catch(e){ console.warn('Could not mark causing match as discordNotified', e); }
        }

        // Immediately post the sweep notification with no delay and let postToDiscord mark the record as notified
        postToDiscord(sweepMatchBase, mRef.key, { delayMs: 0 }).catch(e => {
          console.error('Sweep Discord notify failed', e);
        });
      }
    } catch (e) {
      console.error('Error recording sweep match', e);
    }

    triggerSweepExplosion();
  }

  renderAll();
});

// Timer listener: update countdown and re-render safely when DOM is ready
onValue(ref(db, 'timer/endTimestamp'), snap=>{
  timerEnd = snap.val() || null;

  if (timerEnd){
    startLocalCountdown();
  } else {
    updateTimerDisplay();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    renderAll();
  } else {
    document.addEventListener('DOMContentLoaded', renderAll, { once: true });
  }
});

// --- Helper to render everything ---
function renderAll(){
  ensureSection('champion-card', 'Champion');
  ensureSection('challenge-section', 'Challenger');
  ensureSection('roster', 'Roster');
  ensureSection('match-list', 'Match History');

  renderChampion();
  renderChallengeSection();

  if (typeof renderRoster === 'function') renderRoster();
  if (typeof renderMatchHistory === 'function') renderMatchHistory();

  const addBtn = $('add-player-button');
  if (addBtn){
    addBtn.disabled = Boolean(isSweep || championId);
  }
}

// --- Initial mount ---
document.addEventListener('DOMContentLoaded', ()=>{
  renderAll();
});
