/**
 * Neural Network inference for DELVE bot.
 * Loads trained PyTorch model and replaces botDecisionLogic.
 * Falls back to heuristic bot if NN fails.
 */

// State: loaded = false until model is ready
let nnLoaded = false;
let nnModel = null;

/**
 * Load the trained neural network model.
 * Called once at startup.
 */
function loadNNModel() {
    try {
        // Try to load model via Node.js child_process
        const { execSync } = require('child_process');
        const fs = require('fs');
        const path = require('path');
        
        const modelPath = path.join(__dirname, 'checkpoints', 'delve_ppo_final.pt');
        if (!fs.existsSync(modelPath)) {
            console.log('[NN] No model found, using heuristic bot');
            return false;
        }
        
        // Export model weights to JSON for Node.js consumption
        const exportScript = `
import torch
import json
import sys
sys.path.insert(0, '${__dirname}')
from network import DelveNet
model = DelveNet(state_dim=148, action_dim=18, hidden_dim=256)
model.load_state_dict(torch.load('${modelPath.replace(/\\/g, '\\\\')}', map_location='cpu'))
weights = {}
for name, param in model.named_parameters():
    weights[name] = param.data.numpy().tolist()
print(json.dumps(weights))
`;
        
        const result = execSync(`python -c "${exportScript}"`, { 
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024,
        });
        
        const weights = JSON.parse(result);
        nnModel = weights;
        nnLoaded = true;
        console.log('[NN] Model loaded successfully');
        return true;
    } catch (err) {
        console.log('[NN] Failed to load model:', err.message);
        console.log('[NN] Using heuristic bot');
        return false;
    }
}

/**
 * Extract state vector from game state G.
 * This is a JavaScript port of state_extractor.py.
 */
