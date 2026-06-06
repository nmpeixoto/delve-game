// ===================== SHOP =====================
function generateShopStock(){
  let stock=[];
  let floorScale=G.floor;
  let usedNames = new Set();
  let addStock = item => {
    if(!item || usedNames.has(item.name)) return;
    usedNames.add(item.name);
    stock.push({...item,id:uid(),sold:false});
  };
  let canUseGear = item => typeof isClassUsableGear === 'function'
    ? isClassUsableGear(item, G.player)
    : (!item.reqClass || item.reqClass.includes(G.player.class));
  let nearLevel = item => !item.reqLvl || G.player.lvl >= item.reqLvl - 2;

  // 3-5 potions
  let pots=[...POTIONS].sort(()=>Math.random()-.5);
  for(let i=0; i<Math.min(pots.length, rr(3,5)); i++) {
    addStock(pots[i]);
  }

  let weaponCandidates = WEAPONS.filter(w=>w.atk<=4+floorScale*3 && nearLevel(w));
  let armorCandidates = ARMORS.filter(a=>a.def<=2+floorScale*2 && nearLevel(a));
  let classGear = [...weaponCandidates, ...armorCandidates].filter(item => nearLevel(item) && canUseGear(item));
  let classSpecificGear = classGear.filter(item => item.reqClass && item.reqClass.includes(G.player.class));
  let priorityGear = classSpecificGear.length ? classSpecificGear : classGear;
  if(priorityGear.length) addStock(priorityGear[rr(0, priorityGear.length-1)]);

  // 4-6 weapons scaled to floor
  let weps=weaponCandidates.filter(w=>!usedNames.has(w.name)).sort(()=>Math.random()-.5);
  for(let i=0; i<Math.min(weps.length, rr(4,6)); i++) {
    addStock(weps[i]);
  }

  // 3-4 armors
  let arms=armorCandidates.filter(a=>!usedNames.has(a.name)).sort(()=>Math.random()-.5);
  for(let i=0; i<Math.min(arms.length, rr(3,4)); i++) {
    addStock(arms[i]);
  }

  // 2 upgrades (floors 2+)
  if(G.floor>=2){
    let ups=UPGRADES.filter(u=>u.rarity!=='legendary'||G.floor>=4).sort(()=>Math.random()-.5);
    for(let i=0; i<Math.min(ups.length, 2); i++) {
      addStock(ups[i]);
    }
  }

  return stock;
}

function startActionTouch(e){
  if(!e.touches || e.touches.length !== 1) return;
  let t=e.touches[0], el=e.currentTarget;
  el.dataset.touchStartX=t.clientX;
  el.dataset.touchStartY=t.clientY;
  el.dataset.touchMoved='0';
}

function trackActionTouch(e){
  if(!e.touches || e.touches.length !== 1) return;
  let el=e.currentTarget;
  let sx=parseFloat(el.dataset.touchStartX || e.touches[0].clientX);
  let sy=parseFloat(el.dataset.touchStartY || e.touches[0].clientY);
  let dx=e.touches[0].clientX-sx, dy=e.touches[0].clientY-sy;
  if(Math.sqrt(dx*dx+dy*dy)>12) el.dataset.touchMoved='1';
}

function finishActionTouch(e){
  if(e.cancelable) e.preventDefault();
  e.stopPropagation();
  let el=e.currentTarget;
  let moved=el.dataset.touchMoved==='1';
  delete el.dataset.touchStartX;
  delete el.dataset.touchStartY;
  delete el.dataset.touchMoved;
  return !moved;
}

function openShop(){
  if(G.gameOver||G.won)return;
  if(!G.shops || G.shops.length===0){addLog('No shop on this floor','log-info');return;}
  let p=G.player;
  let nearShop = G.shops.find(s => Math.abs(p.x-s.x)<=1 && Math.abs(p.y-s.y)<=1);
  if(!nearShop){addLog('Move to a shop ($) to enter','log-shop');return;}
  G.currentShop = nearShop;
  _lastAction = 0; // entering the merchant should not inherit the map action cooldown
  if(typeof closeInv === 'function') closeInv();
  renderShop();
  switchShopTab('buy');
  document.getElementById('shop-overlay').classList.add('open');
}

