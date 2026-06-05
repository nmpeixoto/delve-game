// ===================== SCREENS =====================
let _resizeHandlerBound=false;

function handleResize(){
  if(G.map)render();
}

const CLASS_DATA = {
  warrior: { name: 'Warrior', tagline: 'A sturdy fighter who excels in sustained combat.', hp: 32, atk: 4, def: 3, weapon: 'Bare Hands', armor: 'Chain Mail', ability1: 'BASH', desc1: 'Deals 1.5x damage to a nearby visible enemy. Cooldown: 5', ability2: 'SHIELD WALL', desc2: '(Lvl 5) Reduces incoming damage by 40% for 3 turns. Cooldown: 10', passive: 'Regenerates 1 HP every 12 tiles explored.', critChance: 0.05 },
  rogue: { name: 'Rogue', tagline: 'A nimble assassin who relies on positioning.', hp: 24, atk: 7, def: 2, weapon: 'Rusty Dagger', armor: 'Leather Vest', ability1: 'DASH', desc1: 'Instantly take 2 free moves. Cooldown: 3', ability2: 'VANISH', desc2: '(Lvl 5) Become invisible for 3 turns. Next attack deals 2x damage. Cooldown: 10', passive: 'Dodges 40% of all incoming attacks.', dodgeBonus: 0.4 },
  mage: { name: 'Mage', tagline: 'A fragile spellcaster with potent magic.', hp: 20, atk: 4, def: 2, weapon: 'Bone Staff', armor: 'Apprentice Robe', ability1: 'FIREBALL', desc1: 'Deals damage to all enemies in a 3x3 area around a target. Cooldown: 5', ability2: 'BLINK', desc2: '(Lvl 5) Teleport instantly to a safe, visible tile. Cooldown: 8', passive: 'Magic weapons (♦) deal about +20% damage.', critChance: 0.1 },
  paladin: { name: 'Paladin', tagline: 'A holy champion focused on sustain and defense.', hp: 26, atk: 1, def: 1, weapon: 'Iron Mace', armor: 'Iron Plate', ability1: 'SMITE', desc1: 'Deals damage and stuns the enemy for 1 turn. Cooldown: 5', ability2: 'LAY ON HANDS', desc2: '(Lvl 5) Heals for 20% of Max HP. Cooldown: 15', passive: 'Max HP increases by 2 upon leveling up.', critChance: 0.05 },
  ranger: { name: 'Ranger', tagline: 'A master of ranged combat and traps.', hp: 20, atk: 2, def: 1, weapon: 'Shortbow', armor: 'Ranger Tunic', ability1: 'PIERCING SHOT', desc1: 'Fires an arrow that damages all enemies in a straight line. Cooldown: 4', ability2: 'BEAR TRAP', desc2: '(Lvl 5) Drops a trap that stuns and damages an enemy, then jumps back 1 tile. Cooldown: 10', passive: 'Bows allow attacking from 3 tiles away. Avoids counter-attacks at max range.', perception: 1, critChance: 0.1 },
  barbarian: { name: 'Barbarian', tagline: 'A fearless brute who thrives in chaos.', hp: 42, atk: 5, def: 2, weapon: 'Great Axe', armor: 'Furs', ability1: 'CLEAVE', desc1: 'Deals damage to all adjacent enemies. Cooldown: 4', ability2: 'BLOODLUST', desc2: '(Lvl 5) For 3 turns, heal 50% of damage dealt, but take 15% more damage. Cooldown: 12', passive: 'Deals +1 damage for every 6 missing HP.', critChance: 0.15 },
  necromancer: { name: 'Necromancer', tagline: 'A dark caster who drains life from foes.', hp: 18, atk: 4, def: 1, weapon: 'Skull Rod', armor: 'Apprentice Robe', ability1: 'SIPHON LIFE', desc1: 'Deals damage and heals yourself for the same amount. Cooldown: 5', ability2: 'RAISE DEAD', desc2: '(Lvl 5) Mark an enemy for 3 turns. If it dies while marked, it becomes a loyal pet with 50% HP for 25 turns. Cooldown: 8', passive: 'Heals 2 HP whenever an enemy dies.', critChance: 0.05 },
  monk: { name: 'Monk', tagline: 'A disciplined martial artist.', hp: 28, atk: 4, def: 2, weapon: 'Bare Hands', armor: 'Gi', ability1: 'PUSH KICK', desc1: 'Pushes an enemy 1 tile away. Deals extra damage if they hit a wall. Cooldown: 3', ability2: 'FLURRY OF BLOWS', desc2: '(Lvl 5) Attacks 3 times instantly, but you are rooted for your next turn. Cooldown: 10', passive: 'Gains level-based ATK when NO weapon is equipped.', critChance: 0.05 }
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
  let wp = WEAPONS.find(w=>w.name===c.weapon) || {};
  let ar = ARMORS.find(a=>a.name===c.armor) || {};
  
  let dodge = (c.dodgeBonus||0) + (wp.dodgeBonus||0) + (ar.dodgeBonus||0);
  let crit = (c.critChance||0) + (wp.critChance||0) + (ar.critChance||0);
  let per = (c.perception||0) + (wp.perception||0) + (ar.perception||0);

  let h = `
    <div class="class-title">${c.name}</div>
    <div class="class-tagline">${c.tagline}</div>
    <div class="class-stat-box">
      <div class="c-stat"><div class="c-stat-lbl">HP</div><div class="c-stat-val" style="color:var(--red)">${fmt1(c.hp)}</div></div>
      <div class="c-stat"><div class="c-stat-lbl">ATK</div><div class="c-stat-val" style="color:var(--orange)">${fmt1(c.atk)}</div></div>
      <div class="c-stat"><div class="c-stat-lbl">DEF</div><div class="c-stat-val" style="color:var(--blue)">${fmt1(c.def)}</div></div>
    </div>
    <div class="class-stat-box" style="margin-top:8px;">
      <div class="c-stat"><div class="c-stat-lbl">PERC</div><div class="c-stat-val" style="color:var(--green)">${fmt1(per)}</div></div>
      <div class="c-stat"><div class="c-stat-lbl">CRIT</div><div class="c-stat-val" style="color:#fbbf24">${fmtPct(crit)}</div></div>
      <div class="c-stat"><div class="c-stat-lbl">DODGE</div><div class="c-stat-val" style="color:#a78bfa">${fmtPct(dodge)}</div></div>
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
  let hm = document.getElementById('hard-mode-toggle').checked;
  startGame(_selectedClass, hm);
}

function startGame(playerClass = 'warrior', hardMode = false){
  document.getElementById('title-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  initGame(playerClass, hardMode);
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
      Damage dealt: <span>${fmt1(p.damageDealt)}</span><br>
      Best weapon: <span>${p.bestWeapon}</span><br>
      Gold earned: <span>${fmt1(p.gold)}💰</span><br>
      Floors: <span>${G.floor}</span><br>
      Turns: <span>${G.turn}</span>
    </div>
    <button class="btn" onclick="this.closest('.overlay').remove();openClassSelect()">CHOOSE CLASS</button>
  </div>`;
  document.body.appendChild(o);
}

