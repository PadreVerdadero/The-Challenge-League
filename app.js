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

// App state
let players = {};
let championId = null;
let matches = [];
let defeated = new Set();
let playersOrderArr = [];

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Persist defeat helpers
async function persistDefeat(id) {
  try {
    await set(ref(db, `defeats/${id}`), true);
    console.log('persistDefeat saved for', id);
  } catch (e) {
    console.error('persistDefeat failed for', id, e);
  }
}
async function removeDefeat(id) {
  try {
    await remove(ref(db, `defeats/${id}`));
    console.log('removeDefeat removed for', id);
  } catch (e) {
    console.error('removeDefeat failed for', id, e);
  }
}
async function clearAllDefeats() {
  try {
    await remove(ref(db, 'defeats'));
    console.log('clearAllDefeats removed /defeats node');
  } catch (e) {
    console.error('clearAllDefeats failed', e);
  }
}

// Save players order
async function savePlayersOrder() {
  try {
    const obj = {};
    playersOrderArr.forEach((id, idx) => obj[idx] = id);
    await set(ref(db, 'playersOrder'), obj);
    console.log('playersOrder saved', playersOrderArr);
  } catch (e) {
    console.error('savePlayersOrder failed', e);
  }
}

// Render champion
function renderChampion() {
  const champ = players[championId];
  $('champion-card').innerHTML = champ
    ? `<h2>Champion</h2><div class="champ-name">👑 ${escapeHtml(champ.name)}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

// Render roster with ordering and move controls
function renderRoster() {
  const roster = $('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  if (!players || Object.keys(players).length === 0) {
    roster.innerHTML += '<p>No players yet</p>';
    return;
  }

  // Determine order: use playersOrderArr when present, otherwise fallback to alphabetical keys
  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();

  // Build visible list excluding champion
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

    // Only show move controls when more than 1 visible item
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

// Render match history
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

// Challenge flow (extract for reuse)
async function handleRosterClick(id) {
  const p = players[id];
  if (!p) return;

  // If no champion set, offer to set
  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id);
      log(`Champion set to ${p.name}`);
    }
    return;
  }

  // Prompt for challenge details
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
    const mRef = push(ref(db, 'matches'));
    await set(mRef, match);
    console.log('match written', match);

    if (winnerId === id) {
      // Challenger won: mark previous champion defeated, remove defeat for new champion, set champion,
      // then clear defeats node so UI resets only on explicit dethrone
      const prevChampion = championId;
      if (prevChampion && prevChampion !== id) {
        await persistDefeat(prevChampion);
      }
      await removeDefeat(id);
      await set(ref(db, 'championId'), id);
      // clear all defeats now that a new champion has explicitly been crowned
      await clearAllDefeats();
      triggerConfetti();
      log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
    } else {
      // Challenger lost: persist defeat for challenger
      await persistDefeat(id);
      log(`${p.name} lost to ${players[championId].name}`);
    }

    // Ensure new players are appended to order if missing and saved
    if (!playersOrderArr.includes(id)) {
      playersOrderArr.push(id);
      await savePlayersOrder();
    }

    renderChampion();
    renderRoster();
    renderMatchHistory();
  } catch (err) {
    console.error('Error recording match', err);
    log('Error saving match: ' + err.message);
  }
}

// Confetti animation
function triggerConfetti() {
  const canvas = $('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const parts = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<100;i++){
    parts.push({
      x: Math.random()*canvas.width,
      y: -50 - Math.random()*100,
      vx: (Math.random()-0.5)*6,
      vy: 2 + Math.random()*5,
      size: 6 + Math.random()*8,
      c: colors[Math.floor(Math.random()*colors.length)]
    });
  }
  let frame = 0;
  function draw() {
    frame++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, p.size, p.size*0.6);
    });
    if (frame < 140) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// Add player — append to playersOrderArr if missing
async function addPlayer() {
  const input = $('new-player-name');
  const name = input.value.trim();
  if (!name) { log('Enter a name'); return; }
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try {
    await set(ref(db, `players/${id}`), { name });
    input.value = '';
    // append to order if not present locally; will be saved by listener or explicitly
    if (!playersOrderArr.includes(id)) {
      playersOrderArr.push(id);
      await savePlayersOrder();
    }
    log(`Added ${name}`);
  } catch (err) {
    console.error('Add player failed', err);
    log('Add player failed: ' + err.message);
  }
}
$('add-player-button').addEventListener('click', addPlayer);

// Firebase listeners

// players node
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  console.log('players snapshot', players);
  // Ensure order includes any new players
  const allIds = Object.keys(players);
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

// playersOrder node
onValue(ref(db, 'playersOrder'), snap => {
  const val = snap.val();
  if (!val) {
    playersOrderArr = [];
    console.log('playersOrder empty in DB');
  } else {
    playersOrderArr = Object.entries(val)
      .map(([k, id]) => ({ idx: Number(k), id }))
      .sort((a, b) => a.idx - b.idx)
      .map(e => e.id);
    console.log('playersOrder loaded', playersOrderArr);
  }
  // append missing players
  const allIds = Object.keys(players || {});
  allIds.forEach(pid => { if (!playersOrderArr.includes(pid)) playersOrderArr.push(pid); });
  playersOrderArr = playersOrderArr.filter(pid => allIds.includes(pid));
  renderRoster();
});

// championId node (do NOT auto-clear defeats here)
onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val();
  const prev = championId;
  championId = newChampionId;
  console.log('champion snapshot', { prev, newChampionId });

  // ensure current champion not shown as defeated locally
  if (championId && defeated.has(championId)) defeated.delete(championId);

  renderChampion();
  renderRoster();
});

// matches node
onValue(ref(db, 'matches'), snap => {
  const val = snap.val();
  matches = val ? Object.values(val) : [];
  console.log('matches snapshot count', matches.length);
  renderMatchHistory();
});

// defeats node (persistent defeat flags)
onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val));
  console.log('defeats snapshot loaded', Array.from(defeated));
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
});

// Connectivity test
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
