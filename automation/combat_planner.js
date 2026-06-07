// automation/combat_planner.js
// Multi-step combat planning module for the DELVE roguelike dungeon crawler bot.
// Evaluates all possible actions with 2-3 step lookahead and scores them 0-100.
// NOTE: MAP_W, MAP_H, FLOORS, TILE are already defined by constants.js and other source files.

const __DIRS = [
  { dx: 0, dy: -1, key: 'ArrowUp' },
  { dx: 0, dy: 1, key: 'ArrowDown' },
  { dx: -1, dy: 0, key: 'ArrowLeft' },
  { dx: 1, dy: 0, key: 'ArrowRight' },
];

/**
 * @typedef {Object} Action
 * @property {string} type - 'move' | 'attack' | 'ability1' | 'ability2' | 'use_item' | 'descend' | 'shop'
 * @property {string} [key] - Key to press for movement/descend
 * @property {string} [dir] - Direction label
 * @property {string} [itemId] - Item id for use_item
 * @property {string} [itemType] - Item type for use_item
 * @property {number} [targetId] - Enemy id for attack
 */

/**
 * @typedef {Object} ScoredAction
 * @property {Action} action
 * @property {number} score - 0-100
 * @property {string} [reason]
 */

/**
 * @typedef {Object} DamagePrediction
 * @property {number} incoming - Expected damage the player will receive
 * @property {number} outgoing - Expected damage the player will deal
 * @property {number} healAmount - HP recovered from items/abilities
 * @property {number} netHPChange - Net HP change from this action
 * @property {boolean} killLikely - Whether the action likely kills the target
 */

// ──────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ──────────────────────────────────────────────────────────────────────────────

function round1(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function tileAt(G, x, y) {
  if (y < 0 || y >= MAP_H || x < 0 || x >= MAP_W) return TILE.WALL;
  return G.map[y][x];
}

function isPassable(G, x, y) {
  const t = tileAt(G, x, y);
  return t !== TILE.WALL && t !== TILE.LOCKED_DOOR;
}

function tileKey(x, y) {
  return y * MAP_W + x;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function liveEnemies(G) {
  return G.enemies.filter(e => !e.dying && !e.isPet);
}

function visibleEnemies(G) {
  return liveEnemies(G).filter(e => G.visible.has(tileKey(e.x, e.y)));
}

function adjacentEnemies(G) {
  const p = G.player;
  return liveEnemies(G).filter(e => manhattan(e, p) === 1);
}

function carriedItems(G, type) {
  return G.items.filter(i => i.carried && i.type === type);
}

function hasKey(G) {
  return G.items.some(i => i.carried && i.type === 'key');
}

function getStat(G, statName) {
  let base = G.player[statName] || 0;
  let w = G.player.weapon ? (G.player.weapon[statName] || 0) : 0;
  let a = G.player.armor ? (G.player.armor[statName] || 0) : 0;
  return base + w + a;
}

function weaponPower(G) {
  const p = G.player;
  const it = p.weapon;
  if (!it) return p.class === 'monk' ? Math.ceil(p.lvl / 2) : 0;
  let power = it.atk || 0;
  if (p.class === 'mage' && (it.sym === '\u2666' || /staff|rod|wand|scythe/i.test(it.name || ''))) {
    power += Math.floor(power / 5);
  }
  return power;
}

function armorPower(G) {
  return G.player.armor ? (G.player.armor.def || 0) : 0;
}

function totalAtk(G) {
  const p = G.player;
  let total = (p.atk || 0) + weaponPower(G);
  if (p.class === 'barbarian') total += Math.floor((p.maxHp - p.hp) / 6);
  if (p.strengthTurns > 0) total += 10;
  const isMagic = p.weapon && (p.weapon.sym === '\u2666' || /staff|rod|wand|scythe/i.test(p.weapon.name || ''));
  if (p.magicMult && isMagic) total = Math.floor(total * p.magicMult);
  return total;
}

function totalDef(G) {
  return (G.player.def || 0) + armorPower(G);
}

function playerDodgeChance(G) {
  let dodge = getStat(G, 'dodgeBonus');
  if (G.player.class === 'rogue') dodge += 0.4;
  return dodge;
}

function enemyMaxDamage(G, en) {
  let maxHit = Math.max(1, en.atk - totalDef(G) + 2);
  if (G.player.shieldWallTurns > 0) maxHit = Math.ceil(maxHit * 3 / 5);
  if (G.player.bloodlustTurns > 0) maxHit = Math.ceil(maxHit * 23 / 20);
  return maxHit;
}

function enemyMinDamage(G, en) {
  return Math.max(1, en.atk - totalDef(G));
}

function expectedEnemyDamage(G, en) {
  const min = enemyMinDamage(G, en);
  const max = enemyMaxDamage(G, en);
  const dodge = playerDodgeChance(G);
  const dodgeAvoidance = dodge;
  const avgRaw = (min + max) / 2;
  return round1(avgRaw * (1 - dodgeAvoidance));
}

function totalAdjacentIncoming(G) {
  return adjacentEnemies(G).reduce((sum, en) => sum + enemyMaxDamage(G, en), 0);
}

function expectedAdjacentIncoming(G) {
  return adjacentEnemies(G).reduce((sum, en) => sum + expectedEnemyDamage(G, en), 0);
}

function normalAttackDamage(G, en) {
  return Math.max(1, totalAtk(G) - en.def);
}

function maxAttackDamage(G, en) {
  return Math.max(1, totalAtk(G) - en.def + 2);
}

function bashDamage(G, en) {
  return Math.max(1, Math.floor(normalAttackDamage(G, en) * 1.5));
}

function isBowEquipped(G) {
  return G.player.weapon && (G.player.weapon.sym === '\u2666' || /bow/i.test(G.player.weapon.name || ''));
}

function rangedMaxRange(G) {
  return G.player.class === 'ranger' && isBowEquipped(G) ? 3 : 2;
}

function hasKnownStairs(G) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (G.map[y][x] === TILE.STAIRS && G.seen.has(tileKey(x, y))) return { x, y };
    }
  }
  return null;
}

