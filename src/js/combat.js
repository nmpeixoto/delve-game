// ===================== COMBAT =====================
function tileAttack(id){
  if(!canAct()||G.gameOver||G.won) return;
  let en=G.enemies.find(e=>e.id==id);if(!en)return;
  if(en.dying)return;
  let maxRange = (G.player.class === 'ranger' && G.player.weapon && G.player.weapon.sym === '🏹') ? 3 : 2;
  let dist=Math.max(Math.abs(en.x-G.player.x),Math.abs(en.y-G.player.y));
  if(dist<=maxRange){
    let rangedBow = G.player.class === 'ranger' && G.player.weapon && G.player.weapon.sym === '🏹' && dist > 1;
    attackEnemy(id,1,{skipCounter:rangedBow});
  } else {
    if(G.player.rootedTurns > 0) { consumeRootedTurn(); return; }
    move(Math.sign(en.x-G.player.x)||0,Math.sign(en.y-G.player.y)||0);
  }
}

function attackEnemy(id,multiplier=1,opts={}){
  let en=G.enemies.find(e=>e.id==id);if(!en)return;
  if(en.dying)return;
  if(G.player.vanishTurns > 0) {
    multiplier *= 2;
    G.player.vanishTurns = 0;
    addLog('Sneak Attack!', 'log-combat');
  }
  let dmg=Math.max(1,gatk()-en.def+rand(3));
  if(multiplier>1){dmg*=multiplier;SFX.bash();}else{SFX.hit();}
  en.hp-=dmg;
  G.player.damageDealt+=dmg;
  let atkSym = G.player.weapon ? G.player.weapon.sym : '👊';
  if(atkSym === '†') atkSym = '🔪';
  if(atkSym === '♦') atkSym = '✨';
  popText(atkSym, en.x, en.y);
  floatText(`-${dmg}`,en.x,en.y,'#f87171');
  let multTag=multiplier>1?' (CRIT!)':'';
  addLog(`Hit ${en.name} for ${dmg}${multTag}`, 'log-combat');

  if(G.player.bloodlustTurns > 0) {
    let heal = Math.floor(dmg / 2);
    if(heal > 0) {
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
      floatText(`+${heal} HP`, G.player.x, G.player.y, '#4ade80');
    }
  }

  if(en.hp<=0){
    killEnemy(en, false);
    return;
  }

  if(opts.skipCounter){
    advanceTurn();
    return;
  }

  if(en.stunnedTurns>0){
    advanceTurn();
    return;
  }

  let edm=Math.max(1,en.atk-gdef()+rand(3));
  if(G.player.shieldWallTurns > 0) edm = Math.ceil(edm / 2);
  if(G.player.bloodlustTurns > 0) edm *= 2;

  if(G.player.class === 'rogue' && ch(.25)) {
    addLog(`Dodged ${en.name}'s attack!`, 'log-info');
    popText('💨', G.player.x, G.player.y);
  } else {
    checkEmergencyPotion(en, edm, ()=>{
      G.player.hp=Math.max(0,G.player.hp-edm);
      popText('💢', G.player.x, G.player.y);
      floatText(`-${edm}`,G.player.x,G.player.y,'#60a5fa');
      addLog(`${en.name} hits you for ${edm}`,'log-combat');
      SFX.damage();shakeMap();flashDamage();advanceTurn();
      if(G.player.hp<=0){G.gameOver=true;showDeath();}
    });
  }
}

