// ===================== ITEMS =====================
function tilePickup(id){
  if(!canAct()||G.gameOver||G.won) return;
  let it=G.items.find(i=>i.id==id);if(!it||it.carried)return;
  if(Math.abs(it.x-G.player.x)>1||Math.abs(it.y-G.player.y)>1){
    move(Math.sign(it.x-G.player.x)||0,Math.sign(it.y-G.player.y)||0);return;
  }
  if(it.type === 'shrine') interactShrine(it);
  else pickupItem(id);
}

function pickupItem(id, opts={}){
  let it=G.items.find(i=>i.id==id);if(!it||it.carried)return;
  if(it.type==='potion'){
    it.carried=true;it.x=undefined;it.y=undefined;
    addLog(`Picked up ${it.name} — stored in bag`,'log-item');
    floatText(`+BAG`,G.player.x,G.player.y,'#fbbf24');
    SFX.pickup();fireTip('firstPotion');
  } else {
    it.carried=true;it.x=undefined;it.y=undefined;
    addLog(`Picked up ${it.name}`,'log-item');
    SFX.pickup();autoEquip(it);
    fireTip('firstItem');
  }
  advanceTurn(opts);
}

function updateBestWeapon(weapon){
  let current=G.player.bestWeapon;
  let match=current.match(/ATK\+(\d+(?:\.\d)?)/);
  let currentAtk=match?parseFloat(match[1]):0;
  let wp = weaponPower(weapon);
  if(wp>currentAtk){
    G.player.bestWeapon=`${weapon.name} (ATK+${fmt1(wp)})`;
  }
}

function canEquip(it) {
  if (it.reqLvl && G.player.lvl < it.reqLvl) return false;
  if (it.reqClass && !it.reqClass.includes(G.player.class)) return false;
  return true;
}

function weaponDamage(it) {
  let unarmed = G.player.class === 'monk' ? Math.ceil(G.player.lvl / 2) : 0;
  if (!it) {
    return unarmed;
  }
  let power = it.atk || 0;
  if (G.player.class === 'mage' && it.sym === '\u2666') power += Math.floor(power / 5);
  if (G.player.class === 'monk') {
    return Math.max(power, unarmed);
  }
  return power;
}

function weaponPower(it) {
  let power = weaponDamage(it);
  if (!it) return power;
  
  let sec = 0;
  if(it.vampirism) sec += it.vampirism * 0.1;
  if(it.critChance) sec += it.critChance;
  if(it.perception) sec += it.perception * 0.1;
  if(it.swiftness) sec += it.swiftness * 0.5;
  if(it.dodgeBonus) sec += it.dodgeBonus;
  if(it.regen) sec += it.regen * 0.1;
  
  return power + sec;
}

function armorPower(it) {
  if (!it) return 0;
  let power = it.def || 0;
  let sec = 0;
  if(it.dodgeBonus) sec += it.dodgeBonus;
  if(it.perception) sec += it.perception * 0.1;
  if(it.swiftness) sec += it.swiftness * 0.5;
  if(it.critChance) sec += it.critChance;
  return power + sec;
}

function getItemColorClass(it) {
  if (it.type !== 'weapon' && it.type !== 'armor') return '';
  if (it.reqClass && !it.reqClass.includes(G.player.class)) return 'item-never';

  let isUpgrade = false;
  if (it.type === 'weapon') isUpgrade = weaponPower(it) > weaponPower(G.player.weapon);
  if (it.type === 'armor') isUpgrade = armorPower(it) > armorPower(G.player.armor);

  if (!isUpgrade) return '';

  if (it.reqLvl && it.reqLvl > G.player.lvl) return 'item-wait';
  return 'item-upgrade';
}

function checkBagUpgrades(){
  let bag = G.items.filter(i=>i.carried);
  let swapped = false;
  bag.forEach(it => {
    if(canEquip(it)) {
      if(it.type === 'weapon' && weaponPower(it) > weaponPower(G.player.weapon)) {
        let prev = G.player.weapon;
        if(prev) {
          prev.carried = true; prev.x = undefined; prev.y = undefined;
          G.items.push(prev);
        }
        G.player.weapon = it; it.carried = false;
        let idx = G.items.findIndex(i => i.id === it.id);
        if(idx > -1) G.items.splice(idx, 1);
        updateBestWeapon(it);
        addLog(`Auto-equipped better weapon: ${it.name}`, 'log-item');
        swapped = true;
      }
      else if(it.type === 'armor' && armorPower(it) > armorPower(G.player.armor)) {
        let prev = G.player.armor;
        if(prev) {
          prev.carried = true; prev.x = undefined; prev.y = undefined;
          G.items.push(prev);
        }
        G.player.armor = it; it.carried = false;
        let idx = G.items.findIndex(i => i.id === it.id);
        if(idx > -1) G.items.splice(idx, 1);
        addLog(`Auto-equipped better armor: ${it.name}`, 'log-item');
        swapped = true;
      }
    }
  });
  if(swapped) SFX.pickup();
}

