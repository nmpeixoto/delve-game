// ===================== ITEMS =====================
function spawnItem(r){
  let pool=[...WEAPONS,...ARMORS,...POTIONS];
  let w=pool.flatMap(i=>i.rarity==='legendary'?[i]:i.rarity==='rare'?[i,i]:[i,i,i,i]);
  let t=w[rand(w.length)];
  G.items.push({...t,x:r.x+rr(1,r.w-2),y:r.y+rr(1,r.h-2),id:uid()});
}

function tilePickup(id){
  if(!canAct()||G.gameOver||G.won) return;
  let it=G.items.find(i=>i.id==id);if(!it||it.carried)return;
  if(Math.abs(it.x-G.player.x)>1||Math.abs(it.y-G.player.y)>1){
    move(Math.sign(it.x-G.player.x)||0,Math.sign(it.y-G.player.y)||0);return;
  }
  pickupItem(id);
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
  let match=current.match(/ATK\+(\d+)/);
  let currentAtk=match?parseInt(match[1]):0;
  let wp = weaponPower(weapon);
  if(wp>currentAtk){
    G.player.bestWeapon=`${weapon.name} (ATK+${wp})`;
  }
}

function canEquip(it) {
  if (it.reqLvl && G.player.lvl < it.reqLvl) return false;
  if (it.reqClass && !it.reqClass.includes(G.player.class)) return false;
  return true;
}

function weaponPower(it) {
  if (!it) {
    return G.player.class === 'monk' ? Math.floor(G.player.lvl / 2) : 0;
  }
  let power = it.atk || 0;
  if (G.player.class === 'mage' && it.sym === '\u2666') power += Math.floor(power / 5);
  return power;
}

function armorPower(it) {
  return it ? (it.def || 0) : 0;
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

function useItem(id){
  let it=G.items.find(i=>i.id==id);if(!it)return;
  if(it.type==='potion'){
    let h=Math.min(it.heal,G.player.maxHp-G.player.hp);
    G.player.hp+=h;
    addLog(`Drank ${it.name}: +${h} HP`,'log-item');
    floatText(`+${h} HP`,G.player.x,G.player.y,'#4ade80');
    let idx = G.items.findIndex(i=>i.id===id);
    if(idx > -1) G.items.splice(idx,1);
    advanceTurn();closeInv();
    return;
  }

  if(it.type==='scroll') {
    if(it.name==='Scroll of Detection') {
      let r = 8;
      let revealedSomething = false;
      for(let y=Math.max(0, G.player.y-r); y<=Math.min(MAP_H-1, G.player.y+r); y++) {
        for(let x=Math.max(0, G.player.x-r); x<=Math.min(MAP_W-1, G.player.x+r); x++) {
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

function interactShrine(it) {
  let idx = G.items.findIndex(i => i.id === it.id);
  if(idx > -1) G.items.splice(idx, 1);
  
  if(ch(0.75)) {
    let buffType = ch(0.5) ? 'atk' : 'def';
    if(buffType === 'atk') {
      G.player.atk += 1;
      addLog('The shrine blessed you! +1 ATK', 'log-info');
      floatText('+1 ATK', G.player.x, G.player.y, '#fbbf24');
    } else {
      G.player.def += 1;
      addLog('The shrine blessed you! +1 DEF', 'log-info');
      floatText('+1 DEF', G.player.x, G.player.y, '#4ade80');
    }
  } else {
    let debuffType = ch(0.5) ? 'maxHp' : 'atk';
    if(debuffType === 'maxHp') {
      let loss = Math.max(1, Math.floor(G.player.maxHp * 0.1));
      G.player.maxHp -= loss;
      if(G.player.hp > G.player.maxHp) G.player.hp = G.player.maxHp;
      addLog(`The shrine cursed you! -${loss} Max HP`, 'log-combat');
      floatText(`-${loss} MAX HP`, G.player.x, G.player.y, '#f87171');
      flashDamage();
    } else {
      let loss = 1;
      G.player.atk = Math.max(1, G.player.atk - loss);
      addLog('The shrine cursed you! -1 ATK', 'log-combat');
      floatText('-1 ATK', G.player.x, G.player.y, '#f87171');
      flashDamage();
    }
  }
  SFX.click();
  advanceTurn({allowFreeMove:true});
}

function descend(){
  if(G.gameOver||G.won)return;
  if(G.map[G.player.y][G.player.x]!==TILE.STAIRS){addLog('Find the stairs (>) first','log-info');return;}
  G.floor++;
  if(G.floor>FLOORS){G.won=true;showVictory();return;}
  G.player.hp=Math.min(G.player.maxHp,G.player.hp+10);
  buildFloor();
}
