// ===================== FX =====================
function getFxPoint(gx, gy){
  const renderer = typeof window !== 'undefined' ? window.PixedRenderer : null;
  if(renderer && renderer.initialized && renderer.camera && typeof getIsoTileCenter === 'function' && typeof worldToScreen === 'function'){
    const area = document.getElementById('map-area');
    if(area){
      const screen = worldToScreen(getIsoTileCenter(gx, gy), renderer.camera);
      const rect = area.getBoundingClientRect();
      return { left: rect.left + screen.x, top: rect.top + screen.y, halfW: ISO_HALF_W, halfH: ISO_HALF_H, mode: 'pixed' };
    }
  }

  const wrap = document.getElementById('map-wrap');
  const cs = typeof getCellSize === 'function' ? getCellSize() : 32;
  const rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
  const half = cs / 2;
  return { left: rect.left + gx * cs + half, top: rect.top + gy * cs + half, halfW: half, halfH: half, mode: 'legacy' };
}

function shakeMap(){
  const renderer = typeof window !== 'undefined' ? window.PixedRenderer : null;
  const target = renderer && renderer.initialized && renderer.canvas ? renderer.canvas : document.getElementById('map-wrap');
  const fallback = target === document.getElementById('game-canvas') ? document.getElementById('map-wrap') : document.getElementById('game-canvas');
  if(!target) return;
  if(fallback) fallback.classList.remove('shake');
  target.classList.remove('shake');void target.offsetWidth;target.classList.add('shake');
}
function flashDamage(){
  let el=document.getElementById('damage-flash');
  el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
}
function floatText(txt,gx,gy,color){
  const p = getFxPoint(gx, gy);
  let el=document.createElement('div');
  el.className='float-text';el.textContent=txt;el.style.color=color;
  el.style.left=p.left+'px';el.style.top=(p.top-p.halfH)+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),880);
}
function popText(txt,gx,gy){
  const p = getFxPoint(gx, gy);
  let el=document.createElement('div');
  el.className='pop-text';el.textContent=txt;
  // center on tile
  el.style.left=(p.left-p.halfW/2)+'px';el.style.top=(p.top-(p.halfH*1.5))+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),400);
}

// === ENHANCED COMBAT VISUAL FEEDBACK ===

function spawnCombatRipple(x, y, color = '#ffffff'){
  const p = getFxPoint(x, y);
  const el = document.createElement('div');
  el.className = 'combat-ripple';
  el.style.left = p.left + 'px';
  el.style.top = p.top + 'px';
  el.style.borderColor = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

function spawnCritText(x, y, text){
  const p = getFxPoint(x, y);
  const el = document.createElement('div');
  el.className = 'crit-text';
  el.textContent = text;
  el.style.left = (p.left - 20) + 'px';
  el.style.top = (p.top - 30) + 'px';
  el.style.color = '#fbbf24';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 600);
  // Also spawn gold ripple for crit
  spawnCombatRipple(x, y, '#fbbf24');
}

function spawnDodgeEffect(x, y, color = '#60a5fa'){
  const p = getFxPoint(x, y);
  const el = document.createElement('div');
  el.className = 'dodge-text';
  el.textContent = '💨';
  el.style.left = (p.left - 10) + 'px';
  el.style.top = (p.top - 10) + 'px';
  el.style.color = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

function spawnHealEffect(x, y, text, color = '#4ade80'){
  const p = getFxPoint(x, y);
  const el = document.createElement('div');
  el.className = 'heal-text';
  el.textContent = text;
  el.style.left = (p.left - 20) + 'px';
  el.style.top = (p.top - 5) + 'px';
  el.style.color = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function enemyHitFlash(enemyId) {
  const tile = document.querySelector(`.tile-enemy[onclick*="${enemyId}"]`);
  if(tile) {
    tile.classList.remove('combat-flash');
    void tile.offsetWidth;
    tile.classList.add('combat-flash');
  }
}

function spawnDeathExplosion(x, y, color = '#f87171') {
  // Spawn multiple ripples for death
  for(let i = 0; i < 3; i++) {
    setTimeout(() => {
      spawnCombatRipple(x, y, color);
    }, i * 80);
  }
  // Bonus pop for death
  popText('💀', x, y);
}

function spawnAbilityEffect(x, y, type) {
  const colors = {
    bash: '#fb923c',
    fireball: '#ef4444',
    smite: '#fde68a',
    shot: '#bbf7d0',
    cleave: '#fca5a5',
    siphon: '#c4b5fd',
    kick: '#fed7aa',
    shield: '#60a5fa',
    vanish: '#a3a3a3',
    heal: '#4ade80',
    lightning: '#818cf8',
    dark: '#a78bfa'
  };
  const color = colors[type] || '#ffffff';
  spawnCombatRipple(x, y, color);
  // Bigger ripple for abilities
  setTimeout(() => spawnCombatRipple(x, y, color), 100);
  setTimeout(() => spawnCombatRipple(x, y, color), 200);
}

function spawnStatusEffect(x, y, symbol, color = '#ffffff') {
  const p = getFxPoint(x, y);
  const el = document.createElement('div');
  el.className = 'pop-text';
  el.textContent = symbol;
  el.style.left = (p.left - p.halfW/2) + 'px';
  el.style.top = (p.top - p.halfH - 10) + 'px';
  el.style.fontSize = '1.8rem';
  el.style.color = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}
