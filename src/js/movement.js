// ===================== MOVEMENT =====================
function consumeRootedTurn(){
  addLog('You are rooted and cannot move!', 'log-combat');
  advanceTurn();
}

function checkCellItems(nx, ny) {
  let it=G.items.find(i=>!i.carried&&i.x===nx&&i.y===ny);
  if(it) {
    if(it.type === 'key') {
      pickupItem(it.id, {allowFreeMove:true, silent:true});
      addLog('Picked up a Key.', 'log-info');
      floatText('+KEY', nx, ny, '#fbbf24');
    } else if(it.type === 'shrine') {
      interactShrine(it);
    } else {
      pickupItem(it.id,{allowFreeMove:true});
    }
  } else {
    advanceTurn({allowFreeMove:true});
  }
}

function trapDisarmReward(){
  let floor = Math.max(1, Number.isFinite(G.floor) ? G.floor : 1);
  return {
    xp: 2 + floor * 2,
    gold: rr(5 + floor * 2, 10 + floor * 4),
  };
}

function grantTrapDisarmReward(x, y){
  let reward = trapDisarmReward();
  G.player.xp = round1((G.player.xp || 0) + reward.xp);
  G.player.gold = round1((G.player.gold || 0) + reward.gold);
  addLog(`Trap disarmed! +${fmt1(reward.xp)} XP +${fmt1(reward.gold)}💰`, 'log-info');
  floatText(`+${fmt1(reward.xp)} XP`, x, y, '#c084fc');
  floatText(`+${fmt1(reward.gold)}💰`, x, y, '#fbbf24');
  checkLevelUp();
}