function isMapCleared(G) {
  const p = G.player;
  const q = [{ x: p.x, y: p.y }];
  const visited = new Set([`${p.x},${p.y}`]);
  const scanDirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  while (q.length > 0) {
    const cur = q.shift();
    const enemies = liveEnemies(G).filter(e => e.x === cur.x && e.y === cur.y);
    if (enemies.length > 0) return false;

    const floorItems = G.items.filter(i => !i.carried && i.x === cur.x && i.y === cur.y);
    if (floorItems.some(i => i.type === 'key' || i.type === 'upgrade')) return false;

    if (G.shops && G.shops.some(s => s.x === cur.x && s.y === cur.y)) {
      if (s.stock && s.stock.some(item => item && !item.sold)) return false;
    }

    for (const [dx, dy] of scanDirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      if (!isPassable(G, nx, ny)) continue;
      if (visited.has(key)) continue;
      if (liveEnemies(G).some(e => e.x === nx && e.y === ny)) continue;
      visited.add(key);
      q.push({ x: nx, y: ny });
    }
  }
  return true;
}

function xpToNextLevel(G) {
  const p = G.player;
  const xpNeeded = p.xpNext || Math.round((p.xp || 0) * 1.6);
  return Math.max(0, xpNeeded - (p.xp || 0));
}

function xpFromEnemy(en) {
  return Math.ceil(en.xp * 1);
}

function hpPercent(G) {
  return G.player.maxHp > 0 ? G.player.hp / G.player.maxHp : 0;
}

function countCarriedType(G, type) {
  return G.items.filter(i => i.carried && i.type === type).length;
}

function nearestStairsDist(G) {
  const stairs = hasKnownStairs(G);
  if (!stairs) return Infinity;
  return manhattan(G.player, stairs);
}

// ──────────────────────────────────────────────────────────────────────────────
// Projected State — lightweight simulation for lookahead
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Deep-clone only the fields needed for combat simulation.
 * Avoids cloning the full G object for performance.
 */
function clonePlayerState(G) {
  const p = G.player;
  return {
    x: p.x,
    y: p.y,
    hp: p.hp,
    maxHp: p.maxHp,
    atk: p.atk,
    def: p.def,
    class: p.class,
    lvl: p.lvl,
    strengthTurns: p.strengthTurns || 0,
    shieldWallTurns: p.shieldWallTurns || 0,
    vanishTurns: p.vanishTurns || 0,
    bloodlustTurns: p.bloodlustTurns || 0,
    rootedTurns: p.rootedTurns || 0,
    poisonedTurns: p.poisonedTurns || 0,
    weapon: p.weapon,
    armor: p.armor,
    magicMult: p.magicMult,
    xp: p.xp || 0,
    xpNext: p.xpNext || 0,
    gold: p.gold || 0,
  };
}

function cloneEnemyState(en) {
  return {
    id: en.id,
    x: en.x,
    y: en.y,
    hp: en.hp,
    maxHp: en.maxHp,
    atk: en.atk,
    def: en.def,
    name: en.name,
    boss: en.boss,
    phase: en.phase,
    enrage: en.enrage,
    revive: en.revive,
    reviveTurns: en.reviveTurns || 0,
    raiseCorpseTarget: en.raiseCorpseTarget,
    raiseCorpseTurns: en.raiseCorpseTurns || 0,
    stunnedTurns: en.stunnedTurns || 0,
    regen: en.regen || 0,
    vampiric: en.vampiric || 0,
    freezeChance: en.freezeChance || 0,
    dodge: en.dodge || 0,
    dying: en.dying,
  };
}

