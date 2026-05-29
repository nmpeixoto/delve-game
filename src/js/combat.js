// ===================== COMBAT =====================
function tileAttack(id){
  if(!canAct()||G.gameOver||G.won) return;
  let en=G.enemies.find(e=>e.id==id);if(!en)return;
  if(en.dying)return;
  let dist=Math.max(Math.abs(en.x-G.player.x),Math.abs(en.y-G.player.y));
  if(dist<=2){
    attackEnemy(id,false);
  } else {
    move(Math.sign(en.x-G.player.x)||0,Math.sign(en.y-G.player.y)||0);
  }
}

function attackEnemy(id,bash=false){
  let en=G.enemies.find(e=>e.id==id);if(!en)return;
  if(en.dying)return;
  let dmg=Math.max(1,gatk()-en.def+rand(3));
  if(bash){dmg*=2;G.bashCooldown=5;SFX.bash();}else{SFX.hit();}
  en.hp-=dmg;
  G.player.damageDealt+=dmg;
  floatText(`-${dmg}`,en.x,en.y,'#f87171');
  addLog(`Hit ${en.name} for ${dmg}${bash?' (BASH!)':''}`, 'log-combat');
  if(en.hp<=0){
    let goldDrop=en.gold+rand(3);
    G.player.xp+=en.xp;G.player.kills++;G.player.gold+=goldDrop;
    addLog(`${en.name} slain! +${en.xp} XP  +${goldDrop}💰`, 'log-dead');
    floatText(`+${goldDrop}💰`,en.x,en.y,'#fbbf24');
    SFX.enemyDeath();
    fireTip('firstGold');
    // Mark dying — remove after animation
    en.dying=true;
    render();
    setTimeout(()=>{
      G.enemies=G.enemies.filter(e=>e.id!==id);
      if(ch(.2)){
        let pool=[...WEAPONS,...ARMORS,...POTIONS];
        G.items.push({...pool[rand(pool.length)],x:en.x,y:en.y,id:uid()});
      }
      checkLevelUp();
      advanceTurn();
    },320);
    return;
  }
  let edm=Math.max(1,en.atk-gdef()+rand(3));
  checkEmergencyPotion(en, edm, ()=>{
    G.player.hp=Math.max(0,G.player.hp-edm);
    floatText(`-${edm}`,G.player.x,G.player.y,'#60a5fa');
    addLog(`${en.name} hits you for ${edm}`,'log-combat');
    SFX.damage();shakeMap();flashDamage();advanceTurn();
    if(G.player.hp<=0){G.gameOver=true;showDeath();}
  });
}

function checkLevelUp(){
  while(G.player.xp>=G.player.xpNext){
    G.player.xp-=G.player.xpNext;G.player.lvl++;
    G.player.xpNext=Math.round(G.player.xpNext*1.6);
    G.player.maxHp+=8;G.player.hp=Math.min(G.player.maxHp,G.player.hp+8);
    G.player.atk+=1;G.player.def+=1;
    addLog(`LEVEL UP! Now level ${G.player.lvl}!`,'log-level');
    floatText('LVL UP!',G.player.x,G.player.y,'#c084fc');
    SFX.levelUp();fireTip('firstLevelUp');
  }
}

function advanceTurn(){
  G.turn++;if(G.bashCooldown>0)G.bashCooldown--;
  G.enemies.forEach(e=>{
    if(G.gameOver||G.won) return;
    if(e.dying) return;
    if(!G.visible.has(e.y*MAP_W+e.x)){
      if(ch(.4)){
        let ds=[[-1,0],[1,0],[0,-1],[0,1]];let[dx,dy]=ds[rand(4)];
        let nx=e.x+dx,ny=e.y+dy;
        if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&G.map[ny][nx]!==TILE.WALL&&
           !G.enemies.find(o=>o!==e&&o.x===nx&&o.y===ny)){e.x=nx;e.y=ny;}
      }
    } else {
      let dx=G.player.x-e.x,dy=G.player.y-e.y;
      let steps=Math.abs(dx)>Math.abs(dy)?[[Math.sign(dx),0],[0,Math.sign(dy)]]:[[0,Math.sign(dy)],[Math.sign(dx),0]];
      for(let[sx,sy] of steps){
        let nx=e.x+sx,ny=e.y+sy;
        if(nx===G.player.x&&ny===G.player.y){
          let edm=Math.max(1,e.atk-gdef()+rand(3));
          checkEmergencyPotion(e, edm, ()=>{
            G.player.hp=Math.max(0,G.player.hp-edm);
            addLog(`${e.name} attacks! -${edm} HP`,'log-combat');
            SFX.damage();shakeMap();flashDamage();floatText(`-${edm}`,G.player.x,G.player.y,'#f87171');
            if(G.player.hp<=0){G.gameOver=true;showDeath();return;}
            computeVision();render();
          });
          break;
        }
        if(nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&G.map[ny][nx]!==TILE.WALL&&
           !G.enemies.find(o=>o!==e&&o.x===nx&&o.y===ny)){e.x=nx;e.y=ny;break;}
      }
    }
  });
  computeVision();render();
  // Fire tips for newly visible things
  if(!TIPS.firstEnemy.shown && G.enemies.some(e=>G.visible.has(e.y*MAP_W+e.x))) fireTip('firstEnemy');
  if(!TIPS.firstStairs.shown && G.rooms.length &&
     G.visible.has(G.rooms[G.rooms.length-1].cy*MAP_W+G.rooms[G.rooms.length-1].cx)) fireTip('firstStairs');
  if(!TIPS.firstShop.shown && G.shopPos && G.visible.has(G.shopPos.y*MAP_W+G.shopPos.x)) fireTip('firstShop');
}

function doBash(){
  if(G.gameOver||G.won)return;
  if(G.bashCooldown>0){addLog(`Bash on cooldown (${G.bashCooldown} turns)`,'log-info');return;}
  let t=G.enemies
    .filter(e=>!e.dying&&G.visible.has(e.y*MAP_W+e.x)&&Math.abs(e.x-G.player.x)<=2&&Math.abs(e.y-G.player.y)<=2)
    .sort((a,b)=>(Math.abs(a.x-G.player.x)+Math.abs(a.y-G.player.y))-(Math.abs(b.x-G.player.x)+Math.abs(b.y-G.player.y)));
  if(t.length)attackEnemy(t[0].id,true);
  else addLog('No nearby enemies to Bash','log-info');
}
