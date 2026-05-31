// ===================== DATA =====================
const WEAPONS=[
  // Universal
  {name:'Rusty Dagger',  type:'weapon', atk:4, sym:'†', rarity:'common', price:25},
  {name:'Short Sword',   type:'weapon', atk:4, sym:'†', rarity:'common', price:50},
  {name:'Broadsword',    type:'weapon', atk:6, sym:'⚔', rarity:'common', price:85, reqLvl:3},
  {name:'Steel Glaive',  type:'weapon', atk:9, sym:'⚔', rarity:'rare',   price:140, reqLvl:6},

  // Warrior / Paladin
  {name:'Iron Mace',     type:'weapon', atk:5, sym:'⚔', rarity:'common', price:70, reqClass:['warrior','paladin']},
  {name:'War Hammer',    type:'weapon', atk:8, sym:'⚔', rarity:'rare',   price:130, reqClass:['warrior','paladin'], reqLvl:5},
  {name:'Holy Avenger',  type:'weapon', atk:14,sym:'⚔', rarity:'legendary', price:260, reqClass:['paladin'], reqLvl:10},
  {name:'Champion Blade',type:'weapon', atk:15,sym:'⚔', rarity:'legendary', price:280, reqClass:['warrior'], reqLvl:10},

  // Barbarian
  {name:'Great Axe',     type:'weapon', atk:4, sym:'⚔', rarity:'common', price:70, reqClass:['barbarian'], critChance:0.02},
  {name:'Savage Cleaver',type:'weapon', atk:9, sym:'⚔', rarity:'rare',   price:150, reqClass:['barbarian'], reqLvl:5, critChance:0.05},
  {name:'Titan Slayer',  type:'weapon', atk:16,sym:'⚔', rarity:'legendary', price:315, reqClass:['barbarian'], reqLvl:10, critChance:0.10},

  // Rogue
  {name:'Twin Daggers',  type:'weapon', atk:5, sym:'†', rarity:'common', price:80, reqClass:['rogue'], dodgeBonus:0.02},
  {name:'Assassin Dirk', type:'weapon', atk:8, sym:'†', rarity:'rare',   price:130, reqClass:['rogue'], reqLvl:5, critChance:0.05},
  {name:'Shadow Blade',  type:'weapon', atk:14,sym:'†', rarity:'legendary', price:260, reqClass:['rogue'], reqLvl:10, vampirism:1},

  // Ranger
  {name:'Shortbow',      type:'weapon', atk:4, sym:'🏹', rarity:'common', price:50, reqClass:['ranger'], perception:1},
  {name:'Longbow',       type:'weapon', atk:7, sym:'🏹', rarity:'rare',   price:115, reqClass:['ranger'], reqLvl:4, critChance:0.05},
  {name:'Crossbow',      type:'weapon', atk:10, sym:'🏹', rarity:'rare',   price:160, reqClass:['ranger'], reqLvl:7, critChance:0.10},
  {name:'Elven Bow',     type:'weapon', atk:14,sym:'🏹', rarity:'legendary', price:245, reqClass:['ranger'], reqLvl:10, swiftness:1},

  // Mage / Necromancer
  {name:'Bone Staff',    type:'weapon', atk:5, sym:'♦', rarity:'common', price:70, reqClass:['mage','necromancer']},
  {name:'Skull Rod',     type:'weapon', atk:5, sym:'♦', rarity:'common', price:70, reqClass:['mage','necromancer'], vampirism:1},
  {name:'Arcane Wand',   type:'weapon', atk:8, sym:'♦', rarity:'rare',   price:130, reqClass:['mage','necromancer'], reqLvl:5, regen:1},
  {name:'Void Staff',    type:'weapon', atk:12,sym:'♦', rarity:'rare',   price:190, reqClass:['mage','necromancer'], reqLvl:8, vampirism:1},
  {name:'Elder Wand',    type:'weapon', atk:18,sym:'♦', rarity:'legendary', price:350, reqClass:['mage'], reqLvl:12, regen:2},
  {name:'Scythe of Death',type:'weapon',atk:17,sym:'♦', rarity:'legendary', price:330, reqClass:['necromancer'], reqLvl:12, vampirism:2},
];

