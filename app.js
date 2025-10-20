document.addEventListener("DOMContentLoaded", () => {
  const firebaseConfig = {
    apiKey: "AIzaSyApvqkHwcKL7dW0NlArkRAByQ8ia8d-TAk",
    authDomain: "the-challenge-league.firebaseapp.com",
    databaseURL: "https://the-challenge-league-default-rtdb.firebaseio.com",
    projectId: "the-challenge-league",
    storageBucket: "the-challenge-league.appspot.com",
    messagingSenderId: "193530358761",
    appId: "1:193530358761:web:7b782c8bdd1a8ac7973978",
    measurementId: "G-ED0WV8KZ6F"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  let players = {};
  let championId = null;
  let challenges = [];
  let challengeQueue = [];
  let currentTimer = null;
  let currentChallengerId = null;

  function renderChampion() {
    const el = document.getElementById('champion-card');
    const champ = players[championId];
    el.innerHTML = champ
      ? `<h2>Champion</h2><div><span class="champ-name">👑 ${champ.name}</span></div>`
      : `<h2>Champion</h2><div>No champion yet</div>`;
  }

  function renderRoster() {
    const roster = document.getElementById('roster');
    roster.innerHTML = '<h2>Roster</h2>';

    Object.entries(players).forEach(([id, p]) => {
      if (id === championId) return;

      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.gap = '10px';

      const btn = document.createElement('button');
      btn.textContent = p.name;
      btn.onclick = () => {
        challengeQueue = [id, ...challengeQueue.filter(qid => qid !== id)];
        renderChallengeQueue();
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

  function renderMatchHistory() {
    const history = document.getElementById('match-history');
    history.innerHTML = '<h2>Match History</h2>';

    const resolved = challenges
      .filter(c => c.status === 'resolved' || c.status === 'timeout')
      .sort((a, b) => b.timestamp - a.timestamp);

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

  function renderChallengeQueue() {
    const list = document.getElementById('queue-list');
    list.innerHTML = '';
    challengeQueue.forEach(id => {
      const li = document.createElement('li');
      li.textContent = players[id]?.name || 'Unknown';
      list.appendChild(li);
    });
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
    renderRoster();
    renderMatchHistory();
  }

  window.startNextChallengeTimer = startNextChallengeTimer;

  document.getElementById('add-player-button').addEventListener('click', () => {
    const name = document.getElementById('new-player-name').value.trim();
    if (!name) return alert("Please enter a name.");
    const id = name.toLowerCase().replace(/\s+/g, '');
    firebase.database().ref('players/' + id).set({ name });
    document.getElementById('new-player-name').value = '';
  });

  firebase.database().ref('players').on('value', snap => {
    players = snap.val() || {};
    renderRoster();
    renderChallengeQueue();
  });

  firebase.database().ref('championId').on('value', snap => {
    championId = snap.val();
    renderChampion();
  });

  firebase.database().ref('challenges').on('value', snap => {
    challenges = Object.values(snap.val() || {});
    renderMatchHistory();
  });
});
