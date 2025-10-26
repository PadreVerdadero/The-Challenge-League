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

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }

async function persistDefeat(id) {
  await set(ref(db, `defeats/${id}`), true);
}
async function removeDefeat(id) {
  await remove(ref(db, `defeats/${id}`));
}
async function clearAllDefeats() {
  await remove(ref(db, 'defeats'));
}
async function savePlayersOrder() {
  const obj = {};
  playersOrderArr.forEach((id, idx) => obj[idx] = id);
  await set(ref(db, 'playersOrder'), obj);
}

function renderChampion() {
  const champ = players[championId];
  $('champion-card').innerHTML = champ
    ? `<h2>Champion</h2><div class="champ-name">👑 ${champ.name}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

function renderRoster() {
  const roster = $('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  const orderedIds = playersOrderArr.length ? playersOrderArr.slice() : Object.keys(players).sort();
  orderedIds.forEach((id, position) => {
    if (id === championId || !players[id]) return;
    const p = players[id];
    const row = document.createElement('div');
    row.className = 'roster-row';

    const handle = document.createElement('div');
    handle.className = 'order-handle';
    handle.textContent = '☰';

    const nameBtn = document.createElement('button');
    nameBtn.className = 'roster-name';
    nameBtn.textContent = p.name;
    if (defeated.has(id)) nameBtn.classList.add('lost');
    nameBtn.onclick = () => handleRosterClick(id);

    const up = document.createElement('button');
    up.className = 'move-btn';
    up.textContent = '↑';
    up.disabled = position === 0;
    up.onclick = async () => {
      const idx = playersOrderArr.indexOf(id);
      if (idx > 0) {
        [playersOrderArr[idx - 1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx - 1]];
        await savePlayersOrder();
        renderRoster();
      }
    };

    const down = document.createElement('button');
    down.className = 'move-btn';
    down.textContent = '↓';
    down.disabled = position === orderedIds.length - 1;
    down.onclick = async () => {
      const idx = playersOrderArr.indexOf(id);
      if (idx < playersOrderArr.length - 1) {
        [playersOrderArr[idx + 1], playersOrderArr[idx]] = [playersOrderArr[idx], playersOrderArr[idx + 1]];
        await savePlayersOrder();
        renderRoster();
      }
    };

    row.append(handle, nameBtn, up, down);
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

async function handleRosterClick(id) {
  const p = players[id];
  if (!championId) {
    if (confirm(`${p.name} selected. Make them champion?`)) {
      await set(ref(db, 'championId'), id);
      log(`Champion set to ${p.name}`);
    }
    return;
  }

  const desc = prompt(`Describe the challenge between ${p.name} and ${players[championId].name}:`);
  if (!desc) return;
  const winnerName = prompt(`Who won?\nType "${p.name}" or "${players[championId].name}"`);
  if (!winnerName) return;

  const winnerId = winnerName === p.name ? id : championId;
  const match = {
    challengerId: id,
    challengerName: p.name,
    championId,
    championName: players[championId].name,
    winnerId,
    winnerName,