function killEnemy(en, skipAdvanceTurn) {
  let goldDrop=en.gold+rand(3);
  G.player.xp+=en.xp;G.player.kills++;G.player.gold+=goldDrop;

  if(G.player.vampirism > 0) {
    let heal = G.player.vampirism;
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
    floatText(`+${heal} HP`, G.player.x, G.player.y, '#4ade80');
  }
  if(G.player.class === 'necromancer') {
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + 1);
    floatText('+1 HP', G.player.x, G.player.y, '#4ade80');
  }

  addLog(`${en.name} slain! +${en.xp} XP  +${goldDrop}💰`, 'log-dead');
  floatText(`+${goldDrop}💰`,en.x,en.y,'#fbbf24');
  SFX.enemyDeath();
  fireTip('firstGold');
  en.dying=true;

  if(en.corpseExplosionTarget) {
    addLog('CORPSE EXPLOSION!', 'log-combat');
    SFX.bash();
    G.enemies.forEach(o => {
      if(o.id !== en.id && !o.dying && Math.abs(o.x - en.x) <= 1 && Math.abs(o.y - en.y) <= 1) {
        let dmg = 10 + G.player.lvl * 2;
        o.hp -= dmg;
        floatText(`-${dmg}`, o.x, o.y, '#f87171');
        if(o.hp <= 0) killEnemy(o, true);
      }
    });
  }

  render();
  setTimeout(()=>{
    G.enemies=G.enemies.filter(e=>e.id!==en.id);
    if(ch(.2)){
      let pool=[...WEAPONS,...ARMORS,...POTIONS];
      G.items.push({...pool[rand(pool.length)],x:en.x,y:en.y,id:uid()});
    }
    checkLevelUp();
    if(!skipAdvanceTurn) advanceTurn();
  },320);
}

function checkLevelUp(){
  let leveled = false;
  while(G.player.xp>=G.player.xpNext){
    G.player.xp-=G.player.xpNext;G.player.lvl++;
    G.player.xpNext=Math.round(G.player.xpNext*1.6);
    G.player.maxHp+=8;G.player.hp=Math.min(G.player.maxHp,G.player.hp+8);
    G.player.atk+=1;G.player.def+=1;
    if(G.player.class === 'paladin') {
      G.player.maxHp += 2;
      G.player.hp = Math.min(G.player.maxHp, G.player.hp + 2);
    }
    addLog(`LEVEL UP! Now level ${G.player.lvl}!`,'log-level');
    floatText('LVL UP!',G.player.x,G.player.y,'#c084fc');
    SFX.levelUp();fireTip('firstLevelUp');
    leveled = true;
  }
  if(leveled) checkBagUpgrades();
}

