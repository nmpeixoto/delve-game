// ===================== DATA =====================
const WEAPONS=[
  // Universal
  {name:'Rusty Dagger',  type:'weapon', atk:4, sym:'†', rarity:'common', price:15},
  {name:'Short Sword',   type:'weapon', atk:4, sym:'†', rarity:'common', price:30},
  {name:'Broadsword',    type:'weapon', atk:6, sym:'⚔', rarity:'common', price:50, reqLvl:3},
  {name:'Steel Glaive',  type:'weapon', atk:9, sym:'⚔', rarity:'rare',   price:80, reqLvl:6},

  // Warrior / Paladin
  {name:'Iron Mace',     type:'weapon', atk:5, sym:'⚔', rarity:'common', price:40, reqClass:['warrior','paladin']},
  {name:'War Hammer',    type:'weapon', atk:8, sym:'⚔', rarity:'rare',   price:75, reqClass:['warrior','paladin'], reqLvl:5},
  {name:'Holy Avenger',  type:'weapon', atk:14,sym:'⚔', rarity:'legendary', price:150, reqClass:['paladin'], reqLvl:10},
  {name:'Champion Blade',type:'weapon', atk:15,sym:'⚔', rarity:'legendary', price:160, reqClass:['warrior'], reqLvl:10},

  // Barbarian
  {name:'Great Axe',     type:'weapon', atk:4, sym:'⚔', rarity:'common', price:40, reqClass:['barbarian']},
  {name:'Savage Cleaver',type:'weapon', atk:9, sym:'⚔', rarity:'rare',   price:85, reqClass:['barbarian'], reqLvl:5},
  {name:'Titan Slayer',  type:'weapon', atk:16,sym:'⚔', rarity:'legendary', price:180, reqClass:['barbarian'], reqLvl:10},

  // Rogue
  {name:'Twin Daggers',  type:'weapon', atk:5, sym:'†', rarity:'common', price:45, reqClass:['rogue']},
  {name:'Assassin Dirk', type:'weapon', atk:8, sym:'†', rarity:'rare',   price:75, reqClass:['rogue'], reqLvl:5},
  {name:'Shadow Blade',  type:'weapon', atk:14,sym:'†', rarity:'legendary', price:150, reqClass:['rogue'], reqLvl:10},

  // Ranger
  {name:'Shortbow',      type:'weapon', atk:4, sym:'🏹', rarity:'common', price:30, reqClass:['ranger']},
  {name:'Longbow',       type:'weapon', atk:7, sym:'🏹', rarity:'rare',   price:65, reqClass:['ranger'], reqLvl:4},
  {name:'Crossbow',      type:'weapon', atk:10, sym:'🏹', rarity:'rare',   price:90, reqClass:['ranger'], reqLvl:7},
  {name:'Elven Bow',     type:'weapon', atk:14,sym:'🏹', rarity:'legendary', price:140, reqClass:['ranger'], reqLvl:10},

  // Mage / Necromancer
  {name:'Bone Staff',    type:'weapon', atk:5, sym:'♦', rarity:'common', price:40, reqClass:['mage','necromancer']},
  {name:'Skull Rod',     type:'weapon', atk:5, sym:'♦', rarity:'common', price:40, reqClass:['mage','necromancer']},
  {name:'Arcane Wand',   type:'weapon', atk:8, sym:'♦', rarity:'rare',   price:75, reqClass:['mage','necromancer'], reqLvl:5},
  {name:'Void Staff',    type:'weapon', atk:12,sym:'♦', rarity:'rare',   price:110, reqClass:['mage','necromancer'], reqLvl:8},
  {name:'Elder Wand',    type:'weapon', atk:18,sym:'♦', rarity:'legendary', price:200, reqClass:['mage'], reqLvl:12},
  {name:'Scythe of Death',type:'weapon',atk:17,sym:'♦', rarity:'legendary', price:190, reqClass:['necromancer'], reqLvl:12},
];

