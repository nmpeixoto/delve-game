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
  let n=rr(14,22),att=0;
  while(rooms.length<n&&att<300){
    att++;
    let rw=rr(3,7),rh=rr(3,5),rx=rr(1,MAP_W-rw-1),ry=rr(1,MAP_H-rh-1);
    let ok=true;
    for(let r of rooms) if(rx<r.x+r.w+1&&rx+rw>r.x-1&&ry<r.y+r.h+1&&ry+rh>r.y-1){ok=false;break;}
    if(ok) carve(rx,ry,rw,rh);
  }
  for(let i=1;i<rooms.length;i++) tunnel(rooms[i-1].cx,rooms[i-1].cy,rooms[i].cx,rooms[i].cy);
  return{map,rooms};
}

const FLOOR_ENEMY_PROFILES = [
  { tierMin: 0, tierMax: 1, scale: 1.0 },
  { tierMin: 1, tierMax: 2, scale: 1.4 },
  { tierMin: 2, tierMax: 3, scale: 1.75 },
  { tierMin: 3, tierMax: 4, scale: 2.0 },
  { tierMin: 4, tierMax: 6, scale: 2.4 },
];

function getFloorEnemyProfile(floor){
  return FLOOR_ENEMY_PROFILES[Math.max(0, Math.min(floor - 1, FLOOR_ENEMY_PROFILES.length - 1))];
}

// ===================== INIT =====================
function initGame(playerClass = 'warrior'){
  let p = {
    x:0,y:0,lvl:1,xp:0,xpNext:10,
    weapon:null,armor:null,kills:0,gold:0,damageDealt:0,bestWeapon:'Bare hands',
    class: playerClass,
    shieldWallTurns: 0,
    vanishTurns: 0,
    freeMoves: 0,
    bloodlustTurns: 0,
    rootedTurns: 0,
    vampirism: 0,
    regen: 0,
    swiftness: 0
  };
  if(playerClass === 'warrior') {
    p.hp = 30; p.maxHp = 30; p.atk = 3; p.def = 2;
    p.armor = {id:uid(), name:'Chain Mail', type:'armor', def:4, rarity:'common', sym:'◆', price:35};
  } else if(playerClass === 'rogue') {
    p.hp = 24; p.maxHp = 24; p.atk = 7; p.def = 2;
    p.weapon = {id:uid(), name:'Rusty Dagger', type:'weapon', atk:4, rarity:'common', sym:'†', price:15};
    p.armor = {id:uid(), name:'Leather Vest', type:'armor', def:2, rarity:'common', sym:'◆', price:20};
    p.bestWeapon = 'Rusty Dagger (ATK+4)';
  } else if(playerClass === 'mage') {
    p.hp = 15; p.maxHp = 15; p.atk = 4; p.def = 1;
    p.weapon = {id:uid(), name:'Bone Staff', type:'weapon', atk:5, rarity:'common', sym:'♦', price:40};
    p.armor = {id:uid(), name:'Apprentice Robe', type:'armor', def:2, rarity:'common', sym:'◆', price:25};
    p.bestWeapon = 'Bone Staff (ATK+5)';
  } else if(playerClass === 'paladin') {
    p.hp = 20; p.maxHp = 20; p.atk = 1; p.def = 1;
    p.weapon = {id:uid(), name:'Iron Mace', type:'weapon', atk:5, rarity:'common', sym:'⚔', price:40};
    p.armor = {id:uid(), name:'Iron Plate', type:'armor', def:5, rarity:'common', sym:'◆', price:45};
    p.bestWeapon = 'Iron Mace (ATK+5)';
  } else if(playerClass === 'ranger') {
    p.hp = 13; p.maxHp = 13; p.atk = 2; p.def = 1;
    p.weapon = {id:uid(), name:'Shortbow', type:'weapon', atk:4, rarity:'common', sym:'🏹', price:30};
    p.armor = {id:uid(), name:'Ranger Tunic', type:'armor', def:3, rarity:'common', sym:'◆', price:30};
    p.bestWeapon = 'Shortbow (ATK+4)';
  } else if(playerClass === 'barbarian') {
    p.hp = 42; p.maxHp = 42; p.atk = 5; p.def = 1;
    p.weapon = {id:uid(), name:'Great Axe', type:'weapon', atk:4, rarity:'common', sym:'⚔', price:40};
    p.armor = {id:uid(), name:'Furs', type:'armor', def:4, rarity:'common', sym:'◆', price:25};
    p.bestWeapon = 'Great Axe (ATK+4)';
  } else if(playerClass === 'necromancer') {
    p.hp = 18; p.maxHp = 18; p.atk = 4; p.def = 1;
    p.weapon = {id:uid(), name:'Skull Rod', type:'weapon', atk:5, rarity:'common', sym:'♦', price:40};
    p.armor = {id:uid(), name:'Apprentice Robe', type:'armor', def:2, rarity:'common', sym:'◆', price:25};
    p.bestWeapon = 'Skull Rod (ATK+5)';
  } else if(playerClass === 'monk') {
    p.hp = 22; p.maxHp = 22; p.atk = 3; p.def = 1;
    p.armor = {id:uid(), name:'Gi', type:'armor', def:3, rarity:'common', sym:'◆', price:30};
  }

  G={
    floor:1,
    player: p,
    enemies:[],items:[],traps:[],
    map:null,rooms:[],shops:[],
    visible:new Set(),seen:new Set(),
    log:[],turn:0,
    ability1Cooldown:0, ability2Cooldown:0,
    gameOver:false,won:false,
  };
  resetTips();
  buildFloor();
}

