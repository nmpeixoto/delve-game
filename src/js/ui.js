// ===================== TOOLTIP =====================
function showTip(e,name,hp,maxHp,atk){
  e.stopPropagation(); // prevent global dismiss firing on same click
  let t=document.getElementById('tooltip');
  t.innerHTML=`<strong style="color:var(--text)">${name}</strong><br>`+
    (hp!==undefined?`HP:<span style="color:var(--red)">${hp}/${maxHp}</span> `:'') +
    (atk!==undefined?`ATK:<span style="color:var(--orange)">${atk}</span>`:'');
  t.style.display='block';
  // Clamp tooltip to viewport
  let tx=e.clientX+12, ty=e.clientY-8;
  let tw=t.offsetWidth, th=t.offsetHeight;
  if(tx+tw>window.innerWidth) tx=window.innerWidth-tw-4;
  if(ty<0) ty=4;
  if(ty+th>window.innerHeight) ty=window.innerHeight-th-4;
  t.style.left=tx+'px';
  t.style.top=ty+'px';
  clearTimeout(t._hideTimer);
  t._hideTimer=setTimeout(()=>hideTip(), 2500);
}
function hideTip(){
  clearTimeout(document.getElementById('tooltip')._hideTimer);
  document.getElementById('tooltip').style.display='none';
}

window._lpFiredUI = false;
let _uiLpTimer = null;
function startUILongPress(e, type) {
  window._lpFiredUI = false;
  _uiLpTimer = setTimeout(() => {
    window._lpFiredUI = true;
    if(type === 'class') showClassTip(e);
    else if(type === 'a1') showAbility1Tip(e);
    else if(type === 'a2') showAbility2Tip(e);
    if(navigator.vibrate) navigator.vibrate(40);
  }, 480);
}
function cancelUILongPress() {
  clearTimeout(_uiLpTimer);
}
function showClassTip(e) {
  let info = CLASS_INFO[G.player.class];
  if(info) showTip(e, `${G.player.class.toUpperCase()} PASSIVE<br><span style="color:var(--dim);font-weight:normal">${info.passive}</span>`);
}
function showAbility1Tip(e) {
  let info = CLASS_INFO[G.player.class];
  if(info) showTip(e, `${info.a1.name}<br><span style="color:var(--dim);font-weight:normal">${info.a1.desc}</span>`);
}
function showAbility2Tip(e) {
  let info = CLASS_INFO[G.player.class];
  if(info && G.player.lvl >= 5) showTip(e, `${info.a2.name}<br><span style="color:var(--dim);font-weight:normal">${info.a2.desc}</span>`);
  else if(info) showTip(e, `???<br><span style="color:var(--dim);font-weight:normal">Unlocks at Level 5</span>`);
}

// ===================== LOG =====================
function addLog(msg,cls=''){
  G.log.unshift({msg,cls});if(G.log.length>40)G.log.pop();
  let el=document.getElementById('log');
  el.innerHTML=G.log.map((l,i)=>`<div class="log-entry ${l.cls} ${i===0?'new':''}">${l.msg}</div>`).join('');
  el.scrollTop=0;
}

// ===================== LONG PRESS (enemy inspect) =====================
let _lpTimer=null, _lpFired=false, _lpId=null;

function startLongPress(e, id, name, hp, maxHp, atk){
  e.stopPropagation();
  _lpFired=false; _lpId=id;
  _lpTimer=setTimeout(()=>{
    _lpFired=true;
    showTip(e, name, hp, maxHp, atk);
    // Light vibration to confirm long press on mobile
    if(navigator.vibrate) navigator.vibrate(40);
  }, 480);
}
function endLongPress(e, id){
  clearTimeout(_lpTimer);
  e.preventDefault();
  e.stopPropagation();
  if(_lpFired){ _lpFired=false; return; } // long press — tooltip already shown, don't attack
  tileAttack(id); // short tap — attack
}
function cancelLongPress(){
  clearTimeout(_lpTimer);
  _lpFired=false;
}

// ===================== INV DRAWER =====================
function openInv(){
  document.getElementById('inv-drawer').classList.add('open');
  document.getElementById('drawer-backdrop').classList.add('open');
  updateInvDrawer();
  fireTip('firstBag');
}
function closeInv(){
  document.getElementById('inv-drawer').classList.remove('open');
  document.getElementById('drawer-backdrop').classList.remove('open');
}

// ===================== HELP MODAL =====================
function openHelp(){
  document.getElementById('help-overlay').style.display='flex';
  switchHelpTab('controls');
}
function closeHelp(){
  document.getElementById('help-overlay').style.display='none';
}
function switchHelpTab(tab){
  ['controls','combat','items','shop'].forEach(t=>{
    document.getElementById(`htab-${t}`).classList.toggle('active', t===tab);
    document.getElementById(`hpanel-${t}`).style.display= t===tab ? 'block' : 'none';
  });
}

// ===================== CONTEXTUAL TIPS =====================
// Tips fire once per run (not persisted — resets each new game intentionally
// so new players always see them, returning players can dismiss quickly)
const TIPS = {
  firstEnemy:  { shown:false, tab:'combat',   msg:'Tip: walk into an enemy to attack, tap one from range, or press B to use your class ability when it is ready.' },
  firstPotion:{ shown:false, tab:'items', msg:'Tip: potions are stored in your BAG. Tap BAG to drink one manually, or the game will prompt you automatically when a hit could be fatal.' },
  firstItem:  { shown:false, tab:'items', msg:'Tip: items auto-equip if better than what you have. Check your BAG for anything carried.' },
  firstLevelUp:{ shown:false, tab:'combat',   msg:'Tip: levelling up raises ATK, DEF, and Max HP. Kill enemies to gain XP.' },
  firstShop:   { shown:false, tab:'shop',     msg:'Tip: the merchant ($) buys and sells. Save gold for permanent stat upgrades from floor 2.' },
  firstStairs: { shown:false, tab:'controls', msg:'Tip: stand on the > tile and tap STAIRS (or press .) to descend to the next floor.' },
  firstBag:    { shown:false, tab:'items',    msg:'Tip: open BAG to manually equip a weaker item, swap gear, or use a saved potion.' },
  firstGold:   { shown:false, tab:'shop',     msg:'Tip: enemies drop gold. Collect it to spend at the merchant on each floor.' },
};

function fireTip(key){
  let tip = TIPS[key];
  if(!tip || tip.shown) return;
  tip.shown = true;
  addLog(tip.msg, 'log-info');
}

function resetTips(){
  Object.values(TIPS).forEach(t => t.shown = false);
}

// Hide tooltip on any tap outside enemy/item/shop tiles
document.addEventListener('touchstart', e=>{
  if(!e.target.closest('.tile-enemy,.tile-item,.shop-item,.sell-item,.shop-tab,#class-val,.act-btn')) hideTip();
},{passive:true});
document.addEventListener('click', e=>{
  if(!e.target.closest('.tile-enemy,.tile-item,#class-val,.act-btn')) hideTip();
},{passive:true});