function simulateEnemyTurn(proj, en, playerState) {
  if (en.dying || en.hp <= 0) return;
  if (en.stunnedTurns > 0) { en.stunnedTurns--; return; }
  if (en.reviveTurns > 0) { en.reviveTurns--; if (en.reviveTurns <= 0) en.hp = Math.floor(en.maxHp / 2); return; }
  if (en.regen > 0 && en.hp < en.maxHp) {
    en.hp = Math.min(en.maxHp, en.hp + Math.floor(en.maxHp * en.regen));
  }

  const dist = chebyshev(en, playerState);
  if (dist > 1) {
    // Enemy would move toward player, but for simulation we just note proximity change
    return;
  }

  // Enemy attacks player
  let edm = Math.max(1, en.atk - ((playerState.def || 0) + (playerState.armor ? (playerState.armor.def || 0) : 0)));
  if (en.enrage && en.hp <= en.maxHp / 2) edm = Math.floor(edm * 1.5);
  if (playerState.shieldWallTurns > 0) edm = Math.ceil(edm * 3 / 5);
  if (playerState.bloodlustTurns > 0) edm = Math.ceil(edm * 23 / 20);

  // Dodge chance
  let dodge = (playerState.class === 'rogue' ? 0.4 : 0) + (playerState.armor ? (playerState.armor.dodgeBonus || 0) : 0) + (playerState.weapon ? (playerState.weapon.dodgeBonus || 0) : 0);
  const dodged = Math.random() < dodge;

  if (!dodged) {
    proj.incoming += edm;
    if (en.vampiric && edm > 0) {
      en.hp = Math.min(en.maxHp, en.hp + Math.floor(edm * en.vampiric));
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// predictDamage
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Predict the HP change from taking a given action.
 * Simulates one full round (player action + enemy responses).
 *
 * @param {Action} action - The action to evaluate
 * @param {Object} G - The game state (requires player, enemies, items, map, visible, seen)
 * @returns {DamagePrediction} Predicted outcome of the action
 */
function predictDamage(action, G) {
  const result = { incoming: 0, outgoing: 0, healAmount: 0, netHPChange: 0, killLikely: false };
  const p = G.player;
  const adj = adjacentEnemies(G);
  const vis = visibleEnemies(G);

  // ── Action-specific outgoing/heal ──
  switch (action.type) {
    case 'attack': {
      const en = G.enemies.find(e => e.id === action.targetId);
      if (!en) break;
      const minDmg = normalAttackDamage(G, en);
      const maxDmg = maxAttackDamage(G, en);
      let mult = 1;
      if (p.vanishTurns > 0) mult *= 2;
      result.outgoing = Math.round(((minDmg + maxDmg) / 2) * mult);
      if (result.outgoing >= en.hp) result.killLikely = true;
      // Counterattack from this enemy
      result.incoming = expectedEnemyDamage(G, en);
      // Bloodlust heal
      if (p.bloodlustTurns > 0) {
        result.healAmount += Math.floor(result.outgoing * 0.5);
      }
      break;
    }

    case 'ability1': {
      const classResult = predictAbility1(G);
      result.outgoing = classResult.outgoing;
      result.healAmount += classResult.heal;
      result.killLikely = classResult.killLikely;
      // Counterattacks from adjacent enemies (after ability resolves)
      for (const en of adj) {
        if (!en.dying && en.hp > 0) {
          result.incoming += expectedEnemyDamage(G, en);
        }
      }
      break;
    }

    case 'ability2': {
      const classResult = predictAbility2(G);
      result.outgoing = classResult.outgoing;
      result.healAmount += classResult.heal;
      result.killLikely = classResult.killLikely;
      if (classResult.escapes) {
        result.incoming = 0;
      } else {
        for (const en of adj) {
          if (!en.dying && en.hp > 0) {
            result.incoming += expectedEnemyDamage(G, en);
          }
        }
      }
      break;
    }

    case 'use_item': {
      const item = G.items.find(i => i.id === action.itemId);
      if (item) {
        if (item.type === 'potion') {
          result.healAmount = Math.min(item.heal || 0, p.maxHp - p.hp);
          result.outgoing = 0;
        } else if (item.type === 'potion_buff') {
          result.outgoing = 0;
          // Buffed attacks deal more next turn
        } else if (item.type === 'bomb') {
          let bombHits = 0;
          let bombKills = 0;
          for (const en of adj) {
            if (!en.dying) {
              const bombDmg = 30;
              result.outgoing += bombDmg;
              if (en.hp <= bombDmg) {
                result.killLikely = true;
                bombKills++;
              }
              bombHits++;
            }
          }
          if (bombHits === 0) result.outgoing = 0;
          // Dead enemies don't counterattack — only surviving adjacent enemies hit us
          const survivors = adj.filter(e => !e.dying && e.hp > 30);
          for (const en of survivors) {
            result.incoming += expectedEnemyDamage(G, en);
          }
          result.netHPChange = result.healAmount - result.incoming;
          return result;
        } else if (item.type === 'scroll_teleport') {
          result.incoming = 0;
          result.outgoing = 0;
        } else if (item.type === 'scroll') {
          result.outgoing = 0;
        }
      }
      // Enemies still attack if adjacent and we don't teleport
      if (action.itemType !== 'scroll_teleport') {
        for (const en of adj) {
          if (!en.dying && en.hp > 0) {
            result.incoming += expectedEnemyDamage(G, en);
          }
        }
      }
      break;
    }

    case 'move': {
      const dir = _DIRS.find(d => d.key === action.key);
      if (!dir) break;
      const nx = p.x + dir.dx;
      const ny = p.y + dir.dy;
      // Moving into an enemy triggers attack (melee), so we'd hit that enemy
      const targetEn = G.enemies.find(e => e.x === nx && e.y === ny && !e.dying);
      if (targetEn) {
        const minDmg = normalAttackDamage(G, targetEn);
        const maxDmg = maxAttackDamage(G, targetEn);
        result.outgoing = Math.round((minDmg + maxDmg) / 2);
        if (result.outgoing >= targetEn.hp) result.killLikely = true;
        result.incoming = expectedEnemyDamage(G, targetEn);
        if (p.bloodlustTurns > 0) result.healAmount += Math.floor(result.outgoing * 0.5);
      } else {
        // Moving to open tile — enemies near new position attack
        for (const en of vis) {
          const distToNew = manhattan(en, { x: nx, y: ny });
          if (distToNew <= 1) {
            result.incoming += expectedEnemyDamage(G, en);
          }
        }
      }
      break;
    }

    case 'descend': {
      result.incoming = 0;
      result.outgoing = 0;
      break;
    }

    case 'shop': {
      result.incoming = 0;
      result.outgoing = 0;
      break;
    }
  }

  result.netHPChange = result.healAmount - result.incoming;
  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// Ability Prediction Helpers
// ──────────────────────────────────────────────────────────────────────────────

function predictAbility1(G) {
  const p = G.player;
  const result = { outgoing: 0, heal: 0, killLikely: false, escapes: false };
  const adj = adjacentEnemies(G);
  const vis = visibleEnemies(G);
  const atk = totalAtk(G);

  switch (p.class) {
    case 'warrior': {
      // BASH: 1.5x damage to nearest adjacent
      const target = adj.sort((a, b) => manhattan(a, p) - manhattan(b, p))[0];
      if (target) {
        result.outgoing = bashDamage(G, target);
        if (result.outgoing >= target.hp) result.killLikely = true;
      }
      break;
    }
    case 'rogue': {
      // DASH: free moves, no direct damage
      result.outgoing = 0;
      result.escapes = true;
      break;
    }
    case 'mage': {
      // FIREBALL: damage target and adjacent enemies
      const target = vis.sort((a, b) => manhattan(a, p) - manhattan(b, p))[0];
      if (target) {
        for (const en of G.enemies) {
          if (!en.dying && chebyshev(en, target) <= 1) {
            const dmg = Math.max(1, atk - en.def);
            result.outgoing += dmg;
            if (en.hp <= dmg) result.killLikely = true;
          }
        }
      }
      break;
    }
    case 'paladin': {
      // SMITE: damage + stun nearest adjacent
      const target = adj.sort((a, b) => manhattan(a, p) - manhattan(b, p))[0];
      if (target) {
        result.outgoing = Math.max(1, atk - target.def);
        if (result.outgoing >= target.hp) result.killLikely = true;
      }
      break;
    }
    case 'ranger': {
      // PIERCING SHOT: damage all enemies in a line
      const aligned = vis.filter(e => e.x === p.x || e.y === p.y || Math.abs(e.x - p.x) === Math.abs(e.y - p.y));
      for (const en of aligned) {
        const dmg = Math.max(1, atk - en.def);
        result.outgoing += dmg;
        if (en.hp <= dmg) result.killLikely = true;
      }
      break;
    }
    case 'barbarian': {
      // CLEAVE: damage all adjacent
      for (const en of adj) {
        const dmg = Math.max(1, atk - en.def);
        result.outgoing += dmg;
        if (en.hp <= dmg) result.killLikely = true;
      }
      break;
    }
    case 'necromancer': {
      // SIPHON LIFE: damage + heal for same amount
      const target = adj.sort((a, b) => manhattan(a, p) - manhattan(b, p))[0];
      if (target) {
        const dmg = Math.max(1, atk - target.def);
        result.outgoing = dmg;
        result.heal = dmg;
        if (dmg >= target.hp) result.killLikely = true;
      }
      break;
    }
    case 'monk': {
      // PUSH KICK: damage, 2x if wall slam
      const target = adj.sort((a, b) => manhattan(a, p) - manhattan(b, p))[0];
      if (target) {
        let baseDmg = Math.max(1, atk - target.def);
        const dx = Math.sign(target.x - p.x), dy = Math.sign(target.y - p.y);
        const nx = target.x + dx, ny = target.y + dy;
        const wallSlam = nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H ||
          G.map[ny][nx] === TILE.WALL ||
          G.enemies.some(e => e !== target && !e.dying && e.x === nx && e.y === ny);
        result.outgoing = wallSlam ? baseDmg * 2 : baseDmg;
        if (result.outgoing >= target.hp) result.killLikely = true;
      }
      break;
    }
  }

  return result;
}

function predictAbility2(G) {
  const p = G.player;
  const result = { outgoing: 0, heal: 0, killLikely: false, escapes: false };

  if (p.lvl < 5 || G.ability2Cooldown > 0) return result;

  const adj = adjacentEnemies(G);
  const vis = visibleEnemies(G);
  const atk = totalAtk(G);

  switch (p.class) {
    case 'warrior': {
      // SHIELD WALL: damage reduction, no outgoing
      result.outgoing = 0;
      break;
    }
    case 'rogue': {
      // VANISH: invisible, next attack 2x
      result.outgoing = 0;
      result.escapes = true;
      break;
    }
    case 'mage': {
      // BLINK: teleport to safe tile
      result.outgoing = 0;
      result.escapes = true;
      break;
    }
    case 'paladin': {
      // LAY ON HANDS: heal 20% maxHp
      result.heal = Math.floor(p.maxHp * 0.2);
      break;
    }
    case 'ranger': {
      // BEAR TRAP + jump back
      result.outgoing = 5; // trap damage
      result.escapes = true;
      break;
    }
    case 'barbarian': {
      // BLOODLUST: vampiric attacks for 3 turns
      result.outgoing = 0;
      break;
    }
    case 'necromancer': {
      // RAISE DEAD: mark enemy
      result.outgoing = 0;
      break;
    }
    case 'monk': {
      // FLURRY: 3 attacks
      const target = adj.sort((a, b) => manhattan(a, p) - manhattan(b, p))[0];
      if (target) {
        let total = 0;
        for (let i = 0; i < 3; i++) {
          const dmg = Math.max(1, atk - target.def);
          total += dmg;
          if (target.hp - total <= 0) { result.killLikely = true; break; }
        }
        result.outgoing = total;
      }
      break;
    }
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────────
// evaluateAction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Score a single action from 0-100 based on projected outcome.
 * 0 = catastrophic (guaranteed death), 100 = optimal play.
 *
 * Scoring priorities:
 *   1. Survival — avoid actions leading to death
 *   2. Healing — valued when HP is low and enemies are near
 *   3. Teleporting — valued when surrounded and can't escape
 *   4. Fighting — valued when: enemy is weak, we have buffs, we need XP
 *   5. Exploring — valued when: stairs unknown, need items, we're healthy
 *   6. Descending — valued when: explored enough, healthy, stocked
 *
 * @param {Action} action - The action to score
 * @param {Object} G - The game state
 * @param {Object} [strategy] - Optional strategy overrides
 * @returns {number} Score from 0-100
 */
function evaluateAction(action, G, strategy = {}) {
  const p = G.player;
  const hpRatio = hpPercent(G);
  const adj = adjacentEnemies(G);
  const vis = visibleEnemies(G);
  const totalIncoming = totalAdjacentIncoming(G);
  const expIncoming = expectedAdjacentIncoming(G);
  const stairs = hasKnownStairs(G);
  const mapCleared = isMapCleared(G);
  const explored = G.seen.size / (MAP_W * MAP_H);
  const potions = carriedItems(G, 'potion');
  const teleports = carriedItems(G, 'scroll_teleport');
  const bombs = carriedItems(G, 'bomb');
  const buffs = carriedItems(G, 'potion_buff');
  const onBossFloor = G.floor >= FLOORS;

  const exitHp = strategy.exitHp || 0.7;
  const combatHpFloor = strategy.combatHpFloor || 0.45;
  const exploreThreshold = strategy.exploreThreshold || 0.35;
  const potionTarget = strategy.potionTarget ?? 3;
  const teleportTarget = strategy.teleportTarget ?? 1;

  const prediction = predictDamage(action, G);
  const projectedHP = p.hp + prediction.netHPChange;
  const projectedHPRatio = p.maxHp > 0 ? projectedHP / p.maxHp : 0;

  let score = 50; // baseline

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: SURVIVAL CHECK — death = 0
  // ══════════════════════════════════════════════════════════════════════════

  if (projectedHP <= 0) return 0;

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: ACTION-TYPE SCORING
  // ══════════════════════════════════════════════════════════════════════════

  switch (action.type) {

    // ── MOVE ──────────────────────────────────────────────────────────────
    case 'move': {
      const dir = _DIRS.find(d => d.key === action.key);
      if (!dir) { score = 0; break; }
      const nx = p.x + dir.dx;
      const ny = p.y + dir.dy;
      if (!isPassable(G, nx, ny)) { score = 0; break; }

      const movingIntoEnemy = G.enemies.find(e => e.x === nx && e.y === ny && !e.dying && !e.isPet);
      if (movingIntoEnemy) {
        // Treat as attack
        score = evaluateAction({ type: 'attack', targetId: movingIntoEnemy.id }, G, strategy);
        break;
      }

      // Check if moving toward stairs
      let stairBonus = 0;
      if (stairs) {
        const distBefore = manhattan(p, stairs);
        const distAfter = manhattan({ x: nx, y: ny }, stairs);
        if (distAfter < distBefore) stairBonus = 15;
      }

      // Check if moving toward visible items
      let itemBonus = 0;
      const nearbyItems = G.items.filter(i => !i.carried && i.x === nx && i.y === ny);
      if (nearbyItems.length > 0) itemBonus = 10;

      // Danger of new position: how many enemies are adjacent to (nx, ny)
      let danger = 0;
      for (const en of vis) {
        if (manhattan(en, { x: nx, y: ny }) <= 1) {
          danger += expectedEnemyDamage(G, en);
        }
      }

      // Trap danger
      const trapDanger = (G.traps || []).some(t => t.x === nx && t.y === ny && !t.triggered && !t.revealed) ? 15 : 0;

      // Kiting benefit: moving away from enemies
      let kiteBonus = 0;
      if (adj.length > 0 && p.hp < p.maxHp * combatHpFloor) {
        const currentMinDist = Math.min(...adj.map(e => chebyshev(e, p)));
        const newMinDist = Math.min(...adj.map(e => chebyshev(e, { x: nx, y: ny })));
        if (newMinDist > currentMinDist) kiteBonus = 10;
      }

      score = 40 + stairBonus + itemBonus + kiteBonus - danger * 3 - trapDanger;
      break;
    }

    // ── ATTACK ────────────────────────────────────────────────────────────
    case 'attack': {
      const en = G.enemies.find(e => e.id === action.targetId);
      if (!en || en.dying) { score = 0; break; }

      const dist = manhattan(p, en);
      if (dist > rangedMaxRange(G)) { score = 5; break; }

      const dmg = normalAttackDamage(G, en);
      const maxDmg = maxAttackDamage(G, en);
      const isKillShot = en.hp <= maxDmg;
      const hitsToKill = Math.ceil(en.hp / dmg);

      // ── Offense scoring ──
      let offense = 0;
      if (isKillShot) {
        offense = 35;
        // XP gain bonus — especially valuable if close to leveling
        const xpGain = xpFromEnemy(en);
        const xpNeeded = xpToNextLevel(G);
        if (xpGain >= xpNeeded && xpNeeded > 0) offense += 15; // level up!
      } else {
        offense = clamp(15 - hitsToKill * 2, 0, 20);
      }

      // Boss priority
      if (en.boss) offense += 10;

      // ── Defense scoring ──
      let defense = 0;
      const counterDmg = expectedEnemyDamage(G, en);
      if (prediction.killLikely) {
        defense = 20; // no counterattack if we kill
      } else {
        defense = clamp(10 - counterDmg * 2, -10, 10);
      }

      // ── Risk assessment ──
      let risk = 0;
      if (projectedHP <= p.maxHp * 0.2) risk -= 20;
      if (projectedHP <= p.maxHp * 0.35 && !prediction.killLikely) risk -= 10;

      // ── Value of killing this enemy ──
      let value = 0;
      if (en.isElite) value += 10;
      if (en.boss) value += 15;
      if (adj.length >= 2 && isKillShot) value += 8; // reducing incoming pressure

      // ── Buffs active bonus ──
      let buffBonus = 0;
      if (p.strengthTurns > 0) buffBonus += 5;
      if (p.vanishTurns > 0) buffBonus += 8;
      if (p.bloodlustTurns > 0) buffBonus += 3;

      score = 45 + offense + defense + value + buffBonus + risk;
      break;
    }

    // ── ABILITY 1 ─────────────────────────────────────────────────────────
    case 'ability1': {
      if (G.ability1Cooldown > 0) { score = 0; break; }
      if (adj.length === 0 && !['mage', 'ranger', 'necromancer'].includes(p.class)) { score = 10; break; }

      const abilityResult = predictAbility1(G);
      let abilityScore = 20;

      // Damage output
      if (abilityResult.outgoing > 0) {
        const killBonus = abilityResult.killLikely ? 20 : 0;
        abilityScore += clamp(abilityResult.outgoing / 5, 0, 20) + killBonus;
      }

      // Healing (necromancer siphon)
      if (abilityResult.heal > 0) {
        const healValue = hpRatio < 0.5 ? abilityResult.heal * 2 : abilityResult.heal;
        abilityScore += clamp(healValue / 3, 0, 15);
      }

      // Class-specific value adjustments
      switch (p.class) {
        case 'warrior':
          if (adj.length > 0) abilityScore += 5;
          break;
        case 'rogue':
          if (abilityResult.escapes && adj.length > 0 && hpRatio < 0.5) abilityScore += 15;
          break;
        case 'mage':
          if (vis.length >= 2) abilityScore += 10;
          break;
        case 'paladin':
          if (adj.length > 0) {
            const target = adj[0];
            if (target.stunnedTurns === 0 && target.hp > normalAttackDamage(G, target)) abilityScore += 8;
          }
          break;
        case 'ranger':
          if (vis.length >= 2) abilityScore += 10;
          break;
        case 'barbarian':
          if (adj.length >= 2) abilityScore += 10;
          break;
        case 'necromancer':
          if (adj.length > 0) abilityScore += 5;
          if (abilityResult.heal > 0 && hpRatio < 0.6) abilityScore += 10;
          break;
        case 'monk':
          if (adj.length > 0) {
            const wallSlamTarget = adj.find(e => {
              const dx = Math.sign(e.x - p.x), dy = Math.sign(e.y - p.y);
              const nx = e.x + dx, ny = e.y + dy;
              return nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H || G.map[ny][nx] === TILE.WALL;
            });
            if (wallSlamTarget) abilityScore += 10;
          }
          break;
      }

      // Risk
      if (projectedHP <= p.maxHp * 0.2) abilityScore -= 15;

      score = abilityScore;
      break;
    }

    // ── ABILITY 2 ─────────────────────────────────────────────────────────
    case 'ability2': {
      if (p.lvl < 5 || G.ability2Cooldown > 0) { score = 0; break; }

      const abilityResult = predictAbility2(G);
      let ability2Score = 25;

      // Escape value when surrounded and low
      if (abilityResult.escapes && adj.length >= 2 && hpRatio < 0.5) {
        ability2Score += 25;
      }

      // Healing value (paladin)
      if (abilityResult.heal > 0) {
        const missingHP = p.maxHp - p.hp;
        const healEfficiency = Math.min(abilityResult.heal, missingHP) / missingHP;
        ability2Score += healEfficiency * 20;
        if (hpRatio < 0.4) ability2Score += 10;
      }

      // Damage output (monk flurry)
      if (abilityResult.outgoing > 0) {
        const killBonus = abilityResult.killLikely ? 20 : 0;
        ability2Score += clamp(abilityResult.outgoing / 5, 0, 20) + killBonus;
      }

      // Warrior shield wall value
      if (p.class === 'warrior' && totalIncoming >= p.hp * 0.3) {
        ability2Score += 20;
      }

      // Rogue vanish value
      if (p.class === 'rogue' && abilityResult.escapes && adj.length > 0) {
        ability2Score += 15;
      }

      // Bloodlust value (barbarian)
      if (p.class === 'barbarian' && adj.length >= 1 && hpRatio > 0.45) {
        ability2Score += 10;
      }

      // Risk
      if (projectedHP <= p.maxHp * 0.2 && !abilityResult.escapes) ability2Score -= 15;

      score = ability2Score;
      break;
    }

    // ── USE ITEM ──────────────────────────────────────────────────────────
    case 'use_item': {
      const item = G.items.find(i => i.id === action.itemId);
      if (!item) { score = 0; break; }

      if (item.type === 'potion') {
        const missingHP = p.maxHp - p.hp;
        const healAmount = Math.min(item.heal || 0, missingHP);
        if (healAmount <= 0) { score = 5; break; } // Already full

        let potionScore = 15;

        // Healing value scales with urgency
        if (hpRatio < 0.2) potionScore += 35;
        else if (hpRatio < 0.35) potionScore += 25;
        else if (hpRatio < 0.5) potionScore += 15;
        else if (hpRatio < 0.7) potionScore += 5;

        // Adjacent enemies make healing more valuable
        if (adj.length > 0) potionScore += 10;

        // Waste penalty: don't use when almost full
        if (healAmount < (item.heal || 0) * 0.3) potionScore -= 10;

        // Potion scarcity: fewer potions = more reluctance
        if (potions.length <= 1) potionScore -= 5;

        // Projected safety after heal
        const postHealRatio = (p.hp + healAmount) / p.maxHp;
        if (postHealRatio > 0.6) potionScore += 5;

        score = potionScore;
      } else if (item.type === 'potion_buff') {
        let buffScore = 15;

        // Buff is more valuable with visible enemies
        if (vis.length > 0) buffScore += 10;
        if (adj.length >= 2) buffScore += 8;
        if (onBossFloor) buffScore += 10;

        // Already buffed? Less value
        if (p.strengthTurns > 0) buffScore -= 15;

        score = buffScore;
      } else if (item.type === 'bomb') {
        let bombScore = 10;

        // Bomb value scales with number of adjacent enemies
        const bombTargets = adj.filter(e => !e.dying);
        if (bombTargets.length >= 3) bombScore += 30;
        else if (bombTargets.length >= 2) bombScore += 20;
        else if (bombTargets.length >= 1) {
          const weakTargets = bombTargets.filter(e => e.hp <= 30);
          bombScore += weakTargets.length > 0 ? 15 : 5;
        }

        // Emergency bomb
        if (hpRatio < 0.35 && bombTargets.length >= 2) bombScore += 20;

        // Boss bomb
        if (bombTargets.some(e => e.boss)) bombScore += 15;

        score = bombScore;
      } else if (item.type === 'scroll_teleport') {
        let tpScore = 10;

        // Teleport value when surrounded
        if (adj.length >= 3) tpScore += 30;
        else if (adj.length >= 2 && hpRatio < 0.5) tpScore += 25;
        else if (adj.length >= 1 && hpRatio < 0.25) tpScore += 20;

        // Lethal situation
        if (totalIncoming >= p.hp) tpScore += 30;

        // Low HP with visible enemies
        if (hpRatio < 0.3 && vis.length >= 2) tpScore += 20;

        // Penalty if healthy and no enemies
        if (hpRatio > 0.7 && adj.length === 0) tpScore -= 10;

        // Scarcity
        if (teleports.length <= 1 && hpRatio > 0.5) tpScore -= 5;

        score = tpScore;
      } else if (item.type === 'scroll') {
        // Detection scroll
        let detectScore = 15;
        const hasUnrevealedTraps = (G.traps || []).some(t => !t.revealed && !t.triggered);
        const hasSecretDoors = G.map.some(row => row.some(t => t === TILE.SECRET_DOOR));
        if (hasUnrevealedTraps) detectScore += 10;
        if (hasSecretDoors) detectScore += 10;
        if (adj.length > 0) detectScore -= 5;
        score = detectScore;
      } else {
        score = 10;
      }
      break;
    }

    // ── DESCEND ───────────────────────────────────────────────────────────
    case 'descend': {
      if (tileAt(G, p.x, p.y) !== TILE.STAIRS) { score = 0; break; }
      if (G.floor >= FLOORS) { score = 0; break; }

      let descendScore = 20;

      // Map explored enough?
      if (explored >= exploreThreshold) descendScore += 20;
      if (mapCleared) descendScore += 15;

      // HP healthy enough?
      if (hpRatio >= exitHp) descendScore += 15;
      else if (hpRatio < 0.5) descendScore -= 20;

      // Have potions for next floor?
      if (potions.length >= 2) descendScore += 10;
      else if (potions.length === 0) descendScore -= 10;

      // Enemies nearby? Don't descend
      if (adj.length > 0) descendScore -= 25;
      if (vis.length > 0) descendScore -= 10;

      // Boss floor urgency
      if (onBossFloor) descendScore -= 20;

      // Low HP urgency — descend to get floor transition heal
      if (hpRatio < 0.3 && potions.length === 0) descendScore += 10;

      score = descendScore;
      break;
    }

    // ── SHOP ──────────────────────────────────────────────────────────────
    case 'shop': {
      const shop = G.shops && G.shops.find(s =>
        manhattan(s, p) <= 1
      );
      if (!shop) { score = 0; break; }

      let shopScore = 15;

      // Check if shop has useful items
      const usefulItems = (shop.stock || []).filter(item => {
        if (item.sold) return false;
        if (p.gold < item.price) return false;
        if (item.type === 'potion' && potions.length < potionTarget) return true;
        if (item.type === 'scroll_teleport' && teleports.length < teleportTarget) return true;
        if (item.type === 'bomb' && bombs.length < (strategy.bombTarget || 1)) return true;
        if (item.type === 'upgrade') return true;
        if (item.type === 'weapon' || item.type === 'armor') return true;
        return false;
      });

      shopScore += usefulItems.length * 5;

      // Don't shop when in danger
      if (adj.length > 0) shopScore -= 20;
      if (hpRatio < 0.4) shopScore -= 10;

      // Need gold reserve
      const goldReserve = strategy.goldReserve || 60;
      if (p.gold < goldReserve) shopScore -= 10;

      score = shopScore;
      break;
    }

    default:
      score = 0;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3: GLOBAL MODIFIERS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Panic mode ──
  if (hpRatio < 0.3) {
    if (action.type === 'use_item' && action.itemType === 'potion') score += 10;
    if (action.type === 'use_item' && action.itemType === 'scroll_teleport') score += 8;
    if (action.type === 'move') {
      // Prefer moving toward stairs when panicking
      if (stairs && manhattan(p, stairs) < Infinity) {
        const dir = _DIRS.find(d => d.key === action.key);
        if (dir) {
          const distAfter = manhattan({ x: p.x + dir.dx, y: p.y + dir.dy }, stairs);
          const distBefore = manhattan(p, stairs);
          if (distAfter < distBefore) score += 12;
        }
      }
    }
  }

  // ── Stairs known and should head there ──
  if (stairs && explored >= exploreThreshold && hpRatio < 0.5) {
    if (action.type === 'move') {
      const dir = _DIRS.find(d => d.key === action.key);
      if (dir) {
        const distAfter = manhattan({ x: p.x + dir.dx, y: p.y + dir.dy }, stairs);
        const distBefore = manhattan(p, stairs);
        if (distAfter < distBefore) score += 8;
      }
    }
    if (action.type === 'descend') score += 15;
  }

  // ── XP close to level-up bonus ──
  if (action.type === 'attack' && prediction.killLikely) {
    const en = G.enemies.find(e => e.id === action.targetId);
    if (en) {
      const xpGain = xpFromEnemy(en);
      const xpNeeded = xpToNextLevel(G);
      if (xpGain >= xpNeeded && xpNeeded > 0) score += 10;
    }
  }

  // ── Overwhelmed penalty: many adjacent enemies and low HP ──
  if (adj.length >= 3 && hpRatio < 0.5) {
    if (action.type !== 'use_item' && action.itemType !== 'scroll_teleport') {
      score -= 10;
    }
  }

  return clamp(Math.round(score), 0, 100);
}

// ──────────────────────────────────────────────────────────────────────────────
// planCombat
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate all possible actions and return the best one.
 * Performs a 1-step lookahead (simulate each action, score the result).
 *
 * @param {Object} G - The game state
 * @param {Object} [strategy] - Optional strategy overrides
 * @returns {ScoredAction} The best action with its score and reasoning
 */
function planCombat(G, strategy = {}) {
  const p = G.player;
  const actions = [];

  if (G.gameOver || G.won) {
    return { action: { type: 'none' }, score: 0, reason: 'game over' };
  }

  const adj = adjacentEnemies(G);
  const vis = visibleEnemies(G);
  const stairs = hasKnownStairs(G);

  // ── Generate Movement Actions ──
  for (const dir of _DIRS) {
    const nx = p.x + dir.dx;
    const ny = p.y + dir.dy;
    if (!isPassable(G, nx, ny)) continue;

    const onEnemy = G.enemies.find(e => e.x === nx && e.y === ny && !e.dying && !e.isPet);
    if (onEnemy) {
      // Moving onto an enemy is effectively an attack
      actions.push({
        action: { type: 'attack', targetId: onEnemy.id },
        score: 0,
        reason: 'move-attack'
      });
    } else {
      actions.push({
        action: { type: 'move', key: dir.key, dir: dir.key },
        score: 0,
        reason: 'move'
      });
    }
  }

  // ── Generate Attack Actions (adjacent enemies) ──
  for (const en of adj) {
    actions.push({
      action: { type: 'attack', targetId: en.id },
      score: 0,
      reason: 'melee'
    });
  }

  // ── Generate Ranged Attack Actions ──
  const maxRange = rangedMaxRange(G);
  for (const en of vis) {
    const dist = chebyshev(en, p);
    if (dist >= 2 && dist <= maxRange) {
      actions.push({
        action: { type: 'attack', targetId: en.id },
        score: 0,
        reason: 'ranged'
      });
    }
  }

  // ── Generate Ability 1 Action ──
  if (G.ability1Cooldown === 0) {
    const canUseAbility1 = adj.length > 0 ||
      ['mage', 'ranger', 'necromancer'].includes(p.class);
    if (canUseAbility1) {
      actions.push({
        action: { type: 'ability1' },
        score: 0,
        reason: 'ability1'
      });
    }
  }

  // ── Generate Ability 2 Action ──
  if (p.lvl >= 5 && G.ability2Cooldown === 0) {
    actions.push({
      action: { type: 'ability2' },
      score: 0,
      reason: 'ability2'
    });
  }

  // ── Generate Use Item Actions ──
  const potions = carriedItems(G, 'potion');
  for (const pot of potions) {
    if (p.hp < p.maxHp) {
      actions.push({
        action: { type: 'use_item', itemId: pot.id, itemType: 'potion' },
        score: 0,
        reason: 'potion'
      });
    }
  }

  const buffs = carriedItems(G, 'potion_buff');
  for (const buff of buffs) {
    if (p.strengthTurns === 0) {
      actions.push({
        action: { type: 'use_item', itemId: buff.id, itemType: 'potion_buff' },
        score: 0,
        reason: 'buff'
      });
    }
  }

  const bombs = carriedItems(G, 'bomb');
  if (bombs.length > 0 && adj.length >= 1) {
    actions.push({
      action: { type: 'use_item', itemId: bombs[0].id, itemType: 'bomb' },
      score: 0,
      reason: 'bomb'
    });
  }

  const teleports = carriedItems(G, 'scroll_teleport');
  if (teleports.length > 0) {
    actions.push({
      action: { type: 'use_item', itemId: teleports[0].id, itemType: 'scroll_teleport' },
      score: 0,
      reason: 'teleport'
    });
  }

  const detects = G.items.filter(i => i.carried && i.type === 'scroll' && /detection/i.test(i.name || ''));
  if (detects.length > 0) {
    actions.push({
      action: { type: 'use_item', itemId: detects[0].id, itemType: 'scroll' },
      score: 0,
      reason: 'detect'
    });
  }

  // ── Generate Descend Action ──
  if (tileAt(G, p.x, p.y) === TILE.STAIRS && G.floor < FLOORS) {
    actions.push({
      action: { type: 'descend', key: '>' },
      score: 0,
      reason: 'descend'
    });
  }

  // ── Generate Shop Action ──
  const nearbyShop = G.shops && G.shops.find(s => manhattan(s, p) <= 1);
  if (nearbyShop) {
    actions.push({
      action: { type: 'shop' },
      score: 0,
      reason: 'shop'
    });
  }

  // ── Evaluate All Actions ──
  for (const candidate of actions) {
    candidate.score = evaluateAction(candidate.action, G, strategy);
  }

  // ── Sort by score, break ties by preferring offensive actions ──
  const offensiveBonus = {
    attack: 2,
    ability1: 1.5,
    ability2: 1.5,
    use_item: 0.5,
    move: 0,
    descend: -1,
    shop: -2,
  };

  actions.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    // Tiebreak: prefer actions that reduce enemy count
    return (offensiveBonus[b.action.type] || 0) - (offensiveBonus[a.action.type] || 0);
  });

  const best = actions[0] || { action: { type: 'none' }, score: 0, reason: 'no actions' };
  return best;
}

// ──────────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluateAction, planCombat, predictDamage };
}

// Also expose to browser context if needed
if (typeof window !== 'undefined') {
  window.CombatPlanner = { evaluateAction, planCombat, predictDamage };
}
