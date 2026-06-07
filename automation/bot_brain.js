// automation/bot_brain.js
// This file is injected into the browser by the Puppeteer runner.
// The agent modifies this file to improve the bot's decision making based on lessons learned.
// The function must return null (stuck), {type: 'status', val: 'dead'/'won'}, {type: 'click', target: selector}, or {type: 'key', val: keyString}.

function getClassStrategy(className) {
  const base = {
    exitHp: 0.7,
    combatHpFloor: 0.45,
    combatPotionFloor: 0.42,
    exploreThreshold: 0.35,
    trapHpThreshold: 0.5,
    goldReserve: 60,
    potionTarget: 3,
    buffTarget: 1,
    teleportTarget: 1,
    bombTarget: 1,
    detectionTarget: 1,
    bloodHpThreshold: 0.7,
    bloodMinRemainingHp: 16,
    greedGoldCap: 220,
    cursedHpThreshold: 0.35,
    weaponBias: 1,
    armorBias: 1,
    buffAggression: 1,
    secondaryWeights: {
      perception: 1,
      vampirism: 1,
      regen: 1,
      swiftness: 1,
      goldBonus: 1,
      xpMult: 1,
      critChance: 1,
      dodgeBonus: 1,
    },
    upgradeWeights: {
      atk: 1,
      def: 1,
      hp: 1,
      all: 1,
      all5: 1,
      vamp: 1,
      regen: 1,
      swift: 1,
      perception: 1,
      crit: 1,
      dodge: 1,
      goldBonus: 1,
      xpMult: 1,
      magicMult: 1,
    },
  };

  // External config override (set by headless runner or browser)
  const cfg = (typeof window !== 'undefined' && window.STRATEGY_CONFIG) || {};
  if (cfg[className]) {
    return { ...base, ...cfg[className] };
  }

  switch (className) {
    case 'warrior':
      return {
        ...base,
        exitHp: 0.58,
        combatHpFloor: 0.48,
        combatPotionFloor: 0.45,
        exploreThreshold: 0.35,
        trapHpThreshold: 0.55,
        goldReserve: 55,
        potionTarget: 4,
        teleportTarget: 2,
        detectionTarget: 0,
        bloodHpThreshold: 0.7,
        bloodMinRemainingHp: 18,
        greedGoldCap: 220,
        cursedHpThreshold: 0.3,
        weaponBias: 1.5,
        armorBias: 1.45,
        buffAggression: 1.6,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 0.8,
          vampirism: 1.15,
          regen: 1.1,
          swiftness: 0.8,
          goldBonus: 0.9,
          xpMult: 0.85,
          critChance: 1.15,
          dodgeBonus: 0.8,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.35,
          def: 1.3,
          hp: 1.3,
          all: 1.3,
          all5: 1.3,
          vamp: 1.1,
          regen: 1.05,
          swift: 0.8,
          perception: 0.8,
          crit: 1.05,
          dodge: 0.85,
          goldBonus: 0.9,
          xpMult: 0.85,
        },
      };
    case 'rogue':
      return {
        ...base,
        exitHp: 0.60,
        combatHpFloor: 0.48,
        combatPotionFloor: 0.42,
        exploreThreshold: 0.30,
        trapHpThreshold: 0.55,
        goldReserve: 50,
        potionTarget: 4,
        teleportTarget: 2,
        detectionTarget: 1,
        bloodHpThreshold: 0.78,
        bloodMinRemainingHp: 16,
        greedGoldCap: 190,
        cursedHpThreshold: 0.4,
        weaponBias: 1.35,
        armorBias: 1.2,
        buffAggression: 0.95,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 0.95,
          vampirism: 1,
          regen: 0.9,
          swiftness: 1.15,
          goldBonus: 0.9,
          xpMult: 0.95,
          critChance: 1.35,
          dodgeBonus: 1.45,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.4,
          def: 0.95,
          hp: 1.0,
          all: 1,
          all5: 1,
          vamp: 1,
          regen: 0.9,
          swift: 1.15,
          perception: 1.2,
          crit: 1.4,
          dodge: 1.45,
          goldBonus: 0.95,
          xpMult: 0.95,
        },
      };
    case 'mage':
      return {
        ...base,
        exitHp: 0.68,
        combatHpFloor: 0.58,
        combatPotionFloor: 0.52,
        exploreThreshold: 0.32,
        trapHpThreshold: 0.65,
        goldReserve: 60,
        potionTarget: 3,
        teleportTarget: 3,
        detectionTarget: 1,
        bloodHpThreshold: 0.82,
        bloodMinRemainingHp: 14,
        greedGoldCap: 160,
        cursedHpThreshold: 0.45,
        weaponBias: 1.55,
        armorBias: 1.4,
        buffAggression: 1.1,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 1,
          vampirism: 1.15,
          regen: 1.35,
          swiftness: 1,
          goldBonus: 0.8,
          xpMult: 0.95,
          critChance: 0.9,
          dodgeBonus: 0.9,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1,
          def: 1.25,
          hp: 1.3,
          all: 1,
          all5: 1,
          vamp: 1.15,
          regen: 1.4,
          swift: 1,
          perception: 1.1,
          crit: 0.9,
          dodge: 0.9,
          goldBonus: 0.8,
          xpMult: 1,
        },
      };
    case 'paladin':
      return {
        ...base,
        exitHp: 0.60,
        combatHpFloor: 0.48,
        combatPotionFloor: 0.40,
        exploreThreshold: 0.35,
        trapHpThreshold: 0.6,
        goldReserve: 60,
        potionTarget: 3,
        teleportTarget: 2,
        detectionTarget: 0,
        bloodHpThreshold: 0.68,
        bloodMinRemainingHp: 18,
        greedGoldCap: 180,
        cursedHpThreshold: 0.28,
        weaponBias: 1.5,
        armorBias: 1.7,
        buffAggression: 1,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 0.85,
          vampirism: 1,
          regen: 1.15,
          swiftness: 0.8,
          goldBonus: 0.9,
          xpMult: 0.9,
          critChance: 0.9,
          dodgeBonus: 0.9,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.25,
          def: 1.15,
          hp: 1.3,
          all: 1.35,
          all5: 1.35,
          vamp: 1,
          regen: 1.15,
          swift: 0.8,
          perception: 0.8,
          crit: 0.9,
          dodge: 0.9,
          goldBonus: 0.9,
          xpMult: 0.9,
        },
      };
    case 'ranger':
      return {
        ...base,
        exitHp: 0.55,
        combatHpFloor: 0.42,
        combatPotionFloor: 0.38,
        exploreThreshold: 0.30,
        trapHpThreshold: 0.60,
        goldReserve: 55,
        potionTarget: 3,
        buffTarget: 1,
        teleportTarget: 2,
        detectionTarget: 1,
        bloodHpThreshold: 0.76,
        bloodMinRemainingHp: 16,
        greedGoldCap: 210,
        cursedHpThreshold: 0.35,
        weaponBias: 1.4,
        armorBias: 1.25,
        buffAggression: 0.9,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 1.45,
          vampirism: 0.9,
          regen: 0.9,
          swiftness: 1.3,
          goldBonus: 0.9,
          xpMult: 1,
          critChance: 1.15,
          dodgeBonus: 1.2,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.35,
          def: 0.75,
          hp: 1,
          all: 1,
          all5: 1,
          vamp: 0.9,
          regen: 0.9,
          swift: 1.35,
          perception: 1.45,
          crit: 1.1,
          dodge: 1.2,
          goldBonus: 0.9,
          xpMult: 1,
        },
      };
    case 'barbarian':
      return {
        ...base,
        exitHp: 0.55,
        combatHpFloor: 0.50,
        combatPotionFloor: 0.45,
        exploreThreshold: 0.30,
        trapHpThreshold: 0.55,
        goldReserve: 45,
        potionTarget: 3,
        detectionTarget: 0,
        bloodHpThreshold: 0.62,
        bloodMinRemainingHp: 18,
        greedGoldCap: 160,
        cursedHpThreshold: 0.3,
        weaponBias: 1.45,
        armorBias: 1.25,
        buffAggression: 1.2,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 0.8,
          vampirism: 1.2,
          regen: 0.9,
          swiftness: 0.8,
          goldBonus: 0.85,
          xpMult: 0.85,
          critChance: 1.35,
          dodgeBonus: 0.8,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.35,
          def: 1.15,
          hp: 1.35,
          all: 1.1,
          all5: 1.1,
          vamp: 1.3,
          regen: 0.9,
          swift: 0.8,
          perception: 0.8,
          crit: 1.35,
          dodge: 0.8,
          goldBonus: 0.85,
          xpMult: 0.85,
        },
      };
    case 'necromancer':
      return {
        ...base,
        exitHp: 0.62,
        combatHpFloor: 0.52,
        combatPotionFloor: 0.45,
        exploreThreshold: 0.30,
        trapHpThreshold: 0.65,
        goldReserve: 55,
        potionTarget: 4,
        detectionTarget: 1,
        bloodHpThreshold: 0.82,
        bloodMinRemainingHp: 14,
        greedGoldCap: 160,
        cursedHpThreshold: 0.4,
        weaponBias: 1.5,
        armorBias: 1.5,
        buffAggression: 0.9,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 0.9,
          vampirism: 1.45,
          regen: 1.35,
          swiftness: 0.9,
          goldBonus: 0.85,
          xpMult: 0.95,
          critChance: 0.9,
          dodgeBonus: 0.85,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.05,
          def: 1.5,
          hp: 1.4,
          all: 1,
          all5: 1,
          vamp: 1.5,
          regen: 1.35,
          swift: 0.9,
          perception: 1,
          crit: 0.9,
          dodge: 0.85,
          goldBonus: 0.85,
          xpMult: 0.95,
        },
      };
    case 'monk':
      return {
        ...base,
        exitHp: 0.55,
        combatHpFloor: 0.45,
        combatPotionFloor: 0.40,
        exploreThreshold: 0.35,
        trapHpThreshold: 0.60,
        goldReserve: 55,
        potionTarget: 3,
        weaponBias: 1.5,
        armorBias: 1.35,
        secondaryWeights: {
          ...base.secondaryWeights,
          perception: 1.25,
          vampirism: 0.9,
          regen: 1,
          swiftness: 1.4,
          goldBonus: 0.9,
          xpMult: 0.9,
          critChance: 1,
          dodgeBonus: 1.35,
        },
        upgradeWeights: {
          ...base.upgradeWeights,
          atk: 1.25,
          def: 1.1,
          hp: 1.25,
          all: 1,
          all5: 1,
          vamp: 1.15,
          regen: 1.1,
          swift: 1.45,
          perception: 1.25,
          crit: 1,
          dodge: 1.35,
          goldBonus: 0.9,
          xpMult: 0.9,
        },
      };
    default:
      break;
  }
  return base;
}

