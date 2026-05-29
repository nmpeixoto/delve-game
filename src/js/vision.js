// ===================== FOV =====================
function computeVision(){
  G.visible=new Set();
  let px=G.player.x,py=G.player.y;
  for(let a=0;a<360;a+=3){
    let rad=a*Math.PI/180;
    for(let r=0;r<6;r++){
      let ix=Math.round(px+Math.cos(rad)*r),iy=Math.round(py+Math.sin(rad)*r);
      if(ix<0||ix>=MAP_W||iy<0||iy>=MAP_H) break;
      let k=iy*MAP_W+ix;G.visible.add(k);G.seen.add(k);
      if(G.map[iy][ix]===TILE.WALL) break;
    }
  }
}
