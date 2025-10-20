document.addEventListener("DOMContentLoaded", () => {

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

let defeatedByChampion = new Set();
let exChampionId = null;

let challengeQueue = [];
let currentTimer = null;
let currentChallengerId = null;  
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

    // Apply red style if they lost to current champion or are ex-champion
    if (defeatedByChampion.has(id) || id === exChampionId) {
      btn.classList.add('lost-to-champion');
    }

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

      // Update defeat tracking
 if (winnerId === challengerId) {
  defeatedByChampion.clear();
  exChampionId = championId;
  await championRef.set(challengerId);
  animateCrownTransfer(players[championId]?.name || 'Unknown', p.name);
} else {
  defeatedByChampion.add(challengerId);
  animateFailedChallenge(p.name, champion.name);
}
      renderRoster(); // refresh button styles
    };

    roster.appendChild(btn);
  });
}

// 👑 Crown Transfer Animation
function animateCrownTransfer(fromName, toName) {
  const crown = document.createElement('div');
  crown.id = 'crown-transfer';
  crown.textContent = `👑 Crown passed from ${fromName} to ${toName}!`;
  document.body.appendChild(crown);
  setTimeout(() => crown.remove(), 2000);
}
function animateFailedChallenge(challengerName, championName) {
  const fail = document.createElement('div');
  fail.id = 'challenge-fail';
  fail.textContent = `❌ ${challengerName} failed to dethrone ${championName}`;
  document.body.appendChild(fail);
  setTimeout(() => fail.remove(), 2000);
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
function renderChallengeQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = '';

  challengeQueue.forEach(id => {
    const li = document.createElement('li');
    li.textContent = players[id]?.name || 'Unknown';
    li.setAttribute('draggable', true);
    li.dataset.id = id;

    // Drag events
    li.addEventListener('dragstart', () => {
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
    });

    list.appendChild(li);
  });
}
const queueList = document.getElementById('queue-list');

queueList.addEventListener('dragover', e => {
  e.preventDefault();
  const dragging = document.querySelector('.dragging');
  const afterElement = getDragAfterElement(queueList, e.clientY);
  if (afterElement == null) {
    queueList.appendChild(dragging);
  } else {
    queueList.insertBefore(dragging, afterElement);
  }
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('li:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}
// 🔄 Listeners
playersRef.on('value', snap => {
  players = snap.val() || {};
  playersReady = true;
  maybeRender();
});

championRef.on('value', snap => {
  const newChampionId = snap.val();
  if (championId && championId !== newChampionId) {
    exChampionId = championId;
  }
  championId = newChampionId;
  championReady = true;
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
function startNextChallengeTimer() {
  if (challengeQueue.length === 0) {
    document.getElementById('next-challenger-name').textContent = 'Waiting...';
    document.getElementById('challenge-timer').textContent = '--:--';
    return;
  }

  currentChallengerId = challengeQueue.shift();
  const challenger = players[currentChallengerId];
  document.getElementById('next-challenger-name').textContent = challenger.name;

  let timeLeft = 60; // seconds
  document.getElementById('challenge-timer').textContent = `${timeLeft}s`;

  currentTimer = setInterval(() => {
    timeLeft--;
    document.getElementById('challenge-timer').textContent = `${timeLeft}s`;

    if (timeLeft <= 0) {
      clearInterval(currentTimer);
      handleChallengeTimeout(currentChallengerId);
      startNextChallengeTimer(); // move to next
    }
  }, 1000);
}

function handleChallengeTimeout(challengerId) {
  const challengeId = firebase.database().ref('challenges').push().key;
  const challenge = {
    id: challengeId,
    challengerId,
    targetId: championId,
    description: 'Timed out',
    winnerId: championId,
    timestamp: Date.now(),
    status: 'timeout'
  };

  firebase.database().ref('challenges/' + challengeId).set(challenge);
  defeatedByChampion.add(challengerId);
  renderRoster();
}
  function fillChallengeQueue() {
  challengeQueue = Object.keys(players).filter(id => id !== championId);
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
});

  document.getElementById('new-player-name').value = '';
});

