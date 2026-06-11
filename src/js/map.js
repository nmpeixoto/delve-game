// ===================== MAP GEN =====================
function generateMap(){
  let map=Array.from({length:MAP_H},()=>Array(MAP_W).fill(TILE.WALL));
  let rooms=[];
  const carve=(x,y,w,h)=>{
    for(let ry=y;ry<y+h;ry++) for(let rx=x;rx<x+w;rx++)
      if(ry>0&&ry<MAP_H-1&&rx>0&&rx<MAP_W-1) map[ry][rx]=TILE.FLOOR;
    rooms.push({x,y,w,h,cx:Math.floor(x+w/2),cy:Math.floor(y+h/2),type:'normal'});
  };
  const tunnel=(x1,y1,x2,y2)=>{
    let cx=x1,cy=y1;
    while(cx!==x2){map[cy][cx]=TILE.FLOOR;cx+=(x2>cx?1:-1);}
    while(cy!==y2){map[cy][cx]=TILE.FLOOR;cy+=(y2>cy?1:-1);}
  };
  const directTunnel=(x1,y1,x2,y2)=>{
    let cx=x1,cy=y1;
    let dx=x2-x1, dy=y2-y1;
    if(Math.abs(dx)>Math.abs(dy)){
      while(cx!==x2){map[cy][cx]=TILE.FLOOR;cx+=(x2>cx?1:-1);}
      while(cy!==y2){map[cy][cx]=TILE.FLOOR;cy+=(y2>cy?1:-1);}
    } else {
      while(cy!==y2){map[cy][cx]=TILE.FLOOR;cy+=(y2>cy?1:-1);}
      while(cx!==x2){map[cy][cx]=TILE.FLOOR;cx+=(x2>cx?1:-1);}
    }
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

  let pool = rooms.slice(1, -1);
  for (let i = pool.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  if(pool.length > 0) pool[0].type = 'armory';
  if(pool.length > 1) pool[1].type = 'crypt';
  if(pool.length > 2) pool[2].type = 'shrine';

  const canPlaceHiddenRoom = (sx, sy, sw, sh) => {
    if(sx<2||sy<2||sx+sw>=MAP_W-2||sy+sh>=MAP_H-2) return false;
    for(let y=sy-1; y<=sy+sh; y++) {
      for(let x=sx-1; x<=sx+sw; x++) {
        if(map[y][x] !== TILE.WALL) return false;
      }
    }
    return true;
  };

  const findHiddenConnection = (sx, sy, sw, sh) => {
    for(let r=2; r<7; r++) {
      for(let y=sy-r; y<=sy+sh+r-1; y++) {
        for(let x=sx-r; x<=sx+sw+r-1; x++) {
          if(y>0&&y<MAP_H-1&&x>0&&x<MAP_W-1 && map[y][x] === TILE.FLOOR) return {x,y};
        }
      }
    }
    return null;
  };

  const carveHiddenRoom = (type, sx, sy, sw, sh, connection) => {
    directTunnel(sx+Math.floor(sw/2), sy+Math.floor(sh/2), connection.x, connection.y);
    for(let ry=sy;ry<sy+sh;ry++) for(let rx=sx;rx<sx+sw;rx++) map[ry][rx]=TILE.FLOOR;
    let doorTile = type === 'treasure' ? TILE.LOCKED_DOOR : TILE.SECRET_DOOR;
    let potentialDoors = [];
    for(let y=sy-1; y<=sy+sh; y++) {
      for(let x=sx-1; x<=sx+sw; x++) {
        if((x===sx-1 || x===sx+sw || y===sy-1 || y===sy+sh) && map[y][x] === TILE.FLOOR) {
          potentialDoors.push({x,y});
        }
      }
    }
    if(!potentialDoors.length) return false;
    let doorIdx = Math.floor(Math.random() * potentialDoors.length);
    for(let i=0; i<potentialDoors.length; i++) {
      let pd = potentialDoors[i];
      map[pd.y][pd.x] = (i === doorIdx) ? doorTile : TILE.WALL;
    }
    rooms.splice(rooms.length-1, 0, {x:sx, y:sy, w:sw, h:sh, cx:sx+Math.floor(sw/2), cy:sy+Math.floor(sh/2), type});
    return true;
  };

  const tryPlaceHiddenRoom = (type, sx, sy, sw, sh) => {
    if(!canPlaceHiddenRoom(sx, sy, sw, sh)) return false;
    let connection = findHiddenConnection(sx, sy, sw, sh);
    if(!connection) return false;
    return carveHiddenRoom(type, sx, sy, sw, sh, connection);
  };

  const addHiddenRoom = (type) => {
    for(let attempt=0; attempt<120; attempt++) {
      let sw = rr(3, 4), sh = rr(3, 4);
      let sx = rr(2, MAP_W-sw-2), sy = rr(2, MAP_H-sh-2);
      if(tryPlaceHiddenRoom(type, sx, sy, sw, sh)) return true;
    }
    for(let sh=3; sh<=4; sh++) {
      for(let sw=3; sw<=4; sw++) {
        for(let sy=2; sy<MAP_H-sh-2; sy++) {
          for(let sx=2; sx<MAP_W-sw-2; sx++) {
            if(tryPlaceHiddenRoom(type, sx, sy, sw, sh)) return true;
          }
        }
      }
    }
    return false;
  };

  addHiddenRoom('treasure');
  addHiddenRoom('secret');
  addHiddenRoom('secret');

  return{map,rooms};
}

const FLOOR_ENEMY_PROFILES = [
  { tierMin: 0, tierMax: 1, scale: 0.9 },
  { tierMin: 1, tierMax: 2, scale: 1.2 },
  { tierMin: 2, tierMax: 3, scale: 1.45 },
  { tierMin: 3, tierMax: 4, scale: 1.7 },
  { tierMin: 4, tierMax: 6, scale: 2.05 },
];

function getFloorEnemyProfile(floor){
  return FLOOR_ENEMY_PROFILES[Math.max(0, Math.min(floor - 1, FLOOR_ENEMY_PROFILES.length - 1))];
}

function getNormalXpScale(floor, hardMode = false){
  if(hardMode) return 1;
  if(floor === 3) return 1.35;
  if(floor === 4) return 1.6;
  return 1;
}

function getNormalEnemyPressureScale(floor, hardMode = false){
  if(hardMode) return 1;
  return floor === 4 ? 0.9 : 1;
}

function getStairsCandidateOffset(floor, hardMode = false, candidateCount = 0){
  let target = (!hardMode && floor >= 4) ? 3 : 5;
  return Math.max(0, Math.min(target, candidateCount - 1));
}

// ===================== INIT =====================
function initGame(playerClass = 'warrior', hardMode = false){
  let cData = CLASS_DATA[playerClass] || {};
  let p = {
    x:0,y:0,lvl:1,xp:0,xpNext:10,
    weapon:null,armor:null,kills:0,gold:0,damageDealt:0,bestWeapon:'Bare hands',
    class: playerClass,
    shieldWallTurns: 0,
    vanishTurns: 0,
    freeMoves: 0,
    bloodlustTurns: 0,
    rootedTurns: 0,
    vampirism: cData.vampirism || 0,
    regen: cData.regen || 0,
    swiftness: cData.swiftness || 0,
    tilesExplored: 0,
    critChance: cData.critChance || 0,
    dodgeBonus: cData.dodgeBonus || 0,
    goldBonus: cData.goldBonus || 0,
    xpMult: cData.xpMult || 0,
    perception: cData.perception || 0
  };
  p.hp = cData.hp || 20; p.maxHp = cData.hp || 20; 
  p.atk = cData.atk || 1; p.def = cData.def || 0;
  if(playerClass === 'warrior') {
    p.weapon = {id:uid(), name:'Short Sword', type:'weapon', atk:4, rarity:'common', sym:'†', price:50};
    p.armor = {id:uid(), name:'Chain Mail', type:'armor', def:4, rarity:'common', sym:'◆', price:60};
    p.bestWeapon = 'Short Sword (ATK+4)';
  } else if(playerClass === 'rogue') {
    p.weapon = {id:uid(), name:'Rusty Dagger', type:'weapon', atk:4, rarity:'common', sym:'†', price:25};
    p.armor = {id:uid(), name:'Leather Vest', type:'armor', def:2, rarity:'common', sym:'◆', price:35};
    p.bestWeapon = 'Rusty Dagger (ATK+4)';
  } else if(playerClass === 'mage') {
    p.weapon = {id:uid(), name:'Bone Staff', type:'weapon', atk:5, rarity:'common', sym:'♦', price:70};
    p.armor = {id:uid(), name:'Apprentice Robe', type:'armor', def:2, rarity:'common', sym:'◆', price:40};
    p.bestWeapon = 'Bone Staff (ATK+5)';
  } else if(playerClass === 'paladin') {
    p.weapon = {id:uid(), name:'Iron Mace', type:'weapon', atk:5, rarity:'common', sym:'⚔', price:70};
    p.armor = {id:uid(), name:'Iron Plate', type:'armor', def:5, rarity:'common', sym:'◆', price:80};
    p.bestWeapon = 'Iron Mace (ATK+5)';
  } else if(playerClass === 'ranger') {
    p.weapon = {id:uid(), name:'Shortbow', type:'weapon', atk:5, rarity:'common', sym:'🏹', price:50, perception:1};
    p.armor = {id:uid(), name:'Ranger Tunic', type:'armor', def:3, rarity:'common', sym:'◆', price:50};
    p.bestWeapon = 'Shortbow (ATK+5)';
  } else if(playerClass === 'barbarian') {
    p.weapon = {id:uid(), name:'Great Axe', type:'weapon', atk:4, rarity:'common', sym:'⚔', price:70, critChance:0.02};
    p.armor = {id:uid(), name:'Furs', type:'armor', def:4, rarity:'common', sym:'◆', price:40};
    p.bestWeapon = 'Great Axe (ATK+4)';
  } else if(playerClass === 'necromancer') {
    p.weapon = {id:uid(), name:'Skull Rod', type:'weapon', atk:5, rarity:'common', sym:'♦', price:70, vampirism:1};
    p.armor = {id:uid(), name:'Apprentice Robe', type:'armor', def:2, rarity:'common', sym:'◆', price:40};
    p.bestWeapon = 'Skull Rod (ATK+5)';
  } else if(playerClass === 'monk') {
    p.armor = {id:uid(), name:'Gi', type:'armor', def:4, rarity:'common', sym:'◆', price:50};
  }

  G={
    floor:1,
    hardMode: !!hardMode,
    player: p,
    enemies:[],items:[],traps:[],
    map:null,rooms:[],shops:[],
    visible:new Set(),seen:new Set(),
    log:[],turn:0,
    ability1Cooldown:0, ability2Cooldown:0,
    gameOver:false,won:false,
  };
  if(!G.hardMode) {
    let potion = POTIONS.find(item => item.name === 'Health Potion');
    if(potion) G.items.push({...potion, id:`starter-potion-${playerClass}`, carried:true, x:undefined, y:undefined});
  }
  resetTips();
  buildFloor();
}

function buildFloor(){
  console.error('[JS] RNG start buildFloor: ' + (Math.rCount||0));
  let{map,rooms}=generateMap();
  console.error('[JS] RNG after generateMap: ' + (Math.rCount||0));
  G.map=map;G.rooms=rooms;G.enemies=[];G.shops=[];G.traps=[];G.currentShop=null;
  G.visible = new Set();
  G.seen = new Set();
  G.items=G.items.filter(i=>i.carried);
  
  if(G.floor === FLOORS) {
    map = Array(MAP_H).fill(0).map(()=>Array(MAP_W).fill(TILE.WALL));
    let bw = Math.max(10, Math.floor(MAP_W * 0.6));
    let bh = Math.max(10, Math.floor(MAP_H * 0.6));
    let bx = Math.floor((MAP_W - bw) / 2);
    let by = Math.floor((MAP_H - bh) / 2);
    rooms = [{x: bx, y: by, w: bw, h: bh, cx: bx + Math.floor(bw/2), cy: by + Math.floor(bh/2)}];
    for(let y=by; y<by+bh; y++) {
      for(let x=bx; x<bx+bw; x++) {
        map[y][x] = TILE.FLOOR;
      }
    }
    G.map = map; G.rooms = rooms;
    G.player.x = rooms[0].cx; G.player.y = by + bh - 2;
    
    let bossTemp = ENEMIES.find(e=>e.boss);
    let boss = {...bossTemp, 
       hp: Math.round(bossTemp.hp * (G.hardMode?1.2:1)), maxHp: Math.round(bossTemp.hp * (G.hardMode?1.2:1)), 
       atk: Math.round(bossTemp.atk * (G.hardMode?1.2:1)), def: Math.round(bossTemp.def * (G.hardMode?1.2:1)), 
       x: rooms[0].cx, y: by + 2, id: uid(), stunnedTurns: 0};
    G.enemies.push(boss);
    computeVision(); render();
    addLog(`You have reached the Dungeon Lord's lair. There is no escape.`, 'log-level');
    return;
  }

  G.player.x=rooms[0].cx;G.player.y=rooms[0].cy;

  // Place stairs on the main path, but keep the room reserved from later overlays.
  let stairsCandidates = rooms.slice(1).filter(r => r.type === 'normal');
  let stairsRoom = stairsCandidates[getStairsCandidateOffset(G.floor, G.hardMode, stairsCandidates.length)] || rooms[Math.min(6, rooms.length - 1)];

  if(rooms.length>=5){
    let pool = rooms.slice(1, -1).filter(r=>r!==stairsRoom&&r.type==='normal');
    for (let i = pool.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let numShops = Math.min(G.hardMode ? 1 : 3, pool.length);
    for(let i=0; i<numShops; i++){
      let sr = pool[i];
      sr.type = 'shop';
      G.shops.push({x:sr.cx, y:sr.cy, stock:generateShopStock()});
      map[sr.cy][sr.cx]=TILE.SHOP;
    }
  }
  console.error('[JS] RNG after shops: ' + (Math.rCount||0));

  map[stairsRoom.cy][stairsRoom.cx] = TILE.STAIRS;

  computeVision();
  const startVisible = new Set(G.visible);

  console.error('[JS_ROOMS] ' + JSON.stringify(G.rooms.map(r => r.type)));

  for(let i=1;i<rooms.length;i++){
    let r=rooms[i];
    if(r.type === 'shop') continue;
    
    let ne = 0;
    let baseEnemies = rr(1,1+Math.min(G.floor,4));
    let guaranteedItems = 0;
    let itemFilter = null;
    let isElite = false;
    let isCrypt = false;

    if(r.type === 'treasure') {
      ne = 1; isElite = true; guaranteedItems = 2 + rr(0,1);
    } else if(r.type === 'armory') {
      ne = rr(3,4); guaranteedItems = 1 + rr(0,1); itemFilter = (it) => it.type === 'weapon' || it.type === 'armor';
    } else if(r.type === 'crypt') {
      ne = baseEnemies * 3; isCrypt = true; guaranteedItems = 1;
    } else if(r.type === 'shrine') {
      ne = rr(1,2);
      let shrineTypes = ['Blood', 'Greed', 'Cursed'];
      let sType = shrineTypes[Math.floor(Math.random() * shrineTypes.length)];
      G.items.push({id:uid(), x:r.cx, y:r.cy, name: sType + ' Shrine', type:'shrine', shrineType: sType, rarity:'legendary', sym:'⛊', carried:false});
    } else if(r.type === 'secret') {
      ne = 0; guaranteedItems = 1 + rr(0,1);
    } else {
      ne = baseEnemies;
      if(ch(.65)) guaranteedItems = 1;
    }
    console.error('[JS] Room ' + i + ' type=' + r.type + ' ne=' + ne + ' guaranteedItems=' + guaranteedItems + ' (RNG: ' + (Math.rCount||0) + ')');

    let enemyProfile = getFloorEnemyProfile(G.floor);
    for(let e=0;e<ne;e++){
      let tier=rr(enemyProfile.tierMin, enemyProfile.tierMax);
      let t=ENEMIES[tier],sc=enemyProfile.scale;
      if(isCrypt) sc *= 1.2;
      if(G.hardMode) sc *= 1.2;
      
      let ex, ey, attempts=0;
      do {
        ex=r.x+rr(0,r.w-1); ey=r.y+rr(0,r.h-1);
        attempts++;
        let dist=Math.abs(ex-G.player.x)+Math.abs(ey-G.player.y);
        if(!startVisible.has(ey*MAP_W+ex) && dist>8 && map[ey][ex] !== TILE.STAIRS) break;
      } while(attempts<30);
      if(startVisible.has(ey*MAP_W+ex)) if(Math.abs(ex-G.player.x)+Math.abs(ey-G.player.y)<=8) continue;
      
      let goldMult = G.hardMode ? 0.7 : 1;
      let xpMult = getNormalXpScale(G.floor, G.hardMode);
      let pressureMult = getNormalEnemyPressureScale(G.floor, G.hardMode);
      let enemy = {...t,
        hp:Math.round(t.hp*sc*pressureMult),maxHp:Math.round(t.hp*sc*pressureMult),
        atk:Math.round(t.atk*sc*pressureMult),def:Math.round(t.def*sc*pressureMult),
        xp:Math.round(t.xp*(isCrypt?1.5:1)*sc*xpMult),gold:Math.round(t.gold*sc*goldMult),
        x:ex,y:ey,id:uid(), stunnedTurns: 0};
        
      if(isElite) {
        enemy.hp *= 2; enemy.maxHp *= 2; enemy.atk *= 2; enemy.isElite = true; enemy.name = "Elite " + enemy.name;
      }
      G.enemies.push(enemy);
    }
    
    for(let g=0;g<guaranteedItems;g++) {
      spawnItem(r, itemFilter, (r.type==='treasure'||r.type==='crypt'||r.type==='secret'), { preferClassGear: r.type === 'armory' && g === 0 }); 
    }
  }

  let numTraps = rr(3, 7 + G.floor);
  for(let i=0; i<numTraps; i++) {
    if(rooms.length <= 1) break;
    let r = rooms[rr(1, rooms.length-1)];
    if(r.type === 'shop' || r.type === 'treasure') continue;
    let tx, ty, attempts = 0;
    do {
      tx = r.x+rr(0,r.w-1); ty = r.y+rr(0,r.h-1);
      attempts++;
    } while(((r.type === 'shrine' && tx === r.cx && ty === r.cy) || (map[ty] && map[ty][tx] === TILE.STAIRS)) && attempts < 20);
    let type = ch(0.5) ? 'spike' : (ch(0.5) ? 'gas' : 'alarm');
    G.traps.push({x:tx, y:ty, type, triggered: false});
  }

  let keyRooms = rooms.slice(1).filter(r => r.type === 'normal');
  for (let i = keyRooms.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [keyRooms[i], keyRooms[j]] = [keyRooms[j], keyRooms[i]];
  }
  let keyCount = Math.min(keyRooms.length, rr(1, 2));
  for(let i=0; i<keyCount; i++) {
    let r = keyRooms[i];
    let kx, ky, attempts = 0;
    do {
      kx = r.x+rr(0,r.w-1); ky = r.y+rr(0,r.h-1);
      attempts++;
    } while(map[ky] && map[ky][kx] === TILE.STAIRS && attempts < 20);
    G.items.push({id:uid(), x:kx, y:ky, name:'Key', type:'key', rarity:'common', sym:'⚷', carried:false});
  }

  computeVision();render();
  addLog(`Floor ${G.floor}. ${G.shops.length?'Merchants await nearby...':''}`, G.shops.length?'log-shop':'log-info');
  setTimeout(()=>{
    if(!TIPS.firstEnemy.shown && G.enemies.some(e=>G.visible.has(e.y*MAP_W+e.x))) fireTip('firstEnemy');
    if(!TIPS.firstShop.shown && G.shops.some(s=>G.visible.has(s.y*MAP_W+s.x))) fireTip('firstShop');
    if(!TIPS.firstStairs.shown && G.map[G.rooms[G.rooms.length-1].cy][G.rooms[G.rooms.length-1].cx]===TILE.STAIRS &&
       G.visible.has(G.rooms[G.rooms.length-1].cy*MAP_W+G.rooms[G.rooms.length-1].cx)) fireTip('firstStairs');
  }, 600);
}
