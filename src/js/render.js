// ===================== RENDER =====================
function getCellSize(){
  let a=document.getElementById('map-area');
  return Math.max(9,Math.min(Math.floor((a.clientWidth-10)/MAP_W),Math.floor((a.clientHeight-10)/MAP_H),18));
}
function positionMapOnPlayer(){
  const area=document.getElementById('map-area');
  const wrap=document.getElementById('map-wrap');
  const player=document.querySelector('.tile-player');
  if(!area||!wrap||!player) return;
  wrap.style.transform='translate(0px,0px)';
  const areaRect=area.getBoundingClientRect();
  const wrapRect=wrap.getBoundingClientRect();
  const playerRect=player.getBoundingClientRect();
  let tx=0,ty=0;
  const mx=Math.min(32,areaRect.width*.18);
  const my=Math.min(32,areaRect.height*.18);
  if(wrapRect.width>areaRect.width){
    if(playerRect.left<areaRect.left+mx) tx=areaRect.left+mx-playerRect.left;
    else if(playerRect.right>areaRect.right-mx) tx=areaRect.right-mx-playerRect.right;
    tx=Math.max(areaRect.right-wrapRect.right,Math.min(areaRect.left-wrapRect.left,tx));
  }
  if(wrapRect.height>areaRect.height){
    if(playerRect.top<areaRect.top+my) ty=areaRect.top+my-playerRect.top;
    else if(playerRect.bottom>areaRect.bottom-my) ty=areaRect.bottom-my-playerRect.bottom;
    ty=Math.max(areaRect.bottom-wrapRect.bottom,Math.min(areaRect.top-wrapRect.top,ty));
  }
  wrap.style.transform=`translate(${Math.round(tx)}px,${Math.round(ty)}px)`;
}
function formatSecStats(item) {
  let s = [];
  if(item.critChance) s.push(`+${fmtPct(item.critChance)} Crit`);
  if(item.dodgeBonus) s.push(`+${fmtPct(item.dodgeBonus)} Dodge`);
  if(item.perception) s.push(`+${fmt1(item.perception)} PERC`);
  if(item.vampirism) s.push(`+${fmt1(item.vampirism)} Vamp`);
  if(item.regen) s.push(`+${fmt1(item.regen)} Regen`);
  if(item.swiftness) s.push(`+${fmt1(item.swiftness)} Swift`);
  return s.length > 0 ? ` <span class="sec-stats" style="color:var(--accent);font-size:0.7em;">(${s.join(', ')})</span>` : '';
}