function buildFloor(){
  let{map,rooms}=generateMap();
  G.map=map;G.rooms=rooms;G.enemies=[];G.shops=[];G.traps=[];G.currentShop=null;
  G.visible = new Set();
  G.seen = new Set();
  // Preserve carried items (bag contents) across floor transitions; only clear floor items.
  G.items=G.items.filter(i=>i.carried);
  G.player.x=rooms[0].cx;G.player.y=rooms[0].cy;

  // Stairs in last room
  map[rooms[rooms.length-1].cy][rooms[rooms.length-1].cx]=TILE.STAIRS;

  // Shops in middle rooms, up to 3
  if(rooms.length>=5){
    let pool = rooms.slice(1, -1).sort(()=>Math.random()-.5);
    let numShops = Math.min(3, pool.length);
    for(let i=0; i<numShops; i++){
      let sr = pool[i];
      G.shops.push({x:sr.cx, y:sr.cy, stock:generateShopStock()});
      map[sr.cy][sr.cx]=TILE.SHOP;
    }
  }

  // Enemies & items in remaining rooms
  // Compute initial vision to avoid spawning enemies the player can see
  computeVision();
  const startVisible = new Set(G.visible);

  for(let i=1;i<rooms.length;i++){
    let r=rooms[i];
    // Don't spawn enemies in shop rooms or the starting room
    if(G.shops.some(s=>r.cx===s.x&&r.cy===s.y)) continue;
    let ne=rr(1,1+Math.min(G.floor,4));
    let enemyProfile = getFloorEnemyProfile(G.floor);
    for(let e=0;e<ne;e++){
      let tier=rr(enemyProfile.tierMin, enemyProfile.tierMax);
      let t=ENEMIES[tier],sc=enemyProfile.scale;
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
        x:ex,y:ey,id:uid(), stunnedTurns: 0});
    }
    if(ch(.65)) spawnItem(r);
  }
  computeVision();render();
  addLog(`Floor ${G.floor}. ${G.shops.length?'Merchants await nearby...':''}`, G.shops.length?'log-shop':'log-info');
  // Fire tips for anything visible on spawn
  setTimeout(()=>{
    if(!TIPS.firstEnemy.shown && G.enemies.some(e=>G.visible.has(e.y*MAP_W+e.x))) fireTip('firstEnemy');
    if(!TIPS.firstShop.shown && G.shops.some(s=>G.visible.has(s.y*MAP_W+s.x))) fireTip('firstShop');
    if(!TIPS.firstStairs.shown && G.map[G.rooms[G.rooms.length-1].cy][G.rooms[G.rooms.length-1].cx]===TILE.STAIRS &&
       G.visible.has(G.rooms[G.rooms.length-1].cy*MAP_W+G.rooms[G.rooms.length-1].cx)) fireTip('firstStairs');
  }, 600); // slight delay so floor message shows first
}
