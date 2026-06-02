// automation/bot_brain.js
// This file is injected into the browser by the Puppeteer runner.
// The agent modifies this file to improve the bot's decision making based on lessons learned.
// The function must return null (stuck), {type: 'status', val: 'dead'/'won'}, {type: 'click', target: selector}, or {type: 'key', val: keyString}.

window.botDecisionLogic = function() {
  if (document.getElementById('emergency-overlay').style.display === 'flex') {
    return { type: 'click', target: '#emergency-drink-btn' };
  }
  let shrineOverlay = document.getElementById('shrine-overlay');
  let shrineModal = document.getElementById('shrine-modal');
  let shrineOpen = (shrineOverlay && (shrineOverlay.style.display === 'flex' || shrineOverlay.style.display === 'block')) ||
                   (shrineModal && shrineModal.style.display === 'block');
  if (shrineOpen && typeof G !== 'undefined' && G.player) {
    let title = (document.getElementById('shrine-title').textContent || '').toLowerCase();
    const p = G.player;
    let accept = false;
    if (title.includes('blood')) {
      let cost = Math.max(1, Math.floor(p.maxHp * 0.3));
      accept = p.maxHp - cost >= 20 && p.hp > p.maxHp * 0.7;
    } else if (title.includes('greed')) {
      accept = p.gold <= 250 || (G.floor >= 4 && p.lvl < 8);
    } else if (title.includes('cursed')) {
      let hasEscape = G.items.some(i => i.carried && (i.type === 'scroll_teleport' || i.type === 'bomb'));
      let hasClassEscape = p.lvl >= 5 && G.ability2Cooldown === 0 && ['rogue', 'mage', 'ranger'].includes(p.class);
      accept = p.hp < p.maxHp * 0.35 && (hasEscape || hasClassEscape);
    }
    
    if (!accept) {
      // If we decline, mark the shrine on our tile as used so we don't path to it infinitely
      let s = G.items.find(i => i.type === 'shrine' && i.x === p.x && i.y === p.y);
      if (s) s.used = true;
      if (typeof _currentShrine !== 'undefined' && _currentShrine) _currentShrine.used = true;
    }
    return { type: 'click', target: accept ? '#shrine-accept-btn' : '#shrine-decline-btn' };
  }

  if (document.querySelector('.modal.death')) return { type: 'status', val: 'dead' };
  if (document.querySelector('.modal.victory')) return { type: 'status', val: 'won' };

  const MAP_H = G.map ? G.map.length : 36;
  const MAP_W = G.map && G.map[0] ? G.map[0].length : 56;
  const FINAL_FLOOR = typeof FLOORS !== 'undefined' ? FLOORS : 5;
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
  const carriedTeleports = () => G.items.filter(i => i.carried && (i.type === 'scroll_teleport' || /teleport/i.test(i.name || '')));
  const carriedDetects = () => G.items.filter(i => i.carried && i.type === 'scroll' && /detection/i.test(i.name || ''));
  const carriedBuffs = () => G.items.filter(i => i.carried && i.type === 'potion_buff');
  
  const canEquip = item => {
    if (item.type !== 'weapon' && item.type !== 'armor') return false;
    if (item.reqLvl && p.lvl < item.reqLvl) return false;
    if (item.reqClass && !item.reqClass.includes(p.class)) return false;
    return true;
  };
  const isMagicWeapon = item => item && (item.sym === '♦' || /staff|rod|wand|scythe/i.test(item.name || ''));
  const isBow = item => item && (item.sym === '🏹' || /bow/i.test(item.name || ''));
  const weaponPower = item => {
    if (!item) return p.class === 'monk' ? Math.ceil(p.lvl / 2) : 0;
    let power = item.atk || 0;
    if (p.class === 'mage' && isMagicWeapon(item)) power += Math.floor(power / 5);
    return power;
  };
  const armorPower = item => item ? (item.def || 0) : 0;
  const secondaryScore = item => {
    if (!item) return 0;
    return (item.perception || 0) * 4 +
      (item.vampirism || 0) * 8 +
      (item.regen || 0) * 7 +
      (item.swiftness || 0) * 6 +
      (item.goldBonus || 0) * 0.5 +
      (item.xpMult || 0) * 20 +
      (item.critChance || 0) * 60 +
      (item.dodgeBonus || 0) * 60;
  };
  const weaponValue = item => weaponPower(item) * 10 + secondaryScore(item);
  const armorValue = item => armorPower(item) * 10 + secondaryScore(item);
  
  const totalAtk = () => {
    let total = (p.atk || 0) + weaponPower(p.weapon);
    if (p.class === 'barbarian') total += Math.floor((p.maxHp - p.hp) / 6);
    if (p.strengthTurns > 0) total += 10;
    if (p.magicMult && isMagicWeapon(p.weapon)) total = Math.floor(total * p.magicMult);
    return total;
  };
  const minNormalDamage = en => Math.max(1, totalAtk() - en.def);
  const maxNormalDamage = en => Math.max(1, totalAtk() - en.def + 2);
  const maxStrengthDamage = en => Math.max(1, totalAtk() + ((p.strengthTurns || 0) > 0 ? 0 : 10) - en.def + 2);
  const minBashDamage = en => minNormalDamage(en) * 1.5;
  const minSneakDamage = en => minNormalDamage(en) * (p.vanishTurns > 0 ? 2 : 1);
  const maxIncomingHit = en => {
    let maxHit = Math.max(1, en.atk - ((p.def || 0) + armorPower(p.armor)) + 2);
    if (p.shieldWallTurns > 0) maxHit = Math.ceil(maxHit * 3 / 5);
    if (p.bloodlustTurns > 0) maxHit = Math.ceil(maxHit * 23 / 20);
    return maxHit;
  };
  const totalIncomingMax = () => adjEnemies.reduce((sum, en) => sum + maxIncomingHit(en), 0);
  const boss = visEnemies.find(e => e.boss) || liveEnemies.find(e => e.boss && G.seen.has(e.y * MAP_W + e.x));
  const bossPhase = boss ? (boss.phase || (/enraged/i.test(boss.name || '') ? 2 : 1)) : 0;
  const hiddenSecretsRemain = () => {
    if ((G.traps || []).some(t => !t.revealed && !t.triggered)) return true;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === SECRET_DOOR) return true;
      }
    }
    return false;
  };

  // Strategy Tuning
  const strategy = {
    exitHp: p.class === 'rogue' ? 0.65 : 0.7, // We dive for stairs if we have NO healing and HP drops below this
    kiteThreshold: (p.class === 'ranger' || p.class === 'mage') ? 3 : (p.class === 'rogue' ? 2 : 1),
    exploreThreshold: 0.35, // When map is 35% revealed (approx 80% of walkable tiles + walls), we go to stairs
  };

  // ECONOMY & ITEMS
  const usefulShopItem = item => {
    if (item.sold || p.gold < item.price) return false;
    if (item.type === 'upgrade') return true;
    if ((item.type === 'weapon' || item.type === 'armor') && !canEquip(item)) return false;
    if (item.type === 'weapon') return weaponValue(item) > weaponValue(p.weapon);
    if (item.type === 'armor') return armorValue(item) > armorValue(p.armor);
    if (item.type === 'potion' || item.type === 'potion_buff' || item.type === 'bomb' || item.type === 'scroll' || item.type === 'scroll_teleport') return true;
    return false;
  };
  const usefulFloorItem = item => {
    if (item.type === 'potion' || item.type === 'potion_buff' || item.type === 'bomb' || item.type === 'scroll' || item.type === 'scroll_teleport') return true;
    if (item.type === 'upgrade' || item.type === 'key') return true;
    if (item.type === 'weapon') return canEquip(item) && weaponValue(item) > weaponValue(p.weapon);
    if (item.type === 'armor') return canEquip(item) && armorValue(item) > armorValue(p.armor);
    if (item.type === 'shrine' && !item.used) return true;
    return false;
  };

  const shopItemScore = item => {
    if (item.type === 'upgrade') {
      let statScore = item.stat === 'perception' ? 35 : item.stat === 'hp' ? 32 : item.stat === 'def' ? 30 : item.stat === 'atk' ? 30 : 25;
      return 800 + statScore + (item.amount || 0) * 8;
    }
    if (item.type === 'weapon') return 650 + (weaponValue(item) - weaponValue(p.weapon));
    if (item.type === 'armor') return 620 + (armorValue(item) - armorValue(p.armor));
    if (item.type === 'potion') {
      let needHealing = p.hp < p.maxHp * 0.65 || carriedPotions().length === 0;
      return (needHealing ? 560 : 260) + (item.heal || 0);
    }
    if (item.type === 'scroll_teleport') return 380 + (carriedTeleports().length ? 0 : 80) + (G.floor >= 4 ? 50 : 0);
    if (item.type === 'bomb') return 360 + (carriedBombs().length ? 0 : 60) + (G.floor >= 4 ? 50 : 0);
    if (item.type === 'potion_buff') return 330 + (carriedBuffs().length ? 0 : 40) + (G.floor >= 4 ? 50 : 0);
    if (item.type === 'scroll') return 260 + (hiddenSecretsRemain() ? 80 : 0);
    return 0;
  };

  let shopOpen = document.getElementById('shop-overlay') && document.getElementById('shop-overlay').classList.contains('open');
  let nearbyShop = G.shops && G.shops.find(s => Math.abs(p.x - s.x) <= 1 && Math.abs(p.y - s.y) <= 1);
  
  if (nearbyShop) {
     let affordable = nearbyShop.stock.filter(usefulShopItem).sort((a, b) => shopItemScore(b) - shopItemScore(a));
     let bestItem = affordable[0];
                    
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
  
  const shouldUseStrengthBuff = () => {
      if ((p.strengthTurns || 0) > 0 || carriedBuffs().length === 0 || visEnemies.length === 0) return false;
      if (visEnemies.some(e => e.isElite || e.boss)) return true;
      if (adjEnemies.length >= 2 && totalIncomingMax() >= p.hp * 0.35) return true;
      return visEnemies.some(e => {
          let dist = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
          if (dist > 3) return false;
          let currentHits = Math.ceil(e.hp / maxNormalDamage(e));
          let buffedHits = Math.ceil(e.hp / maxStrengthDamage(e));
          let savesAttacks = currentHits >= 3 && buffedHits < currentHits;
          let dangerousHit = maxIncomingHit(e) >= Math.max(6, p.maxHp * 0.18) || e.atk >= p.hp * 0.25;
          return savesAttacks && (dangerousHit || G.floor >= 2 || p.hp < p.maxHp * 0.8);
      });
  };

  // Strength is worth using before durable ordinary fights, not only elites or bosses.
  if (!itemToUse && shouldUseStrengthBuff()) {
      itemToUse = carriedBuffs()[0];
  }
  // Detection scrolls reveal traps and secret rooms before blind exploration.
  if (!itemToUse && visEnemies.length === 0 && carriedDetects().length > 0 && hiddenSecretsRemain()) {
      itemToUse = carriedDetects()[0];
  }
  // Bomb dense melee packs, lethal adjacent clusters, or the boss once phase 2 pressure begins.
  let bombKills = adjEnemies.filter(e => e.hp <= 30).length;
  let adjacentBoss = adjEnemies.some(e => e.boss);
  let bombRemovesPressure = adjEnemies.some(e =>
      e.hp <= 30 &&
      (p.hp <= totalIncomingMax() + Math.max(6, p.maxHp * 0.08) ||
       p.hp < p.maxHp * 0.35 ||
       maxIncomingHit(e) >= p.hp * 0.45)
  );
  if (!itemToUse && carriedBombs().length > 0 &&
      (adjEnemies.length >= 3 ||
       bombKills >= 2 ||
       bombRemovesPressure ||
       (adjEnemies.length >= 2 && totalIncomingMax() >= p.hp * 0.65 && p.hp < p.maxHp * 0.6) ||
       (adjacentBoss && (bossPhase >= 2 || p.hp < p.maxHp * 0.7 || adjEnemies.length >= 2)))) {
      itemToUse = carriedBombs()[0];
  }
  // Teleport if surrounded and going to die without potions
  let lethalAdjacent = adjEnemies.some(e => maxIncomingHit(e) >= p.hp);
  let losingMelee = adjEnemies.length > 0 && p.hp <= totalIncomingMax() + Math.max(4, p.maxHp * 0.05);
  let criticallyExposed = p.hp < p.maxHp * 0.18 && (adjEnemies.length > 0 || visEnemies.length >= 2 || (G.floor >= 3 && visEnemies.length > 0));
  if (!itemToUse && carriedTeleports().length > 0 && potions.length === 0 &&
      (lethalAdjacent ||
       losingMelee ||
       criticallyExposed ||
       (adjEnemies.length >= 2 && p.hp <= totalIncomingMax() * 2) ||
       (adjacentBoss && bossPhase >= 2 && p.hp < p.maxHp * 0.55))) {
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
    let q = [{x: p.x, y: p.y}];
    let visited = new Set([`${p.x},${p.y}`]);
    let scanDirs = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];
    let carriedCount = G.items.filter(i => i.carried).length;

    while (q.length > 0) {
      let curr = q.shift();
      let key = curr.y * MAP_W + curr.x;
      let usefulReachableItem = G.items.some(i =>
        !i.carried && i.x === curr.x && i.y === curr.y && usefulFloorItem(i) &&
        (carriedCount < 12 || i.type === 'key' || i.type === 'upgrade')
      );
      let reachableEnemy = liveEnemies.some(e => e.x === curr.x && e.y === curr.y);
      let reachableShop = G.shops && G.shops.some(s => s.x === curr.x && s.y === curr.y && s.stock.some(usefulShopItem));
      let reachableUnseen = G.map[curr.y][curr.x] !== WALL && G.map[curr.y][curr.x] !== SECRET_DOOR && !G.seen.has(key);
      if (usefulReachableItem || reachableEnemy || reachableShop || reachableUnseen) return false;

      for (let d of scanDirs) {
        let nx = curr.x + d.dx, ny = curr.y + d.dy;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
        if (!isPassable(nx, ny, false, true)) continue;
        if (visited.has(`${nx},${ny}`)) continue;
        let isDyingEnemyTile = G.enemies.some(e => e.dying && e.x === nx && e.y === ny);
        if (isDyingEnemyTile) continue;
        visited.add(`${nx},${ny}`);
        q.push({x: nx, y: ny});
      }
    }
    return true;
  };
  const hasKnownStairs = () => {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === STAIRS && G.seen.has(y * MAP_W + x)) return true;
      }
    }
    return false;
  };
  const shouldExitWithoutPotion = () => p.hp < p.maxHp * strategy.exitHp && potions.length === 0;
  const shouldHeadForStairs = () => G.floor < FINAL_FLOOR && liveEnemies.length === 0 && hasKnownStairs() && (G.seen.size / (MAP_W * MAP_H)) >= strategy.exploreThreshold;
  const shouldAvoidVoluntaryCombat = () => G.floor >= 3 && potions.length === 0 && !hasKnownStairs() && adjEnemies.length === 0 && p.hp < p.maxHp * 0.45;

  if (G.map[p.y][p.x] === STAIRS && (isMapCleared() || shouldExitWithoutPotion() || shouldHeadForStairs() || G.won)) {
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
  const monkWallSlams = en => {
      let dx = Math.sign(en.x - p.x), dy = Math.sign(en.y - p.y);
      let nx = en.x + dx, ny = en.y + dy;
      return nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H ||
        G.map[ny][nx] === WALL ||
        G.enemies.some(e => e !== en && !e.dying && e.x === nx && e.y === ny);
  };
  const monkPushKickMaxDamage = en => maxNormalDamage(en) * (monkWallSlams(en) ? 2 : 1);
  const monkFlurryMaxDamage = en => maxNormalDamage(en) * 3;

  // CLASS ABILITIES (Phase 3)
  const ability2Decision = () => {
      if (G.ability2Cooldown !== 0 || p.lvl < 5) return null;
      if (p.class === 'warrior' && (totalIncomingMax() >= p.hp * 0.6 || (adjEnemies.length >= 2 && p.hp < p.maxHp * 0.9) || (adjacentBoss && bossPhase >= 2))) return { type: 'key', val: 'v' }; // SHIELD WALL
      if (p.class === 'rogue' && (adjEnemies.length >= 2 || (adjEnemies.length >= 1 && p.hp < p.maxHp * 0.65) || (visEnemies.length > 0 && (p.hp < p.maxHp * 0.45 || G.floor >= 5)) || (boss && bossPhase >= 2))) return { type: 'key', val: 'v' }; // VANISH
      if (p.class === 'mage' && (adjEnemies.length > 0 || p.hp < p.maxHp * 0.4) && visEnemies.length > 0) {
          let safeTiles = false;
          for(let y=1; y<MAP_H-1; y++) {
            for(let x=1; x<MAP_W-1; x++) {
              if(G.map[y][x] === FLOOR && !G.enemies.some(e=>e.x===x&&e.y===y) && G.seen.has(y*MAP_W+x)) safeTiles = true;
            }
          }
          if(safeTiles) return { type: 'key', val: 'v' }; // BLINK
      }
      if (p.class === 'paladin' && p.hp <= p.maxHp * 0.8) return { type: 'key', val: 'v' }; // HEAL
      if (p.class === 'ranger' && adjEnemies.length > 0) {
          let safeAdj = false;
          let dirs = [[0,-1],[0,1],[-1,0],[1,0]];
          for(let d of dirs) {
            let nx = p.x + d[0], ny = p.y + d[1];
            if(G.map[ny] && G.map[ny][nx] === FLOOR && !G.enemies.some(e=>e.x===nx&&e.y===ny)) safeAdj = true;
          }
          if(safeAdj) return { type: 'key', val: 'v' }; // BEAR TRAP
      }
      if (p.class === 'barbarian' && ((adjEnemies.length >= 2 || p.hp < p.maxHp * 0.5) || boss) && visEnemies.length > 0 && (p.bloodlustTurns || 0) === 0) return { type: 'key', val: 'v' }; // BLOODLUST
      if (p.class === 'necromancer') {
         let markTargets = visEnemies.filter(e => !e.boss && !e.raiseCorpseTarget);
         if (markTargets.length >= 1 && (visEnemies.length >= 2 || boss)) return { type: 'key', val: 'v' }; // RAISE DEAD
      }
      if (p.class === 'monk' && adjEnemies.length > 0) {
          let flurryKill = adjEnemies.some(e =>
            e.hp <= monkFlurryMaxDamage(e) &&
            (p.hp < p.maxHp * 0.6 || maxIncomingHit(e) >= p.hp * 0.35)
          );
          if (p.hp > p.maxHp * 0.75 || adjEnemies.length >= 2 || flurryKill) return { type: 'key', val: 'v' }; // FLURRY
      }
      return null;
  };
  
  let a2First = ability2Decision();
  if (a2First && ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'].includes(p.class)) return a2First;

  if (G.ability1Cooldown === 0 && !shouldAvoidVoluntaryCombat()) {
      if (p.class === 'warrior' && adjEnemies.length > 0) {
         let target = adjEnemies.find(e => e.hp <= minBashDamage(e)) || adjEnemies[0];
         if (target) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'rogue') {
         let knownThreats = visEnemies.length ? visEnemies : liveEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 3);
         let hasKillableAdjacent = adjEnemies.some(e => e.hp <= maxNormalDamage(e) || e.hp <= minSneakDamage(e));
         let dashTarget = null;
         if ((p.vanishTurns || 0) === 0 && !adjEnemies.length && p.hp > p.maxHp * 0.6 && knownThreats.length === 1) dashTarget = knownThreats[0];
         else if ((p.vanishTurns || 0) === 0 && !hasKillableAdjacent && adjEnemies.length === 1 && p.hp < p.maxHp * 0.7 && p.hp > p.maxHp * 0.4) dashTarget = adjEnemies[0];
         else if ((p.vanishTurns || 0) === 0 && !hasKillableAdjacent && adjEnemies.length >= 2 && p.hp > p.maxHp * 0.45) dashTarget = adjEnemies[0];
         if (dashTarget) return { type: 'key', val: 'b' };
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
        if (target) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'monk' && adjEnemies.length > 0) {
         let target = adjEnemies.sort((a, b) => monkPushKickMaxDamage(b) - monkPushKickMaxDamage(a))[0];
         if (target && target.hp > minSneakDamage(target)) return { type: 'key', val: 'b' };
      } 
  }

  // RANGED ATTACK
  const rangedAttack = () => {
      if (shouldAvoidVoluntaryCombat()) return null;
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
      if (adjEnemies.length > 0 && totalIncomingMax() >= p.hp) {
          if (p.class === 'rogue' && potions.length === 0 && !hasKnownStairs()) return false;
          return true;
      }
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
        
        let leavingFloor = shouldExitWithoutPotion() || shouldHeadForStairs();
        
        let validTarget = false;
        let label = '';
        
        if (targetStairsOnly || leavingFloor) {
             if (!targetStairsOnly && isShopTarget) { validTarget = true; label = 'path to shop'; }
             else if (isStairs) { validTarget = true; label = 'path to stairs'; }
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
  if (G.map[p.y][p.x] === STAIRS && (isMapCleared() || shouldExitWithoutPotion() || shouldHeadForStairs() || G.won)) {
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
