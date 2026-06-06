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
  if(DIRS[e.key]){e.preventDefault();let[dx,dy]=DIRS[e.key];move(dx,dy);}
  if(e.key==='1'||e.key==='b'||e.key==='B') doAbility1();
  if(e.key==='2'||e.key==='v'||e.key==='V') doAbility2();
  if(e.key==='.'||e.key==='>') descend();
  if(e.key==='i'||e.key==='I') {
    if(document.getElementById('inv-drawer').classList.contains('open')) closeInv();
    else openInv();
  }
  if(e.key==='t'||e.key==='T') openShop();
  if(e.key==='?'||e.key==='h'||e.key==='H') openHelp();
});

// Only prevent double-tap zoom on d-pad buttons
document.addEventListener('touchend',e=>{
  if(e.target.closest('.dpad-btn'))e.preventDefault();
},{passive:false});

// ===================== SWIPE =====================
document.getElementById('map-area').addEventListener('touchstart',e=>{
  if(e.touches.length!==1)return;
  _swipeStart={x:e.touches[0].clientX,y:e.touches[0].clientY};
},{passive:true});
document.getElementById('map-area').addEventListener('touchend',e=>{
  if(!_swipeStart||G.gameOver||G.won)return;
  let dx=e.changedTouches[0].clientX-_swipeStart.x;
  let dy=e.changedTouches[0].clientY-_swipeStart.y;
  _swipeStart=null;
  if(Math.sqrt(dx*dx+dy*dy)<20)return;
  if(Math.abs(dx)>Math.abs(dy))move(Math.sign(dx),0);
  else move(0,Math.sign(dy));
},{passive:true});