function extractStateJS(G) {
    if (!G || !G.player) return null;
    
    const p = G.player;
    const MAP_W = 56;
    const features = [];
    
    // PLAYER CORE (10 floats)
    features.push(p.hp / Math.max(p.maxHp, 1));
    features.push(p.maxHp / 100);
    features.push(p.atk / 30);
    features.push(p.def / 20);
    features.push(p.lvl / 15);
    features.push(Math.min((p.xpNext - p.xp) / 100, 1.0));
    features.push(p.gold / 300);
    const classNames = ['warrior','rogue','mage','paladin','ranger','barbarian','necromancer','monk'];
    const classIdx = classNames.indexOf(p.class);
    for (let i = 0; i < 8; i++) features.push(i === classIdx ? 1.0 : 0.0);
    
    // PLAYER BUFFS (9)
    features.push(p.shieldWallTurns > 0 ? 1 : 0);
    features.push(p.vanishTurns > 0 ? 1 : 0);
    features.push(p.strengthTurns > 0 ? 1 : 0);
    features.push(p.bloodlustTurns > 0 ? 1 : 0);
    features.push(p.rootedTurns > 0 ? 1 : 0);
    features.push(p.poisonedTurns > 0 ? 1 : 0);
    features.push(Math.min((p.freeMoves || 0) / 5, 1.0));
    features.push(G.ability1Cooldown === 0 ? 1 : 0);
    features.push(G.ability2Cooldown === 0 && p.lvl >= 5 ? 1 : 0);
    
    // PLAYER GEAR (8)
    features.push(p.weapon ? 1 : 0);
    features.push((p.weapon ? p.weapon.atk : 0) / 20);
    features.push(p.weapon && p.weapon.sym === '♦' ? 1 : 0);
    features.push(p.weapon && p.weapon.sym === '🏹' ? 1 : 0);
    features.push(p.armor ? 1 : 0);
    features.push((p.armor ? p.armor.def : 0) / 15);
    features.push((p.vampirism || 0) / 3);
    features.push((p.regen || 0) / 3);
    
    // PASSIVE COMBAT STATS (6)
    features.push((p.dodgeBonus || 0) / 0.5);
    features.push((p.critChance || 0) / 0.3);
    features.push((p.swiftness || 0) / 3);
    features.push((p.perception || 0) / 3);
    features.push((p.goldBonus || 0) / 10);
    features.push((p.xpMult || 0) / 0.5);
    
    // DUNGEON CONTEXT (14)
    features.push(G.floor / 5);
    features.push(G.floor >= 5 ? 1 : 0);
    features.push(Math.min(G.turn / 2000, 1.0));
    features.push((G.seen ? G.seen.size : 0) / (56 * 36));
    features.push(G.items.some(i => i.carried && i.type === 'key') ? 1 : 0);
    features.push(G.map[p.y] && G.map[p.y][p.x] === 2 ? 1 : 0);
    features.push(G.map[p.y] && G.map[p.y][p.x] === 3 ? 1 : 0);
    features.push(0); // map_cleared placeholder
    features.push(Math.min(G.turn / 5 / 300, 1.0));
    features.push(G.shops && G.shops.some(s => G.seen && G.seen.has(s.y * 56 + s.x)) ? 1 : 0);
    features.push(0.5); // shop_distance placeholder
    features.push(0); // locked_door_count placeholder
    features.push(G.floor * 1.0 / 5);
    
    // CARRIED ITEMS (8)
    const carried = G.items.filter(i => i.carried);
    features.push(Math.min(carried.filter(i => i.type === 'potion').length / 6, 1.0));
    features.push(Math.min(carried.filter(i => i.type === 'potion_buff').length / 3, 1.0));
    features.push(Math.min(carried.filter(i => i.type === 'bomb').length / 3, 1.0));
    features.push(Math.min(carried.filter(i => i.type === 'scroll_teleport').length / 3, 1.0));
    features.push(Math.min(carried.filter(i => i.type === 'scroll' && /detection/.test(i.name || '')).length / 2, 1.0));
    features.push(Math.min(carried.filter(i => i.type === 'key').length / 2, 1.0));
    features.push(Math.min(carried.length / 12, 1.0));
    features.push(G.items.some(i => !i.carried && i.type === 'upgrade') ? 1 : 0);
    
    // ENEMY SUMMARY (6)
    const visEnemies = G.enemies.filter(e => !e.dying && !e.isPet && G.visible && G.visible.has(e.y * MAP_W + e.x));
    const adjEnemies = visEnemies.filter(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
    features.push(Math.min(visEnemies.length / 6, 1.0));
    features.push(Math.min(adjEnemies.length / 4, 1.0));
    features.push(visEnemies.length > 0 ? Math.min(Math.min(...visEnemies.map(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y))) / 10, 1.0) : 1.0);
    features.push(visEnemies.length > 0 ? Math.max(...visEnemies.map(e => e.hp / Math.max(e.maxHp, 1))) : 0.0);
    features.push(Math.min(visEnemies.reduce((s, e) => s + e.atk, 0) / 100, 1.0));
    features.push(visEnemies.some(e => e.boss) ? 1 : 0);
    
    // NEAREST ENEMY DETAIL (6)
    if (visEnemies.length > 0) {
        const nearest = visEnemies.reduce((a, b) => (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) < (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)) ? a : b);
        features.push(Math.min((Math.abs(nearest.x - p.x) + Math.abs(nearest.y - p.y)) / 10, 1.0));
        features.push(nearest.hp / Math.max(nearest.maxHp, 1));
        features.push(nearest.atk / 30);
        features.push(nearest.def / 10);
        features.push(nearest.boss ? 1 : 0);
        features.push(nearest.isElite ? 1 : 0);
    } else {
        features.push(0, 0, 0, 0, 0, 0);
    }
    
    // LOCAL MAP (48)
    for (let dy = -2; dy <= 2; dy += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
            const x = p.x + dx, y = p.y + dy;
            if (y >= 0 && y < 36 && x >= 0 && x < 56) {
                features.push(G.map[y][x] !== 0 ? 1 : 0);
                features.push(G.seen && G.seen.has(y * 56 + x) ? 1 : 0);
                features.push(G.enemies.some(e => e.x === x && e.y === y && !e.dying) ? 1 : 0);
                features.push(G.items.some(i => i.x === x && i.y === y && !i.carried) ? 1 : 0);
            } else {
                features.push(0, 0, 0, 0);
            }
        }
    }
    
    // Pad to 148
    while (features.length < 148) features.push(0);
    return features.slice(0, 148);
}

/**
 * Get action mask from game state.
 * This is a JavaScript port of action_mask.py.
 */
