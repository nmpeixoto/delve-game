// automation/resources.js
// Resource tracking module for the DELVE bot.
// Analyzes inventory state and computes urgency / usage decisions for consumable resources.

(function (root) {
  'use strict';

  const FLOORS = typeof root.FLOORS !== 'undefined' ? root.FLOORS : 5;

  // ── POTION TIER DEFINITIONS ──────────────────────────────────────────────
  const POTION_TIERS = [
    { name: 'Health Potion',      heal: 15 },
    { name: 'Greater Potion',     heal: 30 },
    { name: 'Elixir of Life',     heal: 60 },
  ];

  // ── CLASS RESOURCE WEIGHTS ───────────────────────────────────────────────
  // Higher = the class values this resource more relative to the baseline.
  const CLASS_WEIGHTS = {
    warrior:    { potion: 1.3, teleport: 0.9, bomb: 1.4, buff: 1.6, detection: 0.6, gold: 1.0, key: 1.1 },
    rogue:      { potion: 1.1, teleport: 1.2, bomb: 1.0, buff: 0.9, detection: 1.1, gold: 1.2, key: 1.0 },
    mage:       { potion: 1.2, teleport: 1.4, bomb: 0.8, buff: 1.0, detection: 1.5, gold: 0.9, key: 1.0 },
    paladin:    { potion: 1.2, teleport: 0.9, bomb: 1.0, buff: 1.1, detection: 0.7, gold: 1.0, key: 1.2 },
    ranger:     { potion: 1.0, teleport: 1.1, bomb: 1.1, buff: 0.9, detection: 1.3, gold: 1.0, key: 1.0 },
    barbarian:  { potion: 1.3, teleport: 0.8, bomb: 1.5, buff: 1.3, detection: 0.5, gold: 0.9, key: 1.0 },
    necromancer: { potion: 1.2, teleport: 1.3, bomb: 0.9, buff: 0.9, detection: 1.2, gold: 0.9, key: 1.0 },
    monk:       { potion: 1.0, teleport: 1.1, bomb: 1.1, buff: 1.0, detection: 1.2, gold: 1.0, key: 1.0 },
  };

  // ── HELPERS ──────────────────────────────────────────────────────────────

  /** Clamp a number between 0 and 1. */
  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  /** Return the player object from the game state, or null. */
  function player(G) {
    return G && G.player ? G.player : null;
  }

  /** Manhattan distance between two points, or Infinity if either is missing. */
  function dist(a, b) {
    if (!a || !b) return Infinity;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /** Count carried items matching a predicate. */
  function carriedCount(G, predicate) {
    if (!G || !G.items) return 0;
    return G.items.filter(i => i.carried && predicate(i)).length;
  }

  /** Return carried items of a given type, sorted by quality descending. */
  function carriedOfType(G, type) {
    if (!G || !G.items) return [];
    return G.items.filter(i => i.carried && resolveItemType(i) === type);
  }

  /** Resolve the canonical resource type for an item. */
  function resolveItemType(item) {
    if (!item) return null;
    if (item.type === 'potion') return 'potion';
    if (item.type === 'potion_buff') return 'buff';
    if (item.type === 'bomb') return 'bomb';
    if (item.type === 'scroll_teleport') return 'teleport';
    if (item.type === 'scroll' && /detection/i.test(item.name || '')) return 'detection';
    if (item.type === 'key') return 'key';
    return null;
  }

  /** HP ratio as 0-1. */
  function hpRatio(p) {
    if (!p || !p.maxHp) return 0;
    return p.hp / p.maxHp;
  }

  /** Number of live (non-dying, non-pet) enemies. */
  function liveEnemyCount(G) {
    if (!G || !G.enemies) return 0;
    return G.enemies.filter(e => !e.dying && !e.isPet).length;
  }

  /** Enemies currently visible to the player. */
  function visibleEnemies(G) {
    if (!G || !G.enemies || !G.visible) return [];
    const MAP_W = (typeof root.MAP_W !== 'undefined') ? root.MAP_W : 56;
    return G.enemies.filter(e => !e.dying && !e.isPet && G.visible.has(e.y * MAP_W + e.x));
  }

  /** Enemies adjacent (Manhattan distance 1) to the player. */
  function adjacentEnemies(G) {
    if (!G || !G.enemies) return [];
    const p = player(G);
    if (!p) return [];
    return G.enemies.filter(e => !e.dying && !e.isPet && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
  }

  /** Maximum total incoming damage from adjacent enemies. */
  function totalIncomingDamage(G) {
    const p = player(G);
    if (!p) return 0;
    const armor = p.armor ? (p.armor.def || 0) : 0;
    return adjacentEnemies(G).reduce((sum, e) => {
      const hit = Math.max(1, e.atk - (p.def || 0) - armor + 2);
      return sum + hit;
    }, 0);
  }

  /** Manhattan distance from player to the nearest known stairs. */
  function distToStairs(G) {
    const p = player(G);
    if (!p || !G.map || !G.seen) return Infinity;
    const MAP_W = (typeof root.MAP_W !== 'undefined') ? root.MAP_W : 56;
    const MAP_H = (typeof root.MAP_H !== 'undefined') ? root.MAP_H : 36;
    let best = Infinity;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === 2 && G.seen.has(y * MAP_W + x)) {
          const d = Math.abs(x - p.x) + Math.abs(y - p.y);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Whether there are still hidden secrets (unrevealed traps or secret doors). */
  function hasHiddenSecrets(G) {
    if (!G || !G.map || !G.traps) return false;
    const MAP_W = (typeof root.MAP_W !== 'undefined') ? root.MAP_W : 56;
    const MAP_H = (typeof root.MAP_H !== 'undefined') ? root.MAP_H : 36;
    if (G.traps.some(t => !t.revealed && !t.triggered)) return true;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === 5) return true; // SECRET_DOOR
      }
    }
    return false;
  }

  /** Whether the strength buff is already active. */
  function hasActiveBuff(p) {
    return p && (p.strengthTurns || 0) > 0;
  }

  /** Count locked doors remaining on the floor. */
  function lockedDoorCount(G) {
    if (!G || !G.map) return 0;
    const MAP_W = (typeof root.MAP_W !== 'undefined') ? root.MAP_W : 56;
    const MAP_H = (typeof root.MAP_H !== 'undefined') ? root.MAP_H : 36;
    let count = 0;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (G.map[y][x] === 4) count++; // LOCKED_DOOR
      }
    }
    return count;
  }

  /** Whether the player has seen any shops on this floor. */
  function hasKnownShop(G) {
    return G && G.shops && G.shops.length > 0;
  }

  /** Effective class name, falling back to 'warrior'. */
  function className(G) {
    const p = player(G);
    return (p && p.class) || 'warrior';
  }

  /** Get the class-specific weight for a resource type. */
  function classWeight(type, cls) {
    const w = CLASS_WEIGHTS[cls] || CLASS_WEIGHTS.warrior;
    return w[type] || 1;
  }

  // ── URGENCY COMPONENTS ───────────────────────────────────────────────────
  // Each component returns 0-1. Final urgency is a weighted sum clamped to [0,1].

  /**
   * HP-based urgency: lower HP → higher urgency.
   * Below 30% → 1.0; at 100% → 0.0 (linear interpolation with slight curve).
   */
  function hpUrgency(p) {
    const ratio = hpRatio(p);
    if (ratio <= 0.3) return 1.0;
    if (ratio >= 1.0) return 0.0;
    // Slightly non-linear: urgency ramps faster as HP drops
    return Math.pow(1 - ratio, 1.5);
  }

  /**
   * Floor-based urgency: deeper floors → higher urgency to spend resources.
   * Floor 1 → 0.0; final floor → ~0.6 (max contribution from floor alone).
   */
  function floorUrgency(G) {
    const f = (G && G.floor) || 1;
    return clamp01((f - 1) / (FLOORS - 1) * 0.6);
  }

  /**
   * Enemy proximity urgency: more visible / adjacent enemies → higher urgency.
   * 0 enemies → 0.0; 3+ visible → ~0.7.
   */
  function enemyUrgency(G) {
    const vis = visibleEnemies(G).length;
    const adj = adjacentEnemies(G).length;
    // Adjacent enemies count double
    const score = vis * 0.2 + adj * 0.4;
    return clamp01(score);
  }

  /**
   * Stair distance urgency: further from stairs → more urgency to use
   * survival resources to stay alive long enough to reach them.
   * On-stairs → 0.0; 30+ tiles → ~0.5.
   */
  function stairUrgency(G) {
    const d = distToStairs(G);
    if (d === Infinity) return 0.3; // Unknown stairs — mild urgency
    return clamp01(d / 30 * 0.5);
  }

  /**
   * Inventory pressure: carrying too many items → urgency to use consumables
   * to free up slots. 12+ items → ~0.3.
   */
  function inventoryPressure(G) {
    if (!G || !G.items) return 0;
    const count = G.items.filter(i => i.carried).length;
    return clamp01((count - 8) / 8 * 0.3);
  }

  // ── EXPORTED FUNCTIONS ───────────────────────────────────────────────────

  /**
   * Analyze the current game state and return a full resource summary.
   *
   * @param {Object} G - The global game state object.
   * @returns {{
   *   potions: { count: number, bestHeal: number, totalHeal: number, items: Object[] },
   *   teleportScrolls: number,
   *   bombs: number,
   *   strengthBuffs: number,
   *   detectionScrolls: number,
   *   gold: number,
   *   keys: number,
   *   lockedDoors: number,
   *   hasActiveBuff: boolean,
   *   hpRatio: number,
   *   floor: number,
   *   adjacentEnemies: number,
   *   visibleEnemies: number,
   *   stairDistance: number,
   *   hiddenSecrets: boolean,
   *   overallUrgency: number,
   *   classWeights: Object
   * }}
   */
  function trackResources(G) {
    const p = player(G);
    if (!p) {
      return {
        potions: { count: 0, bestHeal: 0, totalHeal: 0, items: [] },
        teleportScrolls: 0, bombs: 0, strengthBuffs: 0, detectionScrolls: 0,
        gold: 0, keys: 0, lockedDoors: 0, hasActiveBuff: false,
        hpRatio: 0, floor: 1, adjacentEnemies: 0, visibleEnemies: 0,
        stairDistance: -1, hiddenSecrets: false, overallUrgency: 0,
        classWeights: CLASS_WEIGHTS.warrior,
      };
    }

    const potions = carriedOfType(G, 'potion')
      .sort((a, b) => (b.heal || 0) - (a.heal || 0));
    const totalHeal = potions.reduce((sum, i) => sum + (i.heal || 0), 0);

    const visEnemies = visibleEnemies(G);
    const adjEnemies = adjacentEnemies(G);

    // Compute composite urgency
    const hp = hpUrgency(p);
    const fl = floorUrgency(G);
    const en = enemyUrgency(G);
    const st = stairUrgency(G);
    const inv = inventoryPressure(G);
    const overallUrgency = clamp01(hp * 0.35 + fl * 0.15 + en * 0.25 + st * 0.15 + inv * 0.10);

    return {
      potions: {
        count: potions.length,
        bestHeal: potions.length > 0 ? potions[0].heal || 0 : 0,
        totalHeal,
        items: potions,
      },
      teleportScrolls: carriedCount(G, i => i.type === 'scroll_teleport'),
      bombs: carriedCount(G, i => i.type === 'bomb'),
      strengthBuffs: carriedCount(G, i => i.type === 'potion_buff'),
      detectionScrolls: carriedCount(G, i => i.type === 'scroll' && /detection/i.test(i.name || '')),
      gold: p.gold || 0,
      keys: carriedCount(G, i => i.type === 'key'),
      lockedDoors: lockedDoorCount(G),
      hasActiveBuff: hasActiveBuff(p),
      hpRatio: hpRatio(p),
      floor: (G && G.floor) || 1,
      adjacentEnemies: adjEnemies.length,
      visibleEnemies: visEnemies.length,
      stairDistance: distToStairs(G),
      hiddenSecrets: hasHiddenSecrets(G),
      overallUrgency,
      classWeights: CLASS_WEIGHTS[className(G)] || CLASS_WEIGHTS.warrior,
    };
  }

  /**
   * Decide whether a resource of the given type should be used right now.
   *
   * @param {string} type - One of: 'potion', 'teleport', 'bomb', 'buff', 'detection', 'gold', 'key'.
   * @param {Object} G - The global game state object.
   * @param {Object} [strategy] - Optional class strategy overrides (exitHp, combatHpFloor, etc.).
   * @returns {{ use: boolean, reason: string, urgency: number }}
   */
  function shouldUseResource(type, G, strategy) {
    const p = player(G);
    if (!p) return { use: false, reason: 'no player', urgency: 0 };

    const s = strategy || {};
    const cls = className(G);
    const urgency = getResourceUrgency(type, G);
    const carried = carriedOfType(G, type);
    const hp = hpRatio(p);
    const adjCount = adjacentEnemies(G).length;
    const visCount = visibleEnemies(G).length;
    const incoming = totalIncomingDamage(G);

    switch (type) {
      case 'potion': {
        if (carried.length === 0) return { use: false, reason: 'no potions', urgency };

        const combatFloor = s.combatPotionFloor ?? s.combatHpFloor ?? 0.42;
        const exitHp = s.exitHp ?? 0.7;

        // Emergency: incoming damage will kill us next turn
        if (adjCount > 0 && incoming >= p.hp) {
          return { use: true, reason: 'lethal incoming damage', urgency: 1.0 };
        }

        // In melee combat
        if (adjCount > 0) {
          const threshold = Math.max(combatFloor, 0.6);
          if (hp <= threshold) {
            return { use: true, reason: 'low HP in combat', urgency };
          }
          if (hp <= hp + 0.001 && p.hp <= incoming + Math.max(4, p.maxHp * 0.05)) {
            return { use: true, reason: 'will die in 1-2 hits', urgency: 1.0 };
          }
        }

        // Out of combat: heal below exit threshold to prepare
        if (visCount === 0 && hp < exitHp * 0.85) {
          return { use: true, reason: 'HP below exit threshold', urgency };
        }

        // Very low HP anywhere
        if (hp < 0.3) {
          return { use: true, reason: 'critically low HP', urgency: 1.0 };
        }

        // Late floor + moderate damage risk
        if ((G.floor || 1) >= 4 && hp < 0.5 && visCount > 0) {
          return { use: true, reason: 'late floor with enemies visible', urgency };
        }

        return { use: false, reason: 'HP adequate', urgency };
      }

      case 'teleport': {
        if (carried.length === 0) return { use: false, reason: 'no teleport scrolls', urgency };

        // Lethal adjacent enemy
        const anyLethal = adjacentEnemies(G).some(e => {
          const armor = p.armor ? (p.armor.def || 0) : 0;
          const hit = Math.max(1, e.atk - (p.def || 0) - armor + 2);
          return hit >= p.hp;
        });
        if (anyLethal) {
          return { use: true, reason: 'lethal enemy adjacent', urgency: 1.0 };
        }

        // Outnumbered and low HP
        if (adjCount >= 2 && hp < 0.5) {
          return { use: true, reason: 'outnumbered and low HP', urgency };
        }

        // Very low HP with any visible enemies
        if (hp < 0.2 && visCount > 0) {
          return { use: true, reason: 'critical HP with enemies visible', urgency: 1.0 };
        }

        // Boss overwhelmed
        const boss = visibleEnemies(G).find(e => e.boss) || (G.enemies || []).find(e => e.boss && !e.dying);
        if (boss && (boss.phase || 1) >= 2 && hp < 0.55) {
          return { use: true, reason: 'enraged boss + low HP', urgency };
        }

        // Low HP + below combat floor with enemies around
        const combatFloor = s.combatPotionFloor ?? s.combatHpFloor ?? 0.42;
        if (visCount > 0 && hp <= combatFloor) {
          return { use: true, reason: 'below combat HP floor with enemies', urgency };
        }

        return { use: false, reason: 'positioning acceptable', urgency };
      }

      case 'bomb': {
        if (carried.length === 0) return { use: false, reason: 'no bombs', urgency };

        // Boss adjacent
        if (adjacentEnemies(G).some(e => e.boss)) {
          return { use: true, reason: 'boss adjacent', urgency };
        }

        // 2+ adjacent enemies
        if (adjCount >= 2) {
          return { use: true, reason: `${adjCount} adjacent enemies`, urgency };
        }

        // Enemies with low HP that bomb can kill (30 damage)
        const lowHpAdj = adjacentEnemies(G).filter(e => e.hp <= 30);
        if (lowHpAdj.length >= 1 && (hp < 0.5 || adjCount >= 1)) {
          return { use: true, reason: 'bomb kill opportunity', urgency };
        }

        // Panic: surrounded and low
        if (adjCount >= 2 && hp < 0.4) {
          return { use: true, reason: 'panic — surrounded and low HP', urgency: 1.0 };
        }

        // Late floor with 2+ visible
        if ((G.floor || 1) >= 4 && visCount >= 2 && hp < 0.6) {
          return { use: true, reason: 'late floor with group of enemies', urgency };
        }

        return { use: false, reason: 'no good bomb opportunity', urgency };
      }

      case 'buff': {
        if (carried.length === 0) return { use: false, reason: 'no strength buffs', urgency };
        if (hasActiveBuff(p)) return { use: false, reason: 'buff already active', urgency };

        const vis = visibleEnemies(G);
        if (vis.length === 0) return { use: false, reason: 'no visible enemies', urgency };

        // Elite or boss visible → always buff
        if (vis.some(e => e.isElite || e.boss)) {
          return { use: true, reason: 'elite/boss visible', urgency };
        }

        // Multiple adjacent enemies
        if (adjCount >= 2) {
          return { use: true, reason: 'multiple adjacent enemies', urgency };
        }

        // Enemy that would take 2+ fewer hits with buff
        const meleeClass = ['warrior', 'paladin', 'barbarian', 'monk'].includes(cls);
        const baseHits = meleeClass ? 2 : 3;
        const buffWorthIt = vis.some(e => {
          const atk = (p.atk || 0) + (p.weapon ? (p.weapon.atk || 0) : 0);
          if (p.class === 'barbarian') atk += Math.floor((p.maxHp - p.hp) / 6);
          const normalDmg = Math.max(1, atk - e.def);
          const buffedDmg = Math.max(1, atk + 10 - e.def);
          const normalHits = Math.ceil(e.hp / normalDmg);
          const buffedHits = Math.ceil(e.hp / buffedDmg);
          return normalHits - buffedHits >= 1;
        });

        if (buffWorthIt) {
          return { use: true, reason: 'buff saves hits on enemy', urgency };
        }

        return { use: false, reason: 'buff not cost-effective now', urgency };
      }

      case 'detection': {
        if (carried.length === 0) return { use: false, reason: 'no detection scrolls', urgency };
        if (!hasHiddenSecrets(G)) return { use: false, reason: 'no hidden secrets', urgency };

        // Detection is most valuable when exploring and not in combat
        if (visCount === 0) {
          const weight = classWeight('detection', cls);
          if (weight >= 1.2 || (G.floor || 1) >= 3) {
            return { use: true, reason: 'exploring with hidden secrets', urgency };
          }
        }

        // Detection is safe to use out of combat
        if (visCount === 0 && hp > 0.5) {
          return { use: true, reason: 'safe to reveal secrets', urgency };
        }

        return { use: false, reason: 'not ideal time for detection', urgency };
      }

      case 'gold': {
        // Gold is not "used" directly — this evaluates spending priority
        const reserve = (s.goldReserve || 60) + ((G.floor || 1) >= 4 ? 20 : 0);
        const spendable = Math.max(0, (p.gold || 0) - reserve);
        const hasShop = hasKnownShop(G);
        if (spendable <= 0) return { use: false, reason: 'below gold reserve', urgency };
        if (!hasShop) return { use: false, reason: 'no known shop', urgency };
        return { use: true, reason: 'can spend at shop', urgency: clamp01(spendable / 100) };
      }

      case 'key': {
        if (carried.length === 0) return { use: false, reason: 'no keys', urgency };
        const doors = lockedDoorCount(G);
        if (doors === 0) return { use: false, reason: 'no locked doors', urgency };
        // Keys become more urgent when far from stairs (need to progress)
        const stairDist = distToStairs(G);
        const keyUrgency = clamp01(0.4 + (stairDist > 20 ? 0.3 : 0) + ((G.floor || 1) >= 4 ? 0.2 : 0));
        return { use: true, reason: `${doors} locked door(s) remain`, urgency: keyUrgency };
      }

      default:
        return { use: false, reason: 'unknown resource type', urgency: 0 };
    }
  }

  /**
   * Return a 0-1 urgency score for using a resource of the given type.
   *
   * Factors considered:
   * - HP ratio (lower → higher)
   * - Floor depth (deeper → higher)
   * - Enemy proximity (more enemies → higher)
   * - Stair distance (further → higher)
   * - Inventory pressure (more items → higher)
   * - Class-specific weighting (e.g. mage values detection scrolls more)
   * - Type-specific situational modifiers
   *
   * @param {string} type - One of: 'potion', 'teleport', 'bomb', 'buff', 'detection', 'gold', 'key'.
   * @param {Object} G - The global game state object.
   * @returns {number} Urgency score between 0 (not urgent) and 1 (use immediately).
   */
  function getResourceUrgency(type, G) {
    const p = player(G);
    if (!p) return 0;

    const cls = className(G);
    const weight = classWeight(type, cls);

    // Base urgency from environmental factors
    const hp = hpUrgency(p);
    const fl = floorUrgency(G);
    const en = enemyUrgency(G);
    const st = stairUrgency(G);
    const inv = inventoryPressure(G);

    // Base composite
    let base = hp * 0.35 + fl * 0.15 + en * 0.25 + st * 0.15 + inv * 0.10;

    switch (type) {
      case 'potion': {
        // Potions scale strongly with HP — low HP = must heal
        const incoming = totalIncomingDamage(G);
        const adjCount = adjacentEnemies(G).length;

        // Emergency healing: near death
        if (p.hp <= incoming + Math.max(4, p.maxHp * 0.05)) {
          return 1.0;
        }

        // Base HP-driven urgency
        let urgency = hp * 0.6 + fl * 0.1 + en * 0.2 + st * 0.1;

        // Combat modifier: heal earlier when enemies are adjacent
        if (adjCount > 0) {
          urgency = Math.max(urgency, hp * 0.5 + 0.25);
        }

        // Late floor: potions are more precious, use them proactively
        if ((G.floor || 1) >= 4) {
          urgency = Math.min(1, urgency + 0.1);
        }

        return clamp01(urgency * weight);
      }

      case 'teleport': {
        // Teleport urgency spikes when surrounded and dying
        const adjCount = adjacentEnemies(G).length;
        const visCount = visibleEnemies(G).length;

        let urgency = 0;

        // Lethal situation
        if (adjCount > 0 && hp < 0.25) urgency = 1.0;
        // Outnumbered
        else if (adjCount >= 3) urgency = 0.85;
        else if (adjCount >= 2 && hp < 0.5) urgency = 0.75;
        // Low HP + visible enemies
        else if (hp < 0.3 && visCount >= 2) urgency = 0.7;
        // General danger
        else urgency = en * 0.4 + hp * 0.3 + st * 0.3;

        // Boss multiplier
        const boss = visibleEnemies(G).find(e => e.boss);
        if (boss) urgency = Math.min(1, urgency + 0.2);

        return clamp01(urgency * weight);
      }

      case 'bomb': {
        // Bomb urgency scales with enemy density
        const adjCount = adjacentEnemies(G).length;
        const lowHpAdj = adjacentEnemies(G).filter(e => e.hp <= 30).length;

        let urgency = 0;

        // Best case: multiple low-HP enemies that bomb can kill
        if (lowHpAdj >= 2) urgency = 0.95;
        else if (lowHpAdj >= 1 && adjCount >= 2) urgency = 0.8;
        // Boss adjacent
        else if (adjacentEnemies(G).some(e => e.boss)) urgency = 0.7;
        // Pack of enemies
        else if (adjCount >= 3) urgency = 0.85;
        else if (adjCount >= 2) urgency = 0.65;
        else urgency = en * 0.3 + hp * 0.2;

        return clamp01(urgency * weight);
      }

      case 'buff': {
        // Buff urgency depends on upcoming/active combat
        const visCount = visibleEnemies(G).length;
        const adjCount = adjacentEnemies(G).length;

        if (hasActiveBuff(p)) return 0;

        let urgency = 0;

        // Elite/boss fight → high urgency
        if (visCount > 0) {
          const hasElite = visibleEnemies(G).some(e => e.isElite || e.boss);
          if (hasElite) urgency = 0.8;
          else if (adjCount >= 2) urgency = 0.55;
          else if (visCount >= 2) urgency = 0.4;
          else urgency = 0.25;
        }

        // Deep floors make buffs more valuable
        if ((G.floor || 1) >= 4) urgency = Math.min(1, urgency + 0.1);

        // Scale with how many hits the buff would save (approximate)
        urgency = urgency * (0.8 + weight * 0.2);

        return clamp01(urgency);
      }

      case 'detection': {
        // Detection is situational — only useful when secrets remain
        if (!hasHiddenSecrets(G)) return 0;

        let urgency = 0.2; // Base: secrets exist

        // Out of combat = good time
        const visCount = visibleEnemies(G).length;
        if (visCount === 0) urgency += 0.3;

        // Deep floors: more trap danger
        if ((G.floor || 1) >= 3) urgency += 0.15;

        // Low HP makes traps more dangerous
        if (hp < 0.5) urgency += 0.1;

        // Class weight matters a lot for detection
        return clamp01(urgency * weight);
      }

      case 'gold': {
        // Gold urgency: how badly should we spend at the next shop
        const p2 = player(G);
        const reserve = 60 + ((G.floor || 1) >= 4 ? 20 : 0);
        const surplus = Math.max(0, (p2.gold || 0) - reserve);
        if (surplus <= 0) return 0;

        let urgency = clamp01(surplus / 150);

        // Need healing potions → spend gold on them
        const potions = carriedCount(G, i => i.type === 'potion');
        if (potions === 0 && hp < 0.7) urgency = Math.min(1, urgency + 0.3);

        // Late floor → gear upgrades are critical
        if ((G.floor || 1) >= 4) urgency = Math.min(1, urgency + 0.15);

        return clamp01(urgency * weight);
      }

      case 'key': {
        // Key urgency: how much do we need to open a locked door
        const doors = lockedDoorCount(G);
        if (doors === 0) return 0;

        let urgency = 0.3;

        // If we're heading to stairs and door is in the way
        const stairDist = distToStairs(G);
        if (stairDist < 15) urgency += 0.3;

        // Deep floor: progress is important
        if ((G.floor || 1) >= 3) urgency += 0.15;

        // Multiple locked doors = higher urgency
        if (doors >= 2) urgency += 0.1;

        return clamp01(urgency * weight);
      }

      default:
        return 0;
    }
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────

  const api = {
    trackResources,
    shouldUseResource,
    getResourceUrgency,

    // Expose internals for testing
    _internals: {
      hpUrgency,
      floorUrgency,
      enemyUrgency,
      stairUrgency,
      inventoryPressure,
      CLASS_WEIGHTS,
      POTION_TIERS,
      resolveItemType,
      hpRatio,
      liveEnemyCount,
      visibleEnemies,
      adjacentEnemies,
      totalIncomingDamage,
      distToStairs,
      hasHiddenSecrets,
      lockedDoorCount,
    },
  };

  // CommonJS + browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.ResourceTracker = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
