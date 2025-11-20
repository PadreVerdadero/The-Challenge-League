// app.js

// --- Firebase Initialization (Preserved) ---
// Replace with your actual config if not already present elsewhere
// const firebaseConfig = { ... };
// firebase.initializeApp(firebaseConfig);

// --- Demo Data (Replace with Firebase integration as needed) ---
let players = [
  { name: "Alice", status: "champion" },
  { name: "Bob", status: "challenger" },
  { name: "Charlie", status: "defeated" },
  { name: "Dana", status: "active" }
];

// --- Confetti Setup ---
const jsConfetti = new JSConfetti();

// --- DOM Elements ---
const leaderboardEl = document.getElementById('leaderboard');
const challengeBtn = document.getElementById('challenge-btn');
const explosionCanvas = document.getElementById('explosion-canvas');

// --- Timer Logic ---
const TIMER_KEY = 'challengeEndTime';
const TIMER_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function getStoredEndTime() {
  const stored = localStorage.getItem(TIMER_KEY);
  return stored ? parseInt(stored, 10) : null;
}

function setStoredEndTime(endTime) {
  localStorage.setItem(TIMER_KEY, endTime);
}

function initializeTimer() {
  let endTime = getStoredEndTime();
  const now = Date.now();
  if (!endTime || endTime < now) {
    endTime = now + TIMER_DURATION;
    setStoredEndTime(endTime);
  }
  return endTime;
}

let timerEndTime = initializeTimer();
let timerInterval = null;

function updateTimerDisplay() {
  const now = Date.now();
  let timeLeft = timerEndTime - now;

  if (timeLeft <= 0) {
    // Timer expired: reset for next 7 days, trigger explosion
    timerEndTime = now + TIMER_DURATION;
    setStoredEndTime(timerEndTime);
    timeLeft = timerEndTime - now;
    triggerExplosionAnimation();
  }

  const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

  document.getElementById('timer-days').textContent = days;
  document.getElementById('timer-hours').textContent = hours.toString().padStart(2, '0');
  document.getElementById('timer-minutes').textContent = minutes.toString().padStart(2, '0');
  document.getElementById('timer-seconds').textContent = seconds.toString().padStart(2, '0');
}

// --- Rendering Functions ---
function renderPlayer(player) {
  let className = '';
  let label = '';

  if (player.status === 'champion') {
    className = 'champion';
    label = `<span class="champion-text">Champion</span>`;
  } else if (player.status === 'challenger') {
    className = 'challenger';
    label = `<span class="challenger-text">Challenger</span>`;
  } else if (player.status === 'defeated') {
    className = 'defeated';
    label = `<span class="defeated-text">Defeated</span>`;
  }

  return `
    <li class="${className}">
      <span class="player-name">${player.name}</span>
      ${label}
    </li>
  `;
}

function renderLeaderboard() {
  leaderboardEl.innerHTML = players.map(renderPlayer).join('');
}

// --- Animations ---
function triggerConfettiAnimation() {
  jsConfetti.addConfetti({
    confettiColors: ['#FFD700', '#1976D2', '#B32525'],
    confettiNumber: 120
  });
}

function triggerExplosionAnimation() {
  // Show explosion canvas, draw particles, then hide
  explosionCanvas.width = window.innerWidth;
  explosionCanvas.height = window.innerHeight;
  explosionCanvas.style.display = 'block';

  const ctx = explosionCanvas.getContext('2d');
  const particles = [];
  const particleCount = 60;
  const colors = ['#FFD700', '#B32525', '#FF9800', '#fff176'];

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: explosionCanvas.width / 2,
      y: explosionCanvas.height / 2,
      angle: Math.random() * 2 * Math.PI,
      speed: Math.random() * 8 + 4,
      radius: Math.random() * 8 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, explosionCanvas.width, explosionCanvas.height);
    particles.forEach(p => {
      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed;
      p.speed *= 0.96;
      p.alpha *= 0.96;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    frame++;
    if (frame < 40) {
      requestAnimationFrame(animate);
    } else {
      explosionCanvas.style.display = 'none';
    }
  }
  animate();
}

// --- Event Listeners ---
challengeBtn.addEventListener('click', () => {
  // Example: Move challenger to champion, champion to defeated, etc.
  const championIdx = players.findIndex(p => p.status === 'champion');
  const challengerIdx = players.findIndex(p => p.status === 'challenger');
  if (championIdx !== -1 && challengerIdx !== -1) {
    players[championIdx].status = 'defeated';
    players[challengerIdx].status = 'champion';
    // Find next active player to become challenger
    const nextActiveIdx = players.findIndex(p => p.status === 'active');
    if (nextActiveIdx !== -1) {
      players[nextActiveIdx].status = 'challenger';
    }
    renderLeaderboard();
    triggerConfettiAnimation();
  }
});

// --- Initialization ---
function initializeApp() {
  renderLeaderboard();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

// --- Responsive Canvas ---
window.addEventListener('resize', () => {
  if (explosionCanvas.style.display === 'block') {
    explosionCanvas.width = window.innerWidth;
    explosionCanvas.height = window.innerHeight;
  }
});

// --- Start ---
document.addEventListener('DOMContentLoaded', initializeApp);