function showVictory(){
  let p=G.player,o=document.createElement('div');
  o.className='overlay';
  let diffMult = G.hardMode ? 1.5 : 1.0;
  let baseScore = G.floor * p.kills * p.lvl;
  let score = Math.floor(baseScore * diffMult);
  o.innerHTML=`<div class="modal victory">
    <h2>★ VICTORY ★</h2>
    <p>You escaped the dungeon!</p>
    <div class="stats-list">
      Level: <span>${p.lvl}</span><br>
      Kills: <span>${p.kills}</span><br>
      Damage dealt: <span>${fmt1(p.damageDealt)}</span><br>
      Best weapon: <span>${p.bestWeapon}</span><br>
      Gold: <span>${fmt1(p.gold)}💰</span><br>
      Turns: <span>${G.turn}</span>
    </div>
    <div class="stats-list" style="margin-top:10px; border-top:1px dashed var(--dim); padding-top:10px;">
      Base Score (Flr×Kills×Lvl): <span>${baseScore}</span><br>
      Difficulty Multiplier: <span>${fmt1(diffMult)}x</span><br>
      <strong style="color:var(--gold);font-size:1.1em;">Final Score: ${score}</strong>
    </div>
    <button class="btn btn-gold" onclick="this.closest('.overlay').remove();openClassSelect()" style="margin-top:15px;">CHOOSE CLASS</button>
  </div>`;
  document.body.appendChild(o);
}
