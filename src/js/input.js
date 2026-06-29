// ===================== KEYBOARD =====================
function isOverlayOpen(){
  return document.getElementById('shop-overlay').classList.contains('open')
    || document.getElementById('help-overlay').style.display==='flex'
    || document.getElementById('inv-drawer').classList.contains('open')
    || document.getElementById('emergency-overlay').style.display==='flex'
    || document.getElementById('shrine-overlay').style.display==='flex';
}
function isShopActionOverlayOpen(){
  return document.getElementById('shop-overlay').classList.contains('open')
    && document.getElementById('help-overlay').style.display!=='flex'
    && !document.getElementById('inv-drawer').classList.contains('open')
    && document.getElementById('emergency-overlay').style.display!=='flex'
    && document.getElementById('shrine-overlay').style.display!=='flex';
}

function isGameInputReady(){
  const gameScreen = document.getElementById('game-screen');
  return !!(
    gameScreen &&
    !gameScreen.classList.contains('hidden') &&
    !gameScreen.classList.contains('pixed-starting') &&
    typeof G === 'object' &&
    G &&
    G.player &&
    G.map &&
    Array.isArray(G.items)
  );
}

let _activePath = [];
let _activePathIntent = null;
let _pathTimer = null;

function hasCarriedKey() {
  return G.items && G.items.some(item => item.carried && item.type === 'key');
}

function stopActivePath() {
  _activePath = [];
  _activePathIntent = null;
  if (_pathTimer) clearInterval(_pathTimer);
  _pathTimer = null;
}

function getInputAttackRange(player) {
  if (typeof getPlayerAttackRange === 'function') return getPlayerAttackRange(player);
  return player && player.class === 'ranger' && player.weapon && player.weapon.sym === '\uD83C\uDFF9' ? 3 : 1;
}

function isAdjacentToTarget(player, target) {
  if (!player || !target) return false;
  return Math.abs(player.x - target.x) + Math.abs(player.y - target.y) === 1;
}

function isInEnemyInteractionRange(player, enemy) {
  if (!player || !enemy) return false;
  const range = getInputAttackRange(player);
  const dist = Math.max(Math.abs(player.x - enemy.x), Math.abs(player.y - enemy.y));
  return dist > 0 && dist <= range;
}

function beginActivePath(path, intent = null) {
  stopActivePath();
  _activePath = path || [];
  _activePathIntent = intent;
  if (!_activePath.length) {
    resolvePathIntent(intent);
    return;
  }
  _pathTimer = setInterval(stepActivePath, 110);
  stepActivePath();
}

function stepActivePath() {
  if (!isGameInputReady() || G.gameOver || G.won || isOverlayOpen()) {
    stopActivePath();
    return;
  }
  if (!_activePath.length) {
    stopActivePath();
    return;
  }
  const next = _activePath.shift();
  const prevX = G.player.x;
  const prevY = G.player.y;
  const tile = G.map && G.map[next.y] ? G.map[next.y][next.x] : undefined;
  const dx = Math.sign(next.x - prevX);
  const dy = Math.sign(next.y - prevY);
  move(dx, dy);
  if (G.player.x === prevX && G.player.y === prevY) {
    if (tile === TILE.LOCKED_DOOR || tile === TILE.SECRET_DOOR) {
      _activePath.unshift(next);
      return;
    }
    stopActivePath();
    return;
  }
  if (!_activePath.length) {
    const intent = _activePathIntent;
    stopActivePath();
    resolvePathIntent(intent);
  }
}

function beginPathOrResolveIfSettled(path, intent, settled) {
  if (!Array.isArray(path) || !path.length) {
    stopActivePath();
    if (settled) resolvePathIntent(intent);
    return;
  }
  beginActivePath(path, intent);
}

function resolvePathIntent(intent) {
  if (!intent) return;
  if (intent.type === 'enemy' && intent.id) tileAttack(intent.id);
  if (intent.type === 'item' && intent.id) tilePickup(intent.id);
  if (intent.type === 'shop') openShop();
  if (intent.type === 'stairs') descend();
}

function manualMove(dx, dy) {
  stopActivePath();
  move(dx, dy);
}

function manualAbility1() {
  stopActivePath();
  if (typeof window === 'undefined' || !window._lpFiredUI) doAbility1();
  if (typeof window !== 'undefined') window._lpFiredUI = false;
}

function manualAbility2() {
  stopActivePath();
  if (typeof window === 'undefined' || !window._lpFiredUI) doAbility2();
  if (typeof window !== 'undefined') window._lpFiredUI = false;
}

function manualUseBomb() {
  stopActivePath();
  useBombQuickAction();
}

function manualDescend() {
  stopActivePath();
  descend();
}

function manualOpenShop() {
  stopActivePath();
  openShop();
}

function manualOpenInv() {
  stopActivePath();
  openInv();
}

function manualOpenHelp() {
  stopActivePath();
  openHelp();
}

