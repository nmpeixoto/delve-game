// ===================== SCREENS =====================
let _resizeHandlerBound=false;

function handleResize(){
  if(G.map)render();
}

const CLASS_DATA = {
  warrior: { name: 'Warrior', tagline: 'A sturdy fighter who excels in sustained combat.', hp: 30, atk: 3, def: 3, weapon: 'Bare Hands', armor: 'Chain Mail', ability1: 'BASH', desc1: 'Deals 2x damage to a nearby visible enemy. Cooldown: 5', ability2: 'SHIELD WALL', desc2: '(Lvl 5) Reduces incoming damage by 50% for 3 turns. Cooldown: 10', passive: 'Regenerates 1 HP every 5 turns.' },
  rogue: { name: 'Rogue', tagline: 'A nimble assassin who relies on positioning.', hp: 18, atk: 6, def: 1, weapon: 'Rusty Dagger', armor: 'None', ability1: 'DASH', desc1: 'Instantly take 2 free moves. Cooldown: 3', ability2: 'VANISH', desc2: '(Lvl 5) Become invisible for 3 turns. Next attack deals 2x damage. Cooldown: 10', passive: 'Dodges 25% of all incoming attacks.' },
  mage: { name: 'Mage', tagline: 'A fragile spellcaster with potent magic.', hp: 15, atk: 5, def: 1, weapon: 'Bone Staff', armor: 'None', ability1: 'FIREBALL', desc1: 'Deals damage to all enemies in a 3x3 area around a target. Cooldown: 5', ability2: 'BLINK', desc2: '(Lvl 5) Teleport instantly to a safe, visible tile. Cooldown: 8', passive: 'Magic weapons (♦) deal +50% damage.' },
  paladin: { name: 'Paladin', tagline: 'A holy champion focused on sustain and defense.', hp: 25, atk: 2, def: 4, weapon: 'Bare Hands', armor: 'Iron Plate', ability1: 'SMITE', desc1: 'Deals damage and stuns the enemy for 1 turn. Cooldown: 5', ability2: 'LAY ON HANDS', desc2: '(Lvl 5) Heals for 30% of Max HP. Cooldown: 15', passive: 'Max HP increases by 2 upon leveling up.' },
  ranger: { name: 'Ranger', tagline: 'A master of ranged combat and traps.', hp: 15, atk: 4, def: 2, weapon: 'Shortbow', armor: 'None', ability1: 'PIERCING SHOT', desc1: 'Fires an arrow that damages all enemies in a straight line. Cooldown: 4', ability2: 'BEAR TRAP', desc2: '(Lvl 5) Drops a trap that stuns and damages an enemy, then jumps back 1 tile. Cooldown: 10', passive: 'Bows allow attacking from 3 tiles away.' },
  barbarian: { name: 'Barbarian', tagline: 'A fearless brute who thrives in chaos.', hp: 40, atk: 5, def: 0, weapon: 'Great Axe', armor: 'None', ability1: 'CLEAVE', desc1: 'Deals damage to all adjacent enemies. Cooldown: 4', ability2: 'BLOODLUST', desc2: '(Lvl 5) For 3 turns, heal 50% of damage dealt, but take 2x damage. Cooldown: 12', passive: 'Deals +1 damage for every 10 missing HP.' },
  necromancer: { name: 'Necromancer', tagline: 'A dark caster who drains life from foes.', hp: 15, atk: 3, def: 1, weapon: 'Skull Rod', armor: 'None', ability1: 'SIPHON LIFE', desc1: 'Deals damage and heals yourself for the same amount. Cooldown: 5', ability2: 'CORPSE EXPLOSION', desc2: '(Lvl 5) Mark an enemy for 3 turns. If it dies while marked, it explodes for heavy AoE damage. Cooldown: 8', passive: 'Heals 1 HP whenever an enemy dies.' },
  monk: { name: 'Monk', tagline: 'A disciplined martial artist.', hp: 20, atk: 3, def: 2, weapon: 'Bare Hands', armor: 'None', ability1: 'PUSH KICK', desc1: 'Pushes an enemy 1 tile away. Deals extra damage if they hit a wall. Cooldown: 3', ability2: 'FLURRY OF BLOWS', desc2: '(Lvl 5) Attacks 3 times instantly, but you are rooted for your next turn. Cooldown: 10', passive: 'Gains +2 ATK (scaling with level) when NO weapon is equipped.' }
};

let _selectedClass = 'warrior';

function openClassSelect() {
  document.getElementById('class-select-overlay').style.display='flex';
  let listHtml = '';
  Object.keys(CLASS_DATA).forEach(k => {
    listHtml += `<div class="class-btn ${k==='warrior'?'selected':''}" id="cbtn-${k}" onclick="selectClass('${k}')">${CLASS_DATA[k].name}</div>`;
  });
  document.getElementById('class-list').innerHTML = listHtml;
  selectClass('warrior');
}

function closeClassSelect() {
  document.getElementById('class-select-overlay').style.display='none';
}

function selectClass(id) {
  _selectedClass = id;
  document.querySelectorAll('.class-btn').forEach(el => el.classList.remove('selected'));
  document.getElementById(`cbtn-${id}`).classList.add('selected');

  let c = CLASS_DATA[id];
  let h = `
    <div class="class-title">${c.name}</div>
    <div class="class-tagline">${c.tagline}</div>
    <div class="class-stat-box">
      <div class="c-stat"><div class="c-stat-lbl">HP</div><div class="c-stat-val" style="color:var(--red)">${c.hp}</div></div>
      <div class="c-stat"><div class="c-stat-lbl">ATK</div><div class="c-stat-val" style="color:var(--orange)">${c.atk}</div></div>
      <div class="c-stat"><div class="c-stat-lbl">DEF</div><div class="c-stat-val" style="color:var(--blue)">${c.def}</div></div>
    </div>
    <div class="c-section">
      <div class="c-sec-title">STARTING GEAR</div>
      <div style="font-size:.55rem;color:var(--text)">Weapon: <span style="color:var(--gold)">${c.weapon}</span><br>Armor: <span style="color:var(--gold)">${c.armor}</span></div>
    </div>
    <div class="c-section">
      <div class="c-sec-title">ABILITIES</div>
      <div class="c-ability"><div class="c-ab-name">⚡ ${c.ability1}</div><div class="c-ab-desc">${c.desc1}</div></div>
      <div class="c-ability"><div class="c-ab-name">⚡ ${c.ability2}</div><div class="c-ab-desc">${c.desc2}</div></div>
    </div>
    <div class="c-section">
      <div class="c-sec-title">PASSIVE</div>
      <div style="font-size:.55rem;color:var(--text);line-height:1.6">${c.passive}</div>
    </div>
  `;
  document.getElementById('class-details').innerHTML = h;
}

function confirmClassSelect() {
  closeClassSelect();
  startGame(_selectedClass);
}

function startGame(playerClass = 'warrior'){
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  initGame(playerClass);
  if(!_resizeHandlerBound){
    window.addEventListener('resize',handleResize);
    _resizeHandlerBound=true;
  }
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
    <button class="btn" onclick="this.closest('.overlay').remove();startGame('${p.class}')">TRY AGAIN</button>
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
    <button class="btn btn-gold" onclick="this.closest('.overlay').remove();startGame('${p.class}')">DESCEND AGAIN</button>
  </div>`;
  document.body.appendChild(o);
}
