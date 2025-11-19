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
let isPendingState = false;

const $ = id => document.getElementById(id);
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Render functions
function renderChampion() {
  const el = $('champion-card');
  if (!el) return;
  const champ = players[championId];
  el.innerHTML = `<h2>Champion</h2>`;
  const div = document.createElement('div');
  if (champ) {
    div.innerHTML = `<span class="champ-name">👑 ${escapeHtml(champ.name)}</span><span id="champion-actions-area"></span>`;
  } else {
    div.innerHTML = `<span class="champ-name no-champ">No champion yet</span><span id="champion-actions-area"></span>`;
  }
  el.appendChild(div);
  renderChampionActions();
}

function renderChampionActions() {
  const area = $('champion-actions-area');
  if (!area) return;
  area.innerHTML = '';
  if (!championId) {
    const btn = document.createElement('button');
    btn.textContent = 'Lock in Order';
    btn.addEventListener('click', async () => {
      const ordered = playersOrderArr.length ? playersOrderArr : Object.keys(players).sort();
      const pick = ordered.find(id => id && players[id]) || null;
      if (!pick) { alert('No players to select as champion'); return; }
      await set(ref(db, 'championId'), pick);
    });
    area.appendChild(btn);
  } else {
    const btn = document.createElement('button');
    btn.textContent = 'Clear Champion';
    btn.addEventListener('click', async () => {
      await set(ref(db, 'championId'), null);
    });
    area.appendChild(btn);
  }
}

function renderChallengeSection() {
  const el = $('challenge-section');
  if (!el) return;

  const ordered = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = ordered.find(id => id && id !== championId && players[id]) || null;
  const nextUpName = nextUpId ? players[nextUpId].name : 'No one';

  el.innerHTML = `<h2>Challenge</h2>`;
  const row = document.createElement('div'); row.className = 'next-up-row';
  const name = document.createElement('div'); name.className = 'next-up-name'; name.textContent = nextUpName;
  row.appendChild(name);
  if (nextUpId) {
    const badge = document.createElement('span'); badge.className = 'challenger-badge'; badge.textContent = 'CHALLENGER';
    row.appendChild(badge);
  }
  const btn = document.createElement('button'); btn.textContent = 'Record Challenge';
  btn.disabled = !nextUpId || !championId;
  btn.addEventListener('click', () => { if (nextUpId) openChallengeModal(nextUpId); });
  row.appendChild(btn);
  el.appendChild(row);

  const timer = document.createElement('div'); timer.id = 'timer-display';
  el.appendChild(timer);
  updateTimerDisplay();
}

