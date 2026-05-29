// ===================== KEYBOARD =====================
function isOverlayOpen(){
  return document.getElementById('shop-overlay').classList.contains('open')
    || document.getElementById('help-overlay').style.display==='flex'
    || document.getElementById('inv-drawer').classList.contains('open')
    || document.getElementById('emergency-overlay').style.display==='flex';
}
document.addEventListener('keydown',e=>{
  if(G.gameOver||G.won)return;
  if(document.getElementById('game-screen').classList.contains('hidden'))return;
  // Allow closing overlays with Escape
  if(e.key==='Escape'){
    if(document.getElementById('shop-overlay').classList.contains('open')){closeShop();return;}
    if(document.getElementById('help-overlay').style.display==='flex'){closeHelp();return;}
    if(document.getElementById('inv-drawer').classList.contains('open')){closeInv();return;}
    return;
  }
  // Block game input when overlays are open
  if(isOverlayOpen()) return;
  if(DIRS[e.key]){e.preventDefault();let[dx,dy]=DIRS[e.key];move(dx,dy);}
  if(e.key==='b'||e.key==='B') doBash();
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
