// ===================== SHOP =====================
function generateShopStock(){
  let stock=[];
  let floorScale=G.floor;

  // Always offer 2 potions
  let pots=[...POTIONS].sort(()=>Math.random()-.5);
  stock.push({...pots[0],id:uid(),sold:false});
  if(ch(.6)) stock.push({...pots[1],id:uid(),sold:false});

  // 1-2 weapons scaled to floor
  let weps=WEAPONS.filter(w=>w.atk<=4+floorScale*3).sort(()=>Math.random()-.5);
  if(weps.length) stock.push({...weps[0],id:uid(),sold:false});
  if(weps.length>1&&ch(.5)) stock.push({...weps[1],id:uid(),sold:false});

  // 1 armor
  let arms=ARMORS.filter(a=>a.def<=2+floorScale*2).sort(()=>Math.random()-.5);
  if(arms.length) stock.push({...arms[0],id:uid(),sold:false});

  // 1 upgrade (floors 2+)
  if(G.floor>=2){
    let ups=UPGRADES.filter(u=>u.rarity!=='legendary'||G.floor>=4).sort(()=>Math.random()-.5);
    if(ups.length) stock.push({...ups[0],id:uid(),sold:false});
  }

  return stock;
}

function openShop(){
  if(G.gameOver||G.won)return;
  if(!G.shopPos){addLog('No shop on this floor','log-info');return;}
  let p=G.player;
  let dx=Math.abs(p.x-G.shopPos.x),dy=Math.abs(p.y-G.shopPos.y);
  if(dx>1||dy>1){addLog('Move to the shop ($) to enter','log-shop');return;}
  renderShop();
  switchShopTab('buy');
  document.getElementById('shop-overlay').classList.add('open');
}

function closeShop(){
  document.getElementById('shop-overlay').classList.remove('open');
}

function renderShop(){
  document.getElementById('shop-gold-val').textContent=G.player.gold;
  let h='';
  G.shopStock.forEach(item=>{
    let canAfford=G.player.gold>=item.price;
    let desc=item.desc||iDesc(item);
    h+=`<div class="shop-item${item.sold?' sold':''}"
      onclick="buyItem('${item.id}')"
      ontouchend="event.preventDefault();event.stopPropagation();buyItem('${item.id}')">
      <div class="shop-item-left">
        <div class="shop-item-name">${item.sym} ${item.name}${item.sold?' (SOLD)':''}</div>
        <div class="shop-item-desc">${desc} · <span style="color:var(--dim);font-size:.5rem">${item.rarity}</span></div>
      </div>
      <div class="shop-item-price${canAfford?'':' cant-afford'}">💰${item.price}</div>
    </div>`;
  });
  document.getElementById('shop-items').innerHTML=h;
}

function buyItem(id){
  if(!canAct()) return;
  let item=G.shopStock.find(i=>i.id==id);
  if(!item||item.sold)return;
  if(G.player.gold<item.price){addLog('Not enough gold!','log-shop');return;}
  G.player.gold-=item.price;
  item.sold=true;

  if(item.type==='potion'){
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
  } else if(item.type==='armor'){
    let clone={...item,carried:true,id:uid()};
    G.items.push(clone);
    autoEquip(clone);
    addLog(`Bought ${item.name}`,'log-shop');
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
  let h='';
  if(!sellable.length){
    h='<div class="sell-empty">Nothing to sell.</div>';
  } else {
    sellable.forEach(item=>{
      let sellPrice=Math.max(1,Math.floor((item.price||10)/2));
      let equippedTag=item._equipped?` <span style="color:var(--accent);font-size:.5rem">[EQUIPPED]</span>`:'';
      h+=`<div class="sell-item"
        onclick="sellItem('${item.id}','${item._equipped||''}')"
        ontouchend="event.preventDefault();event.stopPropagation();sellItem('${item.id}','${item._equipped||''}')">
        <div class="sell-item-left">
          <div class="sell-item-name">${item.sym} ${item.name}${equippedTag}</div>
          <div class="sell-item-desc">${iDesc(item)} · <span style="color:var(--dim);font-size:.5rem">${item.rarity}</span></div>
        </div>
        <div class="sell-item-price">+${sellPrice}💰</div>
      </div>`;
    });
  }
  document.getElementById('sell-items').innerHTML=h;
}

function sellItem(id, equippedSlot){
  if(!canAct()) return;
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
    G.items=G.items.filter(i=>String(i.id)!==String(id));
  } else {
    G.items=G.items.filter(i=>String(i.id)!==String(id));
  }

  addLog(`Sold ${item.name} for ${sellPrice}💰`, 'log-shop');
  floatText(`+${sellPrice}💰`, G.player.x, G.player.y, '#fbbf24');
  SFX.sell();
  document.getElementById('shop-gold-val').textContent=G.player.gold;
  updateHUD();
  updateActBtns();
  renderSellPanel();
  renderShop(); // refresh buy tab so affordability colours are up to date
}

function applyUpgrade(item){
  let p=G.player;
  if(item.stat==='atk'){p.atk+=item.amount;addLog(`Strength Tonic: ATK +${item.amount}!`,'log-level');}
  else if(item.stat==='def'){p.def+=item.amount;addLog(`Iron Skin: DEF +${item.amount}!`,'log-level');}
  else if(item.stat==='hp'){p.maxHp+=item.amount;p.hp=Math.min(p.maxHp,p.hp+item.amount);addLog(`Vitality Brew: Max HP +${item.amount}!`,'log-level');}
  else if(item.stat==='all'){p.atk+=1;p.def+=1;p.maxHp+=10;p.hp=Math.min(p.maxHp,p.hp+10);addLog(`Blessing: ATK+1, DEF+1, MaxHP+10!`,'log-level');}
  floatText('UPGRADED!',p.x,p.y,'#c084fc');
}