const ARMORS=[
  // Universal light/medium
  {name:'Cloth Tunic',   type:'armor', def:1, sym:'◆', rarity:'common', price:15},
  {name:'Leather Vest',  type:'armor', def:2, sym:'◆', rarity:'common', price:35},
  {name:'Studded Armor', type:'armor', def:4, sym:'◆', rarity:'common', price:70, reqLvl:3},
  {name:'Mithril Shirt', type:'armor', def:7, sym:'◆', rarity:'rare',   price:140, reqLvl:6},

  // Heavy (Warrior/Paladin)
  {name:'Chain Mail',    type:'armor', def:4, sym:'◆', rarity:'common', price:60, reqClass:['warrior','paladin']},
  {name:'Iron Plate',    type:'armor', def:5, sym:'◆', rarity:'common', price:80, reqClass:['warrior','paladin']},
  {name:'Steel Plate',   type:'armor', def:8, sym:'◆', rarity:'rare',   price:140, reqClass:['warrior','paladin'], reqLvl:5},
  {name:'Dragon Scale',  type:'armor', def:12,sym:'◆', rarity:'legendary', price:260, reqClass:['warrior','paladin'], reqLvl:10},

  // Rogue / Ranger
  {name:'Ranger Tunic',  type:'armor', def:3, sym:'◆', rarity:'common', price:50, reqClass:['rogue','ranger'], perception:1},
  {name:'Shadow Cloak',  type:'armor', def:6, sym:'◆', rarity:'rare',   price:120, reqClass:['rogue','ranger'], reqLvl:5, dodgeBonus:0.05},
  {name:'Assassin Garb', type:'armor', def:10,sym:'◆', rarity:'legendary', price:225, reqClass:['rogue'], reqLvl:10, critChance:0.10, dodgeBonus:0.05},
  {name:'Hunter Vest',   type:'armor', def:10,sym:'◆', rarity:'legendary', price:225, reqClass:['ranger'], reqLvl:10, perception:2, dodgeBonus:0.05},

  // Barbarian (Low DEF, but they wear it anyway)
  {name:'Furs',          type:'armor', def:4, sym:'◆', rarity:'common', price:40, reqClass:['barbarian']},
  {name:'Bone Armor',    type:'armor', def:6, sym:'◆', rarity:'rare',   price:100, reqClass:['barbarian'], reqLvl:5},

  // Mage / Necromancer
  {name:'Apprentice Robe',type:'armor',def:2, sym:'◆', rarity:'common', price:40, reqClass:['mage','necromancer']},
  {name:'Mystic Robe',   type:'armor', def:5, sym:'◆', rarity:'rare',   price:100, reqClass:['mage','necromancer'], reqLvl:5},
  {name:'Archmage Robes',type:'armor', def:9, sym:'◆', rarity:'legendary', price:210, reqClass:['mage'], reqLvl:10},
  {name:'Lich Shroud',   type:'armor', def:9, sym:'◆', rarity:'legendary', price:210, reqClass:['necromancer'], reqLvl:10},

  // Monk
  {name:'Gi',            type:'armor', def:3, sym:'◆', rarity:'common', price:50, reqClass:['monk'], dodgeBonus:0.02},
  {name:'Master Gi',     type:'armor', def:6, sym:'◆', rarity:'rare',   price:120, reqClass:['monk'], reqLvl:5, dodgeBonus:0.05},
  {name:'Grandmaster Robe',type:'armor',def:11,sym:'◆', rarity:'legendary', price:245, reqClass:['monk'], reqLvl:10, dodgeBonus:0.10, swiftness:1},
];

function spawnItem(r, itemFilter=null, forceHighTier=false){
  let hasRoomBounds = Number.isFinite(r.w) && Number.isFinite(r.h);
  let cx=hasRoomBounds?r.x+rr(1,r.w-2):r.x;
  let cy=hasRoomBounds?r.y+rr(1,r.h-2):r.y;
  let pool=[];
  if(ch(.3)||forceHighTier) pool.push(...WEAPONS.filter(w=>(!w.reqLvl||G.player.lvl>=w.reqLvl-2)&&(!w.reqClass||w.reqClass.includes(G.player.class))));
  if(ch(.3)||forceHighTier) pool.push(...ARMORS.filter(a=>(!a.reqLvl||G.player.lvl>=a.reqLvl-2)&&(!a.reqClass||a.reqClass.includes(G.player.class))));
  if(!forceHighTier) pool.push(...POTIONS);
  
  if(itemFilter) pool = pool.filter(itemFilter);
  if(!pool.length) pool = POTIONS;
  
  let i=pool[rr(0,pool.length-1)];
  if(forceHighTier) {
    let rares = pool.filter(x=>x.rarity==='rare'||x.rarity==='legendary');
    if(rares.length) i = rares[rr(0, rares.length-1)];
  }
  G.items.push({...i,x:cx,y:cy,id:uid(),carried:false});
}

const POTIONS=[
  {name:'Health Potion', type:'potion',heal:15,sym:'!',rarity:'common',   price:25},
  {name:'Greater Potion',type:'potion',heal:30,sym:'!',rarity:'rare',     price:50},
  {name:'Elixir of Life',type:'potion',heal:60,sym:'!',rarity:'legendary',price:100},
  {name:'Potion of Giant Strength', type:'potion_buff', buff:'strength', sym:'🧪', rarity:'rare', price:75},
  {name:'Scroll of Detection',type:'scroll',sym:'📜',rarity:'common',price:200},
  {name:'Scroll of Teleportation', type:'scroll_teleport', sym:'📜', rarity:'rare', price:150},
  {name:'Bomb', type:'bomb', sym:'💣', rarity:'rare', price:120},
];

