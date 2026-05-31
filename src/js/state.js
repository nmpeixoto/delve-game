// ===================== STATE & HELPERS =====================
let G={},_dpadTimer=null,_swipeStart=null,_lastAction=0;
const rand=n=>Math.floor(Math.random()*n);
const rr=(a,b)=>a+rand(b-a+1);
let _idCounter=0;
const uid=()=>`${Date.now().toString(36)}-${(++_idCounter).toString(36)}-${Math.random().toString(36).slice(2,8)}`;
const ch=p=>Math.random()<p;
// Debounce tile actions — 400ms safety net against double-fire
function canAct(opts={}){
  if(typeof isOverlayOpen === 'function' && isOverlayOpen()){
    if(!opts.allowShopOverlay || typeof isShopActionOverlayOpen !== 'function' || !isShopActionOverlayOpen()) return false;
  }
  const now=Date.now();
  if(now-_lastAction<120) return false;
  _lastAction=now; return true;
}
function getStat(statName) {
  let base = G.player[statName] || 0;
  let w = G.player.weapon ? (G.player.weapon[statName] || 0) : 0;
  let a = G.player.armor ? (G.player.armor[statName] || 0) : 0;
  return base + w + a;
}
