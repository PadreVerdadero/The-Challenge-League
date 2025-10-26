// app.js — Firebase-enabled Challenge League with persistent defeats in /defeats
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";

console.log('app.js loaded');

const firebaseConfig = {
  apiKey: "AIzaSyBSCn8-SpgtrJz3SRBWfiLL-WXylProWqU",
  authDomain: "challengeleague-ec503.firebaseapp.com",
  databaseURL: "https://challengeleague-ec503-default-rtdb.firebaseio.com",
  projectId: "challengeleague-ec503",
  storageBucket: "challengeleague-ec503.appspot.com",
  messagingSenderId: "120184354429",
  appId: "1:120184354429:web:e28ea3cd8c177b3cd72314"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// State
let players = {};
let championId = null;
let matches = [];
let defeated = new Set(); // local mirror of /defeats

const $ = id => document.getElementById(id);
function log(msg) { const el = $('add-player-log'); if (el) el.textContent = msg; console.log(msg); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Helpers to persist/remove defeat flags with logging
async function persistDefeat(id) {
  try {
    await set(ref(db, `defeats/${id}`), true);
    console.log('persistDefeat: saved defeat for', id);
  } catch (e) {
    console.error('persistDefeat: failed to save defeat for', id, e);
  }
}
async function removeDefeat(id) {
  try {
    await remove(ref(db, `defeats/${id}`));
    console.log('removeDefeat: removed defeat for', id);
  } catch (e) {
    console.error('removeDefeat: failed to remove defeat for', id, e);
  }
}
async function clearAllDefeats() {
  try {
    await remove(ref(db, 'defeats'));
    console.log('clearAllDefeats: removed /defeats node');
  } catch (e) {
    console.error('clearAllDefeats: failed', e);
  }
}

// Render champion section
function renderChampion(){
  const el = $('champion-card');
  const champ = players[championId];
  el.innerHTML = champ ? `<h2>Champion</h2><div class="champ-name">👑 ${escapeHtml(champ.name)}</div>` : `<h2>Champion</h2><div>No champion yet</div>`;
}

// Render roster (excludes current champion)
function renderRoster(){
  console.log('renderRoster running, players keys:', Object.keys(players));
  const roster = $('roster');
  roster.innerHTML = '<h2>Roster</h2>';
  if (!players || Object.keys(players).length === 0) {
    roster.innerHTML += '<p>No players yet</p>'; return;
  }
  Object.entries(players).forEach(([id,p])=>{
    if (id === championId) return; // exclude champion from roster list
    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.dataset.id = id;
    if (defeated.has(id)) btn.classList.add('lost'); else btn.classList.remove('lost');

    btn.addEventListener('click', async () => {
      console.log('roster button clicked, id=', id, 'name=', p.name);

      // If no champion, offer to make selected player champion
      if (!championId) {
        if (confirm(`${p.name} selected. Make them champion?`)) {
          await set(ref(db, 'championId'), id);
          log(`Champion set to ${p.name}`);
        }
        return;
      }

      // Prompt for description and winner
      const desc = prompt(`Describe challenge between ${p.name} and ${players[championId].name}:`);
      if (desc === null) { console.log('challenge cancelled by user'); return; }
      const winner = prompt(`Who won? Type exactly: "${p.name}" or "${players[championId].name}"`);
      if (winner === null) { console.log('winner prompt cancelled'); return; }

      // Resolve winnerId (simple exact-name match)
      const winnerId = (winner === p.name) ? id : championId;
      const winnerName = (winner === p.name) ? p.name : players[championId].name;

      const match = {
        challengerId: id,
        challengerName: p.name,
        championId,
        championName: players[championId].name,
        winnerId,
        winnerName,
        description: desc,
        timestamp: Date.now()
      };

      // Write match record then update defeats/champion as needed
      try {
        const mRef = push(ref(db, 'matches'));
        await set(mRef, match);
        console.log('match written:', match);

        if (winnerId === id) {
          // Challenger won: persist previous champion defeat, remove any defeat marker for new champion,
          // set new champion, then CLEAR all defeats so UI resets only when an explicit dethrone occurs.
          const prevChampion = championId;
          if (prevChampion && prevChampion !== id) {
            await persistDefeat(prevChampion); // mark previous champion defeated
          }
          await removeDefeat(id); // remove any defeat mark for new champion
          await set(ref(db, 'championId'), id); // set new champion
          // CLEAR all defeats now that a new champion has explicitly been crowned
          await clearAllDefeats();
          triggerConfetti();
          log(`${p.name} dethroned ${players[prevChampion]?.name || 'previous champion'}`);
        } else {
          // Challenger lost: persist defeat for challenger only
          await persistDefeat(id);
          log(`${p.name} lost to ${players[championId].name}`);
        }

        // UI will sync via listeners, but re-render optimistically
        renderChampion(); renderRoster(); renderMatchHistory();
      } catch (err) {
        console.error('write failed', err);
        log('Error saving match: ' + err.message);
      }
    });

    roster.appendChild(btn);
  });
}

// Render match history
function renderMatchHistory(){
  const el = $('match-list');
  el.innerHTML = '';
  matches.slice().reverse().forEach(m=>{
    const row = document.createElement('div');
    const t = new Date(m.timestamp).toLocaleString();
    row.textContent = `🏁 ${m.challengerName} vs ${m.championName} — Winner: ${m.winnerName} (${t})`;
    el.appendChild(row);
  });
}

// confetti animation
function triggerConfetti(){
  const canvas = $('confetti-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d'); canvas.width = innerWidth; canvas.height = innerHeight;
  const parts = []; const colors = ['#ff595e','#ffca3a','#8ac926','#1982c4','#6a4c93'];
  for (let i=0;i<100;i++) parts.push({x:Math.random()*canvas.width, y:-50, vx:(Math.random()-0.5)*6, vy:2+Math.random()*5, size:6+Math.random()*8, c:colors[Math.floor(Math.random()*colors.length)]});
  let frame=0;
  function draw(){
    frame++; ctx.clearRect(0,0,canvas.width,canvas.height);
    parts.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; p.vy+=0.06; ctx.fillStyle=p.c; ctx.fillRect(p.x,p.y,p.size,p.size*0.6); });
    if (frame<140) requestAnimationFrame(draw); else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// Add player to DB
async function addPlayer(){
  const input = $('new-player-name'); const name = input.value.trim(); if (!name) { log('Enter a name'); return; }
  const id = name.toLowerCase().replace(/\s+/g,'-');
  try { await set(ref(db, `players/${id}`), { name }); input.value=''; log(`Added ${name}`); }
  catch(err){ console.error(err); log('Add player failed: '+err.message); }
}
$('add-player-button').addEventListener('click', addPlayer);

// Firebase listeners

// players
onValue(ref(db, 'players'), snap => {
  players = snap.val() || {};
  console.log('players snapshot', players);
  renderRoster();
});

// championId — DO NOT auto-clear /defeats here. Clearing happens only when dethrone flow runs.
onValue(ref(db, 'championId'), snap => {
  const newChampionId = snap.val();
  const prev = championId;
  championId = newChampionId;
  console.log('champion snapshot', { prev, newChampionId });

  // safety: never mark the current champion as defeated locally
  if (championId && defeated.has(championId)) defeated.delete(championId);

  renderChampion();
  renderRoster();
});

// matches
onValue(ref(db, 'matches'), snap => {
  const val = snap.val();
  matches = val ? Object.values(val) : [];
  console.log('matches snapshot count', matches.length);
  renderMatchHistory();
});

// defeats — persistent defeat flags; keep local mirror and update roster styling
onValue(ref(db, 'defeats'), snap => {
  const val = snap.val() || {};
  defeated = new Set(Object.keys(val)); // keys are player ids marked defeated
  console.log('defeats snapshot loaded:', Array.from(defeated));
  // safety: never mark current champion as defeated locally
  if (championId && defeated.has(championId)) defeated.delete(championId);
  renderRoster();
});

// Connectivity test
(async function testConn(){
  try { const root = await get(ref(db, '/')); console.log('Initial DB root', root.val()); log('Connected to Firebase'); }
  catch(e){ console.error('Connectivity test failed', e); log('Firebase connect failed: ' + e.message); }
})();
