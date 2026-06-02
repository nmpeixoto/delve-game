// ===================== TOOLTIP =====================
function showTip(e,name,hp,maxHp,atk){
  e.stopPropagation(); // prevent global dismiss firing on same click
  let t=document.getElementById('tooltip');
  t.innerHTML=`<strong style="color:var(--text)">${name}</strong><br>`+
    (hp!==undefined?`HP:<span style="color:var(--red)">${fmt1(hp)}/${fmt1(maxHp)}</span> `:'') +
    (atk!==undefined?`ATK:<span style="color:var(--orange)">${fmt1(atk)}</span>`:'');
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

// ===================== SHRINE OVERLAY =====================
let _currentShrine = null;

function showShrinePrompt(shrine) {
  _currentShrine = shrine;
  document.getElementById('shrine-title').textContent = shrine.shrineType ? `${shrine.shrineType.toUpperCase()} SHRINE` : 'SHRINE';
  let msg = '';
  if(shrine.shrineType === 'Blood') {
    let cost = Math.max(1, Math.floor(G.player.maxHp * 0.3));
    msg = `Sacrifice ${fmt1(cost)} Max HP permanently to gain +1 ATK permanently? (HP: ${fmt1(G.player.hp)}/${fmt1(G.player.maxHp)})`;
  } else if(shrine.shrineType === 'Greed') {
    msg = `Sacrifice all your current Gold to instantly gain 2 Levels? (Gold: ${fmt1(G.player.gold)})`;
  } else if(shrine.shrineType === 'Cursed') {
    msg = `Fully heal your HP, but instantly summon 3 Elite enemies surrounding you? (HP: ${fmt1(G.player.hp)}/${fmt1(G.player.maxHp)})`;
  } else {
    msg = `Touch the shrine? (HP: ${fmt1(G.player.hp)}/${fmt1(G.player.maxHp)})`; // Fallback
  }
  document.getElementById('shrine-msg').textContent = msg;
  document.getElementById('shrine-overlay').style.display = 'flex';
}

function closeShrinePrompt() {
  document.getElementById('shrine-overlay').style.display = 'none';
  _currentShrine = null;
}

document.getElementById('shrine-accept-btn').addEventListener('click', () => {
  if(!_currentShrine) return;
  let shrine = _currentShrine;
  closeShrinePrompt();

  let idx = G.items.findIndex(i => i.id === shrine.id);
  if(idx > -1) G.items.splice(idx, 1);

  if(shrine.shrineType === 'Blood') {
    let cost = Math.max(1, Math.floor(G.player.maxHp * 0.3));
    G.player.maxHp = round1(Math.max(1, G.player.maxHp - cost));
    G.player.hp = round1(Math.min(G.player.hp, G.player.maxHp));
    G.player.atk = round1(G.player.atk + 1);
    addLog(`Sacrificed ${fmt1(cost)} Max HP for +1 ATK!`, 'log-combat');
    floatText('+1 ATK', G.player.x, G.player.y, '#f87171');
    flashDamage();
    SFX.hit();
  } else if(shrine.shrineType === 'Greed') {
    let gold = G.player.gold;
    G.player.gold = 0;
    G.player.lvl += 2;
    G.player.maxHp = round1(G.player.maxHp + 4); G.player.hp = round1(G.player.hp + 4);
    G.player.atk = round1(G.player.atk + 2); G.player.def = round1(G.player.def + 1);
    addLog(`Sacrificed ${fmt1(gold)} Gold for 2 Levels!`, 'log-info');
    floatText('LEVEL UP!', G.player.x, G.player.y, '#fbbf24');
    SFX.levelUp();
  } else if(shrine.shrineType === 'Cursed') {
    G.player.hp = G.player.maxHp;
    addLog(`Fully healed, but the curse awakens!`, 'log-combat');
    floatText('FULL HEAL', G.player.x, G.player.y, '#4ade80');
    SFX.levelUp();
    
    // Spawn 3 elites
    let enemyProfile = typeof getFloorEnemyProfile === 'function' ? getFloorEnemyProfile(G.floor) : {tierMin:0, tierMax:1, scale:1};
    let spawned = 0;
    for(let r=1; r<=2 && spawned < 3; r++) {
      for(let y=G.player.y-r; y<=G.player.y+r; y++) {
        for(let x=G.player.x-r; x<=G.player.x+r; x++) {
          if(spawned >= 3) break;
          if(x>=0 && x<MAP_W && y>=0 && y<MAP_H && G.map[y][x] === TILE.FLOOR && !G.enemies.some(e=>e.x===x&&e.y===y) && (x!==G.player.x || y!==G.player.y)) {
            let tier=rr(enemyProfile.tierMin, enemyProfile.tierMax);
            let t=ENEMIES[tier], sc=enemyProfile.scale;
            let enemy = {...t,
              hp:Math.round(t.hp*sc)*2,maxHp:Math.round(t.hp*sc)*2,
              atk:Math.round(t.atk*sc)*2,def:Math.round(t.def*sc),
              xp:Math.round(t.xp*sc)*2,gold:Math.round(t.gold*sc)*2,
              x:x,y:y,id:uid(), stunnedTurns: 0, isElite: true, name: "Cursed " + t.name};
            G.enemies.push(enemy);
            spawned++;
          }
        }
      }
    }
    shakeMap();
  }
  
  advanceTurn({allowFreeMove:true});
});

document.getElementById('shrine-decline-btn').addEventListener('click', () => {
  closeShrinePrompt();
});

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
