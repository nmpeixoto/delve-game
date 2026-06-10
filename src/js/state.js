// ===================== STATE & HELPERS =====================
let G={},_dpadTimer=null,_swipeStart=null,_lastAction=0;
const rand=n=>Math.floor(Math.random()*n);
const rr=(a,b)=>a+rand(b-a+1);
let _idCounter=0;
const uid=()=>`${Date.now().toString(36)}-${(++_idCounter).toString(36)}`;
const ch=p=>Math.random()<p;
function round1(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
function fmt1(value){
  let n = round1(value);
  if(Object.is(n, -0)) n = 0;
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}
function fmtPct(value){
  return `${fmt1(Number(value) * 100)}%`;
}
function addDamageDealt(amount){
  G.player.damageDealt = round1((G.player.damageDealt || 0) + amount);
}
  // Debounce tile actions — 120ms safety net against double-fire
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