function autoEquip(it){
  if(it.type==='weapon'){
    let prev=G.player.weapon;
    if(canEquip(it) && weaponPower(it)>weaponPower(prev)){
      if(prev){
        G.items=G.items.filter(i=>i.id!==prev.id);
        prev.carried=true;prev.x=undefined;prev.y=undefined;
        G.items.push(prev);
      }
      G.player.weapon=it;it.carried=false;
      G.items=G.items.filter(i=>i.id!==it.id);
      updateBestWeapon(it);
      addLog(`Equipped ${it.name}!`,'log-item');
    } else {
      it.carried=true;it.x=undefined;it.y=undefined;
      let reason = !canEquip(it) ? 'requirements not met' : 'weaker than current';
      addLog(`${it.name} added to bag (${reason}).`,'log-item');
    }
  } else if(it.type==='armor'){
    let prev=G.player.armor;
    if(canEquip(it) && armorPower(it)>armorPower(prev)){
      if(prev){
        G.items=G.items.filter(i=>i.id!==prev.id);
        prev.carried=true;prev.x=undefined;prev.y=undefined;
        G.items.push(prev);
      }
      G.player.armor=it;it.carried=false;
      G.items=G.items.filter(i=>i.id!==it.id);
      addLog(`Equipped ${it.name}!`,'log-item');
    } else {
      it.carried=true;it.x=undefined;it.y=undefined;
      let reason = !canEquip(it) ? 'requirements not met' : 'weaker than current';
      addLog(`${it.name} added to bag (${reason}).`,'log-item');
    }
  }
}

function getTeleportSafeTiles(){
  const isSafeFloor = (x, y) => (
    G.map[y][x] === TILE.FLOOR &&
    !G.enemies.some(e => !e.dying && e.x === x && e.y === y)
  );
  const liveEnemies = () => G.enemies.filter(e => !e.dying);
  const roomForTile = (x, y) => (G.rooms || []).find(r =>
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
  );
  const roomHasEnemies = room => room && liveEnemies().some(e =>
    e.x >= room.x && e.x < room.x + room.w && e.y >= room.y && e.y < room.y + room.h
  );
  const withoutEnemyRooms = tiles => {
    let filtered = tiles.filter(tile => !roomHasEnemies(roomForTile(tile.x, tile.y)));
    return filtered.length ? filtered : tiles;
  };
  const visited = new Set();
  const components = [];
  const dirs = [[0,-1],[0,1],[-1,0],[1,0]];

  for(let y=1; y<MAP_H-1; y++) {
    for(let x=1; x<MAP_W-1; x++) {
      let startKey = `${x},${y}`;
      if(visited.has(startKey) || !isSafeFloor(x, y)) continue;

      let component = [];
      let q = [{x, y}];
      visited.add(startKey);
      while(q.length) {
        let cur = q.shift();
        component.push(cur);
        dirs.forEach(([dx, dy]) => {
          let nx = cur.x + dx, ny = cur.y + dy;
          let key = `${nx},${ny}`;
          if(nx<=0 || nx>=MAP_W-1 || ny<=0 || ny>=MAP_H-1) return;
          if(visited.has(key) || !isSafeFloor(nx, ny)) return;
          visited.add(key);
          q.push({x:nx, y:ny});
        });
      }
      components.push(component);
    }
  }

  let playerKey = `${G.player.x},${G.player.y}`;
  let playerComponent = components.find(component => component.some(tile => `${tile.x},${tile.y}` === playerKey));
  let candidates = playerComponent ? playerComponent.filter(tile => tile.x !== G.player.x || tile.y !== G.player.y) : [];
  if(candidates.length) return withoutEnemyRooms(candidates);

  let fallback = components
    .map(component => component.filter(tile => tile.x !== G.player.x || tile.y !== G.player.y))
    .sort((a, b) => b.length - a.length)[0] || [];
  return withoutEnemyRooms(fallback);
}

