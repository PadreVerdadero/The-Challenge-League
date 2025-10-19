// Initialize Firebase using the compat SDK
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

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Firebase references
const playersRef = db.ref('players');
const championRef = db.ref('championId');
const challengesRef = db.ref('challenges');

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
  const id = challengesRef.push().key;
  const challenge = {
    id,
    challengerId,
    targetId,
    timestamp: Date.now(),
    status: 'pending'
  };
  challengesRef.child(id).set(challenge);
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
  const snap = await challengesRef.child(challengeId).get();
  if (!snap.exists()) return;
  const c = snap.val();
  const loserId = winnerId === c.challengerId ? c.targetId : c.challengerId;

  // Update challenge
  challengesRef.child(challengeId).update({
    status: 'resolved',
    result: winnerId === c.challengerId ? 'challenger' : 'target'
  });

  // Update points
  playersRef.child(winnerId).child('points').transaction(p => (p || 0) + 15);
  playersRef.child(loserId).child('points').transaction(p => Math.max(0, (p || 0) - 3));

  // Update champion if needed
  const champSnap = await championRef.get();
  if (champSnap.exists() && c.targetId === champSnap.val() && winnerId === c.challengerId) {
    championRef.set(winnerId);
  }
}

// 🔄 Firebase Listeners
playersRef.on('value', snap => {
  players = snap.val() || {};
  renderRoster();
  renderChampion();
});

championRef.on('value', snap => {
  championId = snap.val();
  renderChampion();
});

challengesRef.on('value', snap => {
  challenges = snap.val() ? Object.values(snap.val()) : [];
  renderQueue();
});

document.getElementById('add-player-button').addEventListener('click', () => {
  const name = document.getElementById('new-player-name').value.trim();
  const id = document.getElementById('new-player-id').value.trim().toLowerCase();

  if (!name || !id) {
    alert("Please enter both a name and a unique ID.");
    return;
  }

  if (players[id]) {
    alert("That ID is already taken. Choose a different one.");
    return;
  }

  firebase.database().ref('players/' + id).set({
    name: name,
    points: 0
  });

  document.getElementById('new-player-name').value = '';
  document.getElementById('new-player-id').value = '';
});
