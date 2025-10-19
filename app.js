// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, onValue, set, get, child, update, push, runTransaction } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

// Your Firebase config (from your project)
const firebaseConfig = {
  apiKey: "AIzaSyApvqkHwcKL7dW0NlArkRAByQ8ia8d-TAk",
  authDomain: "the-challenge-league.firebaseapp.com",
  databaseURL: "https://the-challenge-league-default-rtdb.firebaseio.com",
  projectId: "the-challenge-league",
  storageBucket: "the-challenge-league.firebasestorage.app",
  messagingSenderId: "193530358761",
  appId: "1:193530358761:web:0d86448eddd2a14a973978",
  measurementId: "G-LNQ8DS3R2E"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Firebase references
const playersRef = ref(db, 'players');
const championRef = ref(db, 'championId');
const challengesRef = ref(db, 'challenges');

// Global cache
let players = {};
let championId = null;
let challenges = [];

// 🏆 Render Champion
function renderChampion() {
  const el = document.getElementById('champion-card');
  const champ = players[championId];
  el.innerHTML = champ
    ? `<h2>Champion</h2><div><strong>${champ.name}</strong><br>Points: ${champ.points || 0}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

// 👥 Render Roster
function renderRoster() {
  const roster = document.getElementById('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  Object.entries(players).forEach(([id, p]) => {
    const btn = document.createElement('button');
    btn.textContent = `${p.name} (${p.points || 0})`;
    btn.onclick = () => openChallengeForm(id);
    roster.appendChild(btn);
  });

  const challengerSelect = document.getElementById('challenger-select');
  challengerSelect.innerHTML = Object.entries(players)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`)
    .join('');
}

// ⚔️ Render Challenge Queue
function renderQueue() {
  const queue = document.getElementById('challenge-queue');
  queue.innerHTML = '<h2>Challenge Queue</h2>';
  challenges
    .filter(c => c.status === 'pending')
    .forEach(c => {
      const li = document.createElement('div');
      li.textContent = `${players[c.challengerId].name} vs ${players[c.targetId].name}`;
      const btn = document.createElement('button');
      btn.textContent = 'Resolve';
      btn.onclick = () => resolvePrompt(c);
      li.appendChild(btn);
      queue.appendChild(li);
    });
}

// 📝 Submit Challenge
document.getElementById('submit-challenge').addEventListener('click', () => {
  const challengerId = document.getElementById('challenger-select').value;
  const targetName = document.getElementById('target-input').value.trim();
  const targetEntry = Object.entries(players).find(([id, p]) => p.name === targetName);
  if (!targetEntry) return alert("Player not found.");
  const [targetId] = targetEntry;
  const id = push(challengesRef).key;
  const challenge = {
    id,
    challengerId,
    targetId,
    timestamp: Date.now(),
    status: 'pending'
  };
  set(ref(db, `challenges/${id}`), challenge);
});

// 🏁 Resolve Challenge
function resolvePrompt(challenge) {
  const winnerName = prompt(`Who won?\n${players[challenge.challengerId].name} or ${players[challenge.targetId].name}`);
  const winnerEntry = Object.entries(players).find(([id, p]) => p.name === winnerName);
  if (!winnerEntry) return alert("Invalid winner.");
  const [winnerId] = winnerEntry;
  resolveChallenge(challenge.id, winnerId);
}

async function resolveChallenge(challengeId, winnerId) {
  const challengeSnap = await get(child(ref(db), `challenges/${challengeId}`));
  if (!challengeSnap.exists()) return;
  const c = challengeSnap.val();
  const loserId = winnerId === c.challengerId ? c.targetId : c.challengerId;

  // Update challenge
  await update(ref(db, `challenges/${challengeId}`), {
    status: 'resolved',
    result: winnerId === c.challengerId ? 'challenger' : 'target'
  });

  // Update points
  const winnerPointsRef = ref(db, `players/${winnerId}/points`);
  const loserPointsRef = ref(db, `players/${loserId}/points`);

  runTransaction(winnerPointsRef, (points) => (points || 0) + 15);
  runTransaction(loserPointsRef, (points) => Math.max(0, (points || 0) - 3));

  // Update champion if needed
  const champSnap = await get(championRef);
  if (champSnap.exists() && c.targetId === champSnap.val() && winnerId === c.challengerId) {
    set(championRef, winnerId);
  }
}

// 🔄 Firebase Listeners
onValue(playersRef, (snap) => {
  players = snap.val() || {};
  renderRoster();
  renderChampion();
});

onValue(championRef, (snap) => {
  championId = snap.val();
  renderChampion();
});

onValue(challengesRef, (snap) => {
  challenges = snap.val() ? Object.values(snap.val()) : [];
  renderQueue();
});