function handleCanvasPointer(e) {
  if (!isGameInputReady() || G.gameOver || G.won || isOverlayOpen()) return;
  const renderer = typeof PixedRenderer !== 'undefined' ? PixedRenderer : null;
  if (!renderer || !renderer.camera || typeof screenToGrid !== 'function') return;
  if (typeof e.button === 'number' && e.button !== 0) return;
  const canvas = e.currentTarget || document.getElementById('game-canvas');
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const grid = screenToGrid(e.clientX - rect.left, e.clientY - rect.top, renderer.camera);
  if (!grid || !G.map || grid.y < 0 || grid.y >= G.map.length || grid.x < 0 || grid.x >= G.map[grid.y].length) return;

  const enemy = G.enemies.find(en => !en.dying && en.x === grid.x && en.y === grid.y);
  if (enemy) {
    beginPathOrResolveIfSettled(pathToEnemyTarget({
      map: G.map,
      player: G.player,
      enemy,
      hasKey: hasCarriedKey(),
      blocked: getBlockedEntityTiles(G.enemies, enemy.id),
    }), { type: 'enemy', id: enemy.id }, isInEnemyInteractionRange(G.player, enemy));
    return;
  }

  const item = G.items.find(it => !it.carried && it.x === grid.x && it.y === grid.y);
  if (item) {
    beginPathOrResolveIfSettled(pathToAdjacentTarget({
      map: G.map,
      player: G.player,
      target: item,
      hasKey: hasCarriedKey(),
      blocked: getBlockedEntityTiles(G.enemies),
    }), { type: 'item', id: item.id }, isAdjacentToTarget(G.player, item));
    return;
  }

  const clickedTile = G.map[grid.y][grid.x];
  const intent = clickedTile === TILE.STAIRS
    ? { type: 'stairs' }
    : clickedTile === TILE.SHOP
      ? { type: 'shop' }
      : null;

  beginPathOrResolveIfSettled(findGridPath({
    map: G.map,
    start: G.player,
    goal: { x: grid.x, y: grid.y },
    hasKey: hasCarriedKey(),
    blocked: getBlockedEntityTiles(G.enemies),
  }), intent, grid.x === G.player.x && grid.y === G.player.y);
}

document.addEventListener('keydown',e=>{
  if(G.gameOver||G.won)return;
  if(document.getElementById('game-screen').classList.contains('hidden')){
    if(!document.getElementById('title-screen').classList.contains('hidden')) {
      if(document.getElementById('class-select-overlay').style.display === 'flex') {
        let keys = Object.keys(CLASS_DATA);
        let idx = keys.indexOf(_selectedClass);
        if(e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
          idx = (idx - 1 + keys.length) % keys.length;
          selectClass(keys[idx]);
          let btn = document.getElementById(`cbtn-${keys[idx]}`);
          if(btn) btn.scrollIntoView({block: 'nearest'});
        } else if(e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
          idx = (idx + 1) % keys.length;
          selectClass(keys[idx]);
          let btn = document.getElementById(`cbtn-${keys[idx]}`);
          if(btn) btn.scrollIntoView({block: 'nearest'});
        } else if(e.key === 'Enter') {
          confirmClassSelect();
        } else if(e.key === 'h' || e.key === 'H') {
          let toggle = document.getElementById('hard-mode-toggle');
          if(toggle) toggle.checked = !toggle.checked;
        } else if(e.key === 'Escape') {
          closeClassSelect();
        }
      } else {
        if(e.key === 'Enter') {
          openClassSelect();
        }
      }
    }
    return;
  }
  if(!isGameInputReady()) return;
  // Allow closing overlays with Escape
  if(e.key==='Escape'){
    if(document.getElementById('shop-overlay').classList.contains('open')){closeShop();return;}
    if(document.getElementById('help-overlay').style.display==='flex'){closeHelp();return;}
    if(document.getElementById('inv-drawer').classList.contains('open')){closeInv();return;}
    if(document.getElementById('shrine-overlay').style.display==='flex'){
      if(_currentShrine) {
        let idx = G.items.findIndex(i => i.id === _currentShrine.id);
        if(idx > -1) G.items.splice(idx, 1);
      }
      closeShrinePrompt();
      advanceTurn({allowFreeMove:true});
      return;
    }
    return;
  }
  // Block game input when overlays are open
  if(isOverlayOpen()) return;
  if(DIRS[e.key]){e.preventDefault();let[dx,dy]=DIRS[e.key];stopActivePath();move(dx,dy);}
  if(e.key==='1'||e.key==='b'||e.key==='B') { stopActivePath(); doAbility1(); }
  if(e.key==='2'||e.key==='v'||e.key==='V') { stopActivePath(); doAbility2(); }
  if(e.key==='.'||e.key==='>') { stopActivePath(); descend(); }
  if(e.key==='i'||e.key==='I') {
    stopActivePath();
    if(document.getElementById('inv-drawer').classList.contains('open')) closeInv();
    else openInv();
  }
  if(e.key==='t'||e.key==='T') { stopActivePath(); openShop(); }
  if(e.key==='?'||e.key==='h'||e.key==='H') { stopActivePath(); openHelp(); }
});

// Only prevent double-tap zoom on d-pad buttons
document.addEventListener('touchend',e=>{
  if(e.target.closest('.dpad-btn'))e.preventDefault();
},{passive:false});

// ===================== SWIPE =====================
document.getElementById('map-area').addEventListener('touchstart',e=>{
  if(!isGameInputReady()) return;
  if(e.touches.length!==1)return;
  _swipeStart={x:e.touches[0].clientX,y:e.touches[0].clientY};
},{passive:true});
document.getElementById('map-area').addEventListener('touchend',e=>{
  if(!isGameInputReady()){ _swipeStart=null; return; }
  if(!_swipeStart||G.gameOver||G.won)return;
  let dx=e.changedTouches[0].clientX-_swipeStart.x;
  let dy=e.changedTouches[0].clientY-_swipeStart.y;
  _swipeStart=null;
  if(Math.sqrt(dx*dx+dy*dy)<20)return;
  stopActivePath();
  if(Math.abs(dx)>Math.abs(dy))move(Math.sign(dx),0);
  else move(0,Math.sign(dy));
},{passive:true});

const _gameCanvas = document.getElementById('game-canvas');
if (_gameCanvas) _gameCanvas.addEventListener('pointerdown', handleCanvasPointer);
