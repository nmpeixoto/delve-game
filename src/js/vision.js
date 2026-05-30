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
}
