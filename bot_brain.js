// bot_brain.js
// This file is injected into the browser by the Puppeteer runner.
// The agent modifies this file to improve the bot's decision making based on lessons learned.
// The function must return null (stuck), {type: 'status', val: 'dead'/'won'}, {type: 'click', target: selector}, or {type: 'key', val: keyString}.

window.botDecisionLogic = function() {
  if (document.getElementById('emergency-overlay').style.display === 'flex') {
    return { type: 'click', target: '#emergency-drink-btn' };
  }
  let shrineModal = document.getElementById('shrine-modal');
  if (shrineModal && shrineModal.style.display === 'block') {
    let title = (document.getElementById('shrine-title').textContent || '').toLowerCase();
    const p = G.player;
    if (title.includes('blood') && p.hp > p.maxHp * 0.5) return { type: 'click', target: '#shrine-accept-btn' };
    if (title.includes('greed') && p.gold < 200) return { type: 'click', target: '#shrine-accept-btn' };
    if (title.includes('cursed') && (p.class === 'monk' || p.class === 'rogue')) return { type: 'click', target: '#shrine-accept-btn' };
    return { type: 'click', target: '#shrine-reject-btn' };
  }

  if (document.querySelector('.modal.death')) return { type: 'status', val: 'dead' };
  if (document.querySelector('.modal.victory')) return { type: 'status', val: 'won' };

  const MAP_H = G.map ? G.map.length : 36;
  const MAP_W = G.map && G.map[0] ? G.map[0].length : 56;
  const WALL = 0, FLOOR = 1, STAIRS = 2, SHOP = 3, LOCKED_DOOR = 4, SECRET_DOOR = 5;
  const p = G.player;
  const hasKey = () => G.items.some(i => i.carried && i.type === 'key');

  const isDangerousTrap = (x, y) => {
    // If we have plenty of health (>50%), we can afford to tank a trap if it's blocking the way.
    if (G.player.hp > G.player.maxHp * 0.5) return false;
    let t = G.traps && G.traps.find(tr => tr.x === x && tr.y === y && !tr.triggered);
    if (!t) return false;
    if (G.seen.has(y * MAP_W + x)) return true;
    return false;
  };

  const isPassable = (x, y, forceStairs = false, ignoreTraps = false) => {
      let t = G.map[y][x];
      if (t === WALL) return false;
      if (t === LOCKED_DOOR && !hasKey()) return false;
      if (!ignoreTraps && !forceStairs && isDangerousTrap(x, y)) return false;
      return true;
  };

  const liveEnemies = G.enemies.filter(e => !e.dying && !e.isPet);
  const visEnemies = liveEnemies.filter(e => G.visible.has(e.y*MAP_W + e.x));
  const adjEnemies = liveEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  const carriedPotions = () => G.items.filter(i => i.carried && i.type === 'potion').sort((a,b)=>b.heal-a.heal);
  const carriedBombs = () => G.items.filter(i => i.carried && i.type === 'bomb');
  const carriedTeleports = () => G.items.filter(i => i.carried && i.name === 'Scroll of Teleport');
  const carriedDetects = () => G.items.filter(i => i.carried && i.name === 'Scroll of Detection');
  const carriedBuffs = () => G.items.filter(i => i.carried && i.type === 'potion_buff');
  
  const canEquip = item => {
    if (item.reqLvl && p.lvl < item.reqLvl) return false;
    if (item.reqClass && !item.reqClass.includes(p.class)) return false;
    return true;
  };
  const isMagicWeapon = item => item && (item.sym === '♦' || /staff|rod|wand|scythe/i.test(item.name || ''));
  const isBow = item => item && (item.sym === '🏹' || /bow/i.test(item.name || ''));
  const weaponPower = item => {
    if (!item) return p.class === 'monk' ? Math.floor(p.lvl / 2) : 0;
    let power = item.atk || 0;
    if (p.class === 'mage' && isMagicWeapon(item)) power += Math.floor(power / 5);
    return power;
  };
  const armorPower = item => item ? (item.def || 0) : 0;
  
  const totalAtk = () => {
    let total = (p.atk || 0) + weaponPower(p.weapon);
    if (p.class === 'barbarian') total += Math.floor((p.maxHp - p.hp) / 6);
    return total;
  };
  const minNormalDamage = en => Math.max(1, totalAtk() - en.def);
  const maxNormalDamage = en => Math.max(1, totalAtk() - en.def + 2);
  const minBashDamage = en => minNormalDamage(en) * 1.5;
  const minSneakDamage = en => minNormalDamage(en) * (p.vanishTurns > 0 ? 2 : 1);
  const maxIncomingHit = en => {
    let maxHit = Math.max(1, en.atk - (p.def + armorPower(p.armor)) + 2);
    if (p.shieldWallTurns > 0) maxHit = Math.ceil(maxHit * 3 / 5);
    if (p.bloodlustTurns > 0) maxHit = Math.ceil(maxHit * 23 / 20);
    return maxHit;
  };
  const totalIncomingMax = () => adjEnemies.reduce((sum, en) => sum + maxIncomingHit(en), 0);

  // Strategy Tuning
  const strategy = {
    exitHp: 0.2, // We dive for stairs if we have NO healing and HP drops below this
    kiteThreshold: (p.class === 'ranger' || p.class === 'mage') ? 3 : (p.class === 'rogue' ? 2 : 1),
  };

  // ECONOMY & ITEMS
  const usefulShopItem = item => {
    if (item.sold || p.gold < item.price) return false;
    if (item.type === 'upgrade') return true;
    if ((item.type === 'weapon' || item.type === 'armor') && !canEquip(item)) return false;
    if (item.type === 'weapon') return weaponPower(item) > weaponPower(p.weapon);
    if (item.type === 'armor') return armorPower(item) > armorPower(p.armor);
    if (item.type === 'potion' || item.type === 'potion_buff' || item.type === 'bomb') return true;
    return false;
  };
  const usefulFloorItem = item => {
    if (item.type === 'potion' || item.type === 'potion_buff' || item.type === 'bomb' || item.type === 'scroll' || item.type === 'scroll_teleport') return true;
    if (item.type === 'upgrade' || item.type === 'key') return true;
    if (item.type === 'weapon') return canEquip(item) && weaponPower(item) > weaponPower(p.weapon);
    if (item.type === 'armor') return canEquip(item) && armorPower(item) > armorPower(p.armor);
    if (item.type === 'shrine' && !item.used) return true;
    return false;
  };

  let shopOpen = document.getElementById('shop-overlay') && document.getElementById('shop-overlay').classList.contains('open');
  let nearbyShop = G.shops && G.shops.find(s => Math.abs(p.x - s.x) <= 1 && Math.abs(p.y - s.y) <= 1);
  
  if (nearbyShop) {
     let affordable = nearbyShop.stock.filter(usefulShopItem);
     let bestItem = affordable.find(i => i.type === 'upgrade') ||
                    affordable.find(i => i.type === 'weapon') ||
                    affordable.find(i => i.type === 'armor') ||
                    affordable.find(i => i.type === 'potion') ||
                    affordable[0]; // Fallback to any useful item (buff, bomb, scroll)
                    
     // Check if we have anything to sell
     let bagHasWeaker = G.items.some(i => i.carried && (i.type === 'weapon' || i.type === 'armor') && !canEquip(i));
     let sellBtn = document.querySelector('button[onclick="sellWeakerGear()"]');

     if (bestItem) {
        if (!shopOpen) return { type: 'key', val: 't' }; 
        else return { type: 'click', target: `.shop-item[onclick*="${bestItem.id}"]` };
     } else if (shopOpen) {
        if (bagHasWeaker && sellBtn && sellBtn.style.display !== 'none' && !window._botSold) {
           window._botSold = true;
           return { type: 'click', target: 'button[onclick="sellWeakerGear()"]' };
        }
        window._botSold = false;
        return { type: 'key', val: 'Escape' }; 
     }
  }
  if (shopOpen) {
      window._botSold = false;
      return { type: 'key', val: 'Escape' };
  }

  // SMART HEALING & BUFFS
  let bagOpen = document.getElementById('inv-drawer').classList.contains('open');
  let potions = carriedPotions();
  let bestPotion = null;
  
  if (visEnemies.length === 0) {
      // Out of combat: maximize efficiency
      bestPotion = potions.find(pot => p.maxHp - p.hp >= pot.heal);
      if (!bestPotion && p.hp < p.maxHp * 0.3 && potions.length > 0) bestPotion = potions[potions.length - 1]; // critical
  } else {
      // In combat: Prevent death
      if (p.hp <= totalIncomingMax() && potions.length > 0) {
          bestPotion = [...potions].reverse().find(pot => p.hp + pot.heal > totalIncomingMax()) || potions[0];
      } else if (p.hp < p.maxHp * 0.4 && potions.length > 0) {
          bestPotion = potions[0];
      }
  }

  let itemToUse = bestPotion;
  
  // Buff Potion on elites or bosses
  if (!itemToUse && visEnemies.some(e => e.isElite || e.boss) && p.strengthTurns === 0 && carriedBuffs().length > 0) {
      itemToUse = carriedBuffs()[0];
  }
  // Detection scroll early on new floors
  if (!itemToUse && G.turn < 50 && carriedDetects().length > 0 && !G.traps.some(t => t.revealed)) {
      itemToUse = carriedDetects()[0];
  }
  // Bomb if 3+ enemies adjacent OR adjacent to a boss
  if (!itemToUse && (adjEnemies.length >= 3 || (adjEnemies.length >= 1 && visEnemies.some(e => e.boss))) && carriedBombs().length > 0) {
      itemToUse = carriedBombs()[0];
  }
  // Teleport if surrounded and going to die without potions
  if (!itemToUse && adjEnemies.length >= 2 && p.hp <= totalIncomingMax() * 1.5 && potions.length === 0 && carriedTeleports().length > 0) {
      itemToUse = carriedTeleports()[0];
  }

  if (itemToUse) {
      if (!bagOpen) return { type: 'key', val: 'i' };
      else {
          let visibleItem = G.items.find(i => i.carried && i.type === itemToUse.type && i.name === itemToUse.name) || itemToUse;
          return { type: 'click', target: `.inv-slot[onclick*="${visibleItem.id}"]` };
      }
  } else if (bagOpen) {
      return { type: 'click', target: '#drawer-backdrop' }; 
  }

  // CHECK MAP STATE
  const isMapCleared = () => {
    if (liveEnemies.length > 0) return false;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        let t = G.map[y][x];
        if (t !== WALL && t !== SECRET_DOOR && !G.seen.has(y * MAP_W + x)) {
          // If there's an unseen tile, check if we can even reach it. If not, ignore it.
          // For simplicity, if we are standing on the stairs and have no other targets, we'll descend.
          return false;
        }
      }
    }
    return true;
  };
  const shouldExitWithoutPotion = () => p.hp < p.maxHp * strategy.exitHp && potions.length === 0;

  if (G.map[p.y][p.x] === STAIRS && (isMapCleared() || shouldExitWithoutPotion() || G.won)) {
      return { type: 'key', val: '>' };
  }

  // PICKUP ADJACENT
  let bag = G.items.filter(i => i.carried);
  let adjItem = G.items.find(i => !i.carried && Math.abs(i.x - p.x) + Math.abs(i.y - p.y) === 1);
  if (adjItem && usefulFloorItem(adjItem) && !isDangerousTrap(adjItem.x, adjItem.y)) {
    if (bag.length < 12 || adjItem.type === 'key' || adjItem.type === 'upgrade') {
      if (adjItem.x < p.x) return { type: 'key', val: 'ArrowLeft', label: 'pickup' };
      if (adjItem.x > p.x) return { type: 'key', val: 'ArrowRight', label: 'pickup' };
      if (adjItem.y < p.y) return { type: 'key', val: 'ArrowUp', label: 'pickup' };
      if (adjItem.y > p.y) return { type: 'key', val: 'ArrowDown', label: 'pickup' };
    }
  }

  // MOVEMENT HELPERS
  let dirs = [ { dx: 0, dy: -1, k: 'ArrowUp' }, { dx: 0, dy: 1, k: 'ArrowDown' }, { dx: -1, dy: 0, k: 'ArrowLeft' }, { dx: 1, dy: 0, k: 'ArrowRight' } ];
  const attackMove = en => {
      if (en.x < p.x) return { type: 'key', val: 'ArrowLeft' };
      if (en.x > p.x) return { type: 'key', val: 'ArrowRight' };
      if (en.y < p.y) return { type: 'key', val: 'ArrowUp' };
      if (en.y > p.y) return { type: 'key', val: 'ArrowDown' };
      return null;
  };

  // CLASS ABILITIES (Phase 3)
  const ability2Decision = () => {
      if (G.ability2Cooldown !== 0 || p.lvl < 5) return null;
      if (p.class === 'warrior' && totalIncomingMax() >= p.hp) return { type: 'key', val: 'v' }; // SHIELD WALL
      if (p.class === 'rogue' && (p.hp < p.maxHp * 0.5 || adjEnemies.length >= 2 || (visEnemies.length > 0 && p.hp < p.maxHp * 0.3))) return { type: 'key', val: 'v' }; // VANISH
      if (p.class === 'mage' && (adjEnemies.length > 0 || p.hp < p.maxHp * 0.4) && visEnemies.length > 0) return { type: 'key', val: 'v' }; // BLINK
      if (p.class === 'paladin' && p.hp <= p.maxHp - 15) return { type: 'key', val: 'v' }; // HEAL
      if (p.class === 'ranger' && adjEnemies.length > 0) return { type: 'key', val: 'v' }; // BEAR TRAP
      if (p.class === 'barbarian' && (adjEnemies.length >= 2 || p.hp < p.maxHp * 0.5) && visEnemies.length > 0) return { type: 'key', val: 'v' }; // BLOODLUST
      if (p.class === 'necromancer') {
         let corpses = G.enemies.filter(e => e.dying && Math.abs(e.x - p.x) <= 3 && Math.abs(e.y - p.y) <= 3);
         if (corpses.length >= 1 && visEnemies.length >= 2) return { type: 'key', val: 'v' }; // EXPLOSION
      }
      if (p.class === 'monk' && adjEnemies.length > 0 && (p.hp > p.maxHp * 0.75 || adjEnemies.length >= 2)) return { type: 'key', val: 'v' }; // FLURRY
      return null;
  };
  
  let a2First = ability2Decision();
  if (a2First && ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'].includes(p.class)) return a2First;

  if (G.ability1Cooldown === 0) {
      if (p.class === 'warrior' && adjEnemies.length > 0) {
         let target = adjEnemies.find(e => e.hp <= minBashDamage(e)) || adjEnemies[0];
         if (target) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'rogue') {
         if (!adjEnemies.length && p.hp > p.maxHp * 0.6 && visEnemies.length > 0) return { type: 'key', val: 'b' }; // DASH
         if (adjEnemies.length >= 2 && p.hp > p.maxHp * 0.45) return { type: 'key', val: 'b' }; // DASH
      }
      if (p.class === 'mage' && visEnemies.length >= 1) return { type: 'key', val: 'b' }; 
      if (p.class === 'paladin' && adjEnemies.length > 0) return { type: 'key', val: 'b' }; 
      if (p.class === 'ranger') {
         let aligned = visEnemies.some(e => e.x === p.x || e.y === p.y);
         if (aligned) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'barbarian' && adjEnemies.length >= 2) return { type: 'key', val: 'b' }; 
      if (p.class === 'necromancer') {
        let target = visEnemies.find(e => Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2);
        if (target && p.hp < p.maxHp) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'monk' && adjEnemies.length > 0) return { type: 'key', val: 'b' }; 
  }

  // RANGED ATTACK
  const rangedAttack = () => {
      let targets = visEnemies.filter(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= 2 && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) > 1);
      if (targets.length) {
          let target = targets.sort((a, b) => a.hp - b.hp)[0];
          let killable = target.hp <= minSneakDamage(target);
          if (p.class === 'ranger' && isBow(p.weapon)) return { type: 'attack', target: target.id };
          if (killable && p.class !== 'warrior') return { type: 'attack', target: target.id }; // Rogue throwing knife etc
      }
      return null;
  };
  let rangedAction = rangedAttack();
  if (rangedAction) return rangedAction;

  // MELEE KILL PRIORITY
  let killableAdjEnemy = adjEnemies.sort((a, b) => a.hp - b.hp).find(e => e.hp <= minSneakDamage(e));
  if (killableAdjEnemy) return attackMove(killableAdjEnemy);

  // KITING LOGIC
  const shouldKite = () => {
      if (p.hp < p.maxHp * 0.3) return true; // Emergency
      if (adjEnemies.length > 0 && totalIncomingMax() >= p.hp) return true; // Deadly adjacent threat
      if (p.class === 'mage' || p.class === 'ranger') {
          let canShoot = (p.class === 'mage' && G.ability1Cooldown === 0) || (p.class === 'ranger' && isBow(p.weapon));
          if (canShoot && visEnemies.some(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 2)) return true;
      }
      return false;
  };

  if (visEnemies.length > 0 && shouldKite()) {
      let bestMove = null;
      let bestScore = -Infinity;
      for (let d of dirs) {
          let nx = p.x + d.dx, ny = p.y + d.dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny) && !G.enemies.some(e => e.x === nx && e.y === ny)) {
              let minDist = Math.min(...visEnemies.map(e => Math.abs(e.x - nx) + Math.abs(e.y - ny)));
              let score = minDist * 10 + (G.seen.has(ny*MAP_W+nx) ? 5 : 0); // Prefer explored areas
              if (score > bestScore) {
                  bestScore = score;
                  bestMove = d.k;
              }
          }
      }
      // If we can achieve a distance of >= 2 (score >= 20), we successfully kite.
      // Otherwise we are cornered and should stand our ground.
      if (bestMove && bestScore >= 20) {
          return { type: 'key', val: bestMove, label: 'kite' };
      }
  }

  // FIGHT
  if (adjEnemies.length > 0) {
      let target = adjEnemies.sort((a,b) => maxIncomingHit(b) - maxIncomingHit(a))[0]; 
      return attackMove(target);
  }

  // BFS PATHFINDING FOR EXPLORATION
  const bfsPath = (ignoreDanger = false, targetStairsOnly = false, ignoreTraps = false) => {
      let q = [{x: p.x, y: p.y, path: []}];
      let visited = new Set([`${p.x},${p.y}`]);
      
      while(q.length > 0) {
        let curr = q.shift();

        let isEnemy = liveEnemies.some(e => e.x === curr.x && e.y === curr.y);
        let isItem = G.items.some(i => !i.carried && i.x === curr.x && i.y === curr.y && usefulFloorItem(i) && (bag.length < 12 || i.type === 'key' || i.type === 'upgrade'));
        let isUnseen = !G.seen.has(curr.y * MAP_W + curr.x);
        let isStairs = G.map[curr.y][curr.x] === STAIRS;
        let isShopTarget = G.shops && G.shops.some(s => s.x === curr.x && s.y === curr.y && s.stock.some(usefulShopItem));
        
        let dying = shouldExitWithoutPotion();
        
        let validTarget = false;
        let label = '';
        
        if (targetStairsOnly || dying) {
             if (isStairs) { validTarget = true; label = 'path to stairs'; }
        } else {
             if (isEnemy) { validTarget = true; label = 'path to enemy'; }
             else if (isItem) { validTarget = true; label = 'path to item'; }
             else if (isShopTarget) { validTarget = true; label = 'path to shop'; }
             else if (isUnseen) { validTarget = true; label = 'explore'; }
             else if (isStairs && isMapCleared()) { validTarget = true; label = 'path to stairs'; }
        }

        if (validTarget && curr.path.length > 0) {
            return { type: 'key', val: curr.path[0], label: label };
        }

        for (let d of dirs) {
          let nx = curr.x + d.dx, ny = curr.y + d.dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny, false, ignoreTraps)) {
            
            let isDyingEnemyTile = G.enemies.some(e => e.dying && e.x === nx && e.y === ny);
            if (isDyingEnemyTile) continue;

            let adjacentToEnemy = liveEnemies.some(e => Math.abs(e.x - nx) + Math.abs(e.y - ny) === 1);
            let isEnemyTile = liveEnemies.some(e => e.x === nx && e.y === ny);
            
            if (!ignoreDanger && adjacentToEnemy && !isEnemyTile) continue; 

            if (!visited.has(`${nx},${ny}`)) {
              visited.add(`${nx},${ny}`);
              q.push({x: nx, y: ny, path: [...curr.path, d.k]});
            }
          }
        }
      }
      return null;
  }
  
  let action = bfsPath(false, false, false); // Pass 1: Safe targets
  if (!action && shouldExitWithoutPotion()) action = bfsPath(true, true, false); // Pass 2: Force stairs if dying
  if (!action) action = bfsPath(true, false, false); // Pass 3: Unsafe targets (path through enemy danger zones)
  if (!action) action = bfsPath(true, true, false); // Pass 4: Force stairs (if map isn't cleared but unreachable)
  if (!action) action = bfsPath(true, true, true); // Pass 5: Force stairs ignoring traps
  
  if (action) return action;

  // Final Pass: If we have no action at all, we must be fully cleared of reachable targets!
  if (G.map[p.y][p.x] === STAIRS) {
      return { type: 'key', val: '>', label: 'descend' };
  }

  // FALLBACK RANDOM
  let validMoves = dirs.filter(d => {
    let nx = p.x + d.dx, ny = p.y + d.dy;
    return nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny, false, true) && !G.enemies.some(e => e.x === nx && e.y === ny);
  });
  if(validMoves.length > 0) return { type: 'key', val: validMoves[Math.floor(Math.random() * validMoves.length)].k, label: 'random' };

  return { type: 'key', val: '.', label: 'skip' };
};
