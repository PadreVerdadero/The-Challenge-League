// Initialize Firebase using compat SDK
const firebaseConfig = {
  apiKey: "AIzaSyApvqkHwcKL7dW0NlArkRAByQ8ia8d-TAk",
  authDomain: "the-challenge-league.firebaseapp.com",
  databaseURL: "https://the-challenge-league-default-rtdb.firebaseio.com",
  projectId: "the-challenge-league",
  storageBucket: "the-challenge-league.firebasestorage.app",
  messagingSenderId: "193530358761",
  appId: "1:193530358761:web:7b782c8bdd1a8ac7973978",
  measurementId: "G-ED0WV8KZ6F"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// References
const playersRef = db.ref('players');
const championRef = db.ref('championId');
const challengesRef = db.ref('challenges');

// Global state
let players = {};
let championId = null;
let challenges = [];

let playersReady = false;
let championReady = false;

console.log("App.js loaded");

// 🏆 Champion
function renderChampion() {
  const el = document.getElementById('champion-card');
  const champ = players[championId];
  el.innerHTML = champ
    ? `<h2>Champion</h2><div><span class="champ-name">👑 ${champ.name}</span></div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

// 👥 Roster
function renderRoster() {
  const roster = document.getElementById('roster');
  roster.innerHTML = '<h2>Roster</h2>';

  Object.entries(players).forEach(([id, p]) => {
    if (id === championId) return;

    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.onclick = async () => {
      const challengerId = id;
      const champion = players[championId];
      if (!champion) return alert("No champion is currently set.");

      const description = prompt(`Describe the challenge between ${p.name} and ${champion.name}:`);
      if (!description) return;

      const winnerName = prompt(`Who won?\nType "${p.name}" or "${champion.name}"`);
      const winnerEntry = Object.entries(players).find(([pid, player]) => player.name === winnerName);
      if (!winnerEntry) return alert("Invalid winner name.");
      const [winnerId] = winnerEntry;

      const challengeId = firebase.database().ref('challenges').push().key;
      const challenge = {
        id: challengeId,
        challengerId,
        targetId: championId,
        description,
        winnerId,
        timestamp: Date.now(),
        status: "resolved"
      };

      await firebase.database().ref('challenges/' + challengeId).set(challenge);

      if (winnerId === challengerId) {
        animateCrownTransfer(players[championId]?.name || 'Unknown', p.name);
        await championRef.set(challengerId);
      }
    };

    roster.appendChild(btn);
  });
}

// 🕹️ Match History
function renderMatchHistory() {
  const history = document.getElementById('match-history');
  history.innerHTML = '<h2>Match History</h2>';

  const resolved = challenges
    .filter(c => c.status === 'resolved')
    .sort((a, b) => b.timestamp - a.timestamp);

  if (resolved.length === 0) {
    history.innerHTML += '<p>No matches yet.</p>';
    return;
  }

  resolved.forEach(c => {
    const challenger = players[c.challengerId]?.name || 'Unknown';
    const champion = players[c.targetId]?.name || 'Unknown';
    const winner = players[c.winnerId]?.name || 'Unknown';
    const time = new Date(c.timestamp).toLocaleString();
    const description = c.description || 'No description';

    const entry = document.createElement('div');
    entry.textContent = `🏁 ${challenger} challenged ${champion} — ${description}. Winner: ${winner} (${time})`;
    history.appendChild(entry);
  });
}

// 🏁 Resolve Challenge (legacy flow)
async function resolveChallenge(challengeId, winnerId) {
  const snap = await challengesRef.child(challengeId).get();
  if (!snap.exists()) return;
  const c = snap.val();

  challengesRef.child(challengeId).update({
    status: 'resolved',
    result: winnerId === c.challengerId ? 'challenger' : 'target'
  });

  if (winnerId === c.challengerId) {
    championRef.set(winnerId);
  }
}

// 🔄 Listeners
playersRef.on('value', snap => {
  players = snap.val() || {};
  playersReady = true;
  maybeRender();
});

championRef.on('value', snap => {
  championId = snap.val();
  championReady = true;
  console.log("Champion ID updated to:", championId);
  maybeRender();
});

challengesRef.on('value', snap => {
  challenges = snap.val() ? Object.values(snap.val()) : [];
  renderMatchHistory();
});

function maybeRender() {
  if (playersReady && championReady) {
    renderRoster();
    renderChampion();
  }
}

// ➕ Add Player (name only)
document.getElementById('add-player-button').addEventListener('click', () => {
  console.log("Add Player button clicked");

  const name = document.getElementById('new-player-name').value.trim();
  if (!name) {
    alert("Please enter a player name.");
    return;
  }

  const id = name.toLowerCase().replace(/\s+/g, '');
  console.log("Generated ID:", id);

  if (players[id]) {
    alert("That player already exists. Choose a different name.");
    return;
  }

  firebase.database().ref('players/' + id).set({
    name: name,
  });

  document.getElementById('new-player-name').value = '';
});

// 👑 Crown Transfer Animation
function animateCrownTransfer(fromName, toName) {
  const crown = document.createElement('div');
  crown.id = 'crown-transfer';
  crown.textContent = `👑 Crown passed from ${fromName} to ${toName}!`;
  document.body.appendChild(crown);
  setTimeout(() => crown.remove(), 2000);
}
