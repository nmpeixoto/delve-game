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

function pickupItem(id){
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
  advanceTurn();
}

function updateBestWeapon(weapon){
  let current=G.player.bestWeapon;
  // Parse current best ATK (stored as "Name (ATK+X)")
  let match=current.match(/ATK\+(\d+)/);
  let currentAtk=match?parseInt(match[1]):0;
  if(weapon.atk>currentAtk){
    G.player.bestWeapon=`${weapon.name} (ATK+${weapon.atk})`;
  }
}

function autoEquip(it){
  if(it.type==='weapon'){
    let prev=G.player.weapon;
    if(!prev||it.atk>prev.atk){
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
      // Worse than current — keep in bag
      it.carried=true;it.x=undefined;it.y=undefined;
      addLog(`${it.name} added to bag (weaker than current).`,'log-item');
    }
  } else if(it.type==='armor'){
    let prev=G.player.armor;
    if(!prev||it.def>prev.def){
      if(prev){
        G.items=G.items.filter(i=>i.id!==prev.id);
        prev.carried=true;prev.x=undefined;prev.y=undefined;
        G.items.push(prev);
      }
      G.player.armor=it;it.carried=false;
      G.items=G.items.filter(i=>i.id!==it.id);
      addLog(`Equipped ${it.name}!`,'log-item');
    } else {
      // Worse than current — keep in bag
      it.carried=true;it.x=undefined;it.y=undefined;
      addLog(`${it.name} added to bag (weaker than current).`,'log-item');
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
    G.items=G.items.filter(i=>i.id!==id);
    advanceTurn();closeInv();
    return;
  } else if(it.type==='weapon'){
    let prev=G.player.weapon;
    if(prev){
      G.items=G.items.filter(i=>i.id!==prev.id);
      prev.carried=true;prev.x=prev.y=undefined;
      G.items.push(prev);
    }
    G.player.weapon=it;
    G.items=G.items.filter(i=>i.id!==id);
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
    G.items=G.items.filter(i=>i.id!==id);
    addLog(`Equipped ${it.name}`,'log-item');
  }
  advanceTurn();closeInv();
}

function descend(){
  if(G.gameOver||G.won)return;
  if(G.map[G.player.y][G.player.x]!==TILE.STAIRS){addLog('Find the stairs (>) first','log-info');return;}
  G.floor++;
  if(G.floor>FLOORS){G.won=true;showVictory();return;}
  G.player.hp=Math.min(G.player.maxHp,G.player.hp+10);
  buildFloor();
}
