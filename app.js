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

  const playersRef = db.ref('players');
  const championRef = db.ref('championId');
  const challengesRef = db.ref('challenges');

  let players = {};
  let championId = null;
  let challenges = [];

  let playersReady = false;
  let championReady = false;

  console.log("App.js loaded");

  // 👑 Crown Transfer Animation
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

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '10px';

    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.style.flexGrow = '1';

    if (defeatedByChampion.has(id) || id === exChampionId) {
      btn.classList.add('lost-to-champion');
    }

    btn.onclick = async () => {
      // existing challenge logic...
    };

    const queueBtn = document.createElement('button');
    queueBtn.textContent = '⏫ Queue First';
    queueBtn.style.backgroundColor = '#ffc107';
    queueBtn.style.color = '#333';
    queueBtn.style.fontSize = '1rem';
    queueBtn.style.padding = '10px';
    queueBtn.style.borderRadius = '6px';

    queueBtn.onclick = () => {
      challengeQueue = [id, ...challengeQueue.filter(qid => qid !== id)];
      renderChallengeQueue();
    };

    container.appendChild(btn);
    container.appendChild(queueBtn);
    roster.appendChild(container);
  });
}

  // 🕹️ Match History
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

  // 🧭 Challenge Queue
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

  queueList.addEventListener('dragend', () => {
    const newOrder = [...queueList.querySelectorAll('li')].map(li => li.dataset.id);
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

  function startNextChallengeTimer() {
    if (challengeQueue.length === 0) {
      document.getElementById('next-challenger-name').textContent = 'Waiting...';
      document.getElementById('challenge-timer').textContent = '--:--';
      return;
    }

    currentChallengerId = challengeQueue.shift();
    const challenger = players[currentChallengerId];
    document.getElementById('next-challenger-name').textContent = challenger.name;

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
    renderMatchHistory();
  }
  window.startNextChallengeTimer = startNextChallengeTimer;

  // 🔄 Listeners
  playersRef.on('value', snap => {
    players = snap.val() || {};