function closeShop(){
  document.getElementById('shop-overlay').classList.remove('open');
}

function renderShop(){
  document.getElementById('shop-gold-val').textContent=fmt1(G.player.gold);
  let h='';
  if(!G.currentShop) {
    document.getElementById('shop-items').innerHTML='';
    return;
  }
  G.currentShop.stock.forEach(item=>{
    let canAfford=G.player.gold>=item.price;
    let desc=item.desc||iDesc(item);
      let colorCls = getItemColorClass(item);
      h+=`<div class="shop-item${item.sold?' sold':''}"
        onclick="buyItem('${item.id}')"
        ontouchstart="startActionTouch(event)"
        ontouchmove="trackActionTouch(event)"
        ontouchend="if(finishActionTouch(event))buyItem('${item.id}')">
        <div class="shop-item-left">
          <div class="shop-item-name ${colorCls}">${item.sym} ${item.name}${item.sold?' (SOLD)':''}</div>
        <div class="shop-item-desc">${desc} · <span style="color:var(--dim);font-size:.5rem">${item.rarity}</span></div>
      </div>
      <div class="shop-item-price${canAfford?'':' cant-afford'}">💰${fmt1(item.price)}</div>
    </div>`;
  });
  document.getElementById('shop-items').innerHTML=h;
}

function buyItem(id){
  if(!canAct({allowShopOverlay:true}) || !G.currentShop) return;
  let item=G.currentShop.stock.find(i=>i.id==id);
  if(!item||item.sold)return;
  if(G.player.gold<item.price){addLog('Not enough gold!','log-shop');return;}
  G.player.gold-=item.price;
  item.sold=true;

  if(['potion','potion_buff','bomb','scroll','scroll_teleport'].includes(item.type)){
    let clone={...item,carried:true,id:uid()};
    G.items.push(clone);
    addLog(`Bought ${item.name} — stored in bag`,'log-shop');
    SFX.buy();
  } else if(item.type==='weapon'){
    // Put in inventory, auto-equip if better
    let clone={...item,carried:true,id:uid()};
    G.items.push(clone);
    autoEquip(clone);
    addLog(`Bought ${item.name}`,'log-shop');
    SFX.buy();
  } else if(item.type==='armor'){
    let clone={...item,carried:true,id:uid()};
    G.items.push(clone);
    autoEquip(clone);
    addLog(`Bought ${item.name}`,'log-shop');
    SFX.buy();
  } else if(item.type==='upgrade'){
    applyUpgrade(item);
  }

  renderShop();
  updateHUD();
  updateActBtns();
}

function switchShopTab(tab){
  document.getElementById('tab-buy').classList.toggle('active', tab==='buy');
  document.getElementById('tab-sell').classList.toggle('active', tab==='sell');
  document.getElementById('shop-buy-panel').style.display=tab==='buy'?'block':'none';
  document.getElementById('shop-sell-panel').style.display=tab==='sell'?'block':'none';
  if(tab==='sell') renderSellPanel();
  if(tab==='buy') renderShop();
}

