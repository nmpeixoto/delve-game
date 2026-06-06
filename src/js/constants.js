// ===================== CONSTANTS =====================
const MAP_W=56,MAP_H=36,FLOORS=5;
const TILE={WALL:0,FLOOR:1,STAIRS:2,SHOP:3,LOCKED_DOOR:4,SECRET_DOOR:5};
const DIRS={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],
            w:[0,-1],s:[0,1],a:[-1,0],d:[1,0],W:[0,-1],S:[0,1],A:[-1,0],D:[1,0]};
const CLASS_INFO = {
  warrior: { passive: 'Heal 1 HP every 12 tiles explored.', a1: { name: 'BASH', desc: 'Deal 1.5x damage to a nearby enemy.' }, a2: { name: 'SHIELD WALL', desc: 'Damage taken reduced by 40% for 3 turns.' } },
  rogue: { passive: '40% base chance to dodge attacks.', a1: { name: 'DASH', desc: 'Gain 2 free moves.' }, a2: { name: 'VANISH', desc: 'Become invisible for 3 turns. Next attack deals 2x damage.' } },
  mage: { passive: 'Wands (♦) grant +20% ATK.', a1: { name: 'FIREBALL', desc: 'Damage target and all adjacent enemies.' }, a2: { name: 'BLINK', desc: 'Teleport to a random safe visible tile.' } },
  paladin: { passive: '+2 Max HP per level.', a1: { name: 'SMITE', desc: 'Stun and damage an enemy for 1 turn.' }, a2: { name: 'LAY ON HANDS', desc: 'Heal 20% of your Max HP.' } },
  ranger: { passive: 'Bows (🏹) have range 3.', a1: { name: 'PIERCING SHOT', desc: 'Damage all enemies in a line.' }, a2: { name: 'BEAR TRAP', desc: 'Drop a trap and jump back to safety.' } },
  barbarian: { passive: 'Gain ATK as your HP gets lower.', a1: { name: 'CLEAVE', desc: 'Damage all adjacent enemies.' }, a2: { name: 'BLOODLUST', desc: 'Deal damage to heal, but take 15% more damage for 3 turns.' } },
  necromancer: { passive: 'Heal 2 HP when an enemy dies.', a1: { name: 'SIPHON LIFE', desc: 'Damage an enemy and heal for the same amount.' }, a2: { name: 'RAISE DEAD', desc: 'Marked enemy rises as a temporary pet if it dies in time.' } },
  monk: { passive: 'Unarmed damage scales with your level.', a1: { name: 'PUSH KICK', desc: 'Knock an enemy back. Double damage if they hit a wall.' }, a2: { name: 'FLURRY OF BLOWS', desc: 'Attack 3 times but root yourself for your next turn.' } }
};
