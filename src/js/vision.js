// ===================== FOV =====================
function computeVision(){
  G.visible=new Set();
  let px=G.player.x,py=G.player.y;
  let newTiles = 0;
  for(let a=0;a<360;a+=3){
    let rad=a*Math.PI/180;
    for(let r=0;r<6;r++){
      let ix=Math.round(px+Math.cos(rad)*r),iy=Math.round(py+Math.sin(rad)*r);
      if(ix<0||ix>=MAP_W||iy<0||iy>=MAP_H) break;
      let k=iy*MAP_W+ix;
      G.visible.add(k);
      if(!G.seen.has(k)){
        G.seen.add(k);
        newTiles++;
      }
      if(G.map[iy][ix]===TILE.WALL) break;
    }
  }

  if(newTiles > 0 && G.player && typeof G.player.tilesExplored !== 'undefined'){
    for(let i=0; i<newTiles; i++){
      G.player.tilesExplored++;
      
      if(G.player.regen > 0 && G.player.tilesExplored % 10 === 0) {
        let heal = G.player.regen;
        G.player.hp = Math.min(G.player.maxHp, G.player.hp + heal);
        floatText(`+${heal} HP`, G.player.x, G.player.y, '#4ade80');
      }

      if(G.player.class === 'warrior' && G.player.tilesExplored % 12 === 0 && G.player.hp < G.player.maxHp) {
        G.player.hp = Math.min(G.player.maxHp, G.player.hp + 1);
        floatText('+1 HP', G.player.x, G.player.y, '#4ade80');
      }

      if(G.player.swiftness > 0 && G.player.tilesExplored % 15 === 0) {
        G.player.freeMoves += G.player.swiftness;
        addLog(`Swiftness granted ${G.player.swiftness} free move(s)!`, 'log-info');
      }
    }
  }

  if(G.player.perception > 0) {
    let p = G.player.perception;
    for(let y=Math.max(0, py-p); y<=Math.min(MAP_H-1, py+p); y++) {
      for(let x=Math.max(0, px-p); x<=Math.min(MAP_W-1, px+p); x++) {
        if(!G.visible.has(y*MAP_W+x)) continue;
        if(G.map[y][x] === TILE.SECRET_DOOR) {
          G.map[y][x] = TILE.FLOOR;
          addLog('Your perception revealed a secret door!', 'log-info');
          floatText('SECRET', x, y, '#fbbf24');
          SFX.click();
        }
        let trap = G.traps.find(t => t.x === x && t.y === y && !t.revealed);
        if(trap) {
          trap.revealed = true;
          addLog('Your perception revealed a trap!', 'log-info');
          floatText('TRAP', x, y, '#fbbf24');
        }
      }
    }
  }
}