function advanceTurn(opts={}){
  if(opts.allowFreeMove && G.player.freeMoves > 0) {
    G.player.freeMoves--;
    computeVision(); render();
    return;
  }
  G.turn++;

  if(G.player.regen > 0 && G.turn % 10 === 0) {
    let heal = G.player.regen;
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
    floatText(`+${heal} HP`, G.player.x, G.player.y, '#4ade80');
  }

  if(G.player.class === 'warrior' && G.turn % 5 === 0 && G.player.hp < G.player.maxHp) {
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + 1);
    floatText('+1 HP', G.player.x, G.player.y, '#4ade80');
  }

  if(G.player.swiftness > 0 && G.turn % 15 === 0) {
    G.player.freeMoves += G.player.swiftness;
    addLog(`Swiftness granted ${G.player.swiftness} free move(s)!`, 'log-info');
  }

  if(G.ability1Cooldown>0)G.ability1Cooldown--;
  if(G.ability2Cooldown>0)G.ability2Cooldown--;
  if(G.player.shieldWallTurns>0)G.player.shieldWallTurns--;
  if(G.player.vanishTurns>0)G.player.vanishTurns--;
  if(G.player.bloodlustTurns>0)G.player.bloodlustTurns--;
  if(G.player.rootedTurns>0)G.player.rootedTurns--;

  G.enemies.forEach(e=>{
    if(G.gameOver||G.won) return;
    if(e.dying) return;

    let trapIdx = G.traps.findIndex(t => t.x===e.x && t.y===e.y);
    if(trapIdx !== -1) {
      G.traps.splice(trapIdx, 1);
      e.stunnedTurns = 5;
      e.hp -= 5;
      floatText(`-5`, e.x, e.y, '#f87171');
      addLog(`${e.name} stepped on a Bear Trap!`, 'log-combat');
      if(e.hp<=0) { killEnemy(e, true); return; }
    }

    if(e.stunnedTurns>0) {
      e.stunnedTurns--;
      return;
    }

    let seesPlayer = G.visible.has(e.y*MAP_W+e.x) && G.player.vanishTurns === 0;
    if(!seesPlayer){
      if(ch(.4)){
        let ds=[[-1,0],[1,0],[0,-1],[0,1]];let[dx,dy]=ds[rand(4)];
        let nx=e.x+dx,ny=e.y+dy;
        if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&G.map[ny][nx]!==TILE.WALL&&
           !(nx===G.player.x&&ny===G.player.y)&&
           !G.enemies.find(o=>o!==e&&o.x===nx&&o.y===ny)){e.x=nx;e.y=ny;}
      }
    } else {
      let dx=G.player.x-e.x,dy=G.player.y-e.y;
      let steps=Math.abs(dx)>Math.abs(dy)?[[Math.sign(dx),0],[0,Math.sign(dy)]]:[[0,Math.sign(dy)],[Math.sign(dx),0]];
      for(let[sx,sy] of steps){
        let nx=e.x+sx,ny=e.y+sy;
        if(nx===G.player.x&&ny===G.player.y){
          let edm=Math.max(1,e.atk-gdef()+rand(3));
          if(G.player.shieldWallTurns > 0) edm = Math.ceil(edm / 2);
          if(G.player.bloodlustTurns > 0) edm *= 2;

          if(G.player.class === 'rogue' && ch(.25)) {
            addLog(`Dodged ${e.name}'s attack!`, 'log-info');
            popText('💨', G.player.x, G.player.y);
          } else {
            checkEmergencyPotion(e, edm, ()=>{
              G.player.hp=Math.max(0,G.player.hp-edm);
              addLog(`${e.name} attacks! -${edm} HP`,'log-combat');
              SFX.damage();shakeMap();flashDamage();
              popText('💢', G.player.x, G.player.y);
              floatText(`-${edm}`,G.player.x,G.player.y,'#f87171');
              if(G.player.hp<=0){G.gameOver=true;showDeath();return;}
              computeVision();render();
            });
          }
          break;
        }
        if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&G.map[ny][nx]!==TILE.WALL&&
           !G.enemies.find(o=>o!==e&&o.x===nx&&o.y===ny)){e.x=nx;e.y=ny;break;}
      }
    }
  });
  G.enemies.forEach(e=>{
    if(e.corpseExplosionTurns>0){
      e.corpseExplosionTurns--;
      if(e.corpseExplosionTurns<=0){
        e.corpseExplosionTarget=false;
      }
    }
  });
  computeVision();render();
  if(!TIPS.firstEnemy.shown && G.enemies.some(e=>G.visible.has(e.y*MAP_W+e.x))) fireTip('firstEnemy');
  if(!TIPS.firstStairs.shown && G.rooms.length &&
     G.visible.has(G.rooms[G.rooms.length-1].cy*MAP_W+G.rooms[G.rooms.length-1].cx)) fireTip('firstStairs');
  if(!TIPS.firstShop.shown && G.shops && G.shops.some(s=>G.visible.has(s.y*MAP_W+s.x))) fireTip('firstShop');
}

