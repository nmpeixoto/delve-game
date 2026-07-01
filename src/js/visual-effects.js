// ===================== VISUAL EFFECTS MODULE =====================

// NEW: Particle system for visual effects
function spawnParticle(x, y, color = '#ffffff', duration = 800) {
  const el = document.createElement('div');
  el.className = 'particle';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.backgroundColor = color;
  el.style.boxShadow = `0 0 ${Math.random() * 10}px ${color}`;
  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, duration);
}

// NEW: Auras for magic and special abilities
function createAura(elementId, type) {
  const element = document.getElementById(elementId);
  if (element && ['aura-magic', 'aura-fire', 'aura-lightning'].includes(type)) {
    element.classList.add(type);
  }
}

// NEW: Lighting effects on tiles
function updateTileLighting(tileId, isLit) {
  const tile = document.querySelector(`#${tileId}`);
  if (!tile) return;

  if (isLit) {
    tile.classList.add('tile-lighted');
  } else {
    tile.classList.remove('tile-lighted');
  }
}

// NEW: Dynamic background patterns for atmosphere
function setAtmosphericPattern(type) {
  const body = document.body;
  // Remove existing pattern classes
  body.classList.remove('pattern-dark', 'pattern-ethereal', 'pattern-fire');

  if (type === 'dark') {
    body.classList.add('pattern-dark');
  } else if (type === 'ethereal') {
    body.classList.add('pattern-ethereal');
  } else if (type === 'fire') {
    body.classList.add('pattern-fire');
  }
}

// NEW: Dynamic lighting system for dungeon ambiance
function setDungeonLighting(brightness = 1.0) {
  const mapArea = document.getElementById('map-area');
  if (!mapArea) return;

  // Apply dynamic brightness and contrast adjustments
  mapArea.style.filter = `brightness(${brightness}) contrast(1.2)`;
}

// NEW: Add floating text for magic effects
function spawnMagicText(x, y, text, color) {
  const el = document.createElement('div');
  el.className = 'float-text';
  el.textContent = text;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.color = color;
  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, 1000);
}

// NEW: Create elemental particles on impact
function spawnImpactParticles(x, y, type) {
  const count = 8;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      spawnParticle(
        x + Math.random() * 20 - 10,
        y + Math.random() * 20 - 10,
        type === 'fire' ? '#ff6f00' : 
                      type === 'lightning' ? '#4fc3f7' :
                      type === 'magic' ? '#c59bf8' : '#ffffff',
      600 + Math.random() * 200
      );
    }, i * 50);
  }
}
// === COMBAT-SPECIFIC VISUAL EFFECTS ===

// Player damage burst (when player hits enemy)
function spawnPlayerHitEffect(gx, gy) {
  spawnCombatRipple(gx, gy, '#ef4444');
  enemyHitFlash(gx, gy);
}

// Crit-specific burst with extra particles
function spawnCritBurst(x, y) {
  spawnCritText(x, y, '⚡CRIT!');
  // Extra ripples
  spawnCombatRipple(x, y, '#fbbf24');
  spawnCombatRipple(x, y, '#fbbf24');
}

// Death burst with type-specific color
function spawnDeathBurst(gx, gy, enemyColor) {
  spawnDeathExplosion(gx, gy, enemyColor || '#f87171');
  // Extra particles
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      spawnParticle(
        gx * 32 + 16 + Math.random() * 16 - 8,
        gy * 32 + 16 + Math.random() * 16 - 8,
        enemyColor || '#f87171',
        500 + Math.random() * 300
      );
    }, i * 60);
  }
}

// Ability visual with class-specific theming
function spawnClassAbilityEffect(gx, gy, abilityType) {
  const themeColors = {
    'FIREBALL': '#fb923c',
    'SMITE': '#fde68a',
    'PIERCING_SHOT': '#bbf7d0',
    'CLEAVE': '#fca5a5',
    'SIPHON': '#c4b5fd',
    'BASH': '#fb923c',
    'PUSH_KICK': '#fed7aa',
    'DASH': '#a3a3a3',
    'VANISH': '#94a3b8',
    'BLINK': '#818cf8',
    'SHIELD_WALL': '#60a5fa',
    'BLOODLUST': '#ef4444',
    'RAISE_DEAD': '#a78bfa',
    'BEAR_TRAP': '#fb923c',
    'FLURRY': '#fca5a5',
    'LAY_ON_HANDS': '#4ade80'
  };
  const color = themeColors[abilityType] || '#ffffff';
  // Big triple ripple for abilities
  for (let i = 0; i < 3; i++) {
    setTimeout(() => spawnCombatRipple(gx, gy, color), i * 100);
  }
}