function iDesc(item){
  let reqs = [];
  let canEverEquip = !item.reqClass || item.reqClass.includes(G.player.class);
  let canEquipNow = canEverEquip && (!item.reqLvl || G.player.lvl >= item.reqLvl);

  let pAtk = typeof weaponPower === 'function' ? weaponPower(G.player.weapon) : (G.player.weapon ? G.player.weapon.atk : 0);
  let pDef = typeof armorPower === 'function' ? armorPower(G.player.armor) : (G.player.armor ? G.player.armor.def : 0);
  let itemAtk = typeof weaponPower === 'function' ? weaponPower(item) : (item.atk || 0);
  let itemDefPower = typeof armorPower === 'function' ? armorPower(item) : (item.def || 0);
  let isBetter = (item.type==='weapon' && itemAtk > pAtk) || (item.type==='armor' && itemDefPower > pDef);

  if(item.reqLvl) reqs.push(`Lvl ${item.reqLvl}`);
  if(item.reqClass) reqs.push(`${item.reqClass.map(c=>c.substring(0,3).toUpperCase()).join('/')}`);

  let cls = 'req-tag';
  let prefix = '';
  if(!canEverEquip) {
    // defaults to red
  } else if(!canEquipNow && isBetter) {
    cls += ' req-wait'; prefix = '⏳ ';
  } else if(canEquipNow && isBetter) {
    cls += ' req-match'; prefix = '✔ ';
  } else if(canEquipNow && !isBetter) {
    cls += ' req-dim-match'; prefix = '✔ ';
  }

  let rStr = reqs.length ? `<span class="${cls}">${prefix}Req: ${reqs.join(' ')}</span>` : '';

  if(item.type==='weapon') {
    let up = itemAtk > pAtk ? ' <span class=green>▲</span>' : '';
    return `ATK+${fmt1(item.atk)}${up}${formatSecStats(item)} ${rStr}`;
  }
  if(item.type==='armor') {
    let itemDef = typeof armorPower === 'function' ? armorPower(item) : item.def;
    let up = itemDef > pDef ? ' <span class=green>▲</span>' : '';
    return `DEF+${fmt1(item.def)}${up}${formatSecStats(item)} ${rStr}`;
  }
  if(item.type==='potion') return `Heal ${fmt1(item.heal)} HP`;
  if(item.type==='upgrade')return item.desc||'';
  return item.desc || '';
}
const gatk=()=>{
  let w = G.player.weapon;
  let watk = typeof weaponDamage === 'function' ? weaponDamage(w) : (typeof weaponPower === 'function' ? weaponPower(w) : (w ? w.atk : 0));
  if(typeof weaponDamage !== 'function' && typeof weaponPower !== 'function' && G.player.class === 'monk' && !w) watk += Math.ceil(G.player.lvl / 2);
  if(typeof weaponDamage !== 'function' && typeof weaponPower !== 'function' && G.player.class === 'mage' && w && w.sym === '♦') watk += Math.floor(watk / 5);
  let total = G.player.atk + watk;
  if(G.player.class === 'barbarian') total += Math.floor((G.player.maxHp - G.player.hp) / 6);
  if(G.player.strengthTurns > 0) total += 10;
  if(G.player.magicMult && w && w.sym === '♦') total = Math.floor(total * G.player.magicMult);
  return round1(total);
};
const gdef=()=>{
  let armDef = G.player.armor ? G.player.armor.def : 0;
  return round1(G.player.def + armDef);
};

function render(){
  if (typeof advanceAnimations === 'function') advanceAnimations();
  if (typeof renderPixedScene === 'function') {
    renderPixedScene();
  } else {
    renderLegacyMap();
  }
  drawMinimap();
  updateHUD();
  updateInvDrawer();
  updateActBtns();
}