function doAbility1(){
  if(G.gameOver||G.won)return;
  if(G.ability1Cooldown>0){addLog(`Ability on cooldown (${G.ability1Cooldown})`,'log-info');return;}

  let p = G.player;
  let visEnemies = G.enemies.filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x));

  if(p.class === 'warrior') {
    let t=visEnemies.filter(e=>Math.abs(e.x-p.x)<=2&&Math.abs(e.y-p.y)<=2).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) { G.ability1Cooldown = 5; attackEnemy(t[0].id,2); }
    else addLog('No nearby enemies to Bash','log-info');
  }
  else if(p.class === 'rogue') {
    p.freeMoves = 2; G.ability1Cooldown = 3;
    addLog('Dashed! You have 2 free moves.', 'log-info'); updateActBtns();
  }
  else if(p.class === 'mage') {
    let t=visEnemies.sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      G.ability1Cooldown = 5; let target = t[0]; let hits = [];
      G.enemies.forEach(e => {
        if(!e.dying && Math.abs(e.x-target.x)<=1 && Math.abs(e.y-target.y)<=1) {
          let dmg = Math.max(1, gatk() - e.def + rand(3)); e.hp -= dmg;
          floatText(`-${dmg}`,e.x,e.y,'#f87171'); p.damageDealt += dmg;
          if(e.hp <= 0) hits.push(e);
        }
      });
      SFX.bash(); addLog(`Fireball hit!`, 'log-combat');
      if(hits.length > 0) hits.forEach((en, i) => killEnemy(en, i < hits.length - 1));
      else advanceTurn();
    } else addLog('No visible enemies to Fireball', 'log-info');
  }
  else if(p.class === 'paladin') {
    let t=visEnemies.filter(e=>Math.abs(e.x-p.x)<=2&&Math.abs(e.y-p.y)<=2).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      G.ability1Cooldown = 5;
      let en = t[0];
      en.stunnedTurns = 1;
      attackEnemy(en.id, 1);
      addLog(`Smited ${en.name}! They are stunned.`, 'log-combat');
    } else addLog('No nearby enemies to Smite','log-info');
  }
  else if(p.class === 'ranger') {
    let t=visEnemies.map(e=>{
      let dx=e.x-p.x, dy=e.y-p.y;
      let aligned = dx===0 || dy===0 || Math.abs(dx)===Math.abs(dy);
      if(!aligned) return null;
      let sx=Math.sign(dx), sy=Math.sign(dy);
      let cx=p.x+sx, cy=p.y+sy, clear=true;
      while(cx!==e.x || cy!==e.y) {
        if(cx<0||cx>=MAP_W||cy<0||cy>=MAP_H||G.map[cy][cx]===TILE.WALL){clear=false;break;}
        cx+=sx; cy+=sy;
      }
      return clear ? {e, sx, sy, dist:Math.abs(dx)+Math.abs(dy)} : null;
    }).filter(Boolean).sort((a,b)=>a.dist-b.dist);
    if(t.length) {
      G.ability1Cooldown = 4;
      let target = t[0].e;
      let dx = t[0].sx, dy = t[0].sy;
      let cx = p.x + dx, cy = p.y + dy;
      let hits = [];
      while(cx>=0&&cx<MAP_W&&cy>=0&&cy<MAP_H&&G.map[cy][cx] !== TILE.WALL) {
        let e = G.enemies.find(e => e.x === cx && e.y === cy && !e.dying);
        if(e) {
          let dmg = Math.max(1, gatk() - e.def + rand(3)); e.hp -= dmg;
          floatText(`-${dmg}`,e.x,e.y,'#f87171'); p.damageDealt += dmg;
          if(e.hp <= 0) hits.push(e);
        }
        cx += dx; cy += dy;
      }
      SFX.bash(); addLog('Piercing Shot fired!', 'log-combat');
      if(hits.length > 0) hits.forEach((en, i) => killEnemy(en, i < hits.length - 1));
      else advanceTurn();
    } else addLog('No visible enemies in line for Piercing Shot','log-info');
  }
  else if(p.class === 'barbarian') {
    let targets = G.enemies.filter(e => !e.dying && Math.abs(e.x-p.x)<=1 && Math.abs(e.y-p.y)<=1);
    if(!targets.length){addLog('No adjacent enemies to Cleave','log-info');return;}
    G.ability1Cooldown = 4;
    let hits = [];
    targets.forEach(e => {
        let dmg = Math.max(1, gatk() - e.def + rand(3)); e.hp -= dmg;
        floatText(`-${dmg}`,e.x,e.y,'#f87171'); p.damageDealt += dmg;
        if(e.hp <= 0) hits.push(e);
    });
    SFX.bash(); addLog('Cleave!', 'log-combat');
    if(hits.length > 0) hits.forEach((en, i) => killEnemy(en, i < hits.length - 1));
    else advanceTurn();
  }
  else if(p.class === 'necromancer') {
    let t=visEnemies.filter(e=>Math.abs(e.x-p.x)<=2&&Math.abs(e.y-p.y)<=2).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      G.ability1Cooldown = 5;
      let en = t[0];
      let dmg = Math.max(1, gatk() - en.def + rand(3));
      en.hp -= dmg; floatText(`-${dmg}`,en.x,en.y,'#f87171'); p.damageDealt += dmg;
      let heal = dmg;
      p.hp = Math.min(p.maxHp, p.hp + heal); floatText(`+${heal} HP`, p.x, p.y, '#4ade80');
      SFX.bash(); addLog(`Siphoned ${dmg} life from ${en.name}!`, 'log-combat');
      if(en.hp <= 0) killEnemy(en, false);
      else advanceTurn();
    } else addLog('No nearby enemies to Siphon','log-info');
  }
  else if(p.class === 'monk') {
    let t=visEnemies.filter(e=>Math.abs(e.x-p.x)<=1&&Math.abs(e.y-p.y)<=1).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      G.ability1Cooldown = 3;
      let en = t[0];
      let dx = Math.sign(en.x - p.x), dy = Math.sign(en.y - p.y);
      let nx = en.x + dx, ny = en.y + dy;
      let dmg = Math.max(1, gatk() - en.def + rand(3));
      if(G.map[ny] && G.map[ny][nx] !== TILE.WALL && !G.enemies.some(e=>e.x===nx&&e.y===ny)) {
        en.x = nx; en.y = ny;
      } else {
        dmg *= 2;
        addLog('Slammed into a wall!', 'log-combat');
      }
      en.hp -= dmg; floatText(`-${dmg}`,en.x,en.y,'#f87171'); p.damageDealt += dmg;
      SFX.bash(); addLog(`Push Kick hit ${en.name} for ${dmg}!`, 'log-combat');
      if(en.hp <= 0) killEnemy(en, false);
      else advanceTurn();
    } else addLog('No adjacent enemies to Push Kick','log-info');
  }
}