function getActionMaskJS(G) {
    if (!G || !G.player) return new Array(18).fill(false);
    
    const mask = new Array(18).fill(false);
    const p = G.player;
    const MAP_W = 56;
    
    if (G.gameOver || G.won) return mask;
    
    // Movement
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (let i = 0; i < 4; i++) {
        const nx = p.x + dirs[i][0], ny = p.y + dirs[i][1];
        if (ny >= 0 && ny < 36 && nx >= 0 && nx < 56) {
            const tile = G.map[ny][nx];
            if (tile !== 0 && tile !== 4) {
                const blocking = G.enemies.some(e => e.x === nx && e.y === ny && !e.dying);
                if (!blocking) mask[i] = true;
            }
        }
    }
    
    const visEnemies = G.enemies.filter(e => !e.dying && !e.isPet && G.visible && G.visible.has(e.y * MAP_W + e.x));

    // Attack adjacent enemies
    const adjEnemies = G.enemies.filter(e => !e.dying && !e.isPet && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
    for (let i = 0; i < Math.min(2, adjEnemies.length); i++) mask[4 + i] = true;
    
    // Abilities
    if (G.ability1Cooldown === 0 && visEnemies.length > 0) mask[6] = true;
    if (p.lvl >= 5 && G.ability2Cooldown === 0 && (visEnemies.length > 0 || p.hp / Math.max(p.maxHp, 1) <= 0.8)) mask[7] = true;
    
    // Items
    const carried = G.items.filter(i => i.carried);
    if (carried.some(i => i.type === 'potion')) mask[8] = true;
    if (carried.some(i => i.type === 'potion_buff')) mask[9] = true;
    if (carried.some(i => i.type === 'bomb') && adjEnemies.length > 0) mask[10] = true;
    if (carried.some(i => i.type === 'scroll_teleport')) mask[11] = true;
    if (carried.some(i => i.type === 'scroll' && /detection/.test(i.name || ''))) mask[12] = true;
    
    // Descend
    if (G.map[p.y] && G.map[p.y][p.x] === 2 && G.floor < 5) mask[13] = true;
    
    // Shop
    const nearShop = G.shops && G.shops.some(s => Math.abs(s.x - p.x) <= 1 && Math.abs(s.y - p.y) <= 1);
    if (nearShop) mask[14] = true;
    if (G.shopOpen) { mask[15] = true; mask[16] = true; mask[17] = true; }
    
    if (!mask.some(Boolean)) mask[17] = true;
    
    return mask;
}

/**
 * Convert NN action index to game decision.
 */
function nnActionToDecision(actionIdx, G) {
    const p = G.player;
    const MAP_W = 56;
    
    switch (actionIdx) {
        case 0: return { type: 'key', val: 'ArrowUp' };
        case 1: return { type: 'key', val: 'ArrowDown' };
        case 2: return { type: 'key', val: 'ArrowLeft' };
        case 3: return { type: 'key', val: 'ArrowRight' };
        case 4: case 5:
            // Attack first adjacent enemy
            const adjEnemies = G.enemies.filter(e => !e.dying && !e.isPet && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1);
            if (adjEnemies.length > actionIdx - 4) return { type: 'attack', target: adjEnemies[actionIdx - 4].id };
            return { type: 'key', val: 'Escape' };
        case 6: return { type: 'key', val: 'b' }; // ability1
        case 7: return { type: 'key', val: 'v' }; // ability2
        case 8: return { type: 'key', val: 'i' }; // open inventory (potion)
        case 9: return { type: 'key', val: 'i' }; // open inventory (buff)
        case 10: return { type: 'key', val: 'i' }; // open inventory (bomb)
        case 11: return { type: 'key', val: 'i' }; // open inventory (teleport)
        case 12: return { type: 'key', val: 'i' }; // open inventory (detection)
        case 13: return { type: 'key', val: '>' }; // descend
        case 14: return { type: 'key', val: 't' }; // open shop
        case 15: return { type: 'key', val: 't' }; // buy
        case 16: return { type: 'key', val: 'Escape' }; // sell
        case 17: return { type: 'key', val: 'Escape' }; // escape/close shop
        default: return { type: 'key', val: 'Escape' };
    }
}

// Try to load the model on startup
loadNNModel();

// Export for use in bot_brain.js
if (typeof window !== 'undefined') {
    window.nnInference = {
        loaded: () => nnLoaded,
        getAction: (G) => {
            if (!nnLoaded) return null;
            try {
                const state = extractStateJS(G);
                const mask = getActionMaskJS(G);
                // Simple greedy selection from model weights
                // In production, this would use the actual PyTorch model
                return null; // Placeholder - needs actual model inference
            } catch (e) {
                return null;
            }
        }
    };
}