function renderLegacyMap(){
  const mapEl=document.getElementById('map');
  const cs=getCellSize();
  mapEl.style.gridTemplateColumns=`repeat(${MAP_W},${cs}px)`;
  mapEl.style.fontSize=`${cs*.72}px`;
  const CH={[TILE.WALL]:'█',[TILE.FLOOR]:'·',[TILE.STAIRS]:'>',[TILE.SHOP]:'$',[TILE.LOCKED_DOOR]:'🔒',[TILE.SECRET_DOOR]:'█'};
  let h='';
  for(let y=0;y<MAP_H;y++){
    for(let x=0;x<MAP_W;x++){
      let k=y*MAP_W+x,vis=G.visible.has(k),seen=G.seen.has(k);
      let s=`width:${cs}px;height:${cs}px;`;
      if(!seen){h+=`<div class="tile tile-dark" style="${s}"></div>`;continue;}
      let t=G.map[y][x];
      if(x===G.player.x&&y===G.player.y){h+=`<div class="tile tile-player" style="${s}">@</div>`;continue;}
      let en=vis?G.enemies.find(e=>e.x===x&&e.y===y):null;
      if(en){
        let maxRange = (G.player.class === 'ranger' && G.player.weapon && G.player.weapon.sym === '🏹') ? 3 : 2;
        let dist = Math.max(Math.abs(en.x-G.player.x), Math.abs(en.y-G.player.y));
        let canTap = (dist <= maxRange);
        let dyingClass=en.dying?' tile-enemy-dying':'';
        let eliteClass=en.isElite?' tile-elite':'';
        let petClass=en.isPet?' tile-pet':'';
        h+=`<div class="tile tile-enemy${dyingClass}${eliteClass}${petClass}" style="${s}color:${en.color};text-shadow:0 0 5px ${en.color}"
          onmouseenter="showTip(event,'${en.name}',${en.hp},${en.maxHp},${en.atk})"
          onmouseleave="hideTip()"
          onclick="${en.dying||!canTap?'':`tileAttack('${en.id}')`}"
          ontouchstart="${en.dying?'':`startLongPress(event,'${en.id}','${en.name}',${en.hp},${en.maxHp},${en.atk})`}"
          ontouchend="${en.dying||!canTap?'':`endLongPress(event,'${en.id}')`}"
          ontouchmove="${en.dying?'':'cancelLongPress()'}">
          ${en.sym.toUpperCase()}</div>`;
        continue;
      }
      let it=vis?G.items.find(i=>!i.carried&&i.x===x&&i.y===y):null;
      if(it){
        let safeName = it.name.replace(/'/g,"\\'").replace(/"/g,"&quot;");
        let safeDesc = iDesc(it).replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,"\\'").replace(/"/g,"&quot;");
        h+=`<div class="tile tile-item" style="${s}"
          ontouchend="event.preventDefault();tilePickup('${it.id}')"
          ontouchstart="showTip(event,'${safeName}: ${safeDesc}');event.stopPropagation()"
          onmouseenter="showTip(event,'${safeName}: ${safeDesc}')"
          onmouseleave="hideTip()"
          onclick="tilePickup('${it.id}')">${it.sym}</div>`;
        continue;
      }
      let trap=seen&&G.traps?G.traps.find(t=>t.x===x&&t.y===y):null;
      if(trap && (trap.triggered || trap.revealed)){
        let trapSym = trap.type === 'spike' ? '^' : trap.type === 'gas' ? '*' : '!';
        let trapColor = trap.type === 'spike' ? 'var(--orange)' : trap.type === 'gas' ? 'var(--green)' : 'var(--red)';
        let opacity = trap.triggered ? '1' : '0.5';
        h+=`<div class="tile tile-trap" style="${s}color:${trapColor};text-shadow:0 0 5px ${trapColor};opacity:${opacity}"
            onmouseenter="showTip(event,'${trap.type.toUpperCase()} TRAP (Revealed)')"
            onmouseleave="hideTip()">${trapSym}</div>`;continue;
      }
      if(t===TILE.STAIRS&&seen){
        h+=`<div class="tile tile-stairs" style="${s}" onclick="descend()" ontouchend="event.preventDefault();descend()">></div>`;continue;
      }
      if(t===TILE.SHOP&&seen){
        h+=`<div class="tile tile-shop" style="${s}" onclick="openShop()" ontouchend="event.preventDefault();openShop()">$</div>`;continue;
      }
      let sc=(seen&&!vis)?' tile-seen':'';
      h+=`<div class="tile ${(t===TILE.WALL||t===TILE.SECRET_DOOR)?'tile-wall':'tile-floor'}${sc}" style="${s}">${CH[t]||' '}</div>`;
    }
  }
  mapEl.innerHTML=h;
  positionMapOnPlayer();
}

function updateHUD(){
  let p=G.player;
  let hpBar=document.getElementById('hp-bar'); if(hpBar) hpBar.style.width=Math.max(0,p.hp/p.maxHp*100)+'%';
  let hpVal=document.getElementById('hp-val'); if(hpVal) hpVal.textContent=`${fmt1(Math.max(0, p.hp))}/${fmt1(p.maxHp)}`;
  let xpBar=document.getElementById('xp-bar'); if(xpBar) xpBar.style.width=Math.min(100,p.xp/p.xpNext*100)+'%';
  let xpVal=document.getElementById('xp-val'); if(xpVal) xpVal.textContent=`${fmt1(p.xp)}/${fmt1(p.xpNext)}`;
  let atkVal=document.getElementById('atk-val'); if(atkVal) atkVal.textContent=fmt1(gatk());
  let defVal=document.getElementById('def-val'); if(defVal) defVal.textContent=fmt1(gdef());
  let perVal=document.getElementById('per-val'); if(perVal) perVal.textContent=fmt1(getStat('perception'));
  let lvlVal=document.getElementById('lvl-val'); if(lvlVal) lvlVal.textContent=p.lvl;
  let classVal=document.getElementById('class-val'); if(classVal) classVal.textContent=p.class;
  let goldVal=document.getElementById('gold-val'); if(goldVal) goldVal.textContent=fmt1(p.gold);
  let floorLabel=document.getElementById('floor-label'); if(floorLabel) floorLabel.textContent=`FLOOR ${G.floor}`;
}

