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

let players = {};
let championId = null;
let matches = [];
let defeated = new Set();
let playersOrderArr = [];
let timerEnd = null;
let timerInterval = null;
let isSweep = false;

const $ = id => document.getElementById(id);

// --- Rendering ---
function renderChampion(){
  const el = $('champion-card'); if (!el) return;
  el.innerHTML = `<h2>Champion</h2>`;
  const wrap = document.createElement('div');
  if (championId && players[championId]) wrap.innerHTML = `<span class="champ-name">👑 ${players[championId].name}</span> <span id="champion-actions-area"></span>`;
  else wrap.innerHTML = `<span class="champ-name no-champ">No champion yet</span> <span id="champion-actions-area"></span>`;
  el.appendChild(wrap);
  renderChampionActions();
}

function renderChampionActions(){
  const area = $('champion-actions-area'); if (!area) return;
  area.innerHTML = '';
  if (isSweep && championId){
    const btn = document.createElement('button'); btn.textContent = 'Clear Champion (end sweep)';
    btn.addEventListener('click', async ()=>{
      await set(ref(db,'championId'), null);
      await remove(ref(db,'defeats'));
      await remove(ref(db,'timer/endTimestamp'));
      isSweep = false;
      renderAll();
    });
    area.appendChild(btn);
  } else if (!championId){
    const btn = document.createElement('button'); btn.text