function getUpgradeBaseScore(item) {
  const amount = Number(item && item.amount) || 0;
  switch (item && item.stat) {
    case 'atk': return 30 + amount * 15;
    case 'def': return 30 + amount * 15;
    case 'hp': return 24 + amount * 3.5;
    case 'all': return 95;
    case 'all5': return 190;
    case 'vamp': return 60 + amount * 20;
    case 'regen': return 55 + amount * 18;
    case 'swift': return 50 + amount * 20;
    case 'perception': return 42 + amount * 18;
    case 'crit': return 45 + amount * 600;
    case 'dodge': return 45 + amount * 600;
    case 'goldBonus': return 30 + amount * 5;
    case 'xpMult': return 30 + amount * 120;
    default: return 25 + amount * 10;
  }
}

function shouldAcceptShrineType(p, G, shrineType) {
  if (!p || !shrineType) return false;
  const type = String(shrineType).toLowerCase();
  const className = p.class || '';
  const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
  const hasEscapeItem = (G.items || []).some(i => i.carried && (i.type === 'scroll_teleport' || i.type === 'bomb'));
  const hasEmergencyAbility =
    (p.lvl >= 5 && G.ability2Cooldown === 0 && ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian'].includes(className)) ||
    (p.lvl >= 5 && G.ability1Cooldown === 0 && ['necromancer', 'monk'].includes(className));
  const canRiskCursed = hasEscapeItem || hasEmergencyAbility;

  if (type === 'blood') {
    const minHpRatio =
      className === 'barbarian' ? 0.65 :
      className === 'warrior' || className === 'paladin' ? 0.7 :
      className === 'rogue' || className === 'ranger' ? 0.76 :
      className === 'mage' || className === 'necromancer' ? 0.82 :
      className === 'monk' ? 0.74 : 0.72;
    const minRemaining = className === 'barbarian' ? 24 : (className === 'warrior' || className === 'paladin' ? 22 : 18);
    const cost = Math.max(1, Math.floor(p.maxHp * 0.3));
    return hpRatio >= minHpRatio && (p.maxHp - cost) >= minRemaining;
  }

  if (type === 'greed') {
    const goldCap =
      className === 'warrior' || className === 'paladin' || className === 'barbarian' ? 350 :
      className === 'rogue' || className === 'ranger' || className === 'monk' ? 275 :
      250;
    return p.gold <= goldCap || (G.floor >= 4 && p.lvl < 8) || (G.floor >= 3 && p.lvl < 6 && p.gold <= goldCap + 40);
  }

  if (type === 'cursed') {
    const hpFloor =
      className === 'mage' || className === 'necromancer' ? 0.4 :
      className === 'rogue' || className === 'ranger' ? 0.35 :
      className === 'warrior' || className === 'paladin' ? 0.38 :
      className === 'barbarian' ? 0.3 :
      0.34;
    return hpRatio < hpFloor && canRiskCursed;
  }

  return false;
}

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
    if (title.includes('blood')) accept = shouldAcceptShrineType(p, G, 'blood');
    else if (title.includes('greed')) accept = shouldAcceptShrineType(p, G, 'greed');
    else if (title.includes('cursed')) accept = shouldAcceptShrineType(p, G, 'cursed');
    
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

  // MULTI-STEP PLANNING: Override decisions in extreme danger
  // Only fires when: HP <= 15%, 2+ adjacent enemies, no potions, no known stairs
  const p_check = G.player;
  const adjEnemyCount = G.enemies.filter(e => !e.dying && !e.isPet && Math.abs(e.x - p_check.x) + Math.abs(e.y - p_check.y) === 1).length;
  const potionCount = G.items.filter(i => i.carried && i.type === 'potion').length;
  const hasStairs = (() => {
    for (let y = 0; y < (G.map ? G.map.length : 36); y++) {
      for (let x = 0; x < (G.map && G.map[0] ? G.map[0].length : 56); x++) {
        if (G.map[y][x] === 2 && G.seen && G.seen.has(y * (G.map && G.map[0] ? G.map[0].length : 56) + x)) return true;
      }
    }
    return false;
  })();
  
  if (p_check.hp <= p_check.maxHp * 0.15 && adjEnemyCount >= 2 && potionCount === 0 && !hasStairs) {
    // Extreme danger: no potions, no stairs, surrounded
    // Prefer teleport if available
    if (G.items.some(i => i.carried && i.type === 'scroll_teleport')) {
      return { type: 'key', val: 'i', label: 'plan: teleport' };
    }
    // If no teleport, try bomb
    if (G.items.some(i => i.carried && i.type === 'bomb')) {
      return { type: 'key', val: 'i', label: 'plan: bomb' };
    }
  }

  const MAP_H = G.map ? G.map.length : 36;
  const MAP_W = G.map && G.map[0] ? G.map[0].length : 56;
  const FINAL_FLOOR = typeof FLOORS !== 'undefined' ? FLOORS : 5;
  const onBossFloor = G.floor >= FINAL_FLOOR;
  const WALL = 0, FLOOR = 1, STAIRS = 2, SHOP = 3, LOCKED_DOOR = 4, SECRET_DOOR = 5;
  const p = G.player;
  const hasKey = () => G.items.some(i => i.carried && i.type === 'key');

  const DEFAULT_STRATEGY = {
    exitHp: 0.7,
    combatHpFloor: 0.45,
    exploreThreshold: 0.35,
    trapHpThreshold: 0.5,
    goldReserve: 60,
    potionTarget: 1,
    buffTarget: 1,
    teleportTarget: 1,
    bombTarget: 1,
    detectTarget: 0,
    bloodHpThreshold: 0.7,
    bloodMinRemainingHp: 16,
    greedGoldCap: 220,
    cursedHpThreshold: 0.35,
    weaponBias: 1,
    armorBias: 1,
    buffAggression: 1,
    secondaryWeights: {
      perception: 1,
      vampirism: 1,
      regen: 1,
      swiftness: 1,
      goldBonus: 1,
      xpMult: 1,
      critChance: 1,
      dodgeBonus: 1,
    },
    upgradeWeights: {
      atk: 1,
      def: 1,
      hp: 1,
      all: 1,
      all5: 1,
      vamp: 1,
      regen: 1,
      swift: 1,
      perception: 1,
      crit: 1,
      dodge: 1,
      goldBonus: 1,
      xpMult: 1,
      magicMult: 1,
    },
  };
  const strategy = getClassStrategy(p.class);
  strategy.detectionTarget = strategy.detectionTarget ?? strategy.detectTarget ?? 0;
  strategy.detectTarget = strategy.detectTarget ?? strategy.detectionTarget ?? 0;

  const carriedCount = predicate => G.items.filter(i => i.carried && predicate(i)).length;
  const consumableCount = type => {
    if (type === 'potion') return carriedCount(i => i.type === 'potion');
    if (type === 'buff') return carriedCount(i => i.type === 'potion_buff');
    if (type === 'teleport') return carriedCount(i => i.type === 'scroll_teleport' || /teleport/i.test(i.name || ''));
    if (type === 'bomb') return carriedCount(i => i.type === 'bomb');
    if (type === 'scroll') return carriedCount(i => i.type === 'scroll' && /detection/i.test(i.name || ''));
    return 0;
  };
  const targetCount = type => {
    if (type === 'scroll') return Math.max(0, strategy.detectionTarget ?? strategy.detectTarget ?? 0);
    return Math.max(0, strategy[`${type}Target`] ?? 1);
  };
  const needsConsumable = type => consumableCount(type) < targetCount(type);
  const reserveGold = () => strategy.goldReserve + (G.floor >= 4 ? 20 : 0);

  const isDangerousTrap = (x, y) => {
    if (p.hp > p.maxHp * strategy.trapHpThreshold) return false;
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
    const w = strategy.secondaryWeights || {};
    return (item.perception || 0) * 4 * (w.perception || 1) +
      (item.vampirism || 0) * 8 * (w.vampirism || 1) +
      (item.regen || 0) * 7 * (w.regen || 1) +
      (item.swiftness || 0) * 6 * (w.swiftness || 1) +
      (item.goldBonus || 0) * 0.5 * (w.goldBonus || 1) +
      (item.xpMult || 0) * 20 * (w.xpMult || 1) +
      (item.critChance || 0) * 60 * (w.critChance || 1) +
      (item.dodgeBonus || 0) * 60 * (w.dodgeBonus || 1);
  };
  const weaponValue = item => weaponPower(item) * 10 * (strategy.weaponBias || 1) + secondaryScore(item);
  const armorValue = item => armorPower(item) * 10 * (strategy.armorBias || 1) + secondaryScore(item);
  
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
  const combatPotionFloor = strategy.combatPotionFloor ?? strategy.combatHpFloor;
  const panicFloor = 0.3; // All classes enter panic at 30% HP
  const panicMode = p.hp <= p.maxHp * Math.min(combatPotionFloor, panicFloor);
  const desperateRecovery = panicMode && carriedPotions().length === 0;

  const shouldUseStrengthBuff = () => {
      if ((p.strengthTurns || 0) > 0 || carriedBuffs().length === 0 || visEnemies.length === 0) return false;
      if (visEnemies.some(e => e.isElite || e.boss)) return true;
      if (adjEnemies.length >= 2 && totalIncomingMax() >= p.hp * 0.35) return true;
      const meleeClass = ['warrior', 'paladin', 'barbarian', 'monk'].includes(p.class);
      const baseNeededHits = meleeClass ? 2 : 3;
      const neededHits = Math.max(1, Math.round(baseNeededHits / (strategy.buffAggression || 1)));
      return visEnemies.some(e => {
          let dist = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
          if (dist > 3) return false;
          let currentHits = Math.ceil(e.hp / maxNormalDamage(e));
          let buffedHits = Math.ceil(e.hp / maxStrengthDamage(e));
          let savesAttacks = currentHits >= neededHits && buffedHits < currentHits;
          let dangerousHit = maxIncomingHit(e) >= Math.max(6, p.maxHp * 0.18) || e.atk >= p.hp * 0.25;
          let lowHp = p.hp < p.maxHp * (meleeClass ? 0.9 : 0.8);
          return savesAttacks && (dangerousHit || G.floor >= 2 || lowHp);
      });
  };

  // Strategy Tuning
  const bestPotionHeal = () => {
    const potions = carriedPotions();
    return potions.length ? (potions[0].heal || 0) : 0;
  };
  const wantsMorePotions = item => item.type === 'potion' && (carriedPotions().length < strategy.potionTarget || (item.heal || 0) > bestPotionHeal());
  const wantsMoreBuffs = item => item.type === 'potion_buff' && carriedBuffs().length < strategy.buffTarget;
  const wantsMoreTeleports = item => item.type === 'scroll_teleport' && carriedTeleports().length < strategy.teleportTarget;
  const wantsMoreBombs = item => item.type === 'bomb' && carriedBombs().length < strategy.bombTarget;
  const wantsMoreDetects = item => item.type === 'scroll' && /detection/i.test(item.name || '') && hiddenSecretsRemain() && carriedDetects().length < strategy.detectionTarget;
  const upgradeBaseScore = item => getUpgradeBaseScore(item) * (strategy.upgradeWeights[item.stat] || 1);
  const needPotionStock = carriedPotions().length < strategy.potionTarget;
  const needBuffStock = carriedBuffs().length < strategy.buffTarget;
  const needTeleportStock = carriedTeleports().length < strategy.teleportTarget;
  const needBombStock = carriedBombs().length < strategy.bombTarget;
  const criticalRecovery = p.hp < p.maxHp * strategy.exitHp || p.hp <= totalIncomingMax();
  const shouldSpendGoldOn = item => {
    if (item.type === 'potion') return criticalRecovery || carriedPotions().length < strategy.potionTarget;
    if (item.type === 'potion_buff') return carriedBuffs().length < strategy.buffTarget && visEnemies.length === 0;
    if (item.type === 'scroll_teleport') return criticalRecovery || carriedTeleports().length < strategy.teleportTarget;
    if (item.type === 'bomb') return carriedBombs().length < strategy.bombTarget || (visEnemies.length > 0 && adjEnemies.length >= 2);
    if (item.type === 'scroll') return wantsMoreDetects(item);
    if (item.type === 'upgrade') return !criticalRecovery && upgradeBaseScore(item) >= 110;
    if (item.type === 'weapon') return !criticalRecovery && weaponValue(item) - weaponValue(p.weapon) >= 8;
    if (item.type === 'armor') return !criticalRecovery && armorValue(item) - armorValue(p.armor) >= 8;
    return false;
  };

  // ECONOMY & ITEMS
  const usefulShopItem = item => {
    if (item.sold || p.gold < item.price) return false;
    if (shouldUseStrengthBuff()) return false;
    if (p.gold - item.price < reserveGold() && !shouldSpendGoldOn(item)) return false;
    if (item.type === 'upgrade') return upgradeBaseScore(item) > 0;
    if ((item.type === 'weapon' || item.type === 'armor') && !canEquip(item)) return false;
    if (item.type === 'weapon') return weaponValue(item) > weaponValue(p.weapon);
    if (item.type === 'armor') return armorValue(item) > armorValue(p.armor);
    if (item.type === 'potion') return wantsMorePotions(item) || p.hp < p.maxHp * strategy.exitHp;
    if (item.type === 'potion_buff') return wantsMoreBuffs(item) && visEnemies.length === 0;
    if (item.type === 'bomb') return wantsMoreBombs(item) || (visEnemies.length > 0 && adjEnemies.length >= 2);
    if (item.type === 'scroll_teleport') return wantsMoreTeleports(item) || p.hp < p.maxHp * strategy.exitHp;
    if (item.type === 'scroll') return wantsMoreDetects(item);
    return false;
  };
  const usefulFloorItem = item => {
    if (item.type === 'potion') return wantsMorePotions(item);
    if (item.type === 'potion_buff') return wantsMoreBuffs(item);
    if (item.type === 'bomb') return wantsMoreBombs(item);
    if (item.type === 'scroll_teleport') return wantsMoreTeleports(item);
    if (item.type === 'scroll') return wantsMoreDetects(item);
    if (item.type === 'upgrade' || item.type === 'key') return true;
    if (item.type === 'weapon') return canEquip(item) && weaponValue(item) > weaponValue(p.weapon);
    if (item.type === 'armor') return canEquip(item) && armorValue(item) > armorValue(p.armor);
    if (item.type === 'shrine' && !item.used) return shouldAcceptShrineType(p, G, item.shrineType || '');
    return false;
  };

  const shopItemScore = item => {
    if (item.type === 'upgrade') {
      return (criticalRecovery ? 520 : 800) + upgradeBaseScore(item);
    }
    if (item.type === 'weapon') return (criticalRecovery ? 500 : 650) + (weaponValue(item) - weaponValue(p.weapon));
    if (item.type === 'armor') return (criticalRecovery ? 480 : 620) + (armorValue(item) - armorValue(p.armor));
    if (item.type === 'potion') {
      let needHealing = criticalRecovery || needPotionStock;
      return (needHealing ? 1100 : 240) + (item.heal || 0) * 5 + ((p.class === 'mage' || p.class === 'necromancer') ? 30 : 0);
    }
    if (item.type === 'scroll_teleport') return ((criticalRecovery || needTeleportStock) ? 1000 : 380) + (needTeleportStock ? 80 : 0) + (G.floor >= 4 ? 50 : 0) + (['mage', 'rogue', 'ranger', 'necromancer', 'paladin'].includes(p.class) ? 40 : 20);
    if (item.type === 'bomb') return ((criticalRecovery || needBombStock) ? 920 : 360) + (needBombStock ? 60 : 0) + (G.floor >= 4 ? 50 : 0) + (['warrior', 'barbarian', 'monk'].includes(p.class) ? 40 : 20);
    if (item.type === 'potion_buff') return ((criticalRecovery || needBuffStock) ? 840 : 330) + (needBuffStock ? 40 : 0) + (G.floor >= 4 ? 50 : 0) + (['warrior', 'barbarian', 'paladin'].includes(p.class) ? 40 : (['rogue', 'monk'].includes(p.class) ? 20 : 10));
    if (item.type === 'scroll') return (wantsMoreDetects(item) ? 600 : 260) + (hiddenSecretsRemain() ? 80 : 0) + (['ranger', 'rogue', 'monk'].includes(p.class) ? 20 : 0);
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

  // SMART HEALING & BUFFS - Heal in combat, avoid when enemies are distant (unless critical)
  let bagOpen = document.getElementById('inv-drawer').classList.contains('open');
  let potions = carriedPotions();
  let bestPotion = null;
  
  if (visEnemies.length === 0) {
      // Out of combat: heal when below 60% to be ready for next fight
      if (p.hp < p.maxHp * 0.60 && potions.length > 0) {
          // Use smallest potion that covers at least half the deficit (avoid waste)
          let deficit = p.maxHp - p.hp;
          bestPotion = potions.find(pot => pot.heal >= deficit * 0.5) || potions[0];
      }
  } else if (adjEnemies.length > 0) {
      // In melee combat: heal earlier to prevent death spiral
      let combatHealThreshold = Math.max(strategy.combatHpFloor, 0.6); // At least 60%
      if (p.hp <= p.maxHp * combatHealThreshold && potions.length > 0) {
          bestPotion = potions[0]; // Use best potion for maximum safety
      } else if (p.hp <= totalIncomingMax() && potions.length > 0) {
          // Emergency: incoming damage will kill us
          bestPotion = potions[0];
      }
  } else {
      // Enemies visible but not adjacent: heal if hurt to prepare for engagement
      if (p.hp < p.maxHp * 0.5 && potions.length > 0) {
          bestPotion = potions[0]; // Use best potion before entering combat
      } else if (p.hp <= p.maxHp * (strategy.combatPotionFloor ?? strategy.combatHpFloor) && potions.length > 0) {
          bestPotion = potions[0];
      }
  }

  let itemToUse = bestPotion;

  // Strength is worth using before durable ordinary fights, not only elites or bosses.
  if (!itemToUse && shouldUseStrengthBuff()) {
      itemToUse = carriedBuffs()[0];
  }
  // Detection scrolls reveal traps and secret rooms before blind exploration.
  if (!itemToUse && visEnemies.length === 0 && carriedDetects().length > 0 && hiddenSecretsRemain()) {
      itemToUse = carriedDetects()[0];
  }
  // BOMB: Use aggressively when in danger - bombs save lives
  let bombKills = adjEnemies.filter(e => e.hp <= 30).length;
  let adjacentBoss = adjEnemies.some(e => e.boss);
  let panicBomb = panicMode && adjEnemies.length >= 2;
  let bombRemovesPressure = adjEnemies.some(e =>
      e.hp <= 30 &&
      (p.hp <= totalIncomingMax() + Math.max(6, p.maxHp * 0.08) ||
       p.hp < p.maxHp * 0.45 ||
       maxIncomingHit(e) >= p.hp * 0.45)
  );
  let overwhelmed = adjEnemies.length >= 3 && p.hp < p.maxHp * 0.7;
  let lethalPack = adjEnemies.length >= 2 && totalIncomingMax() >= p.hp * 0.6 && p.hp < p.maxHp * 0.6;
  let desperateBomb = p.hp < p.maxHp * 0.35 && adjEnemies.length >= 2 && potions.length === 0;
  
  if (!itemToUse && carriedBombs().length > 0 &&
      (adjEnemies.length >= 2 ||
       bombKills >= 1 ||
       bombRemovesPressure ||
       panicBomb ||
       overwhelmed ||
       lethalPack ||
       desperateBomb ||
       (adjacentBoss && (bossPhase >= 2 || p.hp < p.maxHp * 0.7)))) {
      itemToUse = carriedBombs()[0];
  }
  // TELEPORT: Use more aggressively when in danger
  let lethalAdjacent = adjEnemies.some(e => maxIncomingHit(e) >= p.hp);
  let losingMelee = adjEnemies.length > 0 && p.hp <= totalIncomingMax() + Math.max(4, p.maxHp * 0.05);
  let criticallyExposed = p.hp < p.maxHp * 0.18 && (adjEnemies.length > 0 || visEnemies.length >= 2 || (G.floor >= 3 && visEnemies.length > 0));
  let bossOverwhelmed = adjacentBoss && (bossPhase >= 2 || p.hp < p.maxHp * 0.55 || adjEnemies.length >= 2);
  let belowCombatFloor = visEnemies.length > 0 && p.hp <= p.maxHp * (strategy.combatPotionFloor ?? strategy.combatHpFloor);
  
  if (!itemToUse && carriedTeleports().length > 0 && potions.length === 0 &&
      (belowCombatFloor ||
       lethalAdjacent ||
       losingMelee ||
       criticallyExposed ||
       bossOverwhelmed ||
       (adjEnemies.length >= 2 && p.hp <= totalIncomingMax() * 2) ||
       (p.hp < p.maxHp * 0.25 && visEnemies.length >= 3))) {
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
  const _stairCache = { floor: -1, known: false, pos: null };
  const hasKnownStairs = () => {
    if (_stairCache.floor === G.floor) return _stairCache.known;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === STAIRS && G.seen.has(y * MAP_W + x)) {
          _stairCache.floor = G.floor; _stairCache.known = true; _stairCache.pos = {x, y};
          return true;
        }
      }
    }
    _stairCache.floor = G.floor; _stairCache.known = false; _stairCache.pos = null;
    return false;
  };
  const knownStairsPosition = () => {
    if (_stairCache.floor === G.floor) return _stairCache.pos;
    hasKnownStairs();
    return _stairCache.pos;
  };
  const shouldExitWithoutPotion = () => p.hp < p.maxHp * strategy.exitHp && potions.length === 0;
  const shouldHeadForStairs = () => {
    if (G.floor >= FINAL_FLOOR || !hasKnownStairs()) return false;
    if (G.floor >= FINAL_FLOOR - 1) return true;
    // Only block stair descent when enemies are CLOSE (adjacent or 1 tile away), not just visible
    let closeEnemies = visEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 2);
    if (closeEnemies.length > 0 && !shouldExitWithoutPotion()) return false;
    
    const exploredRatio = G.seen.size / (MAP_W * MAP_H);
    const hpRatio = p.hp / p.maxHp;
    
    // Head to stairs if explored enough OR if HP is getting low
    if (exploredRatio >= strategy.exploreThreshold) return true;
    if (hpRatio < 0.5 && exploredRatio >= 0.2) return true;
    if (hpRatio < 0.35 && exploredRatio >= 0.1) return true;
    
    return false;
  };
  const shouldAvoidVoluntaryCombat = () => {
    if (G.floor < 2 || adjEnemies.length > 0) return false;
    // If stairs are known and should head there, skip fights
    if (hasKnownStairs() && shouldHeadForStairs()) return true;
    const hpThreshold = hasKnownStairs() ? strategy.exitHp : strategy.combatHpFloor;
    return p.hp < p.maxHp * hpThreshold;
  };
  const shouldRecover = () => G.floor >= 2 && adjEnemies.length === 0 && p.hp < p.maxHp * strategy.combatHpFloor;

  // BOSS FLOOR SPECIAL LOGIC
  if (onBossFloor) {
    // Boss floor: use strength buffs before engaging if boss is visible and we're healthy
    if (!itemToUse && carriedBuffs().length > 0 && boss && (p.strengthTurns || 0) === 0 &&
        p.hp > p.maxHp * 0.5 && Math.abs(boss.x - p.x) + Math.abs(boss.y - p.y) <= 8) {
      itemToUse = carriedBuffs()[0];
    }
    // Boss floor: use bombs on boss or boss + adds (more aggressive)
    if (!itemToUse && carriedBombs().length > 0 && adjEnemies.length >= 1) {
      let bossAdjacent = adjEnemies.some(e => e.boss);
      if (bossAdjacent || adjEnemies.length >= 2 || (boss && boss.hp <= 80)) {
        itemToUse = carriedBombs()[0];
      }
    }
    // Boss floor: heal more aggressively - use potion if below 70% during boss fight
    if (!itemToUse && boss && potions.length > 0 && p.hp < p.maxHp * 0.70) {
      bestPotion = potions[0];
      itemToUse = bestPotion;
    }
    // Boss floor: teleport away if critically low and overwhelmed
    if (!itemToUse && carriedTeleports().length > 0 &&
        p.hp < p.maxHp * 0.35 && (adjEnemies.length >= 2 || bossPhase >= 2)) {
      itemToUse = carriedTeleports()[0];
    }

    if (itemToUse) {
      if (!bagOpen) return { type: 'key', val: 'i' };
      else {
        let visibleItem = G.items.find(i => i.carried && i.type === itemToUse.type && i.name === itemToUse.name) || itemToUse;
        return { type: 'click', target: `.inv-slot[onclick*="${visibleItem.id}"]` };
      }
    }
  }

  if (G.map[p.y][p.x] === STAIRS && (isMapCleared() || shouldExitWithoutPotion() || shouldHeadForStairs() || G.won)) {
      return { type: 'key', val: '>' };
  }

  // PICKUP ADJACENT
  let bag = G.items.filter(i => i.carried);
  let adjItem = G.items.find(i => !i.carried && Math.abs(i.x - p.x) + Math.abs(i.y - p.y) === 1);
  const isRecoveryFloorItem = item => item.type === 'potion' || item.type === 'scroll_teleport' || item.type === 'bomb';
  const shouldPickupAdjacent = item => !shouldExitWithoutPotion() || adjEnemies.length === 0 || isRecoveryFloorItem(item);
  if (adjItem && usefulFloorItem(adjItem) && shouldPickupAdjacent(adjItem) && !isDangerousTrap(adjItem.x, adjItem.y)) {
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
  const stepTowardKnownStairs = () => {
      const stairs = knownStairsPosition();
      if (!stairs) return null;
      const currentDist = Math.abs(stairs.x - p.x) + Math.abs(stairs.y - p.y);
      let bestMove = null;
      let bestScore = -Infinity;
      for (let d of dirs) {
          let nx = p.x + d.dx, ny = p.y + d.dy;
          if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
          if (!isPassable(nx, ny, true)) continue;
          if (liveEnemies.some(e => e.x === nx && e.y === ny)) continue;
          const dist = Math.abs(stairs.x - nx) + Math.abs(stairs.y - ny);
          if (dist >= currentDist) continue;
          const incomingAfter = liveEnemies
            .filter(e => Math.abs(e.x - nx) + Math.abs(e.y - ny) === 1)
            .reduce((sum, e) => sum + maxIncomingHit(e), 0);
          const score = (currentDist - dist) * 20 - incomingAfter * 4 + (G.seen.has(ny * MAP_W + nx) ? 2 : 0);
          if (score > bestScore) {
              bestScore = score;
              bestMove = d.k;
          }
      }
      return bestMove ? { type: 'key', val: bestMove, label: 'path to stairs' } : null;
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
  const monkEscapeOnly = p.class === 'monk' && shouldExitWithoutPotion() && !hasKnownStairs();
  const hasOpenAdjacentTile = () => dirs.some(d => {
      let nx = p.x + d.dx, ny = p.y + d.dy;
      return nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H &&
        isPassable(nx, ny, false, true) &&
        !G.enemies.some(e => e.x === nx && e.y === ny);
  });

  // CLASS ABILITIES (Phase 3)
  const ability2Decision = () => {
      if (G.ability2Cooldown !== 0 || p.lvl < 5) return null;
      if (p.class === 'warrior' && G.floor >= FINAL_FLOOR && shouldExitWithoutPotion() && adjEnemies.length > 0 && p.hp < p.maxHp * 0.2) return { type: 'key', val: 'v' }; // SHIELD WALL
      if (p.class === 'warrior' && (totalIncomingMax() >= p.hp * 0.3 || (adjEnemies.length >= 2 && p.hp < p.maxHp * 0.8) || (adjacentBoss) || (G.floor >= FINAL_FLOOR && adjEnemies.length > 0))) return { type: 'key', val: 'v' }; // SHIELD WALL
      if (p.class === 'rogue' && (adjEnemies.length >= 2 || (adjEnemies.length >= 1 && p.hp < p.maxHp * 0.75) || (visEnemies.length > 0 && (p.hp < p.maxHp * 0.5 || G.floor >= 5)) || (boss && bossPhase >= 2))) return { type: 'key', val: 'v' }; // VANISH
      if (p.class === 'mage' && (adjEnemies.length > 0 || p.hp < p.maxHp * 0.4) && visEnemies.length > 0) {
          let safeTiles = false;
          for(let y=0; y<MAP_H && !safeTiles; y++) {
            for(let x=0; x<MAP_W; x++) {
              if (x === p.x && y === p.y) continue;
              if (G.map[y][x] !== FLOOR) continue;
              if (!G.visible.has(y * MAP_W + x)) continue;
              if (G.enemies.some(e => e.x === x && e.y === y)) continue;
              if ((G.traps || []).some(t => t.x === x && t.y === y && !t.triggered)) continue;
              safeTiles = true;
              break;
            }
          }
          if(safeTiles) return { type: 'key', val: 'v' }; // BLINK
      }
      if (p.class === 'paladin' && p.hp <= p.maxHp * 0.50) return { type: 'key', val: 'v' }; // HEAL
      if (p.class === 'ranger' && adjEnemies.length > 0 && !(shouldExitWithoutPotion() && hasKnownStairs())) {
          let safeAdj = false;
          let dirs = [[0,-1],[0,1],[-1,0],[1,0]];
          for(let d of dirs) {
            let nx = p.x + d[0], ny = p.y + d[1];
            if(G.map[ny] && G.map[ny][nx] === FLOOR && !G.enemies.some(e=>e.x===nx&&e.y===ny)) safeAdj = true;
          }
          if(safeAdj) return { type: 'key', val: 'v' }; // BEAR TRAP - use when any enemy adjacent
      }
      // Ranger: also use Bear Trap when enemies are visible and we're at range (place trap then kite)
      if (p.class === 'ranger' && visEnemies.length > 0 && G.ability2Cooldown === 0 && !shouldExitWithoutPotion()) {
          let safeAdj = false;
          let dirs = [[0,-1],[0,1],[-1,0],[1,0]];
          for(let d of dirs) {
            let nx = p.x + d[0], ny = p.y + d[1];
            if(G.map[ny] && G.map[ny][nx] === FLOOR && !G.enemies.some(e=>e.x===nx&&e.y===ny)) safeAdj = true;
          }
          if(safeAdj) return { type: 'key', val: 'v' }; // BEAR TRAP - place before engaging
      }
      if (p.class === 'barbarian' && !desperateRecovery && !shouldExitWithoutPotion() && 
          ((adjEnemies.length >= 2 && p.hp > p.maxHp * 0.45) || 
           (adjEnemies.length >= 1 && p.hp > p.maxHp * 0.55) ||
           (boss && p.hp > p.maxHp * 0.35)) && 
          visEnemies.length > 0 && (p.bloodlustTurns || 0) === 0) return { type: 'key', val: 'v' }; // BLOODLUST
      if (p.class === 'necromancer') {
         let markTargets = visEnemies.filter(e => !e.boss && !e.raiseCorpseTarget);
         if (markTargets.length >= 1) return { type: 'key', val: 'v' }; // RAISE DEAD
      }
      if (p.class === 'monk' && adjEnemies.length > 0) {
          let flurryKill = adjEnemies.some(e =>
            e.hp <= monkFlurryMaxDamage(e)
          );
          if (monkEscapeOnly && hasOpenAdjacentTile() && adjEnemies.length >= 2 && !flurryKill) return null;
          if ((p.hp > p.maxHp * 0.5 && adjEnemies.length >= 1) || flurryKill) return { type: 'key', val: 'v' }; // FLURRY
      }
      return null;
  };
  
  let a2First = ability2Decision();
  if (a2First && ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'].includes(p.class)) return a2First;

  if (G.ability1Cooldown === 0) {
      if (p.class === 'warrior' && adjEnemies.length > 0) {
         // BASH — always better than basic attack, but escape if dying with known stairs
         if (!(shouldExitWithoutPotion() && hasKnownStairs() && hasOpenAdjacentTile())) {
           let target = adjEnemies.find(e => e.hp <= minBashDamage(e)) || adjEnemies[0];
           if (target) return { type: 'key', val: 'b' };
         }
      }
      if (p.class === 'rogue') {
         let knownThreats = visEnemies.length ? visEnemies : liveEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 3);
         let hasKillableAdjacent = adjEnemies.some(e => e.hp <= maxNormalDamage(e) || e.hp <= minSneakDamage(e));
         let dashTarget = null;
         if (!(shouldExitWithoutPotion() && hasKnownStairs())) {
            if ((p.vanishTurns || 0) === 0 && !adjEnemies.length && p.hp > p.maxHp * 0.5 && knownThreats.length === 1) dashTarget = knownThreats[0];
            else if ((p.vanishTurns || 0) === 0 && !hasKillableAdjacent && adjEnemies.length >= 2 && p.hp > p.maxHp * 0.35) dashTarget = adjEnemies[0];
            else if ((p.vanishTurns || 0) === 0 && !hasKillableAdjacent && adjEnemies.length === 1 && p.hp < p.maxHp * 0.7 && p.hp > p.maxHp * 0.35) dashTarget = adjEnemies[0];
         }
         if (dashTarget) return { type: 'key', val: 'b' };
      }
      if (p.class === 'mage' && visEnemies.length >= 1) return { type: 'key', val: 'b' }; 
      if (p.class === 'paladin' && adjEnemies.length > 0) {
         // SMITE — prioritize enemies that can't be killed in 1 hit or are high-threat
         if (!(shouldExitWithoutPotion() && hasKnownStairs() && hasOpenAdjacentTile())) {
           let target = adjEnemies.find(e => e.hp > minNormalDamage(e) || maxIncomingHit(e) >= p.maxHp * 0.15);
           if (!target) target = adjEnemies[0]; // Fallback: SMITE any enemy if nothing better
           return { type: 'key', val: 'b' };
         }
      } 
      if (p.class === 'ranger') {
          let aligned = visEnemies.some(e => e.x === p.x || e.y === p.y || Math.abs(e.x - p.x) === Math.abs(e.y - p.y));
          if (aligned) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'barbarian' && !desperateRecovery && adjEnemies.length >= 2) return { type: 'key', val: 'b' }; // CLEAVE
      if (p.class === 'necromancer') {
        let target = visEnemies.find(e => Math.abs(e.x - p.x) <= 2 && Math.abs(e.y - p.y) <= 2);
        if (target) return { type: 'key', val: 'b' }; 
      }
      if (p.class === 'monk' && adjEnemies.length > 0) {
         // PUSH KICK — always better than basic attack (pushback + possible wall slam 2x)
         // Only skip when dying with escape available (should explore instead)
         // Also skip when a basic attack can finish the enemy (save cooldown)
         let killableAdj = adjEnemies.some(e => e.hp <= minSneakDamage(e));
         let target = adjEnemies.sort((a, b) => monkPushKickMaxDamage(b) - monkPushKickMaxDamage(a))[0];
         if (target && !killableAdj && !(monkEscapeOnly && hasOpenAdjacentTile())) {
           return { type: 'key', val: 'b' };
         }
      } 
  }

  // RANGED ATTACK
  const rangedAttack = () => {
      if (shouldAvoidVoluntaryCombat()) return null;
      const maxRange = p.class === 'ranger' && isBow(p.weapon) ? 3 : 2;
      let targets = visEnemies.filter(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= maxRange && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) > 1);
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

  if (shouldExitWithoutPotion() && hasKnownStairs() && adjEnemies.length > 0) {
      let stairsAction = stepTowardKnownStairs();
      if (stairsAction) return stairsAction;
  }

  // KITING LOGIC
  const shouldKite = () => {
      // Boss floor: only ranged classes kite (when abilities on cooldown), melee commits
      if (onBossFloor) {
          if (['mage', 'necromancer', 'ranger'].includes(p.class)) {
              // Kite when both abilities on cooldown and we have HP to spare
              if (G.ability1Cooldown > 0 && G.ability2Cooldown > 0 && p.hp > p.maxHp * 0.3) return true;
          }
          return false;
      }
      if ((p.class === 'rogue' || p.class === 'barbarian') && shouldExitWithoutPotion() && !hasKnownStairs()) return false;
      if (panicMode) {
          if (hasKnownStairs() && shouldExitWithoutPotion() && adjEnemies.length === 0) return false;
          if (!shouldHeadForStairs()) return true; // Emergency
      }
      if (adjEnemies.length > 0 && totalIncomingMax() >= p.hp) {
          if ((p.class === 'rogue' || p.class === 'barbarian') && potions.length === 0 && !hasKnownStairs()) return false;
          return true;
      }
      if (p.class === 'mage' || p.class === 'ranger' || p.class === 'necromancer') {
          let maxDist = p.class === 'ranger' && isBow(p.weapon) ? 3 : (p.class === 'necromancer' ? 2 : 3);
          if (visEnemies.some(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= maxDist)) return true;
      }
      return false;
  };

  if (visEnemies.length > 0 && shouldKite()) {
      let bestMove = null;
      let bestScore = -Infinity;
      let bestDistance = -Infinity;
      let exitStairs = shouldExitWithoutPotion() ? knownStairsPosition() : null;
      for (let d of dirs) {
          let nx = p.x + d.dx, ny = p.y + d.dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && isPassable(nx, ny) && !G.enemies.some(e => e.x === nx && e.y === ny)) {
              let minDist = Math.min(...visEnemies.map(e => Math.max(Math.abs(e.x - nx), Math.abs(e.y - ny))));
              let score = minDist * 10 + (G.seen.has(ny*MAP_W+nx) ? 5 : 0); // Prefer explored areas
              if (exitStairs) score -= (Math.abs(exitStairs.x - nx) + Math.abs(exitStairs.y - ny)) * 6;
              if (score > bestScore) {
                  bestScore = score;
                  bestMove = d.k;
                  bestDistance = minDist;
              }
          }
      }
      // If we can achieve a distance of >= 2, we successfully kite.
      // Otherwise we are cornered and should stand our ground.
      if (bestMove && bestDistance >= 2) {
          return { type: 'key', val: bestMove, label: 'kite' };
      }
  }

  // FIGHT - but avoid fights when outnumbered and low on HP
  if (adjEnemies.length > 0) {
      let target;
      if (onBossFloor && boss) {
        // Necromancer: prioritize marked adds for pet creation, then boss
        if (p.class === 'necromancer') {
          let markedAdd = adjEnemies.find(e => e.raiseCorpseTarget && !e.boss);
          target = markedAdd || adjEnemies.find(e => e.boss) || adjEnemies[0];
        } else {
          target = adjEnemies.find(e => e.boss) || adjEnemies[0];
        }
      } else {
        target = adjEnemies.sort((a,b) => maxIncomingHit(b) - maxIncomingHit(a))[0];
      }
      let overwhelmed = adjEnemies.length >= 2 && p.hp < p.maxHp * 0.4 && hasOpenAdjacentTile();
      if (!overwhelmed) {
        return attackMove(target);
      }
      // Overwhelmed - let BFS find escape route instead
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
        
        let headingForStairs = shouldHeadForStairs();
        let leavingFloor = shouldExitWithoutPotion() || headingForStairs;
        let recovering = shouldRecover();
        
        let validTarget = false;
        let label = '';
        
        // Boss floor: always target the boss
        if (onBossFloor && isEnemy) {
          validTarget = true; label = 'path to boss';
        } else if (targetStairsOnly || leavingFloor) {
             if (!targetStairsOnly && shouldExitWithoutPotion() && !headingForStairs && isShopTarget) { validTarget = true; label = 'path to shop'; }
             else if (isStairs) { validTarget = true; label = 'path to stairs'; }
        } else if (recovering) {
             if (isItem) { validTarget = true; label = 'path to item'; }
             else if (isShopTarget) { validTarget = true; label = 'path to shop'; }
             else if (isStairs && (isMapCleared() || shouldHeadForStairs())) { validTarget = true; label = 'path to stairs'; }
             else if (isUnseen) { validTarget = true; label = 'explore'; }
        } else {
             if (!shouldAvoidVoluntaryCombat() && isEnemy) { validTarget = true; label = 'path to enemy'; }
             else if (isItem) { validTarget = true; label = 'path to item'; }
             else if (isShopTarget) { validTarget = true; label = 'path to shop'; }
             else if (isUnseen) { validTarget = true; label = 'explore'; }
             else if (isStairs && (isMapCleared() || shouldHeadForStairs())) { validTarget = true; label = 'path to stairs'; }
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
