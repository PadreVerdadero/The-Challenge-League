// app.js (modular Firebase SDK)
// Uses the new Realtime DB: challengeleague-ec503
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  update
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBSCn8-SpgtrJz3SRBWfiLL-WXylProWqU",
  authDomain: "challengeleague-ec503.firebaseapp.com",
  databaseURL: "https://challengeleague-ec503-default-rtdb.firebaseio.com",
  projectId: "challengeleague-ec503",
  storageBucket: "challengeleague-ec503.firebasestorage.app",
  messagingSenderId: "120184354429",
  appId: "1:120184354429:web:e28ea3cd8c177b3cd72314"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// State
let players = {};
let championId = null;
let challenges = [];
let challengeQueue = [];
let currentTimer = null;
let currentChallengerId = null;
let defeatedByChampion = new Set();
let exChampionId = null;
let playersReady = false;
let championReady = false;

// Animations / notifications
function animateCrownTransfer(fromName, toName) {
  const crown = document.createElement('div');
  crown.id = 'crown-transfer';
  crown.textContent = `👑 Crown passed from ${fromName} to ${toName}!`;
  document.body.appendChild(crown);
  crown.offsetHeight;
  setTimeout(() => crown.remove(), 2000);
}

function animateFailedChallenge(challengerName, championName) {
  const fail = document.createElement('div');
  fail.id = 'challenge-fail';
  fail.textContent = `❌ ${challengerName} failed to dethrone ${championName}`;
  document.body.appendChild(fail);
  fail.offsetHeight;
  setTimeout(() => fail.remove(), 2000);
}

// Champion render
function renderChampion() {
  const el = document.getElementById('champion-card');
  const champ = players[championId];
  el.innerHTML = champ
    ? `<h2>Champion</h2><div><span class="champ-name">👑 ${champ.name}</span></div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

// Roster render (includes Queue First button and challenge button)
function renderRoster() {
  const roster = document.getElementById('roster');
  roster.innerHTML = '<h2>Roster</h2>';

  if (Object.keys(players).length === 0) {
    roster.innerHTML += '<p>No players found.</p>';
    return;
  }

  Object.entries(players).forEach(([id, p]) => {
    if (id === championId) return;

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';

    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.style.flexGrow = '1';

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

      const challengeRef = push(ref(db, 'challenges'));
      const challengeId = challengeRef.key;
      const challenge = {
        id: challengeId,
        challengerId,
        targetId: championId,
        description,
        winnerId,
        timestamp: Date.now(),
        status: "resolved"
      };

      await set(ref(db, 'challenges/' + challengeId), challenge);

      if (winnerId === challengerId) {
        defeatedByChampion.clear();
        exChampionId = championId;
        await set(ref(db, 'championId'), challengerId);
        animateCrownTransfer(players[championId]?.name || 'Unknown', p.name);
      } else {
        defeatedByChampion.add(challengerId);
        animateFailedChallenge(p.name, champion.name);
      }

      renderRoster();
      renderMatchHistory();
    };

    const queueBtn = document.createElement('button');
    queueBtn.textContent = '⏫ Queue First';
    queueBtn.classList.add('queue-first');
    queueBtn.onclick = () => {
      challengeQueue = [id, ...challengeQueue.filter(qid => qid !== id)];
      renderChallengeQueue();
    };

    container.appendChild(btn);
    container.appendChild(queueBtn);
    roster.appendChild(container);
  });
}

// Match history render
function renderMatchHistory() {
  const history = document.getElementById('match-history');
  history.innerHTML = '<h2>Match History</h2>';

  const resolved = challenges
    .filter(c => c.status === 'resolved' || c.status === 'timeout')
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

// Challenge queue render & drag handlers
function renderChallengeQueue() {
  const list = document.getElementById('queue-list');
  list.innerHTML = '';

  challengeQueue.forEach(id => {
    const li = document.createElement('li');
    li.textContent = players[id]?.name || 'Unknown';
    li.setAttribute('draggable', true);
    li.dataset.id = id;

    li.addEventListener('dragstart', () => li.classList.add('dragging'));
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    list.appendChild(li);
  });
}

const queueListEl = document.getElementById('queue-list');
queueListEl.addEventListener('dragover', e => {
  e.preventDefault();
  const dragging = document.querySelector('.dragging');
  const afterElement = getDragAfterElement(queueListEl, e.clientY);
  if (!dragging) return;
  if (afterElement == null) {
    queueListEl.appendChild(dragging);
  } else {
    queueListEl.insertBefore(dragging, afterElement);
  }
});

queueListEl.addEventListener('dragend', () => {
  const newOrder = [...queueListEl.querySelectorAll('li')].map(li => li.dataset.id);
  challengeQueue = newOrder;
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

function fillChallengeQueue() {
  challengeQueue = Object.keys(players).filter(id => id !== championId);
}

// Timer & timeout handling
function startNextChallengeTimer() {
  if (challengeQueue.length === 0) {
    document.getElementById('next-challenger-name').textContent = 'Waiting...';
    document.getElementById('challenge-timer').textContent = '--:--';
    return;
  }

  currentChallengerId = challengeQueue.shift();
  const challenger = players[currentChallengerId];
  document.getElementById('next-challenger-name').textContent = challenger?.name || 'Unknown';

  let timeLeft = 60;
  document.getElementById('challenge-timer').textContent = `${timeLeft}s`;

  currentTimer = setInterval(() => {
    timeLeft--;
    document.getElementById('challenge-timer').textContent = `${timeLeft}s`;

    if (timeLeft <= 0) {
      clearInterval(currentTimer);
      handleChallengeTimeout(currentChallengerId);
      startNextChallengeTimer();
    }
  }, 1000);
}

function handleChallengeTimeout(challengerId) {
  const challengeRef = push(ref(db, 'challenges'));
  const challengeId = challengeRef.key;
  const challenge = {
    id: challengeId,
    challengerId,
    targetId: championId,
    description: 'Timed out',
    winnerId: championId,
    timestamp: Date.now(),
    status: 'timeout'
  };
  set(ref(db, 'challenges/' + challengeId), challenge);
  defeatedByChampion.add(challengerId);
  renderRoster();
  renderMatchHistory();
}

window.startNextChallengeTimer = startNextChallengeTimer;

// Add player button handler
document.getElementById('add-player-button').addEventListener('click', () => {
  const name = document.getElementById('new-player-name').value.trim();
  if (!name) return alert("Please enter a name.");
  const id = name.toLowerCase().replace(/\s+/g, '');
  set(ref(db, 'players/' + id), { name });
  document.getElementById('new-player-name').value = '';
});

// maybeRender to ensure both players and champion loaded before first render
function maybeRender() {
  console.log("maybeRender:", playersReady, championReady);
  if (playersReady && championReady) {
    fillChallengeQueue();
    renderRoster();
    renderChampion();
    renderChallengeQueue();
    renderMatchHistory();
  }
}

// Firebase listeners (read-only listeners)
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  playersReady = true;
  console.log('players snapshot', players);
  renderRoster();
  renderChallengeQueue();
  maybeRender();
});

onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val();
  if (championId && championId !== newChampionId) {
    exChampionId = championId;
  }
  championId = newChampionId;
  championReady = true;
  console.log('championId', championId);
  renderChampion();
  maybeRender();
});

onValue(ref(db, 'challenges'), snap => {
  const val = snap.val();
  challenges = val ? Object.values(val) : [];
  console.log('challenges', challenges);
  renderMatchHistory();
});
