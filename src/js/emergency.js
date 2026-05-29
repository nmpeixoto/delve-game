// ===================== EMERGENCY POTION SYSTEM =====================
// G.pendingHit stores {dmg, afterFn} when paused waiting for player response
function getBestPotions(neededHeal){
  let potions=G.items.filter(i=>i.carried&&i.type==='potion')
    .sort((a,b)=>b.heal-a.heal);
  if(!potions.length) return [];
  // If best potion alone is enough, return just that one
  if(potions[0].heal>=neededHeal) return [potions[0]];
  // Otherwise chain potions until we have enough
  let chain=[], total=0;
  for(let p of potions){
    chain.push(p); total+=p.heal;
    if(total>=neededHeal) break;
  }
  return chain;
}

function incomingDamageMax(enemy){
  let maxNextHit=Math.max(1, enemy.atk-gdef()+2);
  if(G.player.shieldWallTurns>0) maxNextHit=Math.ceil(maxNextHit/2);
  if(G.player.bloodlustTurns>0) maxNextHit*=2;
  return maxNextHit;
}

function checkEmergencyPotion(enemy, dmg, afterFn){
  // Max possible next hit from this enemy
  let maxNextHit=Math.max(dmg, incomingDamageMax(enemy));
  // Would that kill us?
  if(G.player.hp-maxNextHit>0){
    afterFn(); return; // safe — just proceed
  }
  // Do we have any potions?
  let potions=G.items.filter(i=>i.carried&&i.type==='potion');
  if(!potions.length){
    afterFn(); return; // no potions — nothing to offer
  }
  // How much heal do we need to survive the max hit?
  let neededHeal=maxNextHit-G.player.hp+1;
  let chain=getBestPotions(neededHeal);
  let totalHeal=chain.reduce((s,p)=>s+p.heal,0);
  let willSurvive=totalHeal>=neededHeal;

  // Store pending hit
  G.pendingHit={dmg, afterFn, potionChain:chain};

  // Build modal content
  let msg=`<strong style="color:var(--red)">${enemy.name}</strong> could deal up to <strong style="color:var(--orange)">${maxNextHit} damage</strong>. You have <strong style="color:var(--red)">${G.player.hp} HP</strong>.`;
  document.getElementById('emergency-msg').innerHTML=msg;

  let ph='';
  chain.forEach(p=>{
    ph+=`<div class="emergency-potion-row">
      <span class="emergency-potion-name">! ${p.name}</span>
      <span class="emergency-potion-heal">+${p.heal} HP</span>
    </div>`;
  });
  if(!willSurvive){
    ph+=`<div class="emergency-warn">⚠ May not be enough to survive!</div>`;
  }
  document.getElementById('emergency-potion').innerHTML=ph;

  let overlay=document.getElementById('emergency-overlay');
  overlay.style.display='flex';
}

function resolveEmergency(drink){
  let overlay=document.getElementById('emergency-overlay');
  overlay.style.display='none';
  if(!G.pendingHit) return;
  let {afterFn, potionChain}=G.pendingHit;
  G.pendingHit=null;

  if(drink && potionChain.length){
    potionChain.forEach(p=>{
      let heal=Math.min(p.heal, G.player.maxHp-G.player.hp);
      G.player.hp+=heal;
      addLog(`Drank ${p.name}: +${heal} HP`,'log-item');
      floatText(`+${heal} HP`,G.player.x,G.player.y,'#4ade80');
      G.items=G.items.filter(i=>i.id!==p.id);
    });
    updateHUD();
  }
  // Now apply the enemy hit
  afterFn();
}
