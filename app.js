// app.js (modular Firebase SDK) — complete file with challenge flow, animations, confetti, and defeat styling
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
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
let defeatedByChampion = new Set();

// helpers
function $(id) { return document.getElementById(id); }
function logAddPlayer(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; }
function escapeHtml(str) { return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

// notifications & confetti
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
function triggerConfetti() {
  const canvas = $('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const particles = [];
  const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<120;i++){
    particles.push({
      x: Math.random()*canvas.width,
      y: -20 - Math.random()*canvas.height/2,
      vx: (Math.random()-0.5)*6,
      vy: 2 + Math.random()*6,
      size: 6 + Math.random()*8,
      color: colors[Math.floor(Math.random()*colors.length)],
      rotation: Math.random()*360
    });
  }
  let t = 0;
  function draw() {
    t++;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p=>{
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.rotate(p.rotation*Math.PI/180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
      ctx.restore();
    });
    if (t < 140) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
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
    if (id === championId) return; // exclude current champion

    const entry = document.createElement('div');
    entry.style.display = 'flex';
    entry.style.alignItems = 'center';
    entry.style.gap = '8px';

    const nameBtn = document.createElement('button');
    nameBtn.textContent = p.name;
    nameBtn.style.flexGrow = '1';
    nameBtn.dataset.id = id;
    nameBtn.classList.add('button-tooltip');
    nameBtn.setAttribute('data-tooltip', defeatedByChampion.has(id) ? 'Lost to champion' : '');

    if (defeatedByChampion.has(id)) {
      nameBtn.classList.add('lost-to-champion');
    } else {
      nameBtn.classList.remove('lost-to-champion');
    }

    // CLICK HANDLER: selection + challenge flow
    nameBtn.addEventListener('click', async () => {
      // select visual
      selectedPlayerId = id;
      Array.from(document.querySelectorAll('#roster button')).forEach(b => b.style.outline = '');
      nameBtn.style.outline = '2px solid #007bff';

      // add to queue front and update UI
      challengeQueue = [id, ...challengeQueue.filter(qid => qid !== id)];
      renderChallengeQueue();

      // If no champion, offer to make selected player the champion
      if (!championId) {
        const makeChampion = confirm(`${players[id].name} selected but there is no champion. Make them champion?`);
        if (makeChampion) {
          await set(ref(db, 'championId'), id);
          logAddPlayer(`Champion set to ${players[id].name}`);
          defeatedByChampion.delete(id);
          renderChampion();
          renderRoster();
        }
        return;
      }

      // Prompt for challenge description
      const description = prompt(`Describe the challenge between ${players[id].name} and ${players[championId]?.name || 'Champion'}:`);
      if (description === null) return; // user cancelled

      // Prompt for winner with clear options
      const winnerName = prompt(`Who won? Type the exact winner name:\nOptions: ${players[id].name} or ${players[championId]?.name || ''}`);
      if (winnerName === null) return; // user cancelled

      // Resolve winnerId by exact name match; fallback to champion
      const winnerEntry = Object.entries(players).find(([pid, p]) => p.name === winnerName);
      const winnerId = winnerEntry ? winnerEntry[0] : (winnerName === players[id].name ? id : championId);

      // Build and write challenge record
      const challengeRef = push(ref(db, 'challenges'));
      const challengeId = challengeRef.key;
      const challenge = {
        id: challengeId,
        challengerId: id,
        targetId: championId,
        description,
        winnerId,
        timestamp: Date.now(),
        status: 'resolved'
      };

      try {
        await set(ref(db, 'challenges/' + challengeId), challenge);

        // If challenger won, transfer crown
        if (winnerId === id) {
          const prevChampion = championId;
          await set(ref(db, 'championId'), id);
          if (prevChampion && prevChampion !== id) defeatedByChampion.add(prevChampion);
          defeatedByChampion.delete(id);
          animateCrownTransfer(players[prevChampion]?.name || 'Unknown', players[id].name);
          triggerConfetti();
          logAddPlayer(`${players[id].name} dethroned ${players[prevChampion]?.name || 'Champion'}`);
        } else {
          // challenger lost to champion
          defeatedByChampion.add(id);
          animateFailedChallenge(players[id].name, players[championId]?.name || 'Champion');
          logAddPlayer(`${players[id].name} lost to ${players[championId]?.name || 'Champion'}`);
        }

        // Optimistically update UI; listeners will reconcile with DB
        renderRoster();
        renderChampion();
        renderMatchHistory();
      } catch (e) {
        console.error('Error recording challenge', e);
        logAddPlayer('Error recording challenge: ' + e.message);
      }
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
  if (currentTimer) return;
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
  if (championId) defeatedByChampion.add(challengerId);
  renderRoster();
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
    const previousChampion = championId;
    await set(ref(db, 'championId'), selectedPlayerId);

    if (previousChampion && previousChampion !== selectedPlayerId) {
      defeatedByChampion.add(previousChampion);
      triggerConfetti();
      animateCrownTransfer(players[previousChampion]?.name || previousChampion, players[selectedPlayerId]?.name || selectedPlayerId);
    }

    defeatedByChampion.delete(selectedPlayerId);
    logAddPlayer(`Champion set to ${players[selectedPlayerId]?.name || selectedPlayerId}`);
    renderRoster();
    renderChampion();
  } catch (e) {
    logAddPlayer(`Error creating champion: ${e.message}`);
    console.error(e);
  }
}

// wiring UI
function wireUi() {
  const addBtn = $('add-player-button');
  if (addBtn) addBtn.addEventListener('click', addPlayerFromInput);
  const createChampBtn = $('create-champion-button');
  if (createChampBtn) createChampBtn.addEventListener('click', createChampionFromSelected);
  const startQueueBtn = $('start-queue-button');
  if (startQueueBtn) startQueueBtn.addEventListener('click', startNextChallengeTimer);
}

// Firebase listeners
function wireFirebaseListeners() {
  onValue(ref(db, 'players'), snap => {
    players = snap.val() || {};
    console.log('players snapshot', players);
    if (challengeQueue.length === 0) {
      challengeQueue = Object.keys(players).filter(id => id !== championId);
    }
    renderRoster();
    renderChallengeQueue();
    renderMatchHistory();
  });

  onValue(ref(db, 'championId'), snap => {
    const newChampionId = snap.val();
    const prev = championId;
    championId = newChampionId;
    console.log('championId snapshot', championId);

    if (prev && prev !== championId) {
      defeatedByChampion.add(prev);
      triggerConfetti();
      animateCrownTransfer(players[prev]?.name || prev, players[championId]?.name || championId);
    }
    if (championId) defeatedByChampion.delete(championId);

    renderChampion();
    renderRoster();
  });

  onValue(ref(db, 'challenges'), snap => {
    const val = snap.val();
    challenges = val ? Object.values(val) : [];
    console.log('challenges snapshot', challenges);

    if (championId) {
      const newDefeated = new Set();
      challenges.forEach(c => {
        if (c.status === 'resolved' || c.status === 'timeout') {
          if (c.winnerId === championId && c.challengerId && c.challengerId !== championId) {
            newDefeated.add(c.challengerId);
          }
          if (c.targetId === championId && c.winnerId !== championId) {
            newDefeated.add(championId);
          }
        }
      });
      defeatedByChampion = newDefeated;
      if (championId && !defeatedByChampion.has(championId)) {
        defeatedByChampion.delete(championId);
      }
    }
    renderMatchHistory();
    renderRoster();
  });
}

// DOM ready
document.addEventListener('DOMContentLoaded', async () => {
  wireUi();
  wireFirebaseListeners();
  try {
    const rootSnapshot = await get(ref(db, '/'));
    console.log('Initial DB root:', rootSnapshot.val());
    logAddPlayer('Connected to Firebase.');
  } catch (e) {
    console.error('Firebase connectivity test failed', e);
    logAddPlayer('Failed to connect to Firebase. Check rules and network.');
  }
});
