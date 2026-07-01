// ===================== VISUAL THEME COORDINATOR =====================
// Central hub that ties together all visual systems (fx.js, visual-effects.js,
// CSS, combat feedback) into coordinated themes based on dungeon depth.

const DUNGEON_THEMES = {
  // Floor 1 — Damp Catacombs (cool blue-grey)
  damp_catacombs: {
    name: 'Damp Catacombs',
    ambient: '#3b82b6', combat: '#60a5fa', particle: '#93c5fd',
    heal: '#34d399', death: '#94a3b8', magic: '#818cf8',
    floorBase: '#181828', wallBase: '#0a0a18',
    vignette: 'rgba(10,30,60,0.12)',
    dripColor: 'rgba(100,150,210,0.35)',
    cssAccent: '#60a5fa',
  },
  // Floor 2 — Ossuary (bone-white & rust)
  ossuary: {
    name: 'Ossuary',
    ambient: '#a3a3a3', combat: '#f87171', particle: '#e5e5e0',
    heal: '#86efac', death: '#78716c', magic: '#c4b5fd',
    floorBase: '#1c1c1e', wallBase: '#111115',
    vignette: 'rgba(30,20,15,0.15)',
    dripColor: 'rgba(160,140,120,0.25)',
    cssAccent: '#d6d3d1',
  },
  // Floor 3 — Fiery Abyss (orange-red heat)
  fiery_abyss: {
    name: 'Fiery Abyss',
    ambient: '#ef4444', combat: '#fb923c', particle: '#fca5a5',
    heal: '#fbbf24', death: '#991b1b', magic: '#fde68a',
    floorBase: '#1a1414', wallBase: '#0a0808',
    vignette: 'rgba(40,10,5,0.18)',
    dripColor: 'rgba(220,100,50,0.25)',
    cssAccent: '#fb923c',
  },
  // Floor 4 — Ethereal Crypt (purple-magenta)
  ethereal_crypt: {
    name: 'Ethereal Crypt',
    ambient: '#a855f7', combat: '#c084fc', particle: '#d8b4fe',
    heal: '#67e8f9', death: '#7c3aed', magic: '#e879f9',
    floorBase: '#1a1828', wallBase: '#0c0a18',
    vignette: 'rgba(40,10,50,0.15)',
    dripColor: 'rgba(160,120,220,0.3)',
    cssAccent: '#c084fc',
  },
  // Floor 5 — Boss Chamber (golden-bright)
  boss_chamber: {
    name: 'Boss Chamber',
    ambient: '#fbbf24', combat: '#f59e0b', particle: '#fde68a',
    heal: '#a3e635', death: '#b45309', magic: '#fef3c7',
    floorBase: '#1a1810', wallBase: '#0c0a06',
    vignette: 'rgba(30,25,5,0.12)',
    dripColor: 'rgba(200,180,80,0.3)',
    cssAccent: '#fbbf24',
  },
};

// Active theme state
let _activeTheme = null;
let _themeTransitioning = false;
let _coordinatorInitialized = false;

// Effect throttle — prevent overwhelming the DOM
const _effectCooldowns = {};
const EFFECT_COOLDOWNS = {
  ripple: 50,
  particle: 30,
  text: 80,
  flash: 200,
};

function throttleEffect(key, minMs) {
  const now = performance.now();
  if (_effectCooldowns[key] && now - _effectCooldowns[key] < minMs) return true;
  _effectCooldowns[key] = now;
  return false;
}

// ── THEME MANAGEMENT ──

function getThemeForFloor(floor) {
  if (floor >= 5) return DUNGEON_THEMES.boss_chamber;
  if (floor >= 4) return DUNGEON_THEMES.ethereal_crypt;
  if (floor >= 3) return DUNGEON_THEMES.fiery_abyss;
  if (floor >= 2) return DUNGEON_THEMES.ossuary;
  return DUNGEON_THEMES.damp_catacombs;
}

function initThemeCoordinator() {
  if (_coordinatorInitialized) return;
  _coordinatorInitialized = true;
  const theme = getThemeForFloor(G.floor || 1);
  applyTheme(theme, false);
}