function move(dx,dy){
  if(G.gameOver||G.won||!G.map)return;
  if(G.player.rootedTurns > 0) { consumeRootedTurn(); return; }
  let nx=G.player.x+dx,ny=G.player.y+dy;
  if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H||G.map[ny][nx]===TILE.WALL)return;

  if(G.map[ny][nx]===TILE.SECRET_DOOR){
    G.map[ny][nx] = TILE.FLOOR;
    addLog('You found a secret door!', 'log-info');
    SFX.click();
    return;
  }
  
  if(G.map[ny][nx]===TILE.LOCKED_DOOR){
    let keyIdx = G.items.findIndex(i => i.carried && i.type === 'key');
    if(keyIdx !== -1) {
      G.items.splice(keyIdx, 1);
      G.map[ny][nx] = TILE.FLOOR;
      addLog('Unlocked the door.', 'log-info');
      SFX.click();
    } else {
      addLog('The door is locked. You need a Key.', 'log-combat');
    }
    return;
  }

  let en=G.enemies.find(e=>e.x===nx&&e.y===ny);
  if(en){
    if(en.dying)return;
    if(en.isPet) {
      en.x = G.player.x; en.y = G.player.y;
      G.player.x = nx; G.player.y = ny;
      advanceTurn();
      return;
    }
    attackEnemy(en.id);
    return;
  }

  let trap = G.traps.find(t=>t.x===nx&&t.y===ny&&!t.triggered);
  if(trap && trap.type === 'bear') trap = null; // Bear traps only trigger on enemies
  if(trap && trap.revealed) {
    let disarmChance = 0.3 + (getStat('perception') * 0.15) + (G.player.class === 'rogue' ? 0.20 : 0);
    if(ch(disarmChance)) {
      trap.triggered = true;
      let tIdx = G.traps.findIndex(t => t.x===nx && t.y===ny);
      if(tIdx > -1) G.traps.splice(tIdx, 1);
      
      grantTrapDisarmReward(nx, ny);
      if(ch(0.2)) {
        spawnItem({x:nx, y:ny}, null, false);
        addLog('You found an item hidden in the trap mechanism!', 'log-info');
        floatText('+ITEM', nx, ny, '#a78bfa');
      } else {
        floatText('DISARMED', nx, ny, '#4ade80');
      }
      SFX.click();
    } else {
      addLog('You failed to disarm the trap and triggered it!', 'log-combat');
      floatText('FAILED', nx, ny, '#f87171');
      trap.triggered = true;
      let trapDodge = (G.player.class === 'rogue' ? 0.5 : 0) + getStat('dodgeBonus');
      if(ch(trapDodge)) {
        addLog('You agilely dodged the trap!', 'log-info');
        floatText('DODGED', nx, ny, '#fbbf24');
      } else {
        if(trap.type === 'spike') {
          let dmg = Math.floor(G.player.maxHp * 0.15) + 2;
          offerEmergencyPotion(dmg, () => {
            G.player.hp = round1(G.player.hp - dmg);
            addLog(`Spike trap triggered! Took ${fmt1(dmg)} damage.`, 'log-combat');
            floatText(`-${fmt1(dmg)}`, nx, ny, '#f87171');
            flashDamage();
            SFX.hit();
            if(G.player.hp <= 0) { G.gameOver = true; showDeath(); return; }
            advanceTurn();
          });
          return;
        } else if(trap.type === 'gas') {
          G.player.poisonedTurns = 5;
          addLog('Poison gas trap triggered!', 'log-combat');
          floatText('POISONED', nx, ny, '#a855f7');
          SFX.hit();
        } else if(trap.type === 'alarm') {
          G.alarmedTurns = 15;
          addLog('Alarm triggered! Enemies are alerted.', 'log-combat');
          floatText('ALARM!', nx, ny, '#f87171');
          SFX.hit();
          // Awake enemies
          G.enemies.forEach(e => {
            if(!e.dying && e.stunnedTurns) e.stunnedTurns = 0;
          });
        }
      }
    }
    advanceTurn();
    return;
  }

  // Leave a trail glow on the tile we're leaving
  if (typeof spawnPlayerTrail === 'function') spawnPlayerTrail(G.player.x, G.player.y);
  G.player.x=nx;G.player.y=ny;
  computeVision();

  if(trap && trap.type!=='bear'){
    trap.triggered = true;
    let trapDodge = (G.player.class === 'rogue' ? 0.5 : 0) + getStat('dodgeBonus');
    if(ch(trapDodge)) {
      addLog('You agilely dodged a trap!', 'log-info');
      floatText('DODGED', nx, ny, '#fbbf24');
    } else {
      if(trap.type === 'spike') {
        let dmg = Math.floor(G.player.maxHp * 0.15) + 2;
        offerEmergencyPotion(dmg, () => {
          G.player.hp = round1(G.player.hp - dmg);
          addLog(`You stepped on a spike trap! Took ${fmt1(dmg)} damage.`, 'log-combat');
          floatText(`-${fmt1(dmg)}`, nx, ny, '#f87171');
          flashDamage();
          SFX.hit();
          if(G.player.hp <= 0) { G.gameOver = true; showDeath(); return; }
          checkCellItems(nx, ny);
        });
        return;
      } else if(trap.type === 'gas') {
        G.player.poisonedTurns = 5;
        addLog('You triggered a poison gas trap!', 'log-combat');
        floatText('POISONED', nx, ny, '#a855f7');
        SFX.hit();
      } else if(trap.type === 'alarm') {
        G.alarmedTurns = 15;
        addLog('You triggered an alarm! Enemies are alerted.', 'log-combat');
        floatText('ALARM!', nx, ny, '#f87171');
        SFX.hit();
        // Awake enemies
        G.enemies.forEach(e => {
          if(!e.dying && e.stunnedTurns) e.stunnedTurns = 0;
        });
      }
    }
  }

  checkCellItems(nx, ny);
}

function dpadPress(dx,dy){
  if(G.gameOver||G.won)return;
  if(typeof stopActivePath === 'function') stopActivePath();
  move(dx,dy);clearInterval(_dpadTimer);
  _dpadTimer=setInterval(()=>move(dx,dy),185);
}
function dpadRelease(){clearInterval(_dpadTimer);_dpadTimer=null;}
