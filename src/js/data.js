// ===================== DATA =====================
const WEAPONS=[
  {name:'Rusty Dagger', type:'weapon',atk:2, sym:'†',rarity:'common', price:20},
  {name:'Short Sword',  type:'weapon',atk:4, sym:'†',rarity:'common', price:35},
  {name:'Battle Axe',   type:'weapon',atk:7, sym:'⚔',rarity:'rare',   price:60},
  {name:'Shadow Blade', type:'weapon',atk:10,sym:'⚔',rarity:'rare',   price:90},
  {name:'Soul Reaper',  type:'weapon',atk:15,sym:'⚔',rarity:'legendary',price:150},
  {name:'Bone Staff',   type:'weapon',atk:5, sym:'♦',rarity:'common', price:40},
  {name:'Arcane Rod',   type:'weapon',atk:9, sym:'♦',rarity:'rare',   price:75},
];
const ARMORS=[
  {name:'Leather Vest', type:'armor',def:2, sym:'◈',rarity:'common', price:20},
  {name:'Chain Mail',   type:'armor',def:4, sym:'◈',rarity:'common', price:35},
  {name:'Plate Armor',  type:'armor',def:7, sym:'◈',rarity:'rare',   price:65},
  {name:'Shadow Cloak', type:'armor',def:5, sym:'◈',rarity:'rare',   price:55},
  {name:'Dragon Scale', type:'armor',def:12,sym:'◈',rarity:'legendary',price:140},
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