function renderSellPanel(){
  // Sellable = carried items + equipped items (player can sell anything from bag or currently equipped)
  let sellable=[
    ...G.items.filter(i=>i.carried),
    ...(G.player.weapon?[{...G.player.weapon,_equipped:'weapon'}]:[]),
    ...(G.player.armor?[{...G.player.armor,_equipped:'armor'}]:[]),
  ];
  let h='<div style="margin-bottom:10px;"><button class="act-btn" style="width:100%;margin-bottom:10px;border-color:var(--gold);color:var(--gold)" onclick="sellWeakerGear()">SELL UNWANTED GEAR</button></div>';
  if(!sellable.length){
    h+='<div class="sell-empty">Nothing to sell.</div>';
  } else {
    let grouped = {};
    sellable.forEach(item => {
      let key = item.name + (item._equipped ? '_eq' : '');
      if(!grouped[key]) grouped[key] = { count: 0, items: [] };
      grouped[key].count++;
      grouped[key].items.push(item);
    });
    Object.values(grouped).forEach(g => {
      let item = g.items[0];
      let sellPrice=Math.max(1,Math.floor((item.price||10)/2));
      let equippedTag=item._equipped?` <span style="color:var(--accent);font-size:.5rem">[EQUIPPED]</span>`:'';
      let countTag = g.count > 1 ? ` <span style="color:var(--accent);font-size:.5rem">x${g.count}</span>` : '';
      let colorCls = getItemColorClass(item);
      h+=`<div class="sell-item"
        onclick="sellItem('${item.id}','${item._equipped||''}')"
        ontouchstart="startActionTouch(event)"
        ontouchmove="trackActionTouch(event)"
        ontouchend="if(finishActionTouch(event))sellItem('${item.id}','${item._equipped||''}')">
        <div class="sell-item-left">
          <div class="sell-item-name ${colorCls}">${item.sym} ${item.name}${equippedTag}${countTag}</div>
          <div class="sell-item-desc">${iDesc(item)} · <span style="color:var(--dim);font-size:.5rem">${item.rarity}</span></div>
        </div>
        <div class="sell-item-price">+${fmt1(sellPrice)}💰</div>
      </div>`;
    });
  }
  document.getElementById('sell-items').innerHTML=h;
}

function sellItem(id, equippedSlot){
  if(!canAct({allowShopOverlay:true})) return;
  // Prevent double-sell: mark item as selling immediately
  let item, isEquipped=false;
  if(equippedSlot==='weapon' && G.player.weapon && String(G.player.weapon.id)===String(id)){
    item=G.player.weapon; isEquipped=true;
  } else if(equippedSlot==='armor' && G.player.armor && String(G.player.armor.id)===String(id)){
    item=G.player.armor; isEquipped=true;
  } else {
    item=G.items.find(i=>String(i.id)===String(id) && i.carried && !i._selling);
    if(item) item._selling=true; // lock immediately to block double-tap
  }
  if(!item) return;

  let sellPrice=Math.max(1,Math.floor((item.price||10)/2));
  G.player.gold+=sellPrice;

  if(isEquipped){
    if(equippedSlot==='weapon') G.player.weapon=null;
    else if(equippedSlot==='armor') G.player.armor=null;
    // Also purge any ghost copy of this item from G.items
    let idx = G.items.findIndex(i=>String(i.id)===String(id));
    if(idx>-1) G.items.splice(idx,1);
  } else {
    let idx = G.items.findIndex(i=>String(i.id)===String(id));
    if(idx>-1) G.items.splice(idx,1);
  }

  addLog(`Sold ${item.name} for ${sellPrice}💰`, 'log-shop');
  floatText(`+${sellPrice}💰`, G.player.x, G.player.y, '#fbbf24');
  SFX.sell();
  document.getElementById('shop-gold-val').textContent=fmt1(G.player.gold);
  if(typeof checkBagUpgrades === 'function') checkBagUpgrades();
  updateHUD();
  updateActBtns();
  if(typeof updateInvDrawer === 'function') updateInvDrawer();
  renderSellPanel();
  renderShop(); // refresh buy tab so affordability colours are up to date
}

function sellWeakerGear(){
  if(!canAct({allowShopOverlay:true})) return;
  let toSell = [];
  let newItems = [];

  G.items.forEach(it=>{
    if(!it.carried) {
      newItems.push(it);
      return;
    }
    if(it.type==='weapon' || it.type==='armor') {
      if((G.player.weapon && G.player.weapon.id===it.id) || (G.player.armor && G.player.armor.id===it.id)) {
        newItems.push(it);
        return;
      }
      let unusable = it.reqClass && !it.reqClass.includes(G.player.class);
      if(unusable) {
        toSell.push(it);
      } else if(it.type==='weapon' && weaponPower(it) <= weaponPower(G.player.weapon)) {
        toSell.push(it);
      } else if(it.type==='armor' && armorPower(it) <= armorPower(G.player.armor)) {
        toSell.push(it);
      } else {
        newItems.push(it);
      }
    } else {
      newItems.push(it);
    }
  });

  if (toSell.length > 0) {
    let totalGold = 0;
    toSell.forEach(item => {
      let sellPrice = Math.max(1, Math.floor((item.price || 10) / 2));
      totalGold += sellPrice;
    });

    G.items = newItems;
    G.player.gold += totalGold;
    addLog(`Auto-sold ${toSell.length} unwanted gear for ${totalGold}💰`, 'log-shop');
    floatText(`+${totalGold}💰`, G.player.x, G.player.y, '#fbbf24');
    SFX.sell();
    document.getElementById('shop-gold-val').textContent=fmt1(G.player.gold);
    if(typeof checkBagUpgrades === 'function') checkBagUpgrades();
    updateHUD();
    updateActBtns();
    if(typeof updateInvDrawer === 'function') updateInvDrawer();
    renderSellPanel();
  } else {
    addLog('No unwanted gear to sell.', 'log-info');
  }
}

