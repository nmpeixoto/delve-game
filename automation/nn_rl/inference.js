/**
 * Neural Network inference for DELVE bot.
 * Loads trained PyTorch model and replaces botDecisionLogic.
 * Full JavaScript port of state_extractor.py, action_mask.py, and pathfinding.py.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let nnLoaded = false;
let nnModel = null;

function loadNNModel() {
    try {
        const modelPath = path.join(__dirname, 'checkpoints', 'delve_ppo_final.pt');
        if (!fs.existsSync(modelPath)) return false;
        
        const exportScript = `
import torch
import json
import sys
sys.path.insert(0, '${__dirname.replace(/\\/g, '\\\\')}')
from network import DelveNet
from config import STATE_DIM, ACTION_DIM, HIDDEN_DIM
model = DelveNet(state_dim=STATE_DIM, action_dim=ACTION_DIM, hidden_dim=HIDDEN_DIM)
model.load_state_dict(torch.load('${modelPath.replace(/\\/g, '\\\\')}', map_location='cpu'))
weights = {}
for name, param in model.named_parameters():
    weights[name] = param.data.numpy().tolist()
print(json.dumps(weights))
`;
        const result = execSync(`python -c "${exportScript}"`, { encoding: 'utf8', maxBuffer: 50*1024*1024 });
        nnModel = JSON.parse(result);
        nnLoaded = true;
        console.log('[NN] Model loaded successfully');
        return true;
    } catch(err) {
        console.log('[NN] Failed to load model:', err.message);
        return false;
    }
}

// --- CONSTANTS ---
const MAP_W = 56;
const WALL = 0, FLOOR = 1, STAIRS = 2, SHOP = 3, LOCKED_DOOR = 4, SECRET_DOOR = 5;
const DIRS = [[0,-1], [0,1], [-1,0], [1,0]];
const MAX_SHOP_SLOTS = 18;
const SHOP_ITEM_FEATURES = 19;
const STATE_DIM = 411;
const ACTION_DIM = 39;
const FLOORS = 5;

// Actions mapping
const ACTIONS = {
    MOVE_UP: 0, MOVE_DOWN: 1, MOVE_LEFT: 2, MOVE_RIGHT: 3,
    ATTACK_1: 4, ATTACK_2: 5, ABILITY1: 6, ABILITY2: 7,
    USE_POTION: 8, USE_BUFF: 9, USE_BOMB: 10, USE_TELEPORT: 11, USE_DETECTION: 12,
    DESCEND: 13, SHOP_OPEN: 14, SHOP_SELL: 15, ESCAPE: 16, WAIT: 17
};
for (let i = 0; i < MAX_SHOP_SLOTS; i++) ACTIONS[`SHOP_BUY_${i}`] = 18 + i;
ACTIONS.RANGED_ATTACK_WEAK = 36;
ACTIONS.RANGED_ATTACK_NEAREST = 37;
ACTIONS.KITE_SAFE_MOVE = 38;

// --- PATHFINDING & HELPERS ---
function _has_key(G) { return G.items && G.items.some(i => i.carried && i.type === 'key'); }
function _tile_passable(G, tile) {
    if (tile === WALL || tile === SECRET_DOOR) return false;
    if (tile === LOCKED_DOOR && !_has_key(G)) return false;
    return true;
}
function _seen_set(G) { return G.seen instanceof Set ? G.seen : new Set(G.seen || []); }
function _visible_set(G) { return G.visible instanceof Set ? G.visible : new Set(G.visible || []); }

function _visible_enemies(G) {
    if (G._visible_enemies) return G._visible_enemies;
    const vis = _visible_set(G);
    const res = (G.enemies || []).filter(e => !e.dying && !e.isPet && vis.has(e.y * MAP_W + e.x));
    G._visible_enemies = res;
    return res;
}

function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
function chebyshev(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function shortest_stairs_distance(G) {
    const p = G.player;
    if (!p || !G.map || p.y < 0 || p.y >= G.map.length || p.x < 0 || p.x >= G.map[0].length) return null;
    if (!_tile_passable(G, G.map[p.y][p.x])) return null;

    const seen = _seen_set(G);
    const targets = new Set();
    for (let y = 0; y < G.map.length; y++) {
        for (let x = 0; x < G.map[y].length; x++) {
            if (G.map[y][x] === STAIRS && seen.has(y * MAP_W + x)) targets.add(`${x},${y}`);
        }
    }
    if (targets.size === 0) return null;

    const blocked = new Set();
    for (const e of G.enemies || []) if (!e.dying && !e.isPet) blocked.add(`${e.x},${e.y}`);

    const queue = [[p.x, p.y, 0]];
    const visited = new Set([`${p.x},${p.y}`]);
    let head = 0;
    while (head < queue.length) {
        const [x, y, dist] = queue[head++];
        if (targets.has(`${x},${y}`)) return dist;
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key) || blocked.has(key)) continue;
            if (ny < 0 || ny >= G.map.length || nx < 0 || nx >= G.map[0].length) continue;
            if (!_tile_passable(G, G.map[ny][nx])) continue;
            visited.add(key);
            queue.push([nx, ny, dist + 1]);
        }
    }
    return null;
}

function floor_exploration_ratio(G) {
    const walkable = G._walkable_total || 0;
    if (walkable === 0) return 0.0;
    return Math.min(_seen_set(G).size / walkable, 1.0);
}

function nearest_unseen_direction(G) {
    const p = G.player;
    if (!p) return [0, 0];
    const seen = _seen_set(G);
    const blocked = new Set();
    for (const e of G.enemies || []) if (!e.dying && !e.isPet) blocked.add(`${e.x},${e.y}`);

    const queue = [[p.x, p.y, 0, 0]];
    const visited = new Set([`${p.x},${p.y}`]);
    let head = 0;
    while (head < queue.length) {
        const [x, y, idx, idy] = queue[head++];
        if (!seen.has(y * MAP_W + x) && G.map[y] && G.map[y][x] !== WALL) return [idx, idy];
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key) || blocked.has(key)) continue;
            if (ny < 0 || ny >= G.map.length || nx < 0 || nx >= G.map[0].length) continue;
            if (!_tile_passable(G, G.map[ny][nx])) continue;
            visited.add(key);
            queue.push([nx, ny, (idx === 0 && idy === 0) ? dx : idx, (idx === 0 && idy === 0) ? dy : idy]);
        }
    }
    return [0, 0];
}

function nearest_poi_direction(G, type) {
    const p = G.player;
    if (!p) return [0, 0];
    const seen = _seen_set(G);
    const targets = new Set();
    
    if (type === 'shop') {
        const shop_items = new Set((G.items || []).filter(i => !i.carried && (i.price||0) > 0).map(i => `${i.x},${i.y}`));
        for (let y = 0; y < G.map.length; y++) {
            for (let x = 0; x < G.map[y].length; x++) {
                if (G.map[y][x] === SHOP && seen.has(y * MAP_W + x) && shop_items.has(`${x},${y}`)) {
                    targets.add(`${x},${y}`);
                }
            }
        }
    } else if (type === 'locked_door') {
        for (let y = 0; y < G.map.length; y++) {
            for (let x = 0; x < G.map[y].length; x++) {
                if (G.map[y][x] === LOCKED_DOOR && seen.has(y * MAP_W + x)) targets.add(`${x},${y}`);
            }
        }
    } else if (type === 'shrine') {
        for (const item of G.items || []) {
            if (item.type === 'shrine' && !item.carried && seen.has(item.y * MAP_W + item.x)) {
                targets.add(`${item.x},${item.y}`);
            }
        }
    }

    if (targets.size === 0 || targets.has(`${p.x},${p.y}`)) return [0, 0];

    const blocked = new Set();
    for (const e of G.enemies || []) if (!e.dying && !e.isPet) blocked.add(`${e.x},${e.y}`);

    const queue = [[p.x, p.y, 0, 0]];
    const visited = new Set([`${p.x},${p.y}`]);
    let head = 0;
    while (head < queue.length) {
        const [x, y, idx, idy] = queue[head++];
        if (targets.has(`${x},${y}`)) return [idx, idy];
        for (const [dx, dy] of DIRS) {
            const nx = x + dx, ny = y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key) || blocked.has(key)) continue;
            if (ny < 0 || ny >= G.map.length || nx < 0 || nx >= G.map[0].length) continue;
            if (!_tile_passable(G, G.map[ny][nx])) {
                if (!(type === 'locked_door' && targets.has(key))) continue;
            }
            visited.add(key);
            queue.push([nx, ny, (idx === 0 && idy === 0) ? dx : idx, (idx === 0 && idy === 0) ? dy : idy]);
        }
    }
    return [0, 0];
}

function _stair_direction(G) {
    const p = G.player;
    const seen = _seen_set(G);
    let bestDist = Infinity, bestDx = 0, bestDy = 0;
    for (let y = 0; y < G.map.length; y++) {
        for (let x = 0; x < G.map[y].length; x++) {
            if (G.map[y][x] === STAIRS && seen.has(y * MAP_W + x)) {
                const dx = x - p.x, dy = y - p.y;
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < bestDist) { bestDist = dist; bestDx = dx; bestDy = dy; }
            }
        }
    }
    if (bestDist === Infinity) return [0, 0];
    return [Math.max(-1, Math.min(1, bestDx / 3.0)), Math.max(-1, Math.min(1, bestDy / 3.0))];
}

function _min_enemy_distance(G) {
    const p = G.player;
    const vis = _visible_enemies(G);
    if (vis.length === 0) return 10.0;
    return Math.min(...vis.map(e => Math.max(Math.abs(p.x - e.x), Math.abs(p.y - e.y))));
}

function _max_enemy_cluster_density(G) {
    const vis = _visible_enemies(G);
    if (vis.length === 0) return 0.0;
    const coords = new Set(vis.map(e => `${e.x},${e.y}`));
    let maxAdj = 0;
    for (const e of vis) {
        let adjCount = 0;
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            if (coords.has(`${e.x+dx},${e.y+dy}`)) adjCount++;
        }
        if (adjCount > maxAdj) maxAdj = adjCount;
    }
    return maxAdj;
}

function _enemies_adjacent_to_player(G) {
    const p = G.player;
    const vis = _visible_enemies(G);
    const coords = new Set(vis.map(e => `${e.x},${e.y}`));
    let count = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            if (coords.has(`${p.x+dx},${p.y+dy}`)) count++;
        }
    }
    return count;
}

function _max_enemies_in_line(G) {
    const p = G.player;
    const vis = _visible_enemies(G);
    if (vis.length === 0) return 0.0;
    let maxLine = 0;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        let count = 0;
        let cx = p.x + dx, cy = p.y + dy;
        while (cy >= 0 && cy < G.map.length && cx >= 0 && cx < G.map[0].length) {
            if (G.map[cy][cx] === WALL) break;
            if (vis.some(e => e.x === cx && e.y === cy)) count++;
            cx += dx;
            cy += dy;
        }
        if (count > maxLine) maxLine = count;
    }
    return maxLine;
}

function _is_closest_enemy_near_wall(G) {
    const p = G.player;
    const vis = _visible_enemies(G);
    if (vis.length === 0) return false;
    const closest = vis.reduce((a, b) => manhattan(a, p) < manhattan(b, p) ? a : b);
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = closest.x + dx, ny = closest.y + dy;
        if (ny >= 0 && ny < G.map.length && nx >= 0 && nx < G.map[0].length) {
            if (G.map[ny][nx] === WALL) return true;
        }
    }
    return false;
}

function _enemies_within_dist(G, maxDist) {
    const p = G.player;
    const vis = _visible_enemies(G);
    return vis.filter(e => Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= maxDist).length;
}

function _kite_pressure_enemies(player, visible_enemies) {
    const px = player.x || 0, py = player.y || 0;
    return visible_enemies.filter(e => Math.abs(e.x - px) + Math.abs(e.y - py) <= 4);
}

function choose_line_clear_enemy(G, prefer = "weak") {
    const candidates = _visible_enemies(G).filter(e => _is_line_clear(G, G.player, e));
    if (candidates.length === 0) return null;
    const p = G.player;
    if (prefer === "nearest") {
        return candidates.reduce((best, curr) => {
            const dBest = manhattan(best, p);
            const dCurr = manhattan(curr, p);
            if (dCurr < dBest) return curr;
            if (dCurr > dBest) return best;
            if ((curr.hp || 0) < (best.hp || 0)) return curr;
            if ((curr.hp || 0) > (best.hp || 0)) return best;
            return String(curr.id) < String(best.id) ? curr : best;
        });
    }
    return candidates.reduce((best, curr) => {
        const hpBest = best.hp || 0;
        const hpCurr = curr.hp || 0;
        if (hpCurr < hpBest) return curr;
        if (hpCurr > hpBest) return best;
        const dBest = manhattan(best, p);
        const dCurr = manhattan(curr, p);
        if (dCurr < dBest) return curr;
        if (dCurr > dBest) return best;
        return String(curr.id) < String(best.id) ? curr : best;
    });
}

function safest_adjacent_move(G, threat_enemies = null, require_increase = false) {
    const p = G.player;
    if (!p) return null;
    const all_enemies = (G.enemies || []).filter(e => !e.dying && !e.isPet);
    const enemies = threat_enemies !== null ? threat_enemies.filter(e => !e.dying && !e.isPet) : all_enemies;
    if (enemies.length === 0) return null;

    const occupied = new Set(all_enemies.map(e => `${e.x},${e.y}`));
    const px = p.x || 0, py = p.y || 0;
    
    let nearest = null;
    let nearestDist = Infinity;
    for (const e of enemies) {
        const dist = manhattan(e, p);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearest = e;
        } else if (dist === nearestDist) {
            if (nearest === null || String(e.id) < String(nearest.id)) {
                nearest = e;
            }
        }
    }
    
    const current_min_dist = Math.min(...enemies.map(e => manhattan(e, p)));
    let bestVal = null;
    let bestAction = null;

    const DIRS_MAP = {
        'ArrowUp': [0, -1],
        'ArrowDown': [0, 1],
        'ArrowLeft': [-1, 0],
        'ArrowRight': [1, 0]
    };

    for (const [key, [dx, dy]] of Object.entries(DIRS_MAP)) {
        const x = px + dx, y = py + dy;
        if (y < 0 || y >= G.map.length || x < 0 || x >= G.map[y].length) continue;
        if (G.map[y][x] === WALL) continue;
        if (G.map[y][x] === LOCKED_DOOR && !_has_key(G)) continue;
        if (occupied.has(`${x},${y}`)) continue;

        let min_dist = 99;
        for (const e of enemies) {
            const dist = Math.abs(e.x - x) + Math.abs(e.y - y);
            if (dist < min_dist) min_dist = dist;
        }

        if (require_increase && min_dist <= current_min_dist) continue;

        let away_score = 0;
        if (nearest) {
            const away_x = Math.sign(px - nearest.x);
            const away_y = Math.sign(py - nearest.y);
            away_score = dx * away_x + dy * away_y;
        }

        const candidate = [min_dist, away_score, -Math.abs(dx), -Math.abs(dy), -dy, -dx];
        
        const compare = (c1, c2) => {
            for (let i = 0; i < c1.length; i++) {
                if (c1[i] > c2[i]) return 1;
                if (c1[i] < c2[i]) return -1;
            }
            return 0;
        };

        if (bestVal === null || compare(candidate, bestVal) > 0) {
            bestVal = candidate;
            bestAction = { type: 'key', val: key };
        }
    }
    return bestAction;
}

// --- STATE EXTRACTOR ---
function extractStateJS(G, prev_action = null) {
    const p = G.player;
    if (!p || !G.map) return null;
    const features = [];

    features.push((p.hp || 0) / Math.max(p.maxHp || 1, 1));
    features.push((p.atk || 0) / 30.0);
    features.push((p.def || 0) / 20.0);
    features.push((p.lvl || 1) / 15.0);
    features.push(_has_key(G) ? 1.0 : 0.0);
    features.push((G.floor || 1) / FLOORS);
    features.push((G.map[p.y] && G.map[p.y][p.x] === STAIRS) ? 1.0 : 0.0);

    const [stair_dx, stair_dy] = _stair_direction(G);
    features.push(stair_dx, stair_dy);
    const bfs_dist = shortest_stairs_distance(G);
    features.push(bfs_dist !== null ? Math.min(bfs_dist / 30.0, 1.0) : 1.0);
    features.push(floor_exploration_ratio(G));

    const visEnemies = _visible_enemies(G);
    features.push(Math.min(visEnemies.length / 6.0, 1.0));
    features.push(_min_enemy_distance(G) / 10.0);
    features.push(p.weapon ? 1.0 : 0.0);
    features.push(1.0 - Math.min((G.ability1Cooldown || 0) / 10.0, 1.0));
    features.push((p.lvl >= 5) ? 1.0 - Math.min((G.ability2Cooldown || 0) / 15.0, 1.0) : 0.0);
    features.push((p.shieldWallTurns || 0) > 0 ? 1.0 : 0.0);
    features.push((p.vanishTurns || 0) > 0 ? 1.0 : 0.0);
    features.push((p.strengthTurns || 0) > 0 ? 1.0 : 0.0);
    features.push((p.bloodlustTurns || 0) > 0 ? 1.0 : 0.0);
    features.push((p.poisonedTurns || 0) > 0 ? 1.0 : 0.0);

    const items = G.items || [];
    const potions = items.filter(i => (i.type === 'potion' || i.type === 'potion_buff') && i.carried).length;
    features.push(Math.min(potions / 5.0, 1.0));
    const bombs = items.filter(i => i.type === 'bomb' && i.carried).length;
    features.push(Math.min(bombs / 3.0, 1.0));
    const scrolls = items.filter(i => (i.type||'').includes('scroll') && i.carried).length;
    features.push(Math.min(scrolls / 3.0, 1.0));

    // Prev action
    const encPrev = [0.0, 0.0, 0.0, 0.0];
    if (prev_action !== null) {
        if (prev_action === ACTIONS.MOVE_UP) { encPrev[0] = 0; encPrev[1] = -1; }
        else if (prev_action === ACTIONS.MOVE_DOWN) { encPrev[0] = 0; encPrev[1] = 1; }
        else if (prev_action === ACTIONS.MOVE_LEFT) { encPrev[0] = -1; encPrev[1] = 0; }
        else if (prev_action === ACTIONS.MOVE_RIGHT) { encPrev[0] = 1; encPrev[1] = 0; }
        else if (prev_action >= ACTIONS.ATTACK_1 && prev_action <= ACTIONS.ABILITY2) { encPrev[2] = 1.0; }
        else if (prev_action >= ACTIONS.USE_POTION && prev_action <= ACTIONS.USE_DETECTION) { encPrev[3] = 1.0; }
    }
    features.push(...encPrev);

    features.push(Math.min((G._steps_since_floor_change || 0) / 500.0, 1.0));
    features.push(Math.min((G._steps_since_key_pickup || 0) / 200.0, 1.0));
    features.push(Math.min((G._steps_since_enemy_kill || 0) / 200.0, 1.0));

    const [exp_dx, exp_dy] = nearest_unseen_direction(G);
    features.push(exp_dx, exp_dy);
    const [shop_dx, shop_dy] = nearest_poi_direction(G, 'shop');
    features.push(shop_dx, shop_dy);
    const [shrine_dx, shrine_dy] = nearest_poi_direction(G, 'shrine');
    features.push(shrine_dx, shrine_dy);
    
    let ldoor_dx = 0.0, ldoor_dy = 0.0;
    if (_has_key(G)) [ldoor_dx, ldoor_dy] = nearest_poi_direction(G, 'locked_door');
    features.push(ldoor_dx, ldoor_dy);

    let edx = 0.0, edy = 0.0, ehp = 1.0;
    if (visEnemies.length > 0) {
        const closest = visEnemies.reduce((a, b) => manhattan(a, p) < manhattan(b, p) ? a : b);
        edx = Math.max(-1, Math.min(1, (closest.x - p.x) / 3.0));
        edy = Math.max(-1, Math.min(1, (closest.y - p.y) / 3.0));
        ehp = Math.min(Math.max((closest.hp || 0) / Math.max(closest.maxHp || 1, 1), 0.0), 1.0);
    }
    features.push(edx, edy, ehp);

    const w = p.weapon || {};
    const wn = (w.name || '').toLowerCase();
    const isWand = (wn.includes('wand') || wn.includes('staff') || wn.includes('rod')) ? 1.0 : 0.0;
    const isBow = wn.includes('bow') ? 1.0 : 0.0;
    const isMelee = (p.weapon && !isWand && !isBow) ? 1.0 : 0.0;
    features.push(isWand, isBow, isMelee);



    features.push((p.vampirism || 0) / 10.0);
    features.push((p.regen || 0) / 5.0);
    features.push((p.swiftness || 0) / 5.0);
    features.push(Math.min(p.critChance || 0, 1.0));
    features.push(Math.min(p.dodgeBonus || 0, 1.0));
    features.push((p.freeMoves || 0) > 0 ? 1.0 : 0.0);
    features.push((p.rootedTurns || 0) > 0 ? 1.0 : 0.0);
    features.push((p.xp || 0) / Math.max(p.xpNext || 1, 1));
    features.push(Math.min((p.gold || 0) / 1000.0, 1.0));
    features.push((p.maxHp || 1) / 200.0);
    features.push((G.hardMode || G.hard_mode) ? 1.0 : 0.0);

    const cnames = ['warrior', 'rogue', 'mage', 'paladin', 'ranger', 'barbarian', 'necromancer', 'monk'];
    for (const c of cnames) features.push(((p.class || '').toLowerCase() === c) ? 1.0 : 0.0);

    // Advanced tactical context
    features.push(_max_enemy_cluster_density(G) / 4.0);
    features.push(_enemies_adjacent_to_player(G) / 8.0);
    features.push(_max_enemies_in_line(G) / 5.0);
    features.push(_is_closest_enemy_near_wall(G) ? 1.0 : 0.0);
    features.push(_enemies_within_dist(G, 2) / 8.0);

    // Shop items
    const stock = (G.shopOpen && G.currentShop) ? (G.currentShop.stock || []) : [];
    const SHOP_TYPE_ORDER = ['potion', 'potion_buff', 'bomb', 'scroll_teleport', 'scroll', 'weapon', 'armor', 'upgrade'];
    const RARITY_SCALE = { 'common': 0.0, 'rare': 0.5, 'legendary': 1.0 };
    
    for (let slot = 0; slot < MAX_SHOP_SLOTS; slot++) {
        const item = slot < stock.length ? stock[slot] : null;
        if (!item || item.sold) {
            for (let i = 0; i < SHOP_ITEM_FEATURES; i++) features.push(0.0);
        } else {
            features.push(1.0);
            for (const t of SHOP_TYPE_ORDER) features.push(item.type === t ? 1.0 : 0.0);
            features.push(Math.min(Math.max((item.price || 0) / 1000.0, 0.0), 1.0));
            features.push(Math.min(Math.max((item.heal || 0) / 60.0, 0.0), 1.0));
            features.push(Math.min(Math.max((item.atk || 0) / 20.0, 0.0), 1.0));
            features.push(Math.min(Math.max((item.def || 0) / 15.0, 0.0), 1.0));
            features.push(Math.min(Math.max((item.amount || 0) / 30.0, 0.0), 1.0));
            features.push(RARITY_SCALE[(item.rarity || '').toLowerCase()] || 0.0);
            const stat = item.stat || '';
            const all = stat === 'all' || stat === 'all5';
            features.push((all || stat === 'atk') ? 1.0 : 0.0);
            features.push((all || stat === 'def') ? 1.0 : 0.0);
            features.push((all || stat === 'hp') ? 1.0 : 0.0);
            features.push((stat && !all && !['atk','def','hp'].includes(stat)) ? 1.0 : 0.0);
        }
    }

    if (features.length !== STATE_DIM) {
        console.error(`Expected ${STATE_DIM} features, got ${features.length}`);
    }
    return new Float32Array(features);
}

function extractLocalMapJS(G) {
    const channels = new Float32Array(21 * 16 * 16); // initialized to 0
    const p = G.player;
    if (!p || !G.map || G.map.length === 0) return channels;

    const seen = _seen_set(G);
    const eb = new Map();
    for (const e of G.enemies || []) if (!e.dying && !e.isPet) eb.set(`${e.x},${e.y}`, e);
    const ib = new Map();
    for (const i of G.items || []) if (!i.carried) ib.set(`${i.x},${i.y}`, i);
    const tb = new Map();
    for (const t of G.traps || []) if (t.revealed && !t.triggered) tb.set(`${t.x},${t.y}`, t);

    for (let dy = -8; dy < 8; dy++) {
        for (let dx = -8; dx < 8; dx++) {
            const x = p.x + dx, y = p.y + dy;
            if (y >= 0 && y < G.map.length && x >= 0 && x < G.map[y].length) {
                const cy = dy + 8, cx = dx + 8;
                const tile = G.map[y][x];
                
                if (tile === 1 || tile === 2 || tile === 3) channels[0 * 256 + cy * 16 + cx] = 1.0;
                if (seen.has(y * MAP_W + x)) channels[1 * 256 + cy * 16 + cx] = 1.0;
                if (tile === 2) channels[2 * 256 + cy * 16 + cx] = 1.0;
                if (tile === 4) channels[3 * 256 + cy * 16 + cx] = 1.0;

                const key = `${x},${y}`;
                if (eb.has(key)) {
                    const e = eb.get(key);
                    if (e.boss || e.isBoss) channels[6 * 256 + cy * 16 + cx] = 1.0;
                    else if (e.isElite) channels[5 * 256 + cy * 16 + cx] = 1.0;
                    else channels[4 * 256 + cy * 16 + cx] = 1.0;
                    
                    channels[10 * 256 + cy * 16 + cx] = Math.max(0.0, Math.min(1.0, (e.hp || 0) / Math.max(e.maxHp || 1, 1)));
                    channels[11 * 256 + cy * 16 + cx] = Math.max(0.0, Math.min(1.0, (e.atk || 0) / 30.0));

                    // 14-20: Advanced Enemy Abilities
                    channels[14 * 256 + cy * 16 + cx] = Math.max(0.0, Math.min(1.0, (e.def || 0) / 10.0));
                    channels[15 * 256 + cy * 16 + cx] = e.dodge ? 1.0 : 0.0;
                    channels[16 * 256 + cy * 16 + cx] = e.revive ? 1.0 : 0.0;
                    channels[17 * 256 + cy * 16 + cx] = e.enrage ? 1.0 : 0.0;
                    channels[18 * 256 + cy * 16 + cx] = e.regen ? 1.0 : 0.0;
                    channels[19 * 256 + cy * 16 + cx] = e.vampiric ? 1.0 : 0.0;
                    channels[20 * 256 + cy * 16 + cx] = (e.freezeChance || e.freeze_chance) ? 1.0 : 0.0;
                }
                if (tb.has(key)) channels[9 * 256 + cy * 16 + cx] = 1.0;
                
                if (ib.has(key) && seen.has(y * MAP_W + x)) {
                    const i = ib.get(key);
                    const typ = i.type;
                    if (typ === 'potion' || typ === 'potion_buff') {
                        channels[7 * 256 + cy * 16 + cx] = 1.0;
                        channels[12 * 256 + cy * 16 + cx] = 1.0;
                    } else if (typ === 'bomb' || typ === 'scroll_teleport' || typ === 'scroll') {
                        channels[7 * 256 + cy * 16 + cx] = 1.0;
                        channels[13 * 256 + cy * 16 + cx] = 1.0;
                    } else if (typ === 'weapon' || typ === 'armor' || typ === 'upgrade') {
                        channels[8 * 256 + cy * 16 + cx] = 1.0;
                    }
                }
            }
        }
    }
    return channels;
}

// --- ACTION MASKING ---
function _weapon_power(i) { return i ? (i.atk || i.pow || i.amount || 0) : 0; }
function _armor_power(i) { return i ? (i.def || i.armor || i.amount || 0) : 0; }
function _has_sellable_gear(G) {
    const p = G.player, ew = p.weapon || {}, ea = p.armor || {};
    for (const i of G.items || []) {
        if (!i.carried || (i.type !== 'weapon' && i.type !== 'armor')) continue;
        if (ew.id === i.id || ea.id === i.id) continue;
        if (i.reqClass && !i.reqClass.includes(p.class)) return true;
        if (i.type === 'weapon') {
            if (!ew.id || _weapon_power(i) <= _weapon_power(ew)) return true;
        } else if (i.type === 'armor') {
            if (!ea.id || _armor_power(i) <= _armor_power(ea)) return true;
        }
    }
    return false;
}
function _is_line_clear(G, p, e) {
    const dx = e.x - p.x, dy = e.y - p.y;
    if (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;
    const sx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const sy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
    let cx = p.x + sx, cy = p.y + sy;
    while (cx !== e.x || cy !== e.y) {
        if (cy < 0 || cy >= G.map.length || cx < 0 || cx >= G.map[0].length) return false;
        if (G.map[cy][cx] === WALL) return false;
        cx += sx; cy += sy;
    }
    return true;
}
function _has_useful_move(G, p) {
    for (const [dx, dy] of DIRS) {
        const nx = p.x + dx, ny = p.y + dy;
        if (ny >= 0 && ny < G.map.length && nx >= 0 && nx < G.map[0].length) {
            if (G.map[ny][nx] !== WALL) {
                if (!(G.enemies || []).some(e => e.x === nx && e.y === ny && !e.dying && !e.isPet)) return true;
            }
        }
    }
    return false;
}

function getActionMaskJS(G) {
    const mask = new Array(ACTION_DIM).fill(false);
    if (!G || !G.player || G.gameOver || G.won) return mask;
    const p = G.player;

    if (G.shrineOpen) { mask[ACTIONS.USE_BUFF] = true; mask[ACTIONS.ESCAPE] = true; return mask; }
    if (G.shopOpen) {
        const stock = (G.currentShop && G.currentShop.stock) || [];
        for (let idx = 0; idx < Math.min(MAX_SHOP_SLOTS, stock.length); idx++) {
            const item = stock[idx];
            if (!item || item.sold) continue;
            if ((item.price || 0) <= p.gold) mask[ACTIONS[`SHOP_BUY_${idx}`]] = true;
        }
        if (_has_sellable_gear(G)) mask[ACTIONS.SHOP_SELL] = true;
        mask[ACTIONS.ESCAPE] = true;
        return mask;
    }

    for (let i = 0; i < DIRS.length; i++) {
        const nx = p.x + DIRS[i][0], ny = p.y + DIRS[i][1];
        if (ny >= 0 && ny < G.map.length && nx >= 0 && nx < G.map[0].length) {
            const tile = G.map[ny][nx];
            if (tile === WALL) continue;
            if (tile === LOCKED_DOOR && !_has_key(G)) continue;
            mask[i] = true;
        }
    }

    const visEnemies = _visible_enemies(G);
    const adjEnemies = visEnemies.filter(e => chebyshev(e, p) <= 1);

    const cls = p.class || '';
    let ab1Valid = false;
    if (cls === 'rogue') ab1Valid = (p.freeMoves || 0) <= 0 && _has_useful_move(G, p);
    else if (cls === 'mage') ab1Valid = visEnemies.length > 0;
    else if (cls === 'ranger') ab1Valid = visEnemies.some(e => _is_line_clear(G, p, e));
    else if (['warrior','paladin','necromancer'].includes(cls)) ab1Valid = visEnemies.some(e => chebyshev(e, p) <= 2);
    else if (['barbarian','monk'].includes(cls)) ab1Valid = adjEnemies.length > 0;

    if ((G.ability1Cooldown || 0) === 0 && ab1Valid) mask[ACTIONS.ABILITY1] = true;

    let ab2Valid = false;
    const hpRatio = (p.hp || 0) / Math.max(p.maxHp || 1, 1);
    if (['warrior','mage'].includes(cls)) ab2Valid = visEnemies.length > 0 || hpRatio <= 0.5;
    else if (cls === 'rogue') ab2Valid = visEnemies.length > 0;
    else if (cls === 'paladin') ab2Valid = hpRatio <= 0.8;
    else if (cls === 'ranger') ab2Valid = visEnemies.length > 0;
    else if (['barbarian','necromancer'].includes(cls)) ab2Valid = visEnemies.length > 0;
    else if (cls === 'monk') ab2Valid = adjEnemies.length > 0;

    if (p.lvl >= 5 && (G.ability2Cooldown || 0) === 0 && ab2Valid) mask[ACTIONS.ABILITY2] = true;

    const carried = (G.items || []).filter(i => i.carried);
    if (carried.some(i => i.type === 'potion') && p.hp < p.maxHp) mask[ACTIONS.USE_POTION] = true;
    if (carried.some(i => i.type === 'potion_buff')) mask[ACTIONS.USE_BUFF] = true;
    if (carried.some(i => i.type === 'bomb') && visEnemies.some(e => chebyshev(e, p) <= 2)) mask[ACTIONS.USE_BOMB] = true;
    if (carried.some(i => i.type === 'scroll_teleport')) mask[ACTIONS.USE_TELEPORT] = true;
    if (carried.some(i => i.type === 'scroll' && (i.name||'').toLowerCase().includes('detection'))) mask[ACTIONS.USE_DETECTION] = true;

    if (p.y >= 0 && p.y < G.map.length && p.x >= 0 && p.x < G.map[0].length && G.map[p.y][p.x] === STAIRS) mask[ACTIONS.DESCEND] = true;

    const shops = G.shops || [];
    if (shops.some(s => chebyshev(s, p) <= 1)) mask[ACTIONS.SHOP_OPEN] = true;

    if (['rogue', 'mage', 'ranger'].includes((p.class || '').toLowerCase())) {
        if (choose_line_clear_enemy(G) !== null) {
            mask[ACTIONS.RANGED_ATTACK_WEAK] = true;
            mask[ACTIONS.RANGED_ATTACK_NEAREST] = true;
        }
        const kite_enemies = _kite_pressure_enemies(p, visEnemies);
        if (kite_enemies.length > 0 && safest_adjacent_move(G, kite_enemies, true) !== null) {
            mask[ACTIONS.KITE_SAFE_MOVE] = true;
        }
    }

    if (!mask.some(m => m)) mask[ACTIONS.ESCAPE] = true;

    return mask;
}

function nnActionToDecision(idx) {
    if (idx === ACTIONS.MOVE_UP) return { type: 'key', val: 'ArrowUp' };
    if (idx === ACTIONS.MOVE_DOWN) return { type: 'key', val: 'ArrowDown' };
    if (idx === ACTIONS.MOVE_LEFT) return { type: 'key', val: 'ArrowLeft' };
    if (idx === ACTIONS.MOVE_RIGHT) return { type: 'key', val: 'ArrowRight' };
    if (idx === ACTIONS.ATTACK_1) return { type: 'key', val: 'ArrowUp' }; // Not used
    if (idx === ACTIONS.ATTACK_2) return { type: 'key', val: 'ArrowDown' }; // Not used
    if (idx === ACTIONS.ABILITY1) return { type: 'key', val: '1' };
    if (idx === ACTIONS.ABILITY2) return { type: 'key', val: '2' };
    if (idx === ACTIONS.USE_POTION) return { type: 'item', itemType: 'potion' };
    if (idx === ACTIONS.USE_BUFF) return { type: 'item', itemType: 'potion_buff' };
    if (idx === ACTIONS.USE_BOMB) return { type: 'item', itemType: 'bomb' };
    if (idx === ACTIONS.USE_TELEPORT) return { type: 'item', itemType: 'scroll_teleport' };
    if (idx === ACTIONS.USE_DETECTION) return { type: 'item', itemType: 'scroll' };
    if (idx === ACTIONS.DESCEND) return { type: 'key', val: ' ' };
    if (idx === ACTIONS.SHOP_OPEN) return { type: 'key', val: ' ' };
    if (idx >= ACTIONS.SHOP_BUY_0 && idx <= ACTIONS.SHOP_BUY_17) return { type: 'shop_buy', index: idx - ACTIONS.SHOP_BUY_0 };
    if (idx === ACTIONS.SHOP_SELL) return { type: 'shop_sell' };
    if (idx === ACTIONS.ESCAPE) return { type: 'key', val: 'Escape' };
    if (idx === ACTIONS.RANGED_ATTACK_WEAK) {
        const e = choose_line_clear_enemy(G, "weak");
        return e ? { type: 'attack', target: e.id } : { type: 'key', val: ' ' };
    }
    if (idx === ACTIONS.RANGED_ATTACK_NEAREST) {
        const e = choose_line_clear_enemy(G, "nearest");
        return e ? { type: 'attack', target: e.id } : { type: 'key', val: ' ' };
    }
    if (idx === ACTIONS.KITE_SAFE_MOVE) {
        const kite_enemies = _kite_pressure_enemies(G.player, _visible_enemies(G));
        const decision = safest_adjacent_move(G, kite_enemies, true);
        return decision || { type: 'key', val: ' ' };
    }
    return { type: 'key', val: ' ' };
}

// Browser / Node export
if (typeof window !== 'undefined') {
    window.nnInference = {
        loadNNModel, extractStateJS, extractLocalMapJS, getActionMaskJS, nnActionToDecision
    };
} else {
    module.exports = {
        loadNNModel, extractStateJS, extractLocalMapJS, getActionMaskJS, nnActionToDecision
    };
}
