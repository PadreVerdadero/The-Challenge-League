// app.js - chunk 1 of N
// Firebase imports (adjust version if needed)
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  get,
  remove,
  update,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// --- Initialization and globals ---
const db = getDatabase();
const DISCORD_WEBHOOK = ''; // set if you use webhook notifications
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

let players = {};               // map id -> { name, wins, losses, ... }
let playersOrderArr = [];       // canonical order array of player ids
let championId = null;          // current champion id
let isSweep = false;            // sweep state flag
let currentChallengerId = null; // id of the challenger currently shown
const defeated = new Set();     // set of defeated player ids (transient UI state)

// --- Small helpers ---
const $ = id => document.getElementById(id);

function ensureSection(id, title){
  let el = document.getElementById(id);
  if (!el) {
    const container = $('app') || document.body;
    const section = document.createElement('section');
    section.id = id;
    section.className = 'card';
    section.innerHTML = `<h2>${title}</h2>`;
    container.appendChild(section);
    el = section;
  }
  return el;
}

// --- Render orchestration ---
function renderAll(){
  try {
    renderChampion();
    renderChampionActions();
    renderChallengeSection();
    renderRoster();
    renderMatchHistory && renderMatchHistory();
  } catch (e) {
    console.error('renderAll error', e);
  }
}

// --- Champion rendering ---
function renderChampion(){
  const el = ensureSection('champion', 'Champion');
  el.innerHTML = `<h2>Champion</h2>`;

  const wrap = document.createElement('div');
  wrap.className = 'champion-wrap';

  if (championId && players && players[championId]) {
    const champ = players[championId];
    const champWins = Number(champ.wins || 0);
    const champLosses = Number(champ.losses || 0);

    wrap.innerHTML = `
      <span class="champ-name">👑 ${escapeHtml(champ.name)}</span>
      <span class="player-wl"><span class="wins">${champWins}</span><span class="dash">-</span><span class="losses">${champLosses}</span></span>
      <span id="champion-actions-area"></span>
    `;
  } else {
    wrap.innerHTML = `<span class="champ-name no-champ">No champion yet</span><span id="champion-actions-area"></span>`;
  }

  el.appendChild(wrap);
}

