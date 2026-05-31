// ===================== MOVEMENT =====================
function consumeRootedTurn(){
  addLog('You are rooted and cannot move!', 'log-combat');
  advanceTurn();
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
  if(en){if(en.dying)return;attackEnemy(en.id);return;}

  let trap = G.traps.find(t=>t.x===nx&&t.y===ny&&!t.triggered);
  if(trap && trap.type === 'bear') trap = null; // Bear traps only trigger on enemies
  if(trap && trap.revealed) {
    let disarmChance = 0.3 + (G.player.perception * 0.15) + (G.player.class === 'rogue' ? 0.20 : 0);
    if(ch(disarmChance)) {
      trap.triggered = true;
      let tIdx = G.traps.findIndex(t => t.x===nx && t.y===ny);
      if(tIdx > -1) G.traps.splice(tIdx, 1);
      addLog('You successfully disarmed the trap!', 'log-info');
      floatText('DISARMED', nx, ny, '#4ade80');
      SFX.click();
    } else {
      addLog('You failed to disarm the trap and triggered it!', 'log-combat');
      floatText('FAILED', nx, ny, '#f87171');
      trap.triggered = true;
      if(G.player.class === 'rogue' && ch(0.5)) {
        addLog('You agilely dodged the trap!', 'log-info');
        floatText('DODGED', nx, ny, '#fbbf24');
      } else {
        if(trap.type === 'spike') {
          let dmg = Math.floor(G.player.maxHp * 0.15) + 2;
          G.player.hp -= dmg;
          addLog(`Spike trap triggered! Took ${dmg} damage.`, 'log-combat');
          floatText(`-${dmg}`, nx, ny, '#f87171');
          flashDamage();
          SFX.hit();
        } else if(trap.type === 'gas') {
          G.player.poisonedTurns = 5;
          addLog('Poison gas trap triggered!', 'log-combat');
          floatText('POISONED', nx, ny, '#a855f7');
          SFX.hit();
        } else if(trap.type === 'alarm') {
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

  G.player.x=nx;G.player.y=ny;
  computeVision();

  if(trap) {
    trap.triggered = true;
    if(G.player.class === 'rogue' && ch(0.5)) {
      addLog('You agilely dodged a trap!', 'log-info');
      floatText('DODGED', nx, ny, '#fbbf24');
    } else {
      if(trap.type === 'spike') {
        let dmg = Math.floor(G.player.maxHp * 0.15) + 2;
        G.player.hp -= dmg;
        addLog(`You stepped on a spike trap! Took ${dmg} damage.`, 'log-combat');
        floatText(`-${dmg}`, nx, ny, '#f87171');
        flashDamage();
        SFX.hit();
      } else if(trap.type === 'gas') {
        G.player.poisonedTurns = 5;
        addLog('You triggered a poison gas trap!', 'log-combat');
        floatText('POISONED', nx, ny, '#a855f7');
        SFX.hit();
      } else if(trap.type === 'alarm') {
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

function dpadPress(dx,dy){
  if(G.gameOver||G.won)return;
  move(dx,dy);clearInterval(_dpadTimer);
  _dpadTimer=setInterval(()=>move(dx,dy),185);
}
function dpadRelease(){clearInterval(_dpadTimer);_dpadTimer=null;}
