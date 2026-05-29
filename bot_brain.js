// bot_brain.js
// This file is injected into the browser by the Puppeteer runner.
// The agent modifies this file to improve the bot's decision making based on lessons learned.
// The function must return null (stuck), {type: 'status', val: 'dead'/'won'}, {type: 'click', target: selector}, or {type: 'key', val: keyString}.

window.botDecisionLogic = function() {
  if (document.getElementById('emergency-overlay').style.display === 'flex') {
    return { type: 'click', target: '#emergency-drink-btn' };
  }
  if (document.querySelector('.modal.death')) return { type: 'status', val: 'dead' };
  if (document.querySelector('.modal.victory')) return { type: 'status', val: 'won' };

  const MAP_W = 28, MAP_H = 18, WALL = 0, STAIRS = 2, SHOP = 3;
  const p = G.player;
  const liveEnemies = G.enemies.filter(e => !e.dying);
  const carriedPotions = () => G.items.filter(i => i.carried && i.type === 'potion');
  const shouldExitWithoutPotion = () => p.hp < p.maxHp * 0.7 && carriedPotions().length === 0;
  const stairsSeen = () => {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === STAIRS && G.seen.has(y * MAP_W + x)) return true;
      }
    }
    return false;
  };
  const hasUsefulShopItem = () => G.shopPos && G.shopStock.some(i => {
    if (i.sold || p.gold < i.price) return false;
    if (i.type === 'upgrade') return true;
    if (i.type === 'weapon' && (!p.weapon || i.atk > p.weapon.atk)) return true;
    if (i.type === 'armor' && (!p.armor || i.def > p.armor.def)) return true;
    if (i.type === 'potion') return true;
    return false;
  });
  
  // RULE 8: Buy from shop if we have gold and there is a valuable item
  let shopOpen = document.getElementById('shop-overlay').classList.contains('open');
  if (G.shopPos && Math.abs(p.x - G.shopPos.x) <= 1 && Math.abs(p.y - G.shopPos.y) <= 1) {
     let affordable = G.shopStock.filter(i => !i.sold && p.gold >= i.price);
     let bestItem = affordable.find(i => i.type === 'upgrade') ||
                    affordable.find(i => i.type === 'weapon' && (!p.weapon || i.atk > p.weapon.atk)) ||
                    affordable.find(i => i.type === 'armor' && (!p.armor || i.def > p.armor.def)) ||
                    affordable.find(i => i.type === 'potion');

     if (bestItem) {
        if (!shopOpen) {
           return { type: 'key', val: 't' }; // open shop
        } else {
           return { type: 'click', target: `.shop-item[onclick*="${bestItem.id}"]` };
        }
     } else if (shopOpen) {
        return { type: 'key', val: 'Escape' }; // close shop via Escape
     }
  }
  
  if (shopOpen) return { type: 'key', val: 'Escape' }; // fallback close just in case
  
  // RULE 4: Smart out-of-combat healing
  let inCombat = liveEnemies.some(e => G.visible.has(e.y*MAP_W + e.x));
  let bagOpen = document.getElementById('inv-drawer').classList.contains('open');
  let bestPotion = null;

  // Sort potions largest to smallest
  let potions = carriedPotions().sort((a,b) => b.heal - a.heal);
  if (!inCombat) {
      // Find the largest potion that we can drink without wasting any HP
      for (let pot of potions) {
          if (p.maxHp - p.hp >= pot.heal) {
              bestPotion = pot;
              break;
          }
      }
      
      // If we are critically low (< 30%) and no perfect potion exists, drink the smallest one to avoid instant death
      if (!bestPotion && p.hp < p.maxHp * 0.3 && potions.length > 0) {
          bestPotion = potions[potions.length - 1];
      }
  } else if (p.hp < p.maxHp * 0.35 && potions.length > 0) {
      // In combat, avoid voluntary attacks while one enemy turn from death.
      const targetHp = p.maxHp * 0.55;
      bestPotion = [...potions].reverse().find(pot => p.hp + pot.heal >= targetHp) || potions[0];
  }

  if (bestPotion) {
      if (!bagOpen) return { type: 'key', val: 'i' };
      else return { type: 'click', target: `.inv-slot[onclick*="${bestPotion.id}"]` };
  } else if (bagOpen) {
      return { type: 'click', target: '#drawer-backdrop' }; // Close bag if open and nothing to drink
  }

  if (G.map[p.y][p.x] === STAIRS) {
    let dyingWithoutPotion = shouldExitWithoutPotion();
    let mapCleared = liveEnemies.length === 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] !== WALL && !G.seen.has(y * MAP_W + x)) mapCleared = false;
      }
    }

    if (G.floor >= 5 || mapCleared || dyingWithoutPotion) {
        return { type: 'key', val: '>' };
    }
  }

  // RULE 1: Grab adjacent items immediately
  let adjItem = G.items.find(i => !i.carried && Math.abs(i.x - p.x) + Math.abs(i.y - p.y) === 1);
  if (adjItem) {
    if (adjItem.x < p.x) return { type: 'key', val: 'ArrowLeft' };
    if (adjItem.x > p.x) return { type: 'key', val: 'ArrowRight' };
    if (adjItem.y < p.y) return { type: 'key', val: 'ArrowUp' };
    if (adjItem.y > p.y) return { type: 'key', val: 'ArrowDown' };
  }

  let dirs = [
    { dx: 0, dy: -1, k: 'ArrowUp' },
    { dx: 0, dy: 1, k: 'ArrowDown' },
    { dx: -1, dy: 0, k: 'ArrowLeft' },
    { dx: 1, dy: 0, k: 'ArrowRight' }
  ];

  function pathToKnownStairs(avoidEnemies) {
      let q = [{x: p.x, y: p.y, path: []}];
      let visited = new Set([`${p.x},${p.y}`]);
      while(q.length > 0) {
        let curr = q.shift();
        if (G.map[curr.y][curr.x] === STAIRS && G.seen.has(curr.y * MAP_W + curr.x) && curr.path.length > 0) {
          return { type: 'key', val: curr.path[0] };
        }

        for (let d of dirs) {
          let nx = curr.x + d.dx, ny = curr.y + d.dy;
          if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H || G.map[ny][nx] === WALL) continue;
          if (G.enemies.some(e => e.dying && e.x === nx && e.y === ny)) continue;
          if (avoidEnemies && liveEnemies.some(e => e.x === nx && e.y === ny)) continue;
          if (!visited.has(`${nx},${ny}`)) {
            visited.add(`${nx},${ny}`);
            q.push({x: nx, y: ny, path: [...curr.path, d.k]});
          }
        }
      }
      return null;
  }

  function pathToShop(avoidEnemies) {
      if (!G.shopPos || !hasUsefulShopItem()) return null;
      let q = [{x: p.x, y: p.y, path: []}];
      let visited = new Set([`${p.x},${p.y}`]);
      while(q.length > 0) {
        let curr = q.shift();
        if (curr.x === G.shopPos.x && curr.y === G.shopPos.y && curr.path.length > 0) {
          return { type: 'key', val: curr.path[0] };
        }

        for (let d of dirs) {
          let nx = curr.x + d.dx, ny = curr.y + d.dy;
          if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H || G.map[ny][nx] === WALL) continue;
          if (G.enemies.some(e => e.dying && e.x === nx && e.y === ny)) continue;
          if (avoidEnemies && liveEnemies.some(e => e.x === nx && e.y === ny)) continue;
          if (!visited.has(`${nx},${ny}`)) {
            visited.add(`${nx},${ny}`);
            q.push({x: nx, y: ny, path: [...curr.path, d.k]});
          }
        }
      }
      return null;
  }

  const totalAtk = () => p.atk + (p.weapon?.atk || 0);
  const minNormalDamage = en => Math.max(1, totalAtk() - en.def);
  const minBashDamage = en => minNormalDamage(en) * 2;
  const attackMove = en => {
      if (en.x < p.x) return { type: 'key', val: 'ArrowLeft' };
      if (en.x > p.x) return { type: 'key', val: 'ArrowRight' };
      if (en.y < p.y) return { type: 'key', val: 'ArrowUp' };
      if (en.y > p.y) return { type: 'key', val: 'ArrowDown' };
      return null;
  };

  let forcedExit = (G.floor >= 5 || shouldExitWithoutPotion()) && stairsSeen();
  let adjEnemy = liveEnemies.find(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  if (forcedExit && adjEnemy) {
      if (adjEnemy.hp <= minNormalDamage(adjEnemy)) return attackMove(adjEnemy);
      if (G.bashCooldown === 0 && adjEnemy.hp <= minBashDamage(adjEnemy)) return { type: 'key', val: 'b' };
  }
  if (forcedExit && !adjEnemy) {
      if (G.floor < 5) {
          let shopAction = pathToShop(true);
          if (shopAction) return shopAction;
      }
      let exitAction = pathToKnownStairs(true);
      if (exitAction) return exitAction;
  }

  // RULE 2: If Bash is off cooldown and an enemy is within 2 tiles, BASH it!
  let bashTarget = liveEnemies.find(e => Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2 && G.visible.has(e.y*MAP_W+e.x));
  if (bashTarget && G.bashCooldown === 0 && (!forcedExit || bashTarget.hp <= minBashDamage(bashTarget))) {
      return { type: 'key', val: 'b' }; // BASH
  }

  // RULE 3: KITE! If bash is on cooldown, keep distance from enemies!
  if (G.bashCooldown > 0) {
     let visEnemies = liveEnemies.filter(e => G.visible.has(e.y*MAP_W + e.x));
     if (visEnemies.length > 0) {
         let closestDist = Math.min(...visEnemies.map(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y)));
         if (closestDist <= 2) {
            let bestMove = null;
            let bestMinDist = -1;
            for (let d of dirs) {
                let nx = p.x + d.dx, ny = p.y + d.dy;
                if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && G.map[ny][nx] !== WALL) {
                    if (G.enemies.some(e => e.x === nx && e.y === ny)) continue; // don't step ON an enemy
                    
                    let minDist = Math.min(...visEnemies.map(e => Math.abs(e.x - nx) + Math.abs(e.y - ny)));
                    if (minDist > bestMinDist) {
                        bestMinDist = minDist;
                        bestMove = d.k;
                    }
                }
            }
            if (bestMove && bestMinDist > 1) {
                return { type: 'key', val: bestMove };
            }
         }
     }
  }

  // RULE 3.5: If we are adjacent to an enemy, and we cannot kite (Rule 3 failed), we must fight!
  // This prevents the "Walking Punching Bag" loop where we walk adjacent to enemies and get hit in the back.
  if (adjEnemy) {
      if (adjEnemy.x < p.x) return { type: 'key', val: 'ArrowLeft' };
      if (adjEnemy.x > p.x) return { type: 'key', val: 'ArrowRight' };
      if (adjEnemy.y < p.y) return { type: 'key', val: 'ArrowUp' };
      if (adjEnemy.y > p.y) return { type: 'key', val: 'ArrowDown' };
  }

  let dyingWithoutPotion = shouldExitWithoutPotion();
  let knownStairs = stairsSeen();

  function bfsPath(avoidEnemies) {
      let q = [{x: p.x, y: p.y, path: []}];
      let visited = new Set([`${p.x},${p.y}`]);
      while(q.length > 0) {
        let curr = q.shift();
        let isEnemy = liveEnemies.some(e => e.x === curr.x && e.y === curr.y);
        let isItem = G.items.some(i => !i.carried && i.x === curr.x && i.y === curr.y);
        let isUnseen = !G.seen.has(curr.y * MAP_W + curr.x);
        let isStairs = G.map[curr.y][curr.x] === STAIRS;
        
        let isShopTarget = false;
        if (G.map[curr.y][curr.x] === SHOP) {
            isShopTarget = G.shopStock.some(i => {
                if (i.sold || p.gold < i.price) return false;
                if (i.type === 'upgrade') return true;
                if (i.type === 'weapon' && (!p.weapon || i.atk > p.weapon.atk)) return true;
                if (i.type === 'armor' && (!p.armor || i.def > p.armor.def)) return true;
                if (i.type === 'potion') return true;
                return false;
            });
        }
        
        // Determine if map is fully cleared (no enemies, no unseen tiles)
        let mapCleared = liveEnemies.length === 0;
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (G.map[y][x] !== WALL && !G.seen.has(y * MAP_W + x)) mapCleared = false;
          }
        }

        // Only target stairs if the map is cleared, OR if we are dying and need to escape
        if (isStairs && !mapCleared && !dyingWithoutPotion && G.floor < 5) {
           isStairs = false;
        }
        
        if ((dyingWithoutPotion || G.floor >= 5) && knownStairs && !isStairs) {
          // At low HP with no healing, stop full-clearing and take the known exit.
          isEnemy = false;
          isItem = false;
          isUnseen = false;
          isShopTarget = false;
        }

        if ((isEnemy || isItem || isUnseen || isStairs || isShopTarget) && curr.path.length > 0) {
          return { type: 'key', val: curr.path[0] };
        }
        
        for (let d of dirs) {
          let nx = curr.x + d.dx, ny = curr.y + d.dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && G.map[ny][nx] !== WALL) {
            let isEnemyTile = liveEnemies.some(e => e.x === nx && e.y === ny);
            let isDyingEnemyTile = G.enemies.some(e => e.dying && e.x === nx && e.y === ny);
            if (isDyingEnemyTile) continue;
            if (avoidEnemies && isEnemyTile) continue; // TREAT ENEMY AS WALL TO AVOID HITS
            
            if (!visited.has(`${nx},${ny}`)) {
              visited.add(`${nx},${ny}`);
              q.push({x: nx, y: ny, path: [...curr.path, d.k]});
            }
          }
        }
      }
      return null;
  }

  let action = bfsPath(dyingWithoutPotion);
  if (!action && dyingWithoutPotion) {
      // Pass 2: If we couldn't escape safely, fight our way out!
      action = bfsPath(false);
  }

  if (action) return action;

  // RULE 5: If BFS fails, attack adjacent enemies before moving randomly
  const adjEnemyFallback = liveEnemies.find(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  if (adjEnemyFallback) {
    if (adjEnemyFallback.x < p.x) return { type: 'key', val: 'ArrowLeft' };
    if (adjEnemyFallback.x > p.x) return { type: 'key', val: 'ArrowRight' };
    if (adjEnemyFallback.y < p.y) return { type: 'key', val: 'ArrowUp' };
    if (adjEnemyFallback.y > p.y) return { type: 'key', val: 'ArrowDown' };
  }

  let validMoves = dirs.filter(d => {
    let nx = p.x + d.dx, ny = p.y + d.dy;
    let occupied = G.enemies.some(e => e.x === nx && e.y === ny);
    return nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && G.map[ny][nx] !== WALL && !occupied;
  });
  
  if(validMoves.length > 0) {
    return { type: 'key', val: validMoves[Math.floor(Math.random() * validMoves.length)].k };
  }
  
  return null;
};