function applyTheme(theme, animate = true) {
  if (_themeTransitioning) return;
  _activeTheme = theme;
  const root = document.documentElement;

  if (animate) {
    _themeTransitioning = true;
    root.style.setProperty('--theme-transition', 'all 0.6s cubic-bezier(0.4,0,0.2,1)');
    // Brief dark pulse during transition
    const vignette = document.getElementById('theme-vignette');
    if (vignette) {
      vignette.style.opacity = '0.35';
      setTimeout(() => { vignette.style.opacity = ''; }, 400);
    }
    setTimeout(() => {
      _themeTransitioning = false;
      root.style.setProperty('--theme-transition', '');
    }, 700);
  }

  // Set CSS variables for coordinated theme colors
  root.style.setProperty('--theme-ambient', theme.ambient);
  root.style.setProperty('--theme-combat', theme.combat);
  root.style.setProperty('--theme-particle', theme.particle);
  root.style.setProperty('--theme-heal', theme.heal);
  root.style.setProperty('--theme-death', theme.death);
  root.style.setProperty('--theme-magic', theme.magic);
  root.style.setProperty('--theme-floor', theme.floorBase);
  root.style.setProperty('--theme-wall', theme.wallBase);
  root.style.setProperty('--theme-vignette', theme.vignette);
  root.style.setProperty('--theme-accent', theme.cssAccent);

  // Update vignette
  const vignette = document.getElementById('theme-vignette');
  if (vignette) {
    vignette.style.background = `radial-gradient(ellipse at 50% 50%, transparent 55%, ${theme.vignette} 100%)`;
  }
}

function setFloorTheme(floor) {
  const theme = getThemeForFloor(floor);
  if (_activeTheme !== theme) {
    applyTheme(theme, true);
  }
}

// ── COORDINATED EFFECT DISPATCH ──

function coordCombatHit(x, y, isCrit = false) {
  if (!_activeTheme) return;
  const color = isCrit ? '#fbbf24' : _activeTheme.combat;
  if (typeof spawnCombatRipple === 'function') spawnCombatRipple(x, y, color);
  // Coordinated particle burst
  if (typeof spawnParticle === 'function') {
    for (let i = 0; i < (isCrit ? 5 : 2); i++) {
      setTimeout(() => {
        const cx = x * 32 + 16 + Math.random() * 10 - 5;
        const cy = y * 32 + 16 + Math.random() * 10 - 5;
        spawnParticle(cx, cy, isCrit ? '#fbbf24' : _activeTheme.particle, 400 + Math.random() * 200);
      }, i * 40);
    }
  }
}

function coordDeathEffect(x, y, isBoss = false) {
  if (!_activeTheme) return;
  const color = isBoss ? '#fbbf24' : _activeTheme.death;
  if (typeof spawnDeathExplosion === 'function') {
    spawnDeathExplosion(x, y, color);
  }
  // Coordinated burst
  if (typeof spawnDeathBurst === 'function' && !isBoss) {
    spawnDeathBurst(x, y, color);
  }
  if (isBoss && typeof spawnCombatRipple === 'function') {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => spawnCombatRipple(x, y, '#fbbf24'), i * 150);
    }
  }
}

function coordHealEffect(x, y, text) {
  if (!_activeTheme) return;
  if (typeof spawnHealEffect === 'function') {
    spawnHealEffect(x, y, text, _activeTheme.heal);
  }
}

function coordDodgeEffect(x, y, isPlayer = true) {
  const color = isPlayer ? '#60a5fa' : '#fbbf24';
  if (typeof spawnDodgeEffect === 'function') {
    spawnDodgeEffect(x, y, color);
  }
}

function coordCritEffect(x, y) {
  if (typeof spawnCritBurst === 'function') spawnCritBurst(x, y);
  if (typeof spawnCritText === 'function') spawnCritText(x, y, '⚡CRIT!');
}

function coordStatusEffect(x, y, statusType) {
  if (typeof spawnStatusApplied === 'function') {
    spawnStatusApplied(x, y, statusType);
  }
}