function updateActBtns(){
  const A1 = { warrior:'BASH', rogue:'DASH', mage:'FIREBALL', paladin:'SMITE', ranger:'PIERCING SHOT', barbarian:'CLEAVE', necromancer:'SIPHON LIFE', monk:'PUSH KICK' };
  const A2 = { warrior:'SHIELD', rogue:'VANISH', mage:'BLINK', paladin:'HEAL', ranger:'BEAR TRAP', barbarian:'BLOODLUST', necromancer:'RAISE', monk:'FLURRY' };
  const A1Short = { warrior:'BASH', rogue:'DASH', mage:'FIRE', paladin:'SMITE', ranger:'PIERCE', barbarian:'CLEAVE', necromancer:'SIPHON', monk:'KICK' };
  const A2Short = { warrior:'WARD', rogue:'VANISH', mage:'BLINK', paladin:'HEAL', ranger:'TRAP', barbarian:'BLOOD', necromancer:'RAISE', monk:'FLURRY' };
  const cdLabel = (name, cooldown) => cooldown > 0 ? `${name}\n${cooldown}` : name;

  // ABILITY 1
  let a1=document.getElementById('ability1-btn');
  if(a1) {
    let a1Name = A1[G.player.class] || 'ABIL1';
    a1.className='act-btn ability-slot'+(G.ability1Cooldown===0?' bash-ready':'');
    a1.textContent=G.ability1Cooldown>0?`${a1Name} ${G.ability1Cooldown}`:`⚡${a1Name}`;
  }

  if(a1) {
    const a1ShortName = A1Short[G.player.class] || 'ABIL1';
    const a1FullName = A1[G.player.class] || a1ShortName;
    a1.title = a1FullName;
    a1.setAttribute('aria-label', a1FullName);
    a1.textContent = cdLabel(a1ShortName, G.ability1Cooldown);
  }

  // ABILITY 2
  let a2=document.getElementById('ability2-btn');
  if(a2) {
    if(G.player.lvl >= 5) {
      a2.style.display = 'block';
      let a2Name = A2[G.player.class] || 'ABIL2';
      a2.className='act-btn ability-slot'+(G.ability2Cooldown===0?' bash-ready':'');
      a2.textContent=G.ability2Cooldown>0?`${a2Name} ${G.ability2Cooldown}`:`⚡${a2Name}`;
    } else {
      a2.style.display = 'none';
    }
  }

  if(a2 && G.player.lvl >= 5) {
    const a2ShortName = A2Short[G.player.class] || 'ABIL2';
    const a2FullName = A2[G.player.class] || a2ShortName;
    a2.style.display = 'flex';
    a2.title = a2FullName;
    a2.setAttribute('aria-label', a2FullName);
    a2.textContent = cdLabel(a2ShortName, G.ability2Cooldown);
  }

  // BOMB
  let bombBtn=document.getElementById('bomb-btn');
  if(bombBtn) {
    let hasBomb=G.items.some(i=>i.name==='Bomb' && i.carried);
    bombBtn.style.display=hasBomb?'flex':'none';
  }

  // STAIRS
  let sb=document.getElementById('stairs-btn');
  let onS=G.map&&G.map[G.player.y][G.player.x]===TILE.STAIRS;
  sb.className='act-btn ability-slot'+(onS?' stairs-avail':'');
  sb.textContent=onS?'▼ GO':'STAIRS';
  sb.textContent=onS?'GO':'STAIRS';
  // SHOP
  let shopBtn=document.getElementById('shop-btn');
  let nearShop=G.shops && G.shops.some(s => Math.abs(G.player.x-s.x)<=1 && Math.abs(G.player.y-s.y)<=1);
  shopBtn.className='act-btn ability-slot'+(nearShop?' shop-avail':'');
  shopBtn.textContent=nearShop?'$ SHOP':'SHOP';
  shopBtn.textContent='SHOP';
  // BAG
  let bagBtn=document.getElementById('bag-btn');
  let hasItems=G.items.some(i=>i.carried);
  bagBtn.className='act-btn ability-slot'+(hasItems?' bag-has':'');
  bagBtn.textContent=hasItems?'🎒 BAG':'BAG';
  bagBtn.textContent='BAG';
}

