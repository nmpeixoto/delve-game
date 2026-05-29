// ===================== MOVEMENT =====================
function consumeRootedTurn(){
  G.player.rootedTurns=0;
  addLog('You are rooted and cannot move!', 'log-combat');
  advanceTurn();
}

function move(dx,dy){
  if(G.gameOver||G.won||!G.map)return;
  if(G.player.rootedTurns > 0) { consumeRootedTurn(); return; }
  let nx=G.player.x+dx,ny=G.player.y+dy;
  if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H||G.map[ny][nx]===TILE.WALL)return;
  let en=G.enemies.find(e=>e.x===nx&&e.y===ny);
  if(en){if(en.dying)return;attackEnemy(en.id);return;}
  let it=G.items.find(i=>!i.carried&&i.x===nx&&i.y===ny);
  G.player.x=nx;G.player.y=ny;computeVision();
  if(it)pickupItem(it.id,{allowFreeMove:true});else advanceTurn({allowFreeMove:true});
}

function dpadPress(dx,dy){
  if(G.gameOver||G.won)return;
  move(dx,dy);clearInterval(_dpadTimer);
  _dpadTimer=setInterval(()=>move(dx,dy),185);
}
function dpadRelease(){clearInterval(_dpadTimer);_dpadTimer=null;}
