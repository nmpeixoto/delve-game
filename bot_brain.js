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

  const MAP_H = G.map ? G.map.length : 36;
  const MAP_W = G.map && G.map[0] ? G.map[0].length : 56;
  const WALL = 0, STAIRS = 2, SHOP = 3, LOCKED_DOOR = 4, SECRET_DOOR = 5;
  const p = G.player;
  const hasKey = () => G.items.some(i => i.carried && i.type === 'key');
  const isDangerousTrap = (x, y) => {
      let t = G.traps && G.traps.find(tr => tr.x === x && tr.y === y);
      return t && t.revealed && !t.triggered && t.type !== 'bear';
  };
  const isPassable = (x, y) => {
      let t = G.map[y][x];
      if (t === WALL) return false;
      if (t === LOCKED_DOOR && !hasKey()) return false;
      if (isDangerousTrap(x, y)) return false;
      return true;
  };
  const liveEnemies = G.enemies.filter(e => !e.dying);
  const carriedPotions = () => G.items.filter(i => i.carried && i.type === 'potion');
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
  const countVisibleEnemies = () => liveEnemies.filter(e => G.visible.has(e.y * MAP_W + e.x)).length;
  const countAdjacentEnemies = () => liveEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1).length;
  const countNearbyEnemies = range => liveEnemies.filter(e => Math.abs(e.x - p.x) <= range && Math.abs(e.y - p.y) <= range).length;
  const visibleClusters = () => {
    const vis = liveEnemies.filter(e => G.visible.has(e.y * MAP_W + e.x));
    return vis.filter(a => vis.some(b => a.id !== b.id && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1));
  };
  const attackPower = () => {
    let total = (p.atk || 0) + weaponPower(p.weapon);
    if (p.class === 'barbarian') total += Math.floor((p.maxHp - p.hp) / 6);
    return total;
  };
  const strategy = ({
    warrior: { exitHp: 0.6, potionHp: 0.35, stashPotionHp: 0.3, kiteThreshold: 2 },
    rogue: { exitHp: 0.5, potionHp: 0.75, stashPotionHp: 0.6, kiteThreshold: 2 },
    mage: { exitHp: 0.55, potionHp: 0.45, stashPotionHp: 0.35, kiteThreshold: 3 },
    paladin: { exitHp: 0.75, potionHp: 0.45, stashPotionHp: 0.35, kiteThreshold: 2 },
    ranger: { exitHp: 0.5, potionHp: 0.35, stashPotionHp: 0.25, kiteThreshold: 1 },
    barbarian: { exitHp: 0.5, potionHp: 0.55, stashPotionHp: 0.45, kiteThreshold: 1 },
    necromancer: { exitHp: 0.8, potionHp: 0.65, stashPotionHp: 0.55, kiteThreshold: 1 },
    monk: { exitHp: 0.6, potionHp: 0.4, stashPotionHp: 0.3, kiteThreshold: 2 },
  }[p.class] || { exitHp: 0.7, potionHp: 0.45, stashPotionHp: 0.35, kiteThreshold: 2 });
  const usefulShopItem = item => {
    if (item.sold || p.gold < item.price) return false;
    if (item.type === 'upgrade') return true;
    if ((item.type === 'weapon' || item.type === 'armor') && !canEquip(item)) return false;
    if (item.type === 'weapon') return weaponPower(item) > weaponPower(p.weapon);
    if (item.type === 'armor') return armorPower(item) > armorPower(p.armor);
    if (item.type === 'potion') return true;
    return false;
  };
  const usefulFloorItem = item => {
    if (item.type === 'potion') return true;
    if (item.type === 'upgrade') return true;
    if (item.type === 'weapon') return canEquip(item) && weaponPower(item) > weaponPower(p.weapon);
    if (item.type === 'armor') return canEquip(item) && armorPower(item) > armorPower(p.armor);
    if (item.type === 'key') return true;
    if (item.type === 'shrine' && !item.used) return true;
    return false;
  };
  const shouldExitWithoutPotion = () => p.hp < p.maxHp * strategy.exitHp && carriedPotions().length === 0;
  const stairsSeen = () => {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === STAIRS && G.seen.has(y * MAP_W + x)) return true;
      }
    }
    return false;
  };
  const isMapCleared = () => {
    if (liveEnemies.length > 0) return false;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        let t = G.map[y][x];
        if (t !== WALL && t !== SECRET_DOOR && !G.seen.has(y * MAP_W + x)) return false;
      }
    }
    return true;
  };
  const hasUsefulShopItem = () => G.shops && G.shops.some(shop => shop.stock.some(usefulShopItem));

  // RULE 8: Buy from shop if we have gold and there is a valuable item
  let shopOpen = document.getElementById('shop-overlay').classList.contains('open');
  let nearbyShop = G.shops && G.shops.find(s => Math.abs(p.x - s.x) <= 1 && Math.abs(p.y - s.y) <= 1);
  if (nearbyShop) {
     let affordable = nearbyShop.stock.filter(usefulShopItem);
     let bestItem = affordable.find(i => i.type === 'upgrade') ||
                    affordable.find(i => i.type === 'weapon') ||
                    affordable.find(i => i.type === 'armor') ||
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
      if (!bestPotion && p.hp < p.maxHp * strategy.stashPotionHp && potions.length > 0) {
          bestPotion = potions[potions.length - 1];
      }
  } else if (p.hp < p.maxHp * strategy.potionHp && potions.length > 0) {
      // In combat, avoid voluntary attacks while one enemy turn from death.
      const targetHp = p.maxHp * 0.55;
      bestPotion = [...potions].reverse().find(pot => p.hp + pot.heal >= targetHp) || potions[0];
  }

  if (bestPotion) {
      if (!bagOpen) return { type: 'key', val: 'i' };
      else {
          let visiblePotion = G.items.find(i => i.carried && i.type === bestPotion.type && i.name === bestPotion.name) || bestPotion;
          return { type: 'click', target: `.inv-slot[onclick*="${visiblePotion.id}"]` };
      }
  } else if (bagOpen) {
      return { type: 'click', target: '#drawer-backdrop' }; // Close bag if open and nothing to drink
  }

  if (G.map[p.y][p.x] === STAIRS) {
    let dyingWithoutPotion = shouldExitWithoutPotion();
    let mapCleared = isMapCleared();

    if (mapCleared || dyingWithoutPotion) {
        return { type: 'key', val: '>' };
    }
  }

  // RULE 1: Grab adjacent items immediately (if we have space)
  let bag = G.items.filter(i => i.carried);
  if (bag.length < 12) {
      let adjItem = G.items.find(i => !i.carried && Math.abs(i.x - p.x) + Math.abs(i.y - p.y) === 1);
      if (adjItem && usefulFloorItem(adjItem)) {
        if (adjItem.x < p.x) return { type: 'key', val: 'ArrowLeft' };
        if (adjItem.x > p.x) return { type: 'key', val: 'ArrowRight' };
        if (adjItem.y < p.y) return { type: 'key', val: 'ArrowUp' };
        if (adjItem.y > p.y) return { type: 'key', val: 'ArrowDown' };
      }
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
      if (!G.shops || !hasUsefulShopItem()) return null;
      let q = [{x: p.x, y: p.y, path: []}];
      let visited = new Set([`${p.x},${p.y}`]);
      while(q.length > 0) {
        let curr = q.shift();
        if (G.map[curr.y][curr.x] === SHOP && curr.path.length > 0) {
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

  const totalAtk = () => (p.atk || 0) + weaponPower(p.weapon);
  const minNormalDamage = en => Math.max(1, totalAtk() - en.def);
  const maxNormalDamage = en => Math.max(1, totalAtk() - en.def + 2);
  const minBashDamage = en => minNormalDamage(en) * 1.5;
  const minSneakDamage = en => minNormalDamage(en) * (p.vanishTurns > 0 ? 2 : 1);
  const tapRange = () => (p.class === 'ranger' && isBow(p.weapon)) ? 2 : 2;
  const attackMove = en => {
      if (en.x < p.x) return { type: 'key', val: 'ArrowLeft' };
      if (en.x > p.x) return { type: 'key', val: 'ArrowRight' };
      if (en.y < p.y) return { type: 'key', val: 'ArrowUp' };
      if (en.y > p.y) return { type: 'key', val: 'ArrowDown' };
      return null;
  };
  const rangedAttack = () => {
      let targets = visEnemies
        .filter(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= tapRange())
        .filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) > 1)
        .sort((a, b) => {
          let aKill = a.hp <= minSneakDamage(a) ? 0 : 1;
          let bKill = b.hp <= minSneakDamage(b) ? 0 : 1;
          let aDist = Math.abs(a.x - p.x) + Math.abs(a.y - p.y);
          let bDist = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
          return aKill - bKill || a.hp - b.hp || aDist - bDist;
        });
      if (!targets.length) return null;

      let target = targets[0];
      let killable = target.hp <= minSneakDamage(target);
      if (p.class === 'ranger' && isBow(p.weapon)) return { type: 'attack', target: target.id };
      if (killable) return { type: 'attack', target: target.id };
      return null;
  };

  let forcedExit = (shouldExitWithoutPotion() && stairsSeen());
  let adjEnemy = liveEnemies.find(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  let sneakKillableAdjEnemy = liveEnemies
    .filter(e => p.vanishTurns > 0 && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1 && e.hp <= minSneakDamage(e))
    .sort((a, b) => a.hp - b.hp)[0];
  if (sneakKillableAdjEnemy) return attackMove(sneakKillableAdjEnemy);

  let killableAdjEnemy = liveEnemies
    .filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1 && e.hp <= minNormalDamage(e))
    .sort((a, b) => a.hp - b.hp)[0];
  if (killableAdjEnemy) return attackMove(killableAdjEnemy);

  if (forcedExit && adjEnemy) {
      if (adjEnemy.hp <= minNormalDamage(adjEnemy)) return attackMove(adjEnemy);
      if (G.ability1Cooldown === 0 && p.class === 'warrior' && adjEnemy.hp <= minBashDamage(adjEnemy)) return { type: 'key', val: 'b' };
  }
  if (forcedExit && !adjEnemy) {
      let shopAction = pathToShop(true);
      if (shopAction) return shopAction;
      let exitAction = pathToKnownStairs(true);
      if (exitAction) return exitAction;
  }

  // RULE 2: Use Abilities intelligently based on class
  let visEnemies = liveEnemies.filter(e => G.visible.has(e.y*MAP_W + e.x));
  const ability2Decision = () => {
      if (G.ability2Cooldown !== 0 || p.lvl < 5) return null;
      if (p.class === 'warrior' && visEnemies.length >= 2) return { type: 'key', val: 'v' }; // SHIELD WALL
      if (p.class === 'rogue' && (p.hp < p.maxHp * 0.85 || countAdjacentEnemies() > 0 || visEnemies.length >= 2 || G.floor >= 4) && visEnemies.length > 0) return { type: 'key', val: 'v' }; // VANISH
      if (p.class === 'mage' && (countAdjacentEnemies() > 0 || p.hp < p.maxHp * 0.75) && visEnemies.length > 0) return { type: 'key', val: 'v' }; // BLINK
      if (p.class === 'paladin' && p.hp < p.maxHp * 0.7) return { type: 'key', val: 'v' }; // LAY ON HANDS
      if (p.class === 'ranger' && adjEnemy) return { type: 'key', val: 'v' }; // BEAR TRAP
      if (p.class === 'barbarian' && countAdjacentEnemies() >= 2 && p.hp > p.maxHp * 0.85) return { type: 'key', val: 'v' }; // BLOODLUST
      if (p.class === 'necromancer' && (visibleClusters().length > 0 || visEnemies.length >= 2)) return { type: 'key', val: 'v' }; // CORPSE EXPLOSION
      if (p.class === 'monk' && adjEnemy && (p.hp > p.maxHp * 0.75 || countAdjacentEnemies() >= 2)) return { type: 'key', val: 'v' }; // FLURRY OF BLOWS
      return null;
  };
  const classesThatPreferAbility2First = new Set(['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk']);

  if (classesThatPreferAbility2First.has(p.class)) {
      let ability2First = ability2Decision();
      if (ability2First) return ability2First;
  }

  if (G.ability1Cooldown === 0) {
      if (p.class === 'warrior') {
         let target = liveEnemies.find(e => Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2 && G.visible.has(e.y*MAP_W+e.x));
         if (target && (!forcedExit || target.hp <= minBashDamage(target))) return { type: 'key', val: 'b' }; // BASH
      }
      else if (p.class === 'rogue') {
         if (!adjEnemy && p.hp > p.maxHp * 0.6 && (countVisibleEnemies() === 0 || (countVisibleEnemies() === 1 && p.hp > p.maxHp * 0.8))) return { type: 'key', val: 'b' }; // DASH
         if (adjEnemy) {
            let adjacentKillable = maxNormalDamage(adjEnemy) >= adjEnemy.hp;
            let canSpendDash = (p.hp > p.maxHp * 0.45 && p.hp < p.maxHp * 0.75) || countAdjacentEnemies() >= 2;
            if (!adjacentKillable && canSpendDash) return { type: 'key', val: 'b' }; // DASH OUT
         }
      }
      else if (p.class === 'mage') {
         if (visEnemies.length >= 1) return { type: 'key', val: 'b' }; // FIREBALL
      }
      else if (p.class === 'paladin') {
         let target = liveEnemies.find(e => Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2 && G.visible.has(e.y*MAP_W+e.x));
         if (target) return { type: 'key', val: 'b' }; // SMITE
      }
      else if (p.class === 'ranger') {
         let aligned = visEnemies.map(e => {
            let dx = e.x - p.x, dy = e.y - p.y;
            if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) return null;
            let sx = Math.sign(dx), sy = Math.sign(dy);
            let cx = p.x + sx, cy = p.y + sy;
            while (cx !== e.x || cy !== e.y) {
              if (cx < 0 || cx >= MAP_W || cy < 0 || cy >= MAP_H || G.map[cy][cx] === WALL) return null;
              cx += sx; cy += sy;
            }
            return { enemy: e, dist: Math.abs(dx) + Math.abs(dy) };
         }).filter(Boolean).sort((a, b) => a.dist - b.dist)[0];
         if (aligned) return { type: 'key', val: 'b' }; // PIERCING SHOT
      }
      else if (p.class === 'barbarian') {
         if (liveEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1).length >= 1) return { type: 'key', val: 'b' }; // CLEAVE
      }
      else if (p.class === 'necromancer') {
        let target = liveEnemies
          .filter(e => Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2 && G.visible.has(e.y*MAP_W+e.x))
          .sort((a, b) => a.hp - b.hp)[0];
        if (target) return { type: 'key', val: 'b' }; // SIPHON LIFE
      }
      else if (p.class === 'monk') {
         if (adjEnemy) return { type: 'key', val: 'b' }; // PUSH KICK
      }
  }

  let ability2Fallback = ability2Decision();
  if (ability2Fallback) return ability2Fallback;

  let rangedAction = rangedAttack();
  if (rangedAction) return rangedAction;

  if (p.class === 'rogue' && adjEnemy && p.hp >= p.maxHp * 0.75) {
      return attackMove(adjEnemy);
  }

  if (p.class === 'rogue' && adjEnemy && adjEnemy.hp <= maxNormalDamage(adjEnemy)) {
      return attackMove(adjEnemy);
  }

  if (p.class === 'rogue' && adjEnemy && p.hp <= p.maxHp * 0.45 && carriedPotions().length === 0 && !stairsSeen()) {
      return attackMove(adjEnemy);
  }

  // RULE 3: KITE! Keep distance from enemies!
  if (true) {
     if (visEnemies.length > 0) {
         let closestDist = Math.min(...visEnemies.map(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y)));
         let kiteThreshold = strategy.kiteThreshold;
         if (closestDist <= kiteThreshold) {
            let bestMove = null;
            let bestMinDist = -1;
            for (let d of dirs) {
                let nx = p.x + d.dx, ny = p.y + d.dy;
                if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny)) {
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
      if (p.class === 'rogue') {
          let escape = dirs
            .map(d => {
              let nx = p.x + d.dx, ny = p.y + d.dy;
              if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H || !isPassable(nx, ny)) return null;
              if (G.enemies.some(e => e.x === nx && e.y === ny)) return null;
              let minDist = Math.min(...liveEnemies.map(e => Math.abs(e.x - nx) + Math.abs(e.y - ny)));
              return { k: d.k, minDist };
            })
            .filter(Boolean)
            .sort((a, b) => b.minDist - a.minDist)[0];
          if (escape && escape.minDist > 1) return { type: 'key', val: escape.k };
      }
      if (adjEnemy.x < p.x) return { type: 'key', val: 'ArrowLeft' };
      if (adjEnemy.x > p.x) return { type: 'key', val: 'ArrowRight' };
      if (adjEnemy.y < p.y) return { type: 'key', val: 'ArrowUp' };
      if (adjEnemy.y > p.y) return { type: 'key', val: 'ArrowDown' };
  }

  let dyingWithoutPotion = shouldExitWithoutPotion();
  let knownStairs = stairsSeen();

  function bfsPath(avoidEnemies, forceStairs = false) {
      if (!G.shops || !hasUsefulShopItem()) {
          // just a safety check, not strictly needed inside bfsPath but keeping structure
      }
      let q = [{x: p.x, y: p.y, path: []}];
      let visited = new Set([`${p.x},${p.y}`]);
      let bestTargets = [];
      let bestDist = Infinity;

      while(q.length > 0) {
        let curr = q.shift();
        if (curr.path.length > bestDist) break; // We found the closest targets already

        let isEnemy = liveEnemies.some(e => e.x === curr.x && e.y === curr.y);
        let isItem = bag.length < 12 && G.items.some(i => !i.carried && i.x === curr.x && i.y === curr.y && usefulFloorItem(i));
        let isUnseen = !G.seen.has(curr.y * MAP_W + curr.x);
        let isStairs = G.map[curr.y][curr.x] === STAIRS;

        let isShopTarget = false;
        if (G.map[curr.y][curr.x] === SHOP && G.shops) {
            let shop = G.shops.find(s => s.x === curr.x && s.y === curr.y);
            if (shop) {
                isShopTarget = shop.stock.some(usefulShopItem);
            }
        }

        // Determine if map is fully cleared (no enemies, no unseen tiles)
        let mapCleared = isMapCleared();

        // Only target stairs if the map is cleared, OR if we are dying and need to escape
        if (isStairs && !mapCleared && !dyingWithoutPotion && !forceStairs) {
           isStairs = false;
        }

        if (dyingWithoutPotion && knownStairs && !isStairs) {
          // At low HP with no healing, stop full-clearing and take the known exit.
          isEnemy = false;
          isItem = false;
          isUnseen = false;
          isShopTarget = false;
        }

        if ((isEnemy || isItem || isUnseen || isStairs || isShopTarget) && curr.path.length > 0) {
          bestTargets.push(curr);
          bestDist = curr.path.length;
          continue;
        }

        for (let d of dirs) {
          let nx = curr.x + d.dx, ny = curr.y + d.dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny)) {
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
      if (bestTargets.length > 0) {
        return { type: 'key', val: bestTargets[0].path[0] };
      }
      return null;
  }
  let action = bfsPath(dyingWithoutPotion);
  if (!action && dyingWithoutPotion) {
      // Pass 2: If we couldn't escape safely, fight our way out!
      action = bfsPath(false);
  }
  if (!action) {
      // Pass 3: If NO targets found (e.g. all enemies unreachable), force stairs!
      action = bfsPath(false, true);
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
    return nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny) && !occupied;
  });

  if(validMoves.length > 0) {
    return { type: 'key', val: validMoves[Math.floor(Math.random() * validMoves.length)].k };
  }

  return null;
};