// --- Champion actions (full, safe) ---
async function renderChampionActions(){
  const area = document.getElementById('champion-actions-area');
  if (!area) return;
  area.innerHTML = '';

  // Nothing to render if no champion
  if (!championId || !players || !players[championId]) return;

  // If a sweep is active, show the Clear Champion button that also resets W-L and order
  if (isSweep) {
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Champion (end sweep)';
    clearBtn.className = 'record-btn';
    clearBtn.addEventListener('click', async () => {
      try {
        // Clear champion, defeats, and timer
        await set(ref(db, 'championId'), null);
        await remove(ref(db, 'defeats'));
        await remove(ref(db, 'timer/endTimestamp'));
        isSweep = false;
        currentChallengerId = null;

        // Reset playersOrder to canonical list
        const allIds = Object.keys(players || {});
        playersOrderArr = allIds.slice();
        await set(ref(db, 'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));

        // Reset all players' wins and losses to zero
        const playersSnap = await get(ref(db, 'players'));
        if (playersSnap.exists()) {
          const playersObj = playersSnap.val();
          const updates = {};
          Object.keys(playersObj).forEach(pid => {
            updates[`players/${pid}/wins`] = 0;
            updates[`players/${pid}/losses`] = 0;
          });
          await update(ref(db), updates);
        }

        renderAll();
      } catch (e) {
        console.error('Error clearing champion', e);
      }
    });
    area.appendChild(clearBtn);
    return;
  }

  // When not in sweep, show Remove Champion and a manual "Lock In Order" option
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove Champion';
  removeBtn.className = 'record-btn';
  removeBtn.addEventListener('click', async () => {
    try {
      await set(ref(db, 'championId'), null);
      await remove(ref(db, 'defeats'));
      await remove(ref(db, 'timer/endTimestamp'));
      renderAll();
    } catch (e) {
      console.error('Error removing champion', e);
    }
  });
  area.appendChild(removeBtn);

  const lockBtn = document.createElement('button');
  lockBtn.textContent = 'Lock In Order';
  lockBtn.className = 'record-btn';
  lockBtn.addEventListener('click', async () => {
    try {
      await set(ref(db, 'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
      renderAll();
    } catch (e) {
      console.error('Error locking in order', e);
    }
  });
  area.appendChild(lockBtn);
}

// --- Challenge section (always show next challenger; allow recording even when overdue) ---
function renderChallengeSection(){
  const el = ensureSection('challenge-section', 'Challenger');
  el.innerHTML = `<h2>Challenger</h2>`;

  const ordered = (playersOrderArr && playersOrderArr.length) ? playersOrderArr.slice() : Object.keys(players || {}).sort();
  const nextUpId = ordered.find(id => id && id !== championId && players && players[id]) || null;

  currentChallengerId = nextUpId;
  window._currentChallengerId = () => currentChallengerId;

  const row = document.createElement('div');
  row.className = 'next-up-row';

  const name = document.createElement('div');
  name.className = 'next-up-name';
  name.textContent = (nextUpId && players[nextUpId]) ? (players[nextUpId].name || 'Unknown') : 'No active challenger';
  row.appendChild(name);

  if (nextUpId && players[nextUpId]) {
    const cWins = Number(players[nextUpId].wins || 0);
    const cLosses = Number(players[nextUpId].losses || 0);
    const wl = document.createElement('span');
    wl.className = 'player-wl';
    wl.innerHTML = `<span class="wins">${cWins}</span><span class="dash">-</span><span class="losses">${cLosses}</span>`;
    row.appendChild(wl);
  }
  // app.js - chunk 2 of N (continue from renderChallengeSection)
  const btn = document.createElement('button');
  btn.className = 'record-btn';
  btn.textContent = 'Record Challenge';
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

    const nameBtn = document.createElement('button');
    nameBtn.className='roster-name';
    nameBtn.textContent = p.name;

    const wl = document.createElement('span');
    wl.className = 'player-wl';
    const wins = Number(players[id]?.wins || 0);
    const losses = Number(players[id]?.losses || 0);
    wl.innerHTML = `<span class="wins">${wins}</span><span class="dash">-</span><span class="losses">${losses}</span>`;
    row.appendChild(wl);

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
      down.disabled = movesDisabled || (position === visibleIds.length - 1);
      down.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if (movesDisabled) return;
        const idx = playersOrderArr.indexOf(id);
        if (idx >= 0 && idx < playersOrderArr.length - 1){
          [playersOrderArr[idx+1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx+1]];
          await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        }
      });
      row.append(up, down);
    }

    el.appendChild(row);
  });

  // Add player form
  const addWrap = document.createElement('div');
  addWrap.style.marginTop = '12px';
  addWrap.innerHTML = `
    <input id="new-player-name" placeholder="New player name" />
    <button id="add-player-button" class="record-btn">Add Player</button>
  `;
  el.appendChild(addWrap);

  // Wire up add button (idempotent)
  const addBtnEl = $('add-player-button');
  const inputEl = $('new-player-name');
  if (addBtnEl && !addBtnEl._wired) {
    addBtnEl._wired = true;
    addBtnEl.addEventListener('click', async ()=>{
      const name = (inputEl.value || '').trim();
      if (!name) return alert('Enter a name');
      const id = name.toLowerCase().replace(/\s+/g,'-') + '-' + Date.now().toString(36);
      try {
        await set(ref(db, `players/${id}`), { name, wins: 0, losses: 0 });
        playersOrderArr.push(id);
        await set(ref(db,'playersOrder'), Object.fromEntries(playersOrderArr.map((v,i)=>[i,v])));
        inputEl.value = '';
      } catch (e) {
        console.error('add player error', e);
      }
    });
  }
}
// app.js - chunk 3 of N (continuation and utilities)

// --- Match history rendering (simple) ---
function renderMatchHistory(){
  const el = ensureSection('match-history', 'Match History');
  el.innerHTML = `<h2>Match History</h2>`;
  const listWrap = document.createElement('div');
  listWrap.id = 'match-list';
  el.appendChild(listWrap);

  // Read matches from a local cache if present (assume `matches` map), otherwise show placeholder
  if (typeof matches !== 'object' || Object.keys(matches || {}).length === 0) {
    listWrap.innerHTML = '<p>No matches recorded yet</p>';
    return;
  }

  // matches assumed to be an object id -> { challengerId, championId, winnerId, timestamp, note }
  const items = Object.entries(matches).sort((a,b)=> {
    const ta = a[1].timestamp || 0;
    const tb = b[1].timestamp || 0;
    return tb - ta;
  });

  items.forEach(([mid, m])=>{
    const row = document.createElement('div');
    row.className = 'card';
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : 'Unknown time';
    const winnerName = (m.winnerId && players && players[m.winnerId]) ? players[m.winnerId].name : (m.winnerName || 'Unknown');
    const desc = document.createElement('div');
    desc.className = 'match-desc';
    desc.textContent = `${time} — ${winnerName} won`;
    if (m.note) {
      const note = document.createElement('div');
      note.style.color = 'var(--muted)';
      note.style.fontSize = '13px';
      note.textContent = m.note;
      row.append(desc, note);
    } else {
      row.appendChild(desc);
    }
    listWrap.appendChild(row);
  });
}