function coordAbilityEffect(x, y, abilityType) {
  if (typeof spawnClassAbilityEffect === 'function') {
    spawnClassAbilityEffect(x, y, abilityType);
  }
  if (typeof spawnAbilityEffect === 'function') {
    const typeMap = {
      FIREBALL: 'fireball', SMITE: 'smite', PIERCING_SHOT: 'shot',
      CLEAVE: 'cleave', SIPHON: 'siphon', BASH: 'bash',
      PUSH_KICK: 'kick', SHIELD_WALL: 'shield', VANISH: 'vanish',
      BLINK: 'lightning', BLOODLUST: 'cleave', RAISE_DEAD: 'dark',
      BEAR_TRAP: 'bash', FLURRY: 'kick', LAY_ON_HANDS: 'heal',
    };
    spawnAbilityEffect(x, y, typeMap[abilityType] || 'bash');
  }
}

// ── GLOBAL SCREEN EFFECTS ──

function coordScreenFlash(type = 'combat') {
  if (!_activeTheme) return;
  const colorMap = {
    combat: _activeTheme.combat,
    heal: _activeTheme.heal,
    level: _activeTheme.magic,
    death: _activeTheme.death,
  };
  const color = colorMap[type] || _activeTheme.combat;

  let el = document.getElementById('coord-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'coord-flash';
    el.style.cssText = 'position:fixed;inset:0;z-index:350;pointer-events:none;opacity:0;transition:opacity 0.15s ease;';
    document.body.appendChild(el);
  }
  // Very subtle — just a faint edge vignette, not a solid overlay
  el.style.background = `radial-gradient(ellipse at center, transparent 55%, ${color}18 100%)`;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 250);
  // Don't pulse vignette on every effect — too distracting
}

function pulseVignette() {
  const vignette = document.getElementById('theme-vignette');
  if (!vignette) return;
  vignette.style.opacity = '0.35';
  setTimeout(() => { vignette.style.opacity = ''; }, 400);
}

function coordLevelUpFlash() {
  coordScreenFlash('level');
  // Subtle sparkle burst around player — fewer particles, centered properly
  if (typeof spawnParticle === 'function' && G && G.player) {
    const cs = typeof getCellSize === 'function' ? getCellSize() : 32;
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const px = getFxPoint(G.player.x, G.player.y);
        spawnParticle(
          px.left + Math.random() * cs - cs/2,
          px.top + Math.random() * cs - cs/2,
          _activeTheme ? _activeTheme.magic : '#c084fc',
          500 + Math.random() * 300
        );
      }, i * 80);
    }
  }
}

function coordFloorTransition() {
  const el = document.getElementById('floor-transition');
  if (el) {
    el.classList.remove('active');
    void el.offsetWidth;
    el.classList.add('active');
  }
  // Show theme name briefly
  showThemeBanner();
}

function showThemeBanner() {
  if (!_activeTheme) return;
  let banner = document.getElementById('theme-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'theme-banner';
    banner.style.cssText = 'position:fixed;top:15%;left:50%;transform:translate(-50%,-50%);z-index:450;pointer-events:none;font-family:"Press Start 2P",monospace;font-size:0.5rem;color:var(--theme-accent,#c084fc);text-shadow:0 0 20px var(--theme-accent,#c084fc);opacity:0;transition:opacity 0.4s ease;text-align:center;letter-spacing:0.15em;';
    document.body.appendChild(banner);
  }
  banner.textContent = _activeTheme.name.toUpperCase();
  banner.style.opacity = '1';
  setTimeout(() => { banner.style.opacity = '0'; }, 2000);
}

// ── INIT / TEARDOWN ──

function ensureCoordinatorDOM() {
  // Create vignette element
  if (!document.getElementById('theme-vignette')) {
    const v = document.createElement('div');
    v.id = 'theme-vignette';
    v.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;transition:opacity 0.5s ease,background 0.6s cubic-bezier(0.4,0,0.2,1);';
    document.body.appendChild(v);
  }
  // Create floor transition overlay
  if (!document.getElementById('floor-transition')) {
    const ft = document.createElement('div');
    ft.id = 'floor-transition';
    ft.style.cssText = 'position:fixed;inset:0;z-index:400;pointer-events:none;background:#000;opacity:0;transition:opacity 0.5s ease;';
    document.body.appendChild(ft);
  }
}

function shutdownCoordinator() {
  if (typeof stopDungeonAmbient === 'function') stopDungeonAmbient();
  _coordinatorInitialized = false;
  _activeTheme = null;
}
