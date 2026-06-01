// ===================== COMBAT =====================
function tileAttack(id){
  if(!canAct()||G.gameOver||G.won) return;
  let en=G.enemies.find(e=>e.id==id);if(!en)return;
  if(en.dying)return;
  if(en.isPet) {
    let dx = en.x - G.player.x, dy = en.y - G.player.y;
    if(Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
      en.x = G.player.x; en.y = G.player.y;
      G.player.x += dx; G.player.y += dy;
      advanceTurn();
    } else {
      if(G.player.rootedTurns > 0) { addLog('You are rooted and cannot move!', 'log-info'); return; }
      move(Math.sign(dx)||0,Math.sign(dy)||0);
    }
    return;
  }
  let maxRange = (G.player.class === 'ranger' && G.player.weapon && G.player.weapon.sym === '🏹') ? 3 : 2;
  let dist=Math.max(Math.abs(en.x-G.player.x),Math.abs(en.y-G.player.y));
  if(dist<=maxRange){
    let rangedBow = G.player.class === 'ranger' && G.player.weapon && G.player.weapon.sym === '🏹' && dist >= 3;
    attackEnemy(id,1,{skipCounter:rangedBow});
  } else {
    if(G.player.rootedTurns > 0) { addLog('You are rooted and cannot move closer!','log-info'); return; }
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
  if(getStat('critChance') > 0 && Math.random() < getStat('critChance')) {
    multiplier *= 2;
    addLog('Critical Hit!', 'log-combat');
  }
  if(en.dodge && Math.random() < en.dodge) {
    addLog(`${en.name} agilely dodged your attack!`, 'log-combat');
    floatText('DODGED', en.x, en.y, '#fbbf24');
    popText('💨', en.x, en.y);
    SFX.hit();
  } else {
    let dmg=Math.max(1,gatk()-en.def+rand(3));
    if(multiplier>1){dmg*=multiplier;SFX.bash();}else{SFX.hit();}
    en.hp-=dmg;
    G.player.damageDealt+=dmg;
    let atkSym = G.player.weapon ? G.player.weapon.sym : '🗡️';
    if(atkSym === '🏹') atkSym = '🎯';
    if(atkSym === '🪄') atkSym = '💥';
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
    if(en.enrage && en.hp <= en.maxHp / 2 && en.color !== '#dc2626') {
      en.color = '#dc2626';
      popText('💢', en.x, en.y);
      floatText('ENRAGED', en.x, en.y, '#dc2626');
    }
  }

  if(en.hp<=0){
    if(en.reviveTurns > 0) {
      addLog(`You shattered the bones!`, 'log-combat');
      popText('💥', en.x, en.y);
      killEnemy(en, false);
      return;
    } else if(en.revive) {
      en.revive = false;
      en.reviveTurns = 2;
      en.hp = 0;
      en.sym = '🦴';
      en.color = '#94a3b8';
      en.name = 'Bones';
      addLog(`The Skeleton collapsed into a pile of bones!`, 'log-combat');
      floatText('COLLAPSED', en.x, en.y, '#94a3b8');
      popText('🦴', en.x, en.y);
    } else {
      killEnemy(en, false);
      return;
    }
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
  if(en.enrage && en.hp <= en.maxHp / 2) edm = Math.floor(edm * 1.5);
  if(G.player.shieldWallTurns > 0) edm = Math.ceil(edm * 3 / 5);
  if(G.player.bloodlustTurns > 0) edm = Math.ceil(edm * 23 / 20);

  let dodgeChance = playerDodgeChance();
  if(dodgeChance > 0 && ch(dodgeChance)) {
    addLog(`Dodged ${en.name}'s attack!`, 'log-info');
    popText('💨', G.player.x, G.player.y);
    advanceTurn();
  } else {
    checkEmergencyPotion(en, edm, ()=>{
      G.player.hp=Math.max(0,G.player.hp-edm);
      popText('🩸', G.player.x, G.player.y);
      floatText(`-${edm}`,G.player.x,G.player.y,'#60a5fa');
      addLog(`${en.name} hits you for ${edm}`,'log-combat');
      SFX.damage();shakeMap();flashDamage();
      
      if(en.vampiric && edm > 0) {
        let heal = Math.floor(edm * en.vampiric);
        if(heal > 0) {
          en.hp = Math.min(en.maxHp, en.hp + heal);
          floatText(`+${heal}`, en.x, en.y, '#4ade80');
        }
      }
      if(en.freezeChance && Math.random() < en.freezeChance) {
        G.player.rootedTurns = 2;
        addLog(`The ${en.name} froze you!`, 'log-combat');
        floatText('FROZEN', G.player.x, G.player.y, '#3b82f6');
      }

      advanceTurn();
      if(G.player.hp<=0){G.gameOver=true;showDeath();}
    });
  }
}

let _deathBatch = [];
let _deathTimer = null;

function playerDodgeChance() {
  let dodge = getStat('dodgeBonus');
  if(G.player.class === 'rogue' && typeof G.player.dodgeBonus === 'undefined') dodge += 0.4;
  return dodge;
}

function killEnemy(en, skipAdvanceTurn) {
  if(en.isPet) {
    addLog(`${en.name} crumbled to dust.`, 'log-dead');
    en.dying = true;
    _deathBatch.push({en, skipAdvanceTurn});
    if(!_deathTimer) {
      render();
      _deathTimer = setTimeout(flushDeathBatch, 150);
    }
    return;
  }
  let goldDrop = en.gold + rand(3) + getStat('goldBonus');
  let xpDrop = Math.ceil(en.xp * (1 + getStat('xpMult')));
  G.player.xp += xpDrop; G.player.kills++; G.player.gold += goldDrop;

  if(getStat('vampirism') > 0) {
    let heal = getStat('vampirism');
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
    floatText(`+${heal} HP`, G.player.x, G.player.y, '#4ade80');
  }
  if(G.player.class === 'necromancer') {
    G.player.hp = Math.min(G.player.maxHp, G.player.hp + 2);
    floatText('+2 HP', G.player.x, G.player.y, '#4ade80');
  }

  addLog(`${en.name} slain! +${xpDrop} XP  +${goldDrop}💰`, 'log-dead');
  floatText(`+${goldDrop}💰`,en.x,en.y,'#fbbf24');
  SFX.enemyDeath();
  fireTip('firstGold');
  en.dying=true;

  _deathBatch.push({en, skipAdvanceTurn});
  if(!_deathTimer) {
    render();
    _deathTimer = setTimeout(flushDeathBatch, 150);
  }
}

function flushDeathBatch() {
  if(_deathTimer) {
    clearTimeout(_deathTimer);
  }
  let shouldAdvance = _deathBatch.some(d => !d.skipAdvanceTurn);
  _deathBatch.forEach(d => {
    if(d.en.corpseExplosionTarget && !d.en.isPet) {
      let blast = Math.max(12, Math.ceil(d.en.maxHp * 0.35));
      addLog(`${d.en.name}'s corpse exploded!`, 'log-combat');
      popText('💥', d.en.x, d.en.y);
      G.enemies.forEach(other => {
        if(other.id === d.en.id || other.dying || other.isPet) return;
        if(Math.abs(other.x - d.en.x) <= 1 && Math.abs(other.y - d.en.y) <= 1) {
          other.hp -= blast;
          floatText(`-${blast}`, other.x, other.y, '#a78bfa');
          if(other.hp <= 0) killEnemy(other, true);
        }
      });
    }
    if(d.en.raiseCorpseTarget && !d.en.boss && !d.en.isPet) {
      addLog(`${d.en.name} rises to fight for you!`, 'log-combat');
      popText('🧟', d.en.x, d.en.y);
      d.en.name = `Pet ${d.en.name}`;
      d.en.isPet = true;
      d.en.dying = false;
      d.en.raiseCorpseTarget = false;
      d.en.hp = Math.ceil(d.en.maxHp / 2);
      d.en.maxHp = Math.ceil(d.en.maxHp / 2);
      d.en.lifespanTurns = 25;
      d.en.color = '#a78bfa';
      return;
    }
    
    G.enemies = G.enemies.filter(e => e.id !== d.en.id);
    if(d.en.boss) {
      G.won = true;
      showVictory();
      return;
    }
    if(d.en.isElite) {
      if(ch(.5)) {
        let pool=[...WEAPONS,...ARMORS,...POTIONS,...LEGENDARIES];
        let w=pool.flatMap(i=>i.rarity==='legendary'?[i]:i.rarity==='rare'?[i,i]:[i,i,i,i]);
        G.items.push({...w[rand(w.length)],x:d.en.x,y:d.en.y,id:uid()});
      }
    } else if(ch(.2)){
      let pool=[...WEAPONS,...ARMORS,...POTIONS];
      let w=pool.flatMap(i=>i.rarity==='legendary'?[i]:i.rarity==='rare'?[i,i]:[i,i,i,i]);
      G.items.push({...w[rand(w.length)],x:d.en.x,y:d.en.y,id:uid()});
    }
  });
  _deathBatch = [];
  _deathTimer = null;
  checkLevelUp();
  render();
  if(shouldAdvance) advanceTurn();
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

  if(G.ability1Cooldown>0)G.ability1Cooldown--;
  if(G.ability2Cooldown>0)G.ability2Cooldown--;
  if(G.player.shieldWallTurns>0)G.player.shieldWallTurns--;
  if(G.player.vanishTurns>0)G.player.vanishTurns--;
  if(G.player.bloodlustTurns>0)G.player.bloodlustTurns--;
  if(G.player.rootedTurns>0)G.player.rootedTurns--;
  if(G.player.strengthTurns>0)G.player.strengthTurns--;
  if(G.alarmedTurns>0)G.alarmedTurns--;

  if(G.player.poisonedTurns>0) {
    G.player.poisonedTurns--;
    let pdmg = Math.max(1, Math.floor(G.player.maxHp * 0.05));
    G.player.hp -= pdmg;
    addLog(`Poison damage: -${pdmg} HP`, 'log-combat');
    floatText(`-${pdmg} HP`, G.player.x, G.player.y, '#a855f7');
    flashDamage();
    SFX.hit();
    if(G.player.hp <= 0) {
      G.gameOver = true;
      showDeath();
      return;
    }
  }

  processEnemyTurns(0);
}

function processEnemyTurns(index) {
  if(G.gameOver||G.won) return;
  if(index >= G.enemies.length) {
    G.enemies.forEach(e=>{
      if(e.corpseExplosionTurns>0){
        e.corpseExplosionTurns--;
        if(e.corpseExplosionTurns<=0){
          e.corpseExplosionTarget=false;
        }
      }
      if(e.isPet && e.lifespanTurns !== undefined) {
        e.lifespanTurns--;
        if(e.lifespanTurns <= 0) {
          addLog(`${e.name} crumbled to dust.`, 'log-combat');
          e.hp = 0;
          killEnemy(e, true);
        }
      }
    });
    computeVision();render();
    if(!TIPS.firstEnemy.shown && G.enemies.some(e=>G.visible.has(e.y*MAP_W+e.x))) fireTip('firstEnemy');
    if(!TIPS.firstStairs.shown && G.rooms && G.rooms.length &&
       G.visible.has(G.rooms[G.rooms.length-1].cy*MAP_W+G.rooms[G.rooms.length-1].cx)) fireTip('firstStairs');
    if(!TIPS.firstShop.shown && G.shops && G.shops.some(s=>G.visible.has(s.y*MAP_W+s.x))) fireTip('firstShop');
    return;
  }

  let e = G.enemies[index];
  if(e.dying) return processEnemyTurns(index + 1);

  let trapIdx = G.traps.findIndex(t => t.type === 'bear' && t.x===e.x && t.y===e.y);
  if(trapIdx !== -1) {
    G.traps.splice(trapIdx, 1);
    e.stunnedTurns = 5;
    e.hp -= 5;
    floatText(`-5`, e.x, e.y, '#f87171');
    addLog(`${e.name} stepped on a Bear Trap!`, 'log-combat');
    if(e.hp<=0) killEnemy(e, true);
    return processEnemyTurns(index + 1);
  }

  if(e.stunnedTurns>0) {
    e.stunnedTurns--;
    return processEnemyTurns(index + 1);
  }

  if(e.reviveTurns > 0) {
    e.reviveTurns--;
    if(e.reviveTurns <= 0) {
      e.hp = Math.floor(e.maxHp / 2);
      e.sym = 's';
      e.color = '#e2e8f0';
      e.name = 'Skeleton';
      addLog(`The Skeleton revived!`, 'log-combat');
      floatText('REVIVED', e.x, e.y, '#a78bfa');
      popText('💀', e.x, e.y);
    } else {
      floatText('reforming...', e.x, e.y, '#94a3b8');
    }
    return processEnemyTurns(index + 1);
  }

  if(e.regen > 0 && e.hp < e.maxHp) {
    let heal = Math.min(e.maxHp - e.hp, Math.floor(e.maxHp * e.regen));
    if(heal > 0) {
      e.hp += heal;
      floatText(`+${heal}`, e.x, e.y, '#4ade80');
      popText('✨', e.x, e.y);
    }
  }

  if(e.boss && e.phase === 1 && e.hp <= e.maxHp / 2) {
    e.phase = 2;
    e.name = "Dungeon Lord (Enraged)";
    addLog("Dungeon Lord enters Phase 2! Dark magic surges!", "log-combat");
    e.atk = Math.round(e.atk * 1.5);
    e.def = Math.round(e.def * 1.5);
    e.color = "#ff00ff";
    popText('🔥', e.x, e.y);
    let summonTiles = [];
    for(let sy=e.y-1; sy<=e.y+1; sy++) {
      for(let sx=e.x-1; sx<=e.x+1; sx++) {
        if(sx<0||sx>=MAP_W||sy<0||sy>=MAP_H) continue;
        if(sx===e.x && sy===e.y) continue;
        if(sx===G.player.x && sy===G.player.y) continue;
        if(G.map[sy][sx]===TILE.WALL) continue;
        if(G.enemies.some(other=>!other.dying&&other.x===sx&&other.y===sy)) continue;
        summonTiles.push({x:sx,y:sy});
      }
    }
    for(let i=0; i<2 && summonTiles.length; i++) {
      let t=ENEMIES.find(n=>n.name==='Skeleton');
      let pick = summonTiles.splice(rand(summonTiles.length), 1)[0];
      G.enemies.push({...t, hp:t.hp, maxHp:t.hp, x:pick.x, y:pick.y, id:uid(), stunnedTurns:0});
    }
  }

  let seesPlayer = (G.visible.has(e.y*MAP_W+e.x) || G.alarmedTurns > 0) && G.player.vanishTurns === 0;
  if(!seesPlayer){
    if(ch(.4)){
      let ds=[[-1,0],[1,0],[0,-1],[0,1]];let[dx,dy]=ds[rand(4)];
      let nx=e.x+dx,ny=e.y+dy;
      if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&G.map[ny][nx]!==TILE.WALL&&
         !(nx===G.player.x&&ny===G.player.y)&&
         !G.enemies.find(o=>o!==e&&o.x===nx&&o.y===ny)){e.x=nx;e.y=ny;}
    }
    return processEnemyTurns(index + 1);
  } else {
    let target = {x: G.player.x, y: G.player.y, isPlayer: true};
    if(e.isPet) {
      let enemies = G.enemies.filter(o => !o.isPet && !o.dying && G.visible.has(o.y*MAP_W+o.x));
      if(enemies.length) {
        target = enemies.sort((a,b) => (Math.abs(a.x-e.x)+Math.abs(a.y-e.y)) - (Math.abs(b.x-e.x)+Math.abs(b.y-e.y)))[0];
      } else {
        if(Math.abs(G.player.x-e.x) <= 2 && Math.abs(G.player.y-e.y) <= 2) {
          return processEnemyTurns(index + 1);
        }
      }
    } else {
      let targets = [{x: G.player.x, y: G.player.y, isPlayer: true}];
      G.enemies.filter(o => o.isPet && !o.dying).forEach(p => targets.push(p));
      target = targets.sort((a,b) => (Math.abs(a.x-e.x)+Math.abs(a.y-e.y)) - (Math.abs(b.x-e.x)+Math.abs(b.y-e.y)))[0];
    }

    let dx=target.x-e.x, dy=target.y-e.y;
    let steps=Math.abs(dx)>Math.abs(dy)?[[Math.sign(dx),0],[0,Math.sign(dy)]]:[[0,Math.sign(dy)],[Math.sign(dx),0]];
    for(let[sx,sy] of steps){
      let nx=e.x+sx,ny=e.y+sy;
      if(nx===target.x&&ny===target.y){
        if(target.isPlayer) {
          let edm=Math.max(1,e.atk-gdef()+rand(3));
          if(e.enrage && e.hp <= e.maxHp / 2) edm = Math.floor(edm * 1.5);
          if(G.player.shieldWallTurns > 0) edm = Math.ceil(edm * 3 / 5);
          if(G.player.bloodlustTurns > 0) edm = Math.ceil(edm * 23 / 20);

          let dChance = playerDodgeChance();
          if(dChance > 0 && ch(dChance)) {
            addLog(`Dodged ${e.name}'s attack!`, 'log-info');
            popText('💨', G.player.x, G.player.y);
            return processEnemyTurns(index + 1);
          } else {
            checkEmergencyPotion(e, edm, ()=>{
              G.player.hp=Math.max(0,G.player.hp-edm);
              addLog(`${e.name} attacks! -${edm} HP`,'log-combat');
              SFX.damage();shakeMap();flashDamage();
              popText('🩸', G.player.x, G.player.y);
              floatText(`-${edm}`,G.player.x,G.player.y,'#f87171');
              
              if(e.vampiric && edm > 0) {
                let heal = Math.floor(edm * e.vampiric);
                if(heal > 0) {
                  e.hp = Math.min(e.maxHp, e.hp + heal);
                  floatText(`+${heal}`, e.x, e.y, '#4ade80');
                  popText('🦇', e.x, e.y);
                }
              }
              if(e.freezeChance && Math.random() < e.freezeChance) {
                G.player.rootedTurns = 2;
                addLog(`The ${e.name} froze you!`, 'log-combat');
                floatText('FROZEN', G.player.x, G.player.y, '#3b82f6');
                popText('❄️', G.player.x, G.player.y);
              }

              if(G.player.hp<=0){G.gameOver=true;showDeath();return;}
              computeVision();render();
              processEnemyTurns(index + 1);
            });
            return;
          }
        } else {
          if(target.dodge && Math.random() < target.dodge) {
            addLog(`${target.name} dodged ${e.name}'s attack!`, 'log-info');
            popText('💨', target.x, target.y);
            return processEnemyTurns(index + 1);
          }

          let edm = Math.max(1, e.atk - (target.def || 0) + rand(3));
          if(e.enrage && e.hp <= e.maxHp / 2) edm = Math.floor(edm * 1.5);

          target.hp -= edm;
          addLog(`${e.name} attacks ${target.name}! -${edm} HP`, 'log-combat');
          SFX.damage();
          popText('🩸', target.x, target.y);
          floatText(`-${edm}`, target.x, target.y, '#f87171');

          if(e.vampiric && edm > 0) {
            let heal = Math.floor(edm * e.vampiric);
            if(heal > 0) {
              e.hp = Math.min(e.maxHp, e.hp + heal);
              floatText(`+${heal}`, e.x, e.y, '#4ade80');
              popText('🦇', e.x, e.y);
            }
          }

          if(target.hp <= 0) {
            killEnemy(target, true);
          }
          return processEnemyTurns(index + 1);
        }
      }
      if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&G.map[ny][nx]!==TILE.WALL&&
         !G.enemies.find(o=>o!==e&&o.x===nx&&o.y===ny)&&!(nx===G.player.x&&ny===G.player.y)){e.x=nx;e.y=ny;break;}
    }
    return processEnemyTurns(index + 1);
  }
}


function doAbility1(){
  if(G.gameOver||G.won)return;
  if(G.ability1Cooldown>0){addLog(`Ability on cooldown (${G.ability1Cooldown})`,'log-info');return;}

  let p = G.player;
  let visEnemies = G.enemies.filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x));

  if(p.class === 'warrior') {
    let t=visEnemies.filter(e=>Math.abs(e.x-p.x)<=2&&Math.abs(e.y-p.y)<=2).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) { G.ability1Cooldown = 5; attackEnemy(t[0].id,1.5); }
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
      if(nx>=0 && nx<MAP_W && ny>=0 && ny<MAP_H && G.map[ny][nx] !== TILE.WALL && !G.enemies.some(e=>e.x===nx&&e.y===ny)) {
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
    addLog('Shield Wall active! Damage reduced by 40% for 3 turns.', 'log-info'); advanceTurn();
  }
  else if(p.class === 'rogue') {
    p.vanishTurns = 3; G.ability2Cooldown = 10;
    addLog('Vanished! You are invisible for 3 turns.', 'log-info'); advanceTurn();
  }
  else if(p.class === 'mage') {
    let safeTiles = [];
    for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++) {
      if(G.visible.has(y*MAP_W+x) && G.map[y][x] === TILE.FLOOR) {
        if((x !== p.x || y !== p.y) &&
           !G.enemies.some(e=>e.x===x&&e.y===y) &&
           !(G.traps && G.traps.some(t=>t.x===x&&t.y===y&&!t.triggered))) safeTiles.push({x,y});
      }
    }
    if(safeTiles.length) {
      let t = safeTiles[rand(safeTiles.length)];
      p.x = t.x; p.y = t.y; G.ability2Cooldown = 8;
      addLog('Blinked to a safe location!', 'log-combat'); advanceTurn();
    } else addLog('No safe visible tile to Blink to', 'log-info');
  }
  else if(p.class === 'paladin') {
    let heal = Math.floor(p.maxHp * 0.2);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    floatText(`+${heal} HP`, p.x, p.y, '#4ade80');
    G.ability2Cooldown = 15;
    addLog('Lay on Hands: Healed!', 'log-combat'); advanceTurn();
  }
  else if(p.class === 'ranger') {
    G.traps.push({x: p.x, y: p.y, type: 'bear', revealed: true});
    let safeAdj = [[-1,0],[1,0],[0,-1],[0,1]].map(d=>({x:p.x+d[0], y:p.y+d[1]}))
      .filter(t=>G.map[t.y] && G.map[t.y][t.x]===TILE.FLOOR && !G.enemies.some(e=>e.x===t.x&&e.y===t.y));
    if(safeAdj.length) {
      let visEnemies = G.enemies.filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x));
      if(visEnemies.length > 0) {
        safeAdj.forEach(t => {
          t.minDist = Math.min(...visEnemies.map(e => Math.max(Math.abs(e.x - t.x), Math.abs(e.y - t.y))));
        });
        safeAdj.sort((a,b) => b.minDist - a.minDist);
        let bestDist = safeAdj[0].minDist;
        let bestTiles = safeAdj.filter(t => t.minDist === bestDist);
        let best = bestTiles[Math.floor(Math.random() * bestTiles.length)];
        p.x = best.x; p.y = best.y;
      } else {
        let best = safeAdj[Math.floor(Math.random() * safeAdj.length)];
        p.x = best.x; p.y = best.y;
      }
    }
    G.ability2Cooldown = 10;
    addLog('Dropped a Bear Trap and jumped back!', 'log-combat'); advanceTurn();
  }
  else if(p.class === 'barbarian') {
    p.bloodlustTurns = 3; G.ability2Cooldown = 12;
    addLog('Bloodlust! Deal damage to heal, but take 15% more damage!', 'log-combat'); advanceTurn();
  }
  else if(p.class === 'necromancer') {
    let visEnemies = G.enemies.filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x));
    let t=visEnemies.filter(e=>!e.boss&&!e.isPet).sort((a,b)=>(Math.abs(a.x-p.x)+Math.abs(a.y-p.y))-(Math.abs(b.x-p.x)+Math.abs(b.y-p.y)));
    if(t.length) {
      t[0].corpseExplosionTarget = true;
      t[0].corpseExplosionTurns = 3;
      G.ability2Cooldown = 8;
      addLog(`Marked ${t[0].name} for Corpse Explosion!`, 'log-combat'); advanceTurn();
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
