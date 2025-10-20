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

console.log("App.js loaded");

// 🏆 Champion
function renderChampion() {
  const el = document.getElementById('champion-card');
  const champ = players[championId];
  el.innerHTML = champ
    ? `<h2>Champion</h2><div><strong>👑 ${champ.name}</strong><br>Points: ${champ.points || 0}</div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

// 👥 Roster
function renderRoster() {
  const roster = document.getElementById('roster');
  roster.innerHTML = '<h2>Roster</h2>';

  Object.entries(players).forEach(([id, p]) => {
    if (id === championId) return;

    const btn = document.createElement('button');
    btn.textContent = `${p.name} (${p.points || 0})`;
    btn.onclick = async () => {
      const challengerId = id;
      const champion = players[championId];
      if (!champion) return alert("No champion is currently set.");

      const description = prompt(`Describe the challenge between ${p.name} and ${champion.name}:`);
      if (!description) return;

      // Create dropdown for winner selection
      const winnerSelect = document.createElement('select');
      winnerSelect.innerHTML = `
        <option value="">Select winner</option>
        <option value="${challengerId}">${p.name}</option>
        <option value="${championId}">${champion.name}</option>
      `;
      document.body.appendChild(winnerSelect);
      winnerSelect.focus();

      // Wait for selection
      await new Promise(resolve => {
        winnerSelect.addEventListener('change', () => resolve());
      });

      const winnerId = winnerSelect.value;
      document.body.removeChild(winnerSelect);
      if (!winnerId) return alert("No winner selected.");

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

      const loserId = winnerId === challengerId ? championId : challengerId;
      firebase.database().ref('players/' + winnerId + '/points').transaction(p => (p || 0) + 15);
      firebase.database().ref('players/' + loserId + '/points').transaction(p => Math.max(0, (p || 0) - 3));

      if (winnerId === challengerId) {
        animateCrownTransfer(players[championId].name, p.name);
        championRef.set(challengerId);
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

  challengesRef.child(challengeId).update({
    status: 'resolved',
    result: winnerId === c.challengerId ? 'challenger' : 'target'
  });

  playersRef.child(winnerId).child('points').transaction(p => (p || 0) + 15);
  playersRef.child(loserId).child('points').transaction(p => Math.max(0, (p || 0) - 3));

  const champSnap = await championRef.get();
  if (champSnap.exists() && c.targetId === champSnap.val() && winnerId === c.challengerId) {
    championRef.set(winnerId);
  }
}

// 🔄 Listeners
playersRef.on('value', snap => {
  players = snap.val() || {};
  renderRoster();
  renderChampion();
});

championRef.on('value', snap => {
  championId = snap.val();
  renderRoster();
  renderChampion();
});

challengesRef.on('value', snap => {
  challenges = snap.val() ? Object.values(snap.val()) : [];
  renderMatchHistory();
});

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
    points: 0
  });

  document.getElementById('new-player-name').value = '';
});