function renderRoster() {
  const el = $('roster');
  if (!el) return;
  el.innerHTML = `<h2>Roster</h2>`;
  if (!players || Object.keys(players).length === 0) { el.innerHTML += '<p>No players yet</p>'; return; }

  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  const nextUpId = orderedIds.find(id => id && id !== championId && players[id]) || null;
  const visibleIds = orderedIds.filter(id => id !== championId && players[id]);

  visibleIds.forEach((id, position) => {
    const p = players[id];
    if (!p) return;
    const row = document.createElement('div'); row.className = 'roster-row';
    const handle = document.createElement('div'); handle.className = 'order-handle'; handle.textContent = '☰';
    const nameBtn = document.createElement('button'); nameBtn.className = 'roster-name'; nameBtn.textContent = p.name;
    if (id === nextUpId) nameBtn.classList.add('challenger');
    if (defeated.has(id)) nameBtn.classList.add('lost');

    nameBtn.addEventListener('click', () => {
      if (id === nextUpId) openChallengeModal(id);
      else alert(`${p.name}\nStatus: ${defeated.has(id) ? 'Defeated' : 'Waiting in queue'}`);
    });

    row.append(handle, nameBtn);

    if (visibleIds.length > 1) {
      const up = document.createElement('button'); up.className='move-btn'; up.textContent='↑';
      up.disabled = (position === 0);
      up.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = playersOrderArr.indexOf(id);
        if (idx > 0) { [playersOrderArr[idx-1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx-1]]; await set(ref(db, 'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }
      });
      const down = document.createElement('button'); down.className='move-btn'; down.textContent='↓';
      down.disabled = (position === visibleIds.length - 1);
      down.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = playersOrderArr.indexOf(id);
        if (idx >= 0 && idx < playersOrderArr.length - 1) { [playersOrderArr[idx+1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx+1]]; await set(ref(db, 'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }
      });
      row.append(up, down);
    }

    el.appendChild(row);
  });
}

function renderMatchHistory() {
  const el = $('match-list');
  if (!el) return;
  el.innerHTML = `<h2>Match History</h2>`;
  const sorted = matches.slice().sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  sorted.forEach(m => {
    const div = document.createElement('div');
    const when = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
    div.innerHTML = `🏁 <strong>${escapeHtml(m.challengerName||'Unknown')}</strong> vs <strong>${escapeHtml(m.championName||'Unknown')}</strong> — Winner: <strong>${escapeHtml(m.winnerName||'Unknown')}</strong> ${when ? `(${when})` : ''}`;
    el.appendChild(div);
    if (m.description) {
      const d = document.createElement('div'); d.className = 'match-desc'; d.textContent = m.description; el.appendChild(d);
    }
  });
}

function renderChampionBoard() {
  const el = $('champion-board-list'); if (!el) return;
  el.innerHTML = `<h2>Champion Board</h2>`;
  // champion board will be handled by onValue listener (if present)
}

// Modal
function openChallengeModal(challengerId) {
  if (!championId) return;
  if ($('challenge-modal')) return;
  const challenger = players[challengerId];
  const modal = document.createElement('div'); modal.id='challenge-modal';
  modal.style.position='fixed'; modal.style.left=0; modal.style.top=0; modal.style.width='100%'; modal.style.height='100%'; modal.style.display='flex'; modal.style.alignItems='center'; modal.style.justifyContent='center'; modal.style.background='rgba(0,0,0,0.45)'; modal.style.zIndex=10000;
  const panel = document.createElement('div'); panel.style.background='#0b1220'; panel.style.padding='16px'; panel.style.borderRadius='10px'; panel.style.minWidth='320px'; panel.style.maxWidth='560px'; panel.style.boxShadow='0 8px 30px rgba(0,0,0,0.6)'; panel.style.color='#e6eef8';
  const header = document.createElement('h3'); header.textContent = `Record Challenge: ${challenger.name} vs ${players[championId].name}`; panel.appendChild(header);
  const descArea = document.createElement('textarea'); descArea.rows=4; descArea.style.width='100%'; descArea.placeholder='Short description...'; panel.appendChild(descArea);
  const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='8px'; btnRow.style.marginTop='12px';
  const challengerBtn = document.createElement('button'); challengerBtn.textContent = `${challenger.name} wins`; challengerBtn.style.background='#2b8a3e'; challengerBtn.style.color='#fff';
  challengerBtn.addEventListener('click', async () => { await submitChallenge(challengerId, descArea.value||'', challengerId); closeModal(); });
  const champBtn = document.createElement('button'); champBtn.textContent = `${players[championId].name} wins`; champBtn.style.background='#1f6feb'; champBtn.style.color='#fff';
  champBtn.addEventListener('click', async () => { await submitChallenge(challengerId, descArea.value||'', championId); closeModal(); });
  const cancelBtn = document.createElement('button'); cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click', closeModal);
  btnRow.append(challengerBtn, champBtn, cancelBtn); panel.appendChild(btnRow);
  modal.appendChild(panel); document.body.appendChild(modal);
  function closeModal(){ const m = $('challenge-modal'); if(m) m.remove(); }
}

async function submitChallenge(challengerId, description, winnerId) {
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

    if (winnerId === challengerId) {
      // challenger becomes champion
      await set(ref(db, 'championId'), challengerId);
      // clear defeats
      await remove(ref(db, 'defeats'));
    } else {
      // mark challenger defeated
      await set(ref(db, `defeats/${challengerId}`), true);
      // move challenger to end of order
      const idx = playersOrderArr.indexOf(challengerId);
      if (idx !== -1) { playersOrderArr.splice(idx,1); playersOrderArr.push(challengerId); await set(ref(db, 'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v]))); }
    }
  } catch (e) { console.error('submitChallenge error', e); }
}

// Timer UI helper (light)
function updateTimerDisplay() {
  const el = $('timer-display'); if(!el) return;
  if (isPendingState || !championId) { el.textContent = 'New group challenge pending'; return; }
  if (!timerEnd) { el.textContent = 'No active challenge'; return; }
  const remaining = timerEnd - Date.now();
  el.textContent = remaining > 0 ? `Time left: ${Math.max(0,Math.floor(remaining/1000))}s` : 'Expired';
}

// Add player
async function addPlayer() {
  const input = $('new-player-name'); if (!input) return;
  const name = input.value.trim(); if (!name) return alert('Enter a name');
  const id = name.toLowerCase().replace(/\s+/g,'-');
  await set(ref(db, `players/${id}`), { name });
  // update order if missing
  if (!playersOrderArr.includes(id)) {
    playersOrderArr.push(id);
    await set(ref(db, 'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
  }
  input.value='';
}
$('add-player-button')?.addEventListener('click', addPlayer);

// Firebase listeners
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  // ensure any players appear in order array
  const allIds = Object.keys(players);
  allIds.forEach(id => { if (!playersOrderArr.includes(id)) playersOrderArr.push(id); });
  playersOrderArr = playersOrderArr.filter(id => allIds.includes(id));
  renderRoster();
  renderChallengeSection();
  renderChampion();
});

onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) playersOrderArr = [];
  else playersOrderArr = Object.entries(val).map(([k,id])=>({idx:Number(k),id})).sort((a,b)=>a.idx-b.idx).map(e=>e.id);
  // fill with any players not present
  const allIds = Object.keys(players || {});
  allIds.forEach(id => { if (!playersOrderArr.includes(id)) playersOrderArr.push(id); });
  renderRoster(); renderChallengeSection();
});

onValue(ref(db, 'championId'), snap => {
  championId = snap.val() || null;
  // remove champion from defeated if present
  if (championId) {
    // fetch defeats snapshot handled by defeats listener
  }
  renderChampion();
  renderRoster();
  renderChallengeSection();
});

onValue(ref(db, 'matches'), snap => {
  const val = snap.val() || {};
  matches = Object.values(val);
  renderMatchHistory();
});

onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val || {}));
  // prevent champion from being marked defeated
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
  renderChallengeSection();
});

onValue(ref(db, 'timer/endTimestamp'), snap => {
  timerEnd = snap.val() || null;
  if (timerEnd) isPendingState = false; else isPendingState = true;
  updateTimerDisplay();
});

// Initial mount
document.addEventListener('DOMContentLoaded', () => {
  renderChampion(); renderRoster(); renderChallengeSection(); renderMatchHistory(); renderChampionBoard();
});
