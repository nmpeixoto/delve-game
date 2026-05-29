// ===================== SCREENS =====================
function startGame(){
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  initGame();
  window.addEventListener('resize',()=>{if(G.map)render();});
}

function showDeath(){
  SFX.playerDeath();
  let p=G.player,o=document.createElement('div');
  o.className='overlay';
  o.innerHTML=`<div class="modal death">
    <h2>⚰ YOU DIED</h2>
    <p>Fallen on floor ${G.floor}.</p>
    <div class="stats-list">
      Level: <span>${p.lvl}</span><br>
      Kills: <span>${p.kills}</span><br>
      Damage dealt: <span>${p.damageDealt}</span><br>
      Best weapon: <span>${p.bestWeapon}</span><br>
      Gold earned: <span>${p.gold}💰</span><br>
      Floors: <span>${G.floor}</span><br>
      Turns: <span>${G.turn}</span>
    </div>
    <button class="btn" onclick="this.closest('.overlay').remove();startGame()">TRY AGAIN</button>
  </div>`;
  document.body.appendChild(o);
}

function showVictory(){
  let p=G.player,o=document.createElement('div');
  o.className='overlay';
  o.innerHTML=`<div class="modal victory">
    <h2>★ VICTORY ★</h2>
    <p>You escaped the dungeon!</p>
    <div class="stats-list">
      Level: <span>${p.lvl}</span><br>
      Kills: <span>${p.kills}</span><br>
      Damage dealt: <span>${p.damageDealt}</span><br>
      Best weapon: <span>${p.bestWeapon}</span><br>
      Gold: <span>${p.gold}💰</span><br>
      Turns: <span>${G.turn}</span>
    </div>
    <button class="btn btn-gold" onclick="this.closest('.overlay').remove();startGame()">DESCEND AGAIN</button>
  </div>`;
  document.body.appendChild(o);
}