function useItem(id){
  let it=G.items.find(i=>i.id==id);if(!it)return;
  if(it.type==='potion'){
    if(G.player.hp >= G.player.maxHp){
      addLog('Already at full HP.','log-info');
      return;
    }
    let h=Math.min(it.heal,G.player.maxHp-G.player.hp);
    G.player.hp=round1(G.player.hp+h);
    addLog(`Drank ${it.name}: +${fmt1(h)} HP`,'log-item');
    floatText(`+${fmt1(h)} HP`,G.player.x,G.player.y,'#4ade80');
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    advanceTurn();closeInv();
    return;
  }

  if(it.type==='potion_buff'){
    if(it.buff === 'strength') {
      G.player.strengthTurns = 10;
      addLog(`Drank ${it.name}: Strength surged!`, 'log-item');
      floatText('STRENGTH', G.player.x, G.player.y, '#f87171');
      SFX.levelUp();
    }
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    advanceTurn();closeInv();
    return;
  }

  if(it.type==='bomb'){
    addLog(`Threw a Bomb!`, 'log-combat');
    floatText('BOOM!', G.player.x, G.player.y, '#fbbf24');
    SFX.damage();shakeMap();
    let killed = 0;
    for(let y = G.player.y - 1; y <= G.player.y + 1; y++){
      for(let x = G.player.x - 1; x <= G.player.x + 1; x++){
        let en = G.enemies.find(e => e.x === x && e.y === y && !e.dying);
        if(en){
          en.hp = round1(en.hp - 30);
          floatText(`-${fmt1(30)}`, en.x, en.y, '#f87171');
          if(en.hp <= 0) {
            killEnemy(en, true);
            killed++;
          }
        }
      }
    }
    if(killed === 0) addLog(`The bomb hit nothing.`, 'log-info');
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    advanceTurn();closeInv();
    return;
  }

  if(it.type==='scroll_teleport'){
    let safeTiles = getTeleportSafeTiles();
    if(safeTiles.length > 0) {
      let t = safeTiles[Math.floor(Math.random()*safeTiles.length)];
      G.player.x = t.x; G.player.y = t.y;
      addLog(`Teleported to a random location!`, 'log-info');
      floatText('TELEPORT', G.player.x, G.player.y, '#c084fc');
      SFX.pickup();
      computeVision();
    }
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    advanceTurn();closeInv();
    return;
  }

  if(it.type==='scroll') {
    if(it.name==='Scroll of Detection') {
      let revealedSomething = false;
      for(let y=0; y<MAP_H; y++) {
        for(let x=0; x<MAP_W; x++) {
          if(G.map[y][x] === TILE.SECRET_DOOR) {
            G.map[y][x] = TILE.FLOOR;
            revealedSomething = true;
          }
          let trap = G.traps.find(t => t.x === x && t.y === y && !t.revealed);
          if(trap) {
            trap.revealed = true;
            revealedSomething = true;
          }
        }
      }
      if(revealedSomething) {
        addLog('The scroll revealed hidden secrets nearby!', 'log-info');
        floatText('REVEALED', G.player.x, G.player.y, '#fbbf24');
      } else {
        addLog('The scroll revealed nothing.', 'log-info');
      }
      SFX.levelUp();
    }
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    advanceTurn();closeInv();
    return;
  }

  if(!canEquip(it)) {
    addLog(`Cannot equip ${it.name} (Requires: ${it.reqLvl?'Lvl '+it.reqLvl:''} ${it.reqClass?it.reqClass.join('/'):''})`, 'log-info');
    return;
  }

  if(it.type==='weapon'){
    let prev=G.player.weapon;
    if(prev){
      G.items=G.items.filter(i=>i.id!==prev.id);
      prev.carried=true;prev.x=prev.y=undefined;
      G.items.push(prev);
    }
    G.player.weapon=it;
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    updateBestWeapon(it);
    addLog(`Equipped ${it.name}`,'log-item');
  } else if(it.type==='armor'){
    let prev=G.player.armor;
    if(prev){
      G.items=G.items.filter(i=>i.id!==prev.id);
      prev.carried=true;prev.x=prev.y=undefined;
      G.items.push(prev);
    }
    G.player.armor=it;
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    addLog(`Equipped ${it.name}`,'log-item');
  }
  advanceTurn();closeInv();
}

function useBombQuickAction() {
  if(!canAct()||G.gameOver||G.won) return;
  let bomb = G.items.find(i => i.name === 'Bomb' && i.carried);
  if(bomb) {
    useItem(bomb.id);
  } else {
    addLog('You do not have a Bomb!', 'log-info');
  }
}

function interactShrine(it) {
  showShrinePrompt(it);
}

function descend(){
  if(G.gameOver||G.won)return;
  if(G.map[G.player.y][G.player.x]!==TILE.STAIRS){addLog('Find the stairs (>) first','log-info');return;}
  G.floor++;
  if(G.floor>FLOORS){G.won=true;showVictory();return;}
  if(typeof flushDeathBatch === 'function') flushDeathBatch();
  G.player.hp=round1(Math.min(G.player.maxHp,G.player.hp+10));
  G.player.poisonedTurns=0;
  buildFloor();
}
