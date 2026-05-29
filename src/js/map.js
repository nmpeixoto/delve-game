// ===================== MAP GEN =====================
function generateMap(){
  let map=Array.from({length:MAP_H},()=>Array(MAP_W).fill(TILE.WALL));
  let rooms=[];
  const carve=(x,y,w,h)=>{
    for(let ry=y;ry<y+h;ry++) for(let rx=x;rx<x+w;rx++)
      if(ry>0&&ry<MAP_H-1&&rx>0&&rx<MAP_W-1) map[ry][rx]=TILE.FLOOR;
    rooms.push({x,y,w,h,cx:Math.floor(x+w/2),cy:Math.floor(y+h/2)});
  };
  const tunnel=(x1,y1,x2,y2)=>{
    let cx=x1,cy=y1;
    while(cx!==x2){map[cy][cx]=TILE.FLOOR;cx+=(x2>cx?1:-1);}
    while(cy!==y2){map[cy][cx]=TILE.FLOOR;cy+=(y2>cy?1:-1);}
  };
  let n=rr(5,8),att=0;
  while(rooms.length<n&&att<200){
    att++;
    let rw=rr(3,7),rh=rr(3,5),rx=rr(1,MAP_W-rw-1),ry=rr(1,MAP_H-rh-1);
    let ok=true;
    for(let r of rooms) if(rx<r.x+r.w+1&&rx+rw>r.x-1&&ry<r.y+r.h+1&&ry+rh>r.y-1){ok=false;break;}
    if(ok) carve(rx,ry,rw,rh);
  }
  for(let i=1;i<rooms.length;i++) tunnel(rooms[i-1].cx,rooms[i-1].cy,rooms[i].cx,rooms[i].cy);
  return{map,rooms};
}

// ===================== INIT =====================
function initGame(){
  G={
    floor:1,
    player:{x:0,y:0,hp:20,maxHp:20,atk:4,def:1,lvl:1,xp:0,xpNext:10,
            weapon:null,armor:null,kills:0,gold:0,damageDealt:0,bestWeapon:'Bare hands'},
    enemies:[],items:[],
    map:null,rooms:[],shopPos:null,shopStock:[],
    visible:new Set(),seen:new Set(),
    log:[],turn:0,bashCooldown:0,
    gameOver:false,won:false,
  };
  resetTips();
  buildFloor();
}

function buildFloor(){
  let{map,rooms}=generateMap();
  G.map=map;G.rooms=rooms;G.enemies=[];G.shopPos=null;G.shopStock=[];
  // Preserve carried items (bag contents) across floor transitions — only clear floor items
  G.items=G.items.filter(i=>i.carried);
  G.player.x=rooms[0].cx;G.player.y=rooms[0].cy;

  // Stairs in last room
  map[rooms[rooms.length-1].cy][rooms[rooms.length-1].cx]=TILE.STAIRS;

  // Shop in a middle room (if enough rooms), not first or last
  if(rooms.length>=4){
    let shopRoomIdx=Math.floor(rooms.length/2)+rand(2)-1;
    shopRoomIdx=Math.max(1,Math.min(rooms.length-2,shopRoomIdx));
    let sr=rooms[shopRoomIdx];
    G.shopPos={x:sr.cx,y:sr.cy};
    map[sr.cy][sr.cx]=TILE.SHOP;
    G.shopStock=generateShopStock();
  }

  // Enemies & items in remaining rooms
  // Compute initial vision to avoid spawning enemies the player can see
  computeVision();
  const startVisible = new Set(G.visible);

  for(let i=1;i<rooms.length;i++){
    let r=rooms[i];
    // Don't spawn enemies in shop room or the starting room
    if(G.shopPos&&r.cx===G.shopPos.x&&r.cy===G.shopPos.y) continue;
    let ne=rr(1,2+G.floor);
    for(let e=0;e<ne;e++){
      let tier=Math.min(Math.floor(G.floor*.8+rand(2)),ENEMIES.length-1);
      let t=ENEMIES[tier],sc=1+(G.floor-1)*.4;
      // Find a position not visible from player start, with extra distance check
      let ex, ey, attempts=0;
      do {
        ex=r.x+rr(1,r.w-2);
        ey=r.y+rr(1,r.h-2);
        attempts++;
        let dist=Math.abs(ex-G.player.x)+Math.abs(ey-G.player.y);
        if(!startVisible.has(ey*MAP_W+ex) && dist>8) break;
      } while(attempts<30);
      // Only place if clearly out of starting vision
      if(startVisible.has(ey*MAP_W+ex)) {
        // Last resort: skip this enemy rather than spawn it visible
        if(Math.abs(ex-G.player.x)+Math.abs(ey-G.player.y)<=8) continue;
      }
      G.enemies.push({...t,
        hp:Math.round(t.hp*sc),maxHp:Math.round(t.hp*sc),
        atk:Math.round(t.atk*sc),def:Math.round(t.def*sc),
        xp:Math.round(t.xp*sc),gold:Math.round(t.gold*sc),
        x:ex,y:ey,id:uid()});
    }
    if(ch(.65)) spawnItem(r);
  }
  computeVision();render();
  addLog(`Floor ${G.floor}. ${G.shopPos?'A merchant awaits nearby...':''}`, G.shopPos?'log-shop':'log-info');
  // Fire tips for anything visible on spawn
  setTimeout(()=>{
    if(!TIPS.firstEnemy.shown && G.enemies.some(e=>G.visible.has(e.y*MAP_W+e.x))) fireTip('firstEnemy');
    if(!TIPS.firstShop.shown && G.shopPos && G.visible.has(G.shopPos.y*MAP_W+G.shopPos.x)) fireTip('firstShop');
    if(!TIPS.firstStairs.shown && G.map[G.rooms[G.rooms.length-1].cy][G.rooms[G.rooms.length-1].cx]===TILE.STAIRS &&
       G.visible.has(G.rooms[G.rooms.length-1].cy*MAP_W+G.rooms[G.rooms.length-1].cx)) fireTip('firstStairs');
  }, 600); // slight delay so floor message shows first
}