// Dodge/Miss visual feedback
function spawnEvadeEffect(gx, gy, type) {
  if (type === 'dodge') {
    spawnDodgeEffect(gx, gy, '#60a5fa');
  } else if (type === 'block') {
    spawnDodgeEffect(gx, gy, '#a78bfa');
  }
}

// Status application visual
function spawnStatusApplied(gx, gy, statusType) {
  const statusIcons = {
    'stunned': { symbol: '💫', color: '#fbbf24' },
    'poisoned': { symbol: '☠️', color: '#a855f7' },
    'frozen': { symbol: '❄️', color: '#3b82f6' },
    'rooted': { symbol: '🌿', color: '#4ade80' },
    'enraged': { symbol: '💢', color: '#ef4444' },
    'burning': { symbol: '🔥', color: '#fb923c' }
  };
  const s = statusIcons[statusType] || { symbol: '✨', color: '#ffffff' };
  spawnStatusEffect(gx, gy, s.symbol, s.color);
}

// ════════════════════════════════════════════════
// ROUND D — ENVIRONMENTAL & AMBIENT FX
// ════════════════════════════════════════════════

// Ambient water drip particle
function spawnAmbientDrip() {
  const mapArea = document.getElementById('map-area');
  if (!mapArea || !G || !G.map) return;
  const rect = mapArea.getBoundingClientRect();
  // Spawn drips only over dark/seen areas (random positions)
  const x = rect.left + Math.random() * rect.width;
  const y = rect.top + Math.random() * rect.height * 0.6;
  const el = document.createElement('div');
  el.className = 'ambient-drip';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.animationDuration = (1.5 + Math.random() * 1.0) + 's';
  el.style.opacity = 0.15 + Math.random() * 0.2;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Ambient dust mote particle
function spawnAmbientDust() {
  const mapArea = document.getElementById('map-area');
  if (!mapArea || !G || !G.map) return;
  const rect = mapArea.getBoundingClientRect();
  const x = rect.left + Math.random() * rect.width;
  const y = rect.top + Math.random() * rect.height;
  const el = document.createElement('div');
  el.className = 'ambient-dust';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.animationDuration = (3 + Math.random() * 3) + 's';
  el.style.width = (2 + Math.random() * 3) + 'px';
  el.style.height = el.style.width;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// Player movement trail — fading glow on tile
function spawnPlayerTrail(gx, gy) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  // Find the tile div at this grid position
  const idx = gy * MAP_W + gx;
  const tile = mapEl.children[idx];
  if (!tile) return;
  // Check it's a floor tile and not player's current position
  if (gx === G.player.x && gy === G.player.y) return;
  const trail = document.createElement('div');
  trail.className = 'trail-glow';
  tile.appendChild(trail);
  setTimeout(() => { if (trail.parentNode) trail.remove(); }, 600);
}

// Add bloodstain to the game state
function spawnBloodstain(gx, gy) {
  if (!G.bloodstains) G.bloodstains = new Set();
  const key = gx + ',' + gy;
  G.bloodstains.add(key);
}

// Tile reveal burst effect
function spawnTileReveal(gx, gy) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  const idx = gy * MAP_W + gx;
  const tile = mapEl.children[idx];
  if (!tile) return;
  // The tile-reveal CSS animation is already applied in renderLegacyMap
  // This can add an extra particle burst
  if (typeof spawnParticle === 'function') {
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const rect = tile.getBoundingClientRect();
        spawnParticle(
          rect.left + rect.width / 2 + Math.random() * 10 - 5,
          rect.top + rect.height / 2 + Math.random() * 10 - 5,
          'rgba(200,200,255,0.3)',
          400
        );
      }, i * 80);
    }
  }
}

// Start/stop ambient dungeon effects (managed externally)
let _ambientTimer = null;

function startDungeonAmbient() {
  stopDungeonAmbient();
  // Drip sounds-like effect (visual only — occasional droplets)
  _ambientTimer = setInterval(() => {
    if (!G || !G.map) return;
    if (Math.random() < 0.3) spawnAmbientDrip();
    if (Math.random() < 0.4) spawnAmbientDust();
  }, 2000);
}

function stopDungeonAmbient() {
  if (_ambientTimer) {
    clearInterval(_ambientTimer);
    _ambientTimer = null;
  }
}