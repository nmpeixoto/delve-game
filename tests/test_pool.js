const fs = require('fs');
const code = fs.readFileSync('src/js/data.js', 'utf8');
const matchW = code.match(/const WEAPONS=\[(.*?)\];/s);
const WEAPONS = eval('[' + matchW[1] + ']');
const matchA = code.match(/const ARMORS=\[(.*?)\];/s);
const ARMORS = eval('[' + matchA[1] + ']');
const matchP = code.match(/const POTIONS=\[(.*?)\];/s);
const POTIONS = eval('[' + matchP[1] + ']');

function isClassUsableGear(item, playerClass){
  if(!item || (item.type !== 'weapon' && item.type !== 'armor')) return false;
  if(item.reqClass && !item.reqClass.includes(playerClass)) return false;
  return true;
}

let lvl = 1;
let playerClass = 'monk';

function gearPoolForPlayer(items, playerClass, levelSlack = 2){
  return items.filter(item =>
    (!item.reqLvl || lvl >= item.reqLvl - levelSlack) &&
    isClassUsableGear(item, playerClass)
  );
}

let weaponPool = gearPoolForPlayer(WEAPONS, playerClass);
let armorPool = gearPoolForPlayer(ARMORS, playerClass);

let pool = [];
pool.push(...weaponPool.map(w=>w.name));
pool.push(...armorPool.map(a=>a.name));
pool.push(...POTIONS.map(p=>p.name));
pool.push(...POTIONS.filter(p=>p.type==='potion').map(p=>p.name));

console.log("JS POOL FOR MONK:");
console.log(pool);
console.log("Length:", pool.length);