function updateInvDrawer(){
  let inv=G.items.filter(i=>i.carried);
  let h='';
  if(!inv.length) h='<div class="inv-empty">Empty</div>';
  else {
    let grouped = {};
    inv.forEach(it => {
      if(!grouped[it.name]) grouped[it.name] = { count: 0, items: [] };
      grouped[it.name].count++;
      grouped[it.name].items.push(it);
    });
    Object.values(grouped).forEach(g => {
      let it = g.items[0];
      let countTag = g.count > 1 ? ` <span style="color:var(--accent);font-size:.5rem">x${g.count}</span>` : '';
      let colorCls = getItemColorClass(it);
      h+=`<div class="inv-slot"
        onclick="useItem('${it.id}')"
        ontouchend="event.preventDefault();useItem('${it.id}')">
        <div><div class="inv-name ${colorCls}">${it.name}${countTag}</div><div class="inv-type">${it.rarity} ${it.type}</div></div>
        <div class="inv-bonus">${iDesc(it)}</div>
      </div>`;
    });
  }
  document.getElementById('inventory-list').innerHTML=h;
  let eh='';
  if(G.player.weapon) eh+=`<div class="inv-slot equipped"><div><div class="inv-name">${G.player.weapon.name}</div><div class="inv-type">weapon</div></div><div class="inv-bonus">ATK+${fmt1(weaponPower(G.player.weapon))}</div></div>`;
  if(G.player.armor)  eh+=`<div class="inv-slot equipped"><div><div class="inv-name">${G.player.armor.name}</div><div class="inv-type">armor</div></div><div class="inv-bonus">DEF+${fmt1(armorPower(G.player.armor))}</div></div>`;
  if(!G.player.weapon&&!G.player.armor) eh='<div class="inv-empty">Nothing equipped</div>';
  document.getElementById('equipped-list').innerHTML=eh;
}

function drawMinimap() {
  const cvs = document.getElementById('minimap');
  if(!cvs || !G.map) return;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,112,72);
  const pxSize = 2;
  for(let y=0; y<MAP_H; y++){
    for(let x=0; x<MAP_W; x++){
      let k = y*MAP_W+x;
      if(!G.seen.has(k)) continue;
      
      let t = G.map[y][x];
      let vis = G.visible.has(k);
      if(t===TILE.WALL || t===TILE.SECRET_DOOR) ctx.fillStyle = vis ? '#333' : '#111';
      else if(t===TILE.STAIRS) ctx.fillStyle = vis ? '#4ade80' : '#225533';
      else if(t===TILE.SHOP) ctx.fillStyle = vis ? '#fbbf24' : '#665511';
      else if(t===TILE.LOCKED_DOOR) ctx.fillStyle = vis ? '#f87171' : '#662222';
      else ctx.fillStyle = vis ? '#7e7ea3' : '#333344';
      
      ctx.fillRect(x*pxSize, y*pxSize, pxSize, pxSize);
    }
  }
  ctx.fillStyle = '#4ade80'; // Player
  ctx.fillRect(G.player.x*pxSize, G.player.y*pxSize, pxSize, pxSize);
}