const ARMORS=[
  // Universal light/medium
  {name:'Cloth Tunic',   type:'armor', def:1, sym:'◆', rarity:'common', price:10},
  {name:'Leather Vest',  type:'armor', def:2, sym:'◆', rarity:'common', price:20},
  {name:'Studded Armor', type:'armor', def:4, sym:'◆', rarity:'common', price:40, reqLvl:3},
  {name:'Mithril Shirt', type:'armor', def:7, sym:'◆', rarity:'rare',   price:80, reqLvl:6},

  // Heavy (Warrior/Paladin)
  {name:'Chain Mail',    type:'armor', def:4, sym:'◆', rarity:'common', price:35, reqClass:['warrior','paladin']},
  {name:'Iron Plate',    type:'armor', def:5, sym:'◆', rarity:'common', price:45, reqClass:['warrior','paladin']},
  {name:'Steel Plate',   type:'armor', def:8, sym:'◆', rarity:'rare',   price:80, reqClass:['warrior','paladin'], reqLvl:5},
  {name:'Dragon Scale',  type:'armor', def:12,sym:'◆', rarity:'legendary', price:150, reqClass:['warrior','paladin'], reqLvl:10},

  // Rogue / Ranger
  {name:'Ranger Tunic',  type:'armor', def:3, sym:'◆', rarity:'common', price:30, reqClass:['rogue','ranger']},
  {name:'Shadow Cloak',  type:'armor', def:6, sym:'◆', rarity:'rare',   price:70, reqClass:['rogue','ranger'], reqLvl:5},
  {name:'Assassin Garb', type:'armor', def:10,sym:'◆', rarity:'legendary', price:130, reqClass:['rogue'], reqLvl:10},
  {name:'Hunter Vest',   type:'armor', def:10,sym:'◆', rarity:'legendary', price:130, reqClass:['ranger'], reqLvl:10},

  // Barbarian (Low DEF, but they wear it anyway)
  {name:'Furs',          type:'armor', def:4, sym:'◆', rarity:'common', price:25, reqClass:['barbarian']},
  {name:'Bone Armor',    type:'armor', def:6, sym:'◆', rarity:'rare',   price:60, reqClass:['barbarian'], reqLvl:5},

  // Mage / Necromancer
  {name:'Apprentice Robe',type:'armor',def:2, sym:'◆', rarity:'common', price:25, reqClass:['mage','necromancer']},
  {name:'Mystic Robe',   type:'armor', def:5, sym:'◆', rarity:'rare',   price:60, reqClass:['mage','necromancer'], reqLvl:5},
  {name:'Archmage Robes',type:'armor', def:9, sym:'◆', rarity:'legendary', price:120, reqClass:['mage'], reqLvl:10},
  {name:'Lich Shroud',   type:'armor', def:9, sym:'◆', rarity:'legendary', price:120, reqClass:['necromancer'], reqLvl:10},

  // Monk
  {name:'Gi',            type:'armor', def:3, sym:'◆', rarity:'common', price:30, reqClass:['monk']},
  {name:'Master Gi',     type:'armor', def:6, sym:'◆', rarity:'rare',   price:70, reqClass:['monk'], reqLvl:5},
  {name:'Grandmaster Robe',type:'armor',def:11,sym:'◆', rarity:'legendary', price:140, reqClass:['monk'], reqLvl:10},
];

const POTIONS=[
  {name:'Health Potion', type:'potion',heal:15,sym:'!',rarity:'common',   price:15},
  {name:'Greater Potion',type:'potion',heal:30,sym:'!',rarity:'rare',     price:30},
  {name:'Elixir of Life',type:'potion',heal:60,sym:'!',rarity:'legendary',price:60},
];

// Shop-exclusive upgrades
const UPGRADES=[
  {name:'Strength Tonic', type:'upgrade',stat:'atk',amount:2,sym:'↑',rarity:'rare',   price:50,  desc:'+2 Attack (permanent)'},
  {name:'Iron Skin',      type:'upgrade',stat:'def',amount:2,sym:'↑',rarity:'rare',   price:50,  desc:'+2 Defense (permanent)'},
  {name:'Vitality Brew',  type:'upgrade',stat:'hp', amount:15,sym:'♥',rarity:'rare',  price:45,  desc:'+15 Max HP (permanent)'},
  {name:'Blessing',       type:'upgrade',stat:'all',amount:1,sym:'★',rarity:'legendary',price:120,desc:'+1 ATK, +1 DEF, +10 Max HP'},
  {name:'Vampiric Ring',  type:'upgrade',stat:'vamp',amount:1,sym:'💍',rarity:'legendary',price:150,desc:'Heal 1 HP per kill'},
  {name:'Troll Blood',    type:'upgrade',stat:'regen',amount:1,sym:'♥',rarity:'legendary',price:160,desc:'Heal 1 HP every 10 turns'},
  {name:'Hermes Boots',   type:'upgrade',stat:'swift',amount:1,sym:'⚡',rarity:'legendary',price:140,desc:'Gain 1 free move every 15 turns'},
];
const ENEMIES=[
  {name:'Rat',    sym:'r',hp:5, atk:2, def:0,xp:3, gold:2, color:'#cd853f'},
  {name:'Goblin', sym:'g',hp:10,atk:4, def:1,xp:6, gold:4, color:'#4ade80'},
  {name:'Skeleton',sym:'s',hp:15,atk:6,def:2,xp:10,gold:6, color:'#e2e8f0'},
  {name:'Orc',    sym:'o',hp:25,atk:8, def:3,xp:15,gold:10,color:'#84cc16'},
  {name:'Troll',  sym:'T',hp:40,atk:12,def:4,xp:25,gold:15,color:'#22d3ee'},
  {name:'Demon',  sym:'D',hp:55,atk:15,def:5,xp:35,gold:22,color:'#f87171'},
  {name:'Lich',   sym:'L',hp:70,atk:18,def:6,xp:50,gold:30,color:'#a78bfa'},
];
