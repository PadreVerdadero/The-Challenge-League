// app.js

// --- Firebase Initialization ---
// (Assume Firebase config is already correct and included here)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getDatabase, ref, onValue, set, get, child, update } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

// Replace with your actual Firebase config
const firebaseConfig = {
  // ... your config here ...
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- DOM Elements ---
const championDiv = document.getElementById('champion');
const challengerQueueUl = document.getElementById('challenger-queue');
const matchHistoryUl = document.getElementById('match-history');
const timerSpan = document.getElementById('timer');
const celebrationCanvas = document.getElementById('celebration-canvas');

// --- Timer State ---
let timerInterval = null;
let challengeEndTimestamp = null;

// --- Utility Functions ---

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (
    String(days).padStart(2, '0') + ':' +
    String(hours).padStart(2, '0') + ':' +
    String(minutes).padStart(2, '0') + ':' +
    String(seconds).padStart(2, '0')
  );
}

// --- Timer Display and Logic ---

function updateTimerDisplay() {
  if (challengeEndTimestamp === null) {
    timerSpan.textContent = '...';
    return;
  }
  const now = Date.now();
  const remaining = challengeEndTimestamp - now;
  if (remaining <= 0) {
    timerSpan.textContent = '00:00:00:00';
    clearInterval(timerInterval);
    // Optionally trigger expiry logic here
    // For demo: launch explosion
    launchExplosion();
    // Optionally reset timer in Firebase if admin
    return;
  }
  timerSpan.textContent = formatDuration(remaining);
}

function startTimer(endTimestamp) {
  challengeEndTimestamp = endTimestamp;
  updateTimerDisplay();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

// --- Firebase Listeners ---

function listenChampion() {
  const championRef = ref(db, 'champion');
  onValue(championRef, (snapshot) => {
    const champion = snapshot.val();
    renderChampion(champion);
  });
}

function listenChallengerQueue() {
  const queueRef = ref(db, 'challengerQueue');
  onValue(queueRef, (snapshot) => {
    const queue = snapshot.val() || [];
    renderChallengerQueue(queue);
  });
}

function listenMatchHistory() {
  const historyRef = ref(db, 'matchHistory');
  onValue(historyRef, (snapshot) => {
    const history = snapshot.val() || [];
    renderMatchHistory(history);
  });
}

function listenTimer() {
  const timerRef = ref(db, 'challengeEndTimestamp');
  onValue(timerRef, (snapshot) => {
    const endTimestamp = snapshot.val();
    if (typeof endTimestamp === 'number') {
      startTimer(endTimestamp);
    }
  });
}

// --- Rendering Functions ---

function renderChampion(champion) {
  if (!champion) {
    championDiv.textContent = 'No Champion';
    championDiv.className = 'pill champion';
    return;
  }
  championDiv.textContent = champion.name || 'Unknown';
  championDiv.className = 'pill champion';
  // Optionally add more info (e.g., streak)
}

function renderChallengerQueue(queue) {
  challengerQueueUl.innerHTML = '';
  queue.forEach((player, idx) => {
    const li = document.createElement('li');
    li.className = '';
    const pill = document.createElement('span');
    pill.className = 'pill challenger';
    pill.textContent = player.name || `Challenger ${idx + 1}`;
    li.appendChild(pill);
    challengerQueueUl.appendChild(li);
  });
}

function renderMatchHistory(history) {
  matchHistoryUl.innerHTML = '';
  history.slice().reverse().forEach((match) => {
    const li = document.createElement('li');
    li.className = 'match-entry';
    // Winner
    const winnerPill = document.createElement('span');
    winnerPill.className = 'pill ' + (match.winnerRole === 'champion' ? 'champion' : 'challenger');
    winnerPill.textContent = match.winnerName;
    li.appendChild(winnerPill);

    // VS
    const vs = document.createElement('span');
    vs.className = 'vs';
    vs.textContent = 'vs';
    li.appendChild(vs);

    // Loser
    const loserPill = document.createElement('span');
    loserPill.className = 'pill defeated';
    loserPill.textContent = match.loserName;
    li.appendChild(loserPill);

    // Timestamp
    const ts = document.createElement('span');
    ts.className = 'timestamp';
    ts.textContent = formatMatchTimestamp(match.timestamp);
    li.appendChild(ts);

    matchHistoryUl.appendChild(li);

    // Animation triggers
    if (match.sweep) {
      launchConfetti();
    } else if (match.dethroned) {
      launchExplosion();
    }
  });
}

function formatMatchTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Celebratory Animations ---

function launchConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      zIndex: 1000,
      disableForReducedMotion: true
    });
  }
}

function launchExplosion() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 180,
      spread: 140,
      startVelocity: 60,
      origin: { y: 0.7 },
      colors: ['#ff5252', '#ffd700', '#fff176', '#81d4fa'],
      zIndex: 1000,
      disableForReducedMotion: true
    });
  }
}

// --- Initialization ---

function init() {
  listenChampion();
  listenChallengerQueue();
  listenMatchHistory();
  listenTimer();
  // Resize celebration canvas to viewport (canvas-confetti uses its own, but keep for future use)
  window.addEventListener('resize', resizeCelebrationCanvas);
  resizeCelebrationCanvas();
}

function resizeCelebrationCanvas() {
  celebrationCanvas.width = window.innerWidth;
  celebrationCanvas.height = window.innerHeight;
}

// --- Start ---
document.addEventListener('DOMContentLoaded', init);