// Shop-exclusive upgrades
const UPGRADES=[
  // Stat variants
  {name:'Minor Strength Tonic', type:'upgrade',stat:'atk',amount:1,sym:'↑',rarity:'common', price:100, desc:'+1 Attack (permanent)'},
  {name:'Strength Tonic', type:'upgrade',stat:'atk',amount:2,sym:'↑',rarity:'rare',   price:200, desc:'+2 Attack (permanent)'},
  {name:'Ogre Strength',  type:'upgrade',stat:'atk',amount:3,sym:'↑',rarity:'legendary', price:450, desc:'+3 Attack (permanent)'},

  {name:'Minor Iron Skin',      type:'upgrade',stat:'def',amount:1,sym:'↑',rarity:'common', price:100, desc:'+1 Defense (permanent)'},
  {name:'Iron Skin',      type:'upgrade',stat:'def',amount:2,sym:'↑',rarity:'rare',   price:200, desc:'+2 Defense (permanent)'},
  {name:'Titan Shield',   type:'upgrade',stat:'def',amount:3,sym:'↑',rarity:'legendary', price:450, desc:'+3 Defense (permanent)'},

  {name:'Minor Vitality Brew',  type:'upgrade',stat:'hp', amount:8,sym:'♥',rarity:'common', price:90, desc:'+8 Max HP (permanent)'},
  {name:'Vitality Brew',  type:'upgrade',stat:'hp', amount:15,sym:'♥',rarity:'rare',  price:180, desc:'+15 Max HP (permanent)'},
  {name:'Heart of the Mountain',type:'upgrade',stat:'hp', amount:30,sym:'♥',rarity:'legendary', price:400, desc:'+30 Max HP (permanent)'},

  {name:'Blessing',       type:'upgrade',stat:'all',amount:1,sym:'★',rarity:'legendary',price:450, desc:'+1 ATK, +1 DEF, +10 Max HP'},

  // Healing passives
  {name:'Vampiric Ring',  type:'upgrade',stat:'vamp',amount:1,sym:'💍',rarity:'legendary',price:500, desc:'Heal 1 HP per kill'},
  {name:'Vampiric Amulet',type:'upgrade',stat:'vamp',amount:2,sym:'💍',rarity:'legendary',price:600, desc:'Heal 2 HP per kill'},

  {name:'Troll Blood',    type:'upgrade',stat:'regen',amount:1,sym:'♥',rarity:'legendary',price:500, desc:'Heal 1 HP every 10 tiles explored'},
  {name:'Troll Heart',    type:'upgrade',stat:'regen',amount:2,sym:'♥',rarity:'legendary',price:600, desc:'Heal 2 HP every 10 tiles explored'},

  // Speed & Perception
  {name:'Hermes Boots',   type:'upgrade',stat:'swift',amount:1,sym:'⚡',rarity:'legendary',price:450, desc:'Gain 1 free move every 15 tiles explored'},
  {name:'Dungeoneer\'s Kit',type:'upgrade',stat:'perception',amount:1,sym:'👁',rarity:'common',price:100, desc:'+1 Perception (Detects nearby traps/secrets)'},
  {name:'Third Eye',        type:'upgrade',stat:'perception',amount:2,sym:'👁',rarity:'rare',price:250, desc:'+2 Perception (Detects distant traps/secrets)'},

  // New Mechanics
  {name:'Assassin\'s Mark', type:'upgrade',stat:'crit',amount:0.05,sym:'🎯',rarity:'rare', price:250, desc:'+5% Critical Hit Chance'},
  {name:'Deadly Precision', type:'upgrade',stat:'crit',amount:0.12,sym:'🎯',rarity:'legendary', price:500, desc:'+12% Critical Hit Chance'},

  {name:'Thief\'s Cloak',   type:'upgrade',stat:'dodge',amount:0.05,sym:'💨',rarity:'rare', price:250, desc:'+5% Dodge Chance'},
  {name:'Acrobat\'s Boots', type:'upgrade',stat:'dodge',amount:0.12,sym:'💨',rarity:'legendary', price:500, desc:'+12% Dodge Chance'},

  {name:'Midas Coin',     type:'upgrade',stat:'goldBonus',amount:5,sym:'💰',rarity:'rare', price:200, desc:'+5 Gold per kill'},
  {name:'Scholar\'s Quill', type:'upgrade',stat:'xpMult',amount:0.20,sym:'📖',rarity:'rare', price:300, desc:'+20% XP from kills'},
];
const ENEMIES=[
  {name:'Rat',    sym:'r',hp:8, atk:3, def:0,xp:3, gold:2, color:'#cd853f'},
  {name:'Goblin', sym:'g',hp:15,atk:6, def:1,xp:6, gold:4, color:'#4ade80', dodge: 0.2},
  {name:'Skeleton',sym:'s',hp:25,atk:9,def:2,xp:10,gold:6, color:'#e2e8f0', revive: true},
  {name:'Orc',    sym:'o',hp:40,atk:12, def:3,xp:15,gold:10,color:'#84cc16', enrage: true},
  {name:'Troll',  sym:'T',hp:60,atk:18,def:4,xp:25,gold:15,color:'#22d3ee', regen: 0.1},
  {name:'Demon',  sym:'D',hp:85,atk:22,def:5,xp:35,gold:22,color:'#f87171', vampiric: 0.5},
  {name:'Lich',   sym:'L',hp:120,atk:26,def:6,xp:50,gold:30,color:'#a78bfa', freezeChance: 0.25},
];
