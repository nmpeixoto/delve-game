// ===================== RENDER =====================
function getCellSize(){
  let a=document.getElementById('map-area');
  return Math.max(9,Math.min(Math.floor((a.clientWidth-10)/MAP_W),Math.floor((a.clientHeight-10)/MAP_H),18));
}
function iDesc(item){
  if(item.type==='weapon') return `ATK+${item.atk}`;
  if(item.type==='armor')  return `DEF+${item.def}`;
  if(item.type==='potion') return `Heal ${item.heal} HP`;
  if(item.type==='upgrade')return item.desc||'';
  return '';
}
const gatk=()=>G.player.atk+(G.player.weapon?.atk||0);
const gdef=()=>G.player.def+(G.player.armor?.def||0);

function render(){
  const mapEl=document.getElementById('map');
  const cs=getCellSize();
  mapEl.style.gridTemplateColumns=`repeat(${MAP_W},${cs}px)`;
  mapEl.style.fontSize=`${cs*.72}px`;
  const CH={[TILE.WALL]:'█',[TILE.FLOOR]:'·',[TILE.STAIRS]:'>',[TILE.SHOP]:'$'};
  let h='';
  for(let y=0;y<MAP_H;y++){
    for(let x=0;x<MAP_W;x++){
      let k=y*MAP_W+x,vis=G.visible.has(k),seen=G.seen.has(k);
      let s=`width:${cs}px;height:${cs}px;`;
      if(!seen){h+=`<div class="tile tile-dark" style="${s}"></div>`;continue;}
      let t=G.map[y][x];
      if(x===G.player.x&&y===G.player.y){h+=`<div class="tile tile-player" style="${s}">@</div>`;continue;}
      let en=vis?G.enemies.find(e=>e.x===x&&e.y===y):null;
      if(en){
        let dyingClass=en.dying?' tile-enemy-dying':'';
        h+=`<div class="tile tile-enemy${dyingClass}" style="${s}color:${en.color};text-shadow:0 0 5px ${en.color}"
          onmouseenter="showTip(event,'${en.name}',${en.hp},${en.maxHp},${en.atk})"
          onmouseleave="hideTip()"
          onclick="${en.dying?'':`tileAttack('${en.id}')`}"
          ontouchstart="${en.dying?'':`startLongPress(event,'${en.id}','${en.name}',${en.hp},${en.maxHp},${en.atk})`}"
          ontouchend="${en.dying?'':`endLongPress(event,'${en.id}')`}"
          ontouchmove="${en.dying?'':'cancelLongPress()'}">
          ${en.sym.toUpperCase()}</div>`;
        continue;
      }
      let it=vis?G.items.find(i=>!i.carried&&i.x===x&&i.y===y):null;
      if(it){
        h+=`<div class="tile tile-item" style="${s}"
          ontouchend="event.preventDefault();tilePickup('${it.id}')"
          ontouchstart="showTip(event,'${it.name}: ${iDesc(it)}');event.stopPropagation()"
          onmouseenter="showTip(event,'${it.name}: ${iDesc(it)}')"
          onmouseleave="hideTip()"
          onclick="tilePickup('${it.id}')">${it.sym}</div>`;
        continue;
      }
      if(t===TILE.STAIRS&&vis){h+=`<div class="tile tile-stairs" style="${s}" onclick="descend()" ontouchend="event.preventDefault();descend()">></div>`;continue;}
      if(t===TILE.SHOP&&vis){h+=`<div class="tile tile-shop" style="${s}" onclick="openShop()" ontouchend="event.preventDefault();openShop()">$</div>`;continue;}
      let sc=(seen&&!vis)?' tile-seen':'';
      h+=`<div class="tile ${t===TILE.WALL?'tile-wall':'tile-floor'}${sc}" style="${s}">${CH[t]||' '}</div>`;
    }
  }
  mapEl.innerHTML=h;
  updateHUD();updateInvDrawer();updateActBtns();
}

function updateHUD(){
  let p=G.player;
  document.getElementById('hp-bar').style.width=(p.hp/p.maxHp*100)+'%';
  document.getElementById('hp-val').textContent=`${p.hp}/${p.maxHp}`;
  document.getElementById('xp-bar').style.width=(p.xp/p.xpNext*100)+'%';
  document.getElementById('xp-val').textContent=`${p.xp}/${p.xpNext}`;
  document.getElementById('atk-val').textContent=gatk();
  document.getElementById('def-val').textContent=gdef();
  document.getElementById('lvl-val').textContent=p.lvl;
  document.getElementById('gold-val').textContent=p.gold;
  document.getElementById('floor-label').textContent=`FLOOR ${G.floor}`;
}

function updateActBtns(){
  // BASH
  let bb=document.getElementById('bash-btn');
  bb.className='act-btn'+(G.bashCooldown===0?' bash-ready':'');
  bb.textContent=G.bashCooldown>0?`BASH ${G.bashCooldown}`:'⚡BASH';
  // STAIRS
  let sb=document.getElementById('stairs-btn');
  let onS=G.map&&G.map[G.player.y][G.player.x]===TILE.STAIRS;
  sb.className='act-btn'+(onS?' stairs-avail':'');
  sb.textContent=onS?'▼ GO':'STAIRS';
  // SHOP
  let shopBtn=document.getElementById('shop-btn');
  let nearShop=G.shopPos&&Math.abs(G.player.x-G.shopPos.x)<=1&&Math.abs(G.player.y-G.shopPos.y)<=1;
  shopBtn.className='act-btn'+(nearShop?' shop-avail':'');
  shopBtn.textContent=nearShop?'$ SHOP':'SHOP';
  // BAG
  let bagBtn=document.getElementById('bag-btn');
  let hasItems=G.items.some(i=>i.carried);
  bagBtn.className='act-btn'+(hasItems?' bag-has':'');
  bagBtn.textContent=hasItems?'🎒 BAG':'BAG';
}

function updateInvDrawer(){
  let inv=G.items.filter(i=>i.carried);
  let h='';
  if(!inv.length) h='<div class="inv-empty">Empty</div>';
  else inv.forEach(it=>{
    h+=`<div class="inv-slot"
      onclick="useItem('${it.id}')"
      ontouchend="event.preventDefault();useItem('${it.id}')">
      <div><div class="inv-name">${it.name}</div><div class="inv-type">${it.rarity} ${it.type}</div></div>
      <div class="inv-bonus">${iDesc(it)}</div>
    </div>`;
  });
  document.getElementById('inventory-list').innerHTML=h;
  let eh='';
  if(G.player.weapon) eh+=`<div class="inv-slot equipped"><div><div class="inv-name">${G.player.weapon.name}</div><div class="inv-type">weapon</div></div><div class="inv-bonus">ATK+${G.player.weapon.atk}</div></div>`;
  if(G.player.armor)  eh+=`<div class="inv-slot equipped"><div><div class="inv-name">${G.player.armor.name}</div><div class="inv-type">armor</div></div><div class="inv-bonus">DEF+${G.player.armor.def}</div></div>`;
  if(!G.player.weapon&&!G.player.armor) eh='<div class="inv-empty">Nothing equipped</div>';
  document.getElementById('equipped-list').innerHTML=eh;
}