// --- Challenge modal (simple overlay) ---
function openChallengeModal(challengerId){
  // create modal if not exists
  let modal = $('challenge-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'challenge-modal';
    modal.innerHTML = `
      <div class="panel">
        <h3>Record Challenge</h3>
        <div id="modal-body"></div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="modal-cancel" class="record-btn">Cancel</button>
          <button id="modal-submit" class="record-btn">Submit</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    $('modal-cancel').addEventListener('click', ()=> { modal.remove(); });
  }

  const body = modal.querySelector('#modal-body');
  const champName = championId && players[championId] ? players[championId].name : 'No champion';
  const chalName = challengerId && players[challengerId] ? players[challengerId].name : 'Unknown';
  body.innerHTML = `
    <p><strong>Champion:</strong> ${escapeHtml(champName)}</p>
    <p><strong>Challenger:</strong> ${escapeHtml(chalName)}</p>
    <label>Winner:
      <select id="modal-winner">
        <option value="${championId}">${escapeHtml(champName)}</option>
        <option value="${challengerId}">${escapeHtml(chalName)}</option>
      </select>
    </label>
    <label style="display:block; margin-top:8px;">Note:
      <textarea id="modal-note" rows="3" style="width:100%;"></textarea>
    </label>
  `;

  $('modal-submit').onclick = async () => {
    const winnerId = document.getElementById('modal-winner').value;
    const note = document.getElementById('modal-note').value || '';
    await submitChallenge({ challengerId, championId, winnerId, note });
    modal.remove();
  };

  // show modal
  modal.style.display = 'flex';
}

// --- Submit a challenge result ---
async function submitChallenge({ challengerId, championId, winnerId, note }){
  try {
    const mRef = push(ref(db, 'matches'));
    const match = {
      challengerId: challengerId || null,
      championId: championId || null,
      winnerId: winnerId || null,
      note: note || '',
      timestamp: Date.now()
    };
    await set(mRef, match);

    // Update W-L counters atomically
    try {
      const loserId = (winnerId === challengerId) ? championId : challengerId;

      if (winnerId) {
        await runTransaction(ref(db, `players/${winnerId}/wins`), current => {
          return (Number(current) || 0) + 1;
        });
      }
      if (loserId) {
        await runTransaction(ref(db, `players/${loserId}/losses`), current => {
          return (Number(current) || 0) + 1;
        });
      }
    } catch (e) {
      console.warn('Could not update W-L counters', e);
    }

    // If the champion lost and that triggers a sweep or other logic, handle it elsewhere
    renderAll();
  } catch (e) {
    console.error('submitChallenge error', e);
  }
}

// --- Timer display update (simple) ---
function updateTimerDisplay(){
  const el = $('timer-display');
  if (!el) return;
  // read timer from DB snapshot if available (we keep a local timerEnd variable)
  const endTs = window._timerEndTimestamp || null;
  if (!endTs) {
    el.textContent = '';
    return;
  }
  const remaining = endTs - Date.now();
  if (remaining <= 0) {
    el.textContent = 'Challenge window expired';
  } else {
    const days = Math.floor(remaining / (24*60*60*1000));
    const hours = Math.floor((remaining % (24*60*60*1000)) / (60*60*1000));
    const mins = Math.floor((remaining % (60*60*1000)) / (60*1000));
    el.textContent = `Time left: ${days}d ${hours}h ${mins}m`;
  }
}

// --- Utility: escape HTML for safe insertion ---
function escapeHtml(str){
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Local caches for matches and timer ---
let matches = {};
window._timerEndTimestamp = null;

// --- Firebase listeners to keep local state in sync ---
function startFirebaseListeners(){
  // players
  onValue(ref(db, 'players'), (snap) => {
    players = snap.exists() ? snap.val() : {};
    renderAll();
  });

  // playersOrder
  onValue(ref(db, 'playersOrder'), (snap) => {
    const val = snap.exists() ? snap.val() : null;
    if (val) {
      // convert object map to array by numeric keys
      playersOrderArr = Object.entries(val)
        .map(([k,id])=>({idx: Number(k), id}))
        .filter(x => x.id)
        .sort((a,b)=>a.idx-b.idx)
        .map(e=>e.id);
    } else {
      playersOrderArr = [];
    }
    renderAll();
  });

  // championId
  onValue(ref(db, 'championId'), (snap) => {
    championId = snap.exists() ? snap.val() : null;
    renderAll();
  });

  // defeats (sweep state)
  onValue(ref(db, 'defeats'), (snap) => {
    const val = snap.exists() ? snap.val() : null;
    isSweep = Boolean(val && Object.keys(val).length > 0);
    renderAll();
  });

  // matches list
  onValue(ref(db, 'matches'), (snap) => {
    matches = snap.exists() ? snap.val() : {};
    renderAll();
  });

  // timer end timestamp
  onValue(ref(db, 'timer/endTimestamp'), (snap) => {
    const v = snap.exists() ? snap.val() : null;
    window._timerEndTimestamp = v || null;
    updateTimerDisplay();
  });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', ()=>{
  // initial render placeholders
  renderAll();
  // start listeners
  startFirebaseListeners();
  // periodic timer update
  setInterval(updateTimerDisplay, 30 * 1000);
});