function applyUpgrade(item){
  let p=G.player;
  let amount=Number(item.amount) || 0;
  if(item.stat==='atk'){p.atk=round1((p.atk||0)+amount);addLog(`${item.name}: ATK +${fmt1(amount)}!`,'log-level');}
  else if(item.stat==='def'){p.def=round1((p.def||0)+amount);addLog(`${item.name}: DEF +${fmt1(amount)}!`,'log-level');}
  else if(item.stat==='hp'){p.maxHp=round1((p.maxHp||0)+amount);p.hp=round1(Math.min(p.maxHp,p.hp+amount));addLog(`${item.name}: Max HP +${fmt1(amount)}!`,'log-level');}
  else if(item.stat==='all'){p.atk=round1(p.atk+1);p.def=round1(p.def+1);p.maxHp=round1(p.maxHp+10);p.hp=round1(Math.min(p.maxHp,p.hp+10));addLog(`Blessing: ATK+1, DEF+1, MaxHP+10!`,'log-level');}
  else if(item.stat==='all5'){p.atk=round1(p.atk+5);p.def=round1(p.def+5);p.maxHp=round1(p.maxHp+50);p.hp=round1(Math.min(p.maxHp,p.hp+50));addLog(`Ring of the Fallen: ATK+5, DEF+5, MaxHP+50!`,'log-level');}
  else if(item.stat==='magicMult'){p.magicMult=round1((p.magicMult||1)*amount);addLog(`${item.name}: ${fmt1(amount)}x Magic Damage!`,'log-level');}
  else if(item.stat==='vamp'){p.vampirism=round1((p.vampirism||0)+amount);addLog(`${item.name}: Heal ${fmt1(amount)} HP per kill!`,'log-level');}
  else if(item.stat==='regen'){p.regen=round1((p.regen||0)+amount);addLog(`${item.name}: Heal ${fmt1(amount)} HP every 10 tiles explored!`,'log-level');}
  else if(item.stat==='swift'){p.swiftness=round1((p.swiftness||0)+amount);addLog(`${item.name}: +${fmt1(amount)} free move every 15 tiles explored!`,'log-level');}
  else if(item.stat==='perception'){p.perception=round1((p.perception||0)+amount);addLog(`${item.name}: Perception +${fmt1(amount)}!`,'log-level');}
  else if(item.stat==='crit'){p.critChance=round1((p.critChance||0)+amount);addLog(`${item.name}: +${fmtPct(amount)} Critical Hit Chance!`,'log-level');}
  else if(item.stat==='dodge'){p.dodgeBonus=round1((p.dodgeBonus||0)+amount);addLog(`${item.name}: +${fmtPct(amount)} Dodge Chance!`,'log-level');}
  else if(item.stat==='goldBonus'){p.goldBonus=round1((p.goldBonus||0)+amount);addLog(`${item.name}: +${fmt1(amount)} Gold per kill!`,'log-level');}
  else if(item.stat==='xpMult'){p.xpMult=round1((p.xpMult||0)+amount);addLog(`${item.name}: +${fmtPct(amount)} XP from kills!`,'log-level');}
  floatText('UPGRADED!',p.x,p.y,'#c084fc');
}