function doAbility2(){
  let p = G.player;
  if(G.gameOver||G.won || p.lvl < 5)return;
  if(G.ability2Cooldown>0){addLog(`Ability on cooldown (${G.ability2Cooldown})`,'log-info');return;}

  if(p.class === 'warrior') {
    p.shieldWallTurns = 3; G.ability2Cooldown = 10;
    addLog('Shield Wall active! Damage halved for 3 turns.', 'log-info'); advanceTurn();
  }
  else if(p.class === 'rogue') {
    p.vanishTurns = 3; G.ability2Cooldown = 10;
    addLog('Vanished! You are invisible for 3 turns.', 'log-info'); advanceTurn();
  }
  else if(p.class === 'mage') {
    let safeTiles = [];
    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++) {
      if(G.visible.has(y*MAP_W+x) && G.map[y][x] === TILE.FLOOR) {
        if(!G.enemies.some(e=>e.x===x&&e.y===y)) safeTiles.push({x,y});
      }
    }
    if(safeTiles.length) {
      let t = safeTiles[rand(safeTiles.length)];
      p.x = t.x; p.y = t.y; G.ability2Cooldown = 8;
      addLog('Blinked to a safe location!', 'log-combat'); advanceTurn();
    }
  }
  else if(p.class === 'paladin') {
    let heal = Math.floor(p.maxHp * 0.3);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    floatText(`+${heal} HP`, p.x, p.y, '#4ade80');
    G.ability2Cooldown = 15;
    addLog('Lay on Hands: Healed!', 'log-combat'); advanceTurn();
  }
  else if(p.class === 'ranger') {
    G.traps.push({x: p.x, y: p.y});
    let safeAdj = [[-1,0],[1,0],[0,-1],[0,1]].map(d=>({x:p.x+d[0], y:p.y+d[1]}))
      .filter(t=>G.map[t.y] && G.map[t.y][t.x]===TILE.FLOOR && !G.enemies.some(e=>e.x===t.x&&e.y===t.y));
    if(safeAdj.length) {
      let best = safeAdj[rand(safeAdj.length)];
      p.x = best.x; p.y = best.y;
    }
    G.ability2Cooldown = 10;
    addLog('Dropped a Bear Trap and jumped back!', 'log-combat'); advanceTurn();
  }
  else if(p.class === 'barbarian') {
    p.bloodlustTurns = 3; G.ability2Cooldown = 12;
    addLog('Bloodlust! Deal damage to heal, but take double damage!', 'log-combat'); advanceTurn();
  }
  else if(p.class === 'necromancer') {
    let visEnemies = G.enemies.filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x));
    let t=visEnemies.sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      t[0].corpseExplosionTarget = true;
      t[0].corpseExplosionTurns = 3;
      G.ability2Cooldown = 8;
      addLog(`Targeted ${t[0].name} for Corpse Explosion!`, 'log-combat'); advanceTurn();
    } else addLog('No visible enemies to target', 'log-info');
  }
  else if(p.class === 'monk') {
    let visEnemies = G.enemies.filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x));
    let t=visEnemies.filter(e=>Math.abs(e.x-p.x)<=1&&Math.abs(e.y-p.y)<=1).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      G.ability2Cooldown = 10;
      p.rootedTurns = 2;
      let en = t[0];
      addLog('Flurry of Blows! You are rooted.', 'log-combat');
      attackEnemy(en.id, 3);
    } else addLog('No adjacent enemies for Flurry', 'log-info');
  }
}
