// app.js (modular Firebase SDK) — updated to your new DB
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  child,
  get
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

// state
let players = {};
let championId = null;
let challenges = [];
let challengeQueue = [];
let currentTimer = null;
let currentChallengerId = null;
let selectedPlayerId = null;

// small UI helpers
function $(id) { return document.getElementById(id); }
function logAddPlayer(msg) { const el = $('add-player-log'); el.textContent = msg; }

// notifications
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

// rendering
function renderChampion() {
  const el = $('champion-card');
  const champ = players[championId];
  el.innerHTML = champ
    ? `<h2>Champion</h2><div><span class="champ-name">👑 ${escapeHtml(champ.name)}</span></div>`
    : `<h2>Champion</h2><div>No champion yet</div>`;
}

function renderRoster() {
  const roster = $('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  if (!players || Object.keys(players).length === 0) {
    roster.innerHTML += '<p>No players found.</p>';
    return;
  }

  Object.entries(players).forEach(([id, p]) => {
    const entry = document.createElement('div');
    entry.style.display = 'flex';
    entry.style.alignItems = 'center';
    entry.style.gap = '8px';

    const nameBtn = document.createElement('button');
    nameBtn.textContent = p.name;
    nameBtn.style.flexGrow = '1';
    nameBtn.dataset.id = id;

    // clicking a player selects them (for create champion) and queues them
    nameBtn.addEventListener('click', () => {
      // select visual
      selectedPlayerId = id;
      Array.from(document.querySelectorAll('#roster button')).forEach(b => b.style.outline = '');
      nameBtn.style.outline = '2px solid #007bff';
      // also add to queue front
      challengeQueue = [id, ...challengeQueue.filter(qid => qid !== id)];
      renderChallengeQueue();
    });

    const queueBtn = document.createElement('button');
    queueBtn.textContent = '⏫ Queue First';
    queueBtn.classList.add('queue-first');
    queueBtn.addEventListener('click', () => {
      challengeQueue = [id, ...challengeQueue.filter(qid => qid !== id)];
      renderChallengeQueue();
    });

    entry.appendChild(nameBtn);
    entry.appendChild(queueBtn);
    roster.appendChild(entry);
  });
}

function renderMatchHistory() {
  const history = $('match-history');
  history.innerHTML = '<h2>Match History</h2>';
  if (!challenges || challenges.length === 0) {
    history.innerHTML += '<p>No matches yet.</p>';
    return;
  }
  const resolved = challenges
    .filter(c => c.status === 'resolved' || c.status === 'timeout')
    .sort((a,b) => b.timestamp - a.timestamp);

  resolved.forEach(c => {
    const challenger = players[c.challengerId]?.name || 'Unknown';
    const champion = players[c.targetId]?.name || 'Unknown';
    const winner = players[c.winnerId]?.name || 'Unknown';
    const time = new Date(c.timestamp).toLocaleString();
    const entry = document.createElement('div');
    entry.textContent = `🏁 ${challenger} vs ${champion} — Winner: ${winner} (${time})`;
    history.appendChild(entry);
  });
}

function renderChallengeQueue() {
  const list = $('queue-list');
  list.innerHTML = '';
  challengeQueue.forEach(id => {
    const li = document.createElement('li');
    li.dataset.id = id;
    const name = players[id]?.name || 'Unknown';
    const span = document.createElement('span');
    span.textContent = name;
    const remove = document.createElement('button');
    remove.textContent = '✖';
    remove.style.marginLeft = '8px';
    remove.addEventListener('click', () => {
      challengeQueue = challengeQueue.filter(qid => qid !== id);
      renderChallengeQueue();
    });
    li.appendChild(span);
    li.appendChild(remove);
    list.appendChild(li);
  });
}

// timer logic
function startNextChallengeTimer() {
  if (currentTimer) return; // already running
  if (challengeQueue.length === 0) {
    $('next-challenger-name').textContent = 'Waiting...';
    $('challenge-timer').textContent = '--:--';
    return;
  }
  advanceToNext();
}

function advanceToNext() {
  if (challengeQueue.length === 0) {
    $('next-challenger-name').textContent = 'Waiting...';
    $('challenge-timer').textContent = '--:--';
    currentTimer = null;
    return;
  }
  currentChallengerId = challengeQueue.shift();
  renderChallengeQueue();
  const challenger = players[currentChallengerId];
  $('next-challenger-name').textContent = challenger?.name || 'Unknown';
  let timeLeft = 60;
  $('challenge-timer').textContent = `${timeLeft}s`;
  currentTimer = setInterval(() => {
    timeLeft--;
    $('challenge-timer').textContent = `${timeLeft}s`;
    if (timeLeft <= 0) {
      clearInterval(currentTimer);
      currentTimer = null;
      handleChallengeTimeout(currentChallengerId).then(() => {
        advanceToNext();
      });
    }
  }, 1000);
}

async function handleChallengeTimeout(challengerId) {
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
  await set(ref(db, 'challenges/' + challengeId), challenge);
  // update local arrays after write will come from listener, but update UI optimistically
  renderMatchHistory();
}

// add player
async function addPlayerFromInput() {
  const name = $('new-player-name').value.trim();
  if (!name) { logAddPlayer('Please enter a name.'); return; }
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try {
    await set(ref(db, `players/${id}`), { name });
    $('new-player-name').value = '';
    logAddPlayer(`Added player ${name}`);
  } catch (e) {
    logAddPlayer(`Error adding player: ${e.message}`);
    console.error(e);
  }
}

// create champion from selected player
async function createChampionFromSelected() {
  if (!selectedPlayerId) { logAddPlayer('Select a player first by clicking their name.'); return; }
  try {
    await set(ref(db, 'championId'), selectedPlayerId);
    logAddPlayer(`Champion set to ${players[selectedPlayerId]?.name || selectedPlayerId}`);
  } catch (e) {
    logAddPlayer(`Error creating champion: ${e.message}`);
    console.error(e);
  }
}

// utility
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

// wiring UI events
function wireUi() {
  $('add-player-button').addEventListener('click', addPlayerFromInput);
  $('create-champion-button').addEventListener('click', createChampionFromSelected);
  $('start-queue-button').addEventListener('click', startNextChallengeTimer);
}

// Firebase listeners
function wireFirebaseListeners() {
  onValue(ref(db, 'players'), snap => {
    players = snap.val() || {};
    console.log('players snapshot', players);
    renderRoster();
    // If queue is empty, fill it with all non-champion players
    if (challengeQueue.length === 0) {
      challengeQueue = Object.keys(players).filter(id => id !== championId);
    }
    renderChallengeQueue();
    renderMatchHistory();
  });

  onValue(ref(db, 'championId'), snap => {
    const newChampionId = snap.val();
    championId = newChampionId;
    console.log('championId snapshot', championId);
    renderChampion();
  });

  onValue(ref(db, 'challenges'), snap => {
    const val = snap.val();
    challenges = val ? Object.values(val) : [];
    console.log('challenges snapshot', challenges);
    renderMatchHistory();
  });
}

// DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  wireUi();
  wireFirebaseListeners();

  // quick connectivity test: try to read a small path and log result
  try {
    const rootSnapshot = await get(ref(db, '/'));
    console.log('Initial DB root:', rootSnapshot.val());
    logAddPlayer('Connected to Firebase.'); 
  } catch (e) {
    console.error('Firebase connectivity test failed', e);
    logAddPlayer('Failed to connect to Firebase. Check rules and network.');
  }
});
