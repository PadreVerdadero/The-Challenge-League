import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push
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

const $ = id => document.getElementById(id);

function renderChampion() {
  const champ = players[championId];
  $('champion-card').innerHTML = champ
    ? `<h2>Champion</h2><div class="champ-name">👑 ${champ.name}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

function renderRoster() {
  const roster = $('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  Object.entries(players).forEach(([id, p]) => {
    if (id === championId) return;
    const btn = document.createElement('button');
    btn.textContent = p.name;
    if (defeated.has(id)) btn.classList.add('lost');
    btn.onclick = () => handleChallenge(id);
    roster.appendChild(btn);
  });
}

function renderMatchHistory() {
  const list = $('match-list');
  list.innerHTML = '';
  matches.slice().reverse().forEach(m => {
    const time = new Date(m.timestamp).toLocaleString();
    const div = document.createElement('div');
    div.textContent = `🏁 ${m.challenger} vs ${m.champion} — Winner: ${m.winner} (${time})`;
    list.appendChild(div);
  });
}

function handleChallenge(challengerId) {
  if (!championId) {
    if (confirm(`${players[challengerId].name} selected. Make them champion?`)) {
      set(ref(db, 'championId'), challengerId);
    }
    return;
  }

  const champ = players[championId];
  const description = prompt(`Describe the challenge between ${players[challengerId].name} and ${champ.name}:`);
  if (!description) return;

  const winnerName = prompt(`Who won?\nType "${players[challengerId].name}" or "${champ.name}"`);
  if (!winnerName) return;

  const match = {
    challenger: players[challengerId].name,
    champion: champ.name,
    winner: winnerName,
    description,
    timestamp: Date.now()
  };

  const matchRef = push(ref(db, 'matches'));
  set(matchRef, match);

  if (winnerName === players[challengerId].name) {
    defeated.add(championId);
    set(ref(db, 'championId'), challengerId);
    defeated.delete(challengerId);
    triggerConfetti();
    alert(`${players[challengerId].name} is the new champion!`);
  } else {
    defeated.add(challengerId);
    alert(`${players[challengerId].name} lost to ${champ.name}`);
  }

  renderChampion();
  renderRoster();
}

function addPlayer() {
  const name = $('new-player-name').value.trim();
  if (!name) return;
  const id = name.toLowerCase().replace(/\s+/g, '-');
  set(ref(db, `players/${id}`), { name });
  $('new-player-name').value = '';
  $('add-player-log').textContent = `Added ${name}`;
}

$('add-player-button').onclick = addPlayer;

function triggerConfetti() {
  const canvas = $('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const particles = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i = 0; i < 100; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20,
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 4,
      size: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360
    });
  }
  let t = 0;
  function draw() {
    t++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (t < 100) requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  draw();
}

// Firebase listeners
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  renderRoster();
});

onValue(ref(db, 'championId'), snap => {
  championId = snap.val();
  renderChampion();
  renderRoster();
});

onValue(ref(db, 'matches'), snap => {
  const val = snap.val();
  matches = val ? Object.values(val) : [];
  renderMatchHistory();
});
