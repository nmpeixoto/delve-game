# DELVE

DELVE is a browser roguelike dungeon crawler built with vanilla HTML, CSS, and JavaScript. This README is a reference manual for the current game data and workflow. It documents the classes, weapons, armor, consumables, upgrades, enemies, controls, systems, and build/test commands used by the game.

The production build is a single self-contained `dungeon.html` file. The modular `src/` tree is the development source of truth.

## Contents

- [At A Glance](#at-a-glance)
- [Core Rules](#core-rules)
- [Controls](#controls)
- [Classes](#classes)
- [Weapons](#weapons)
- [Armor](#armor)
- [Potions](#potions)
- [Permanent Shop Upgrades](#permanent-shop-upgrades)
- [Enemies](#enemies)
- [Systems Reference](#systems-reference)
- [Map Symbols](#map-symbols)
- [PWA Install](#pwa-install)
- [Development](#development)
- [Tests](#tests)
- [Project Layout](#project-layout)
- [License](#license)

## At A Glance

- Five floors total; floor 5 is the final floor
- Eight playable classes with unique abilities and passives
- Procedural rooms, tunnels, fog of war, loot, merchants, and floor scaling
- Weapons, armor, potions, and permanent shop upgrades
- Emergency potion prompt when a hit could be fatal
- Web Audio sound effects and DOM/CSS-driven visuals
- PWA install support and offline play after the first load

## Core Rules

- Death is permanent. When you die, the run ends and the game shows a run summary.
- Descend from floor 5 to finish the game in victory.
- Carried items persist between floors.
- Better gear auto-equips when picked up or bought.
- Unequipped weapons, armor, and potions stay in the bag.
- `Sell Weaker Gear` sells only carried weapons and armor that are weaker than your current equipped gear.

## Controls

| Input | Action |
| --- | --- |
| WASD / Arrow keys | Move |
| Swipe on mobile | Move |
| Walk into an enemy | Attack in melee |
| Tap or click a visible enemy | Attack from range |
| Long press a visible enemy on mobile | Inspect HP and ATK without attacking |
| `1` or `B` | Class ability 1 |
| `2` or `V` | Class ability 2, unlocked at level 5 |
| `.` or `>` | Descend stairs |
| `I` | Open inventory |
| `T` | Open shop |
| `H` or `?` | Open help |
| `Escape` | Close the current overlay |

Ranger bows extend tap/click attack range to 3 tiles and skip the enemy counterattack when firing from range.

## Classes

### Warrior
Base stats: HP 30, ATK 3, DEF 3

Starting gear: Bare Hands, Chain Mail

Ability 1: Bash. Double-damage attack against a nearby visible enemy. Cooldown: 5 turns.

Ability 2: Shield Wall. Unlocked at level 5. Reduces incoming damage by 50% for 3 turns. Cooldown: 10 turns.

Passive: Regenerates 1 HP every 5 turns.

### Rogue
Base stats: HP 20, ATK 6, DEF 1

Starting gear: Rusty Dagger, Leather Vest

Ability 1: Dash. Instantly grants 2 free moves. Cooldown: 3 turns.

Ability 2: Vanish. Unlocked at level 5. Grants invisibility for 3 turns; the next attack deals 2x damage. Cooldown: 10 turns.

Passive: Dodges 30% of incoming attacks.

### Mage
Base stats: HP 15, ATK 5, DEF 1

Starting gear: Bone Staff, Apprentice Robe

Ability 1: Fireball. Deals damage to every enemy in a 3x3 area around a chosen visible target. Cooldown: 5 turns.

Ability 2: Blink. Unlocked at level 5. Teleports to a safe visible floor tile. Cooldown: 8 turns.

Passive: Magic weapons deal 50% bonus damage.

### Paladin
Base stats: HP 25, ATK 2, DEF 4

Starting gear: Bare Hands, Iron Plate

Ability 1: Smite. Deals damage and stuns the target for 1 turn. Cooldown: 5 turns.

Ability 2: Lay on Hands. Unlocked at level 5. Heals 30% of Max HP. Cooldown: 15 turns.

Passive: Max HP increases by 2 on each level up.

### Ranger
Base stats: HP 15, ATK 3, DEF 1

Starting gear: Shortbow, Ranger Tunic

Ability 1: Piercing Shot. Fires an arrow that damages every enemy in a straight line. Cooldown: 4 turns.

Ability 2: Bear Trap. Unlocked at level 5. Drops a trap that stuns and damages an enemy, then jumps you back 1 tile. Cooldown: 10 turns.

Passive: Bows allow attacks from up to 3 tiles away.

### Barbarian
Base stats: HP 40, ATK 5, DEF 0

Starting gear: Great Axe, Furs

Ability 1: Cleave. Damages all adjacent enemies. Cooldown: 4 turns.

Ability 2: Bloodlust. Unlocked at level 5. For 3 turns, heal for 50% of damage dealt but take 2x damage. Cooldown: 12 turns.

Passive: Deals +1 damage for every 10 missing HP.

### Necromancer
Base stats: HP 15, ATK 3, DEF 1

Starting gear: Skull Rod, Apprentice Robe

Ability 1: Siphon Life. Deals damage and heals you for the same amount. Cooldown: 5 turns.

Ability 2: Corpse Explosion. Unlocked at level 5. Marks an enemy for 3 turns; if it dies while marked, it explodes for heavy AoE damage. Cooldown: 8 turns.

Passive: Heals 1 HP whenever an enemy dies.

### Monk
Base stats: HP 20, ATK 3, DEF 2

Starting gear: Bare Hands, Gi

Ability 1: Push Kick. Pushes an enemy 1 tile away and deals extra damage if it hits a wall. Cooldown: 3 turns.

Ability 2: Flurry of Blows. Unlocked at level 5. Attacks 3 times instantly, but you are rooted for your next turn. Cooldown: 10 turns.

Passive: Gains +2 ATK, scaling with level, when no weapon is equipped.

## Weapons

Weapon power is modified by class passives and gear bonuses. Mage magic weapons receive a 50% bonus, and Monk unarmed scaling applies when no weapon is equipped.

### Universal Weapons

| Name | ATK | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Rusty Dagger | +3 | Common | 15g | None |
| Short Sword | +4 | Common | 30g | None |
| Broadsword | +6 | Common | 50g | Level 3 |
| Steel Glaive | +9 | Rare | 80g | Level 6 |

### Warrior / Paladin Weapons

| Name | ATK | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Iron Mace | +5 | Common | 40g | Warrior or Paladin |
| War Hammer | +8 | Rare | 75g | Warrior or Paladin, Level 5 |
| Holy Avenger | +14 | Legendary | 150g | Paladin, Level 10 |
| Champion Blade | +15 | Legendary | 160g | Warrior, Level 10 |

### Barbarian Weapons

| Name | ATK | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Great Axe | +4 | Common | 40g | Barbarian |
| Savage Cleaver | +9 | Rare | 85g | Barbarian, Level 5 |
| Titan Slayer | +16 | Legendary | 180g | Barbarian, Level 10 |

### Rogue Weapons

| Name | ATK | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Twin Daggers | +5 | Common | 45g | Rogue |
| Assassin Dirk | +8 | Rare | 75g | Rogue, Level 5 |
| Shadow Blade | +14 | Legendary | 150g | Rogue, Level 10 |

### Ranger Weapons

| Name | ATK | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Shortbow | +3 | Common | 30g | Ranger |
| Longbow | +6 | Rare | 65g | Ranger, Level 4 |
| Crossbow | +9 | Rare | 90g | Ranger, Level 7 |
| Elven Bow | +13 | Legendary | 140g | Ranger, Level 10 |

### Mage / Necromancer Weapons

| Name | ATK | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Bone Staff | +5 | Common | 40g | Mage or Necromancer |
| Skull Rod | +4 | Common | 40g | Mage or Necromancer |
| Arcane Wand | +8 | Rare | 75g | Mage or Necromancer, Level 5 |
| Void Staff | +12 | Rare | 110g | Mage or Necromancer, Level 8 |
| Elder Wand | +18 | Legendary | 200g | Mage, Level 12 |
| Scythe of Death | +17 | Legendary | 190g | Necromancer, Level 12 |

## Armor

Armor power stacks with your class base DEF. Each point of DEF reduces incoming damage by 1 before randomness, with a minimum of 1 damage taken.

### Universal Armor

| Name | DEF | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Cloth Tunic | +1 | Common | 10g | None |
| Leather Vest | +2 | Common | 20g | None |
| Studded Armor | +4 | Common | 40g | Level 3 |
| Mithril Shirt | +7 | Rare | 80g | Level 6 |

### Warrior / Paladin Armor

| Name | DEF | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Chain Mail | +4 | Common | 35g | Warrior or Paladin |
| Iron Plate | +5 | Common | 45g | Warrior or Paladin |
| Steel Plate | +8 | Rare | 80g | Warrior or Paladin, Level 5 |
| Dragon Scale | +12 | Legendary | 150g | Warrior or Paladin, Level 10 |

### Rogue / Ranger Armor

| Name | DEF | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Ranger Tunic | +3 | Common | 30g | Rogue or Ranger |
| Shadow Cloak | +6 | Rare | 70g | Rogue or Ranger, Level 5 |
| Assassin Garb | +10 | Legendary | 130g | Rogue, Level 10 |
| Hunter Vest | +10 | Legendary | 130g | Ranger, Level 10 |

### Barbarian Armor

| Name | DEF | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Furs | +3 | Common | 25g | Barbarian |
| Bone Armor | +6 | Rare | 60g | Barbarian, Level 5 |

### Mage / Necromancer Armor

| Name | DEF | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Apprentice Robe | +2 | Common | 25g | Mage or Necromancer |
| Mystic Robe | +5 | Rare | 60g | Mage or Necromancer, Level 5 |
| Archmage Robes | +9 | Legendary | 120g | Mage, Level 10 |
| Lich Shroud | +9 | Legendary | 120g | Necromancer, Level 10 |

### Monk Armor

| Name | DEF | Rarity | Price | Requirements |
| --- | ---: | --- | ---: | --- |
| Gi | +3 | Common | 30g | Monk |
| Master Gi | +6 | Rare | 70g | Monk, Level 5 |
| Grandmaster Robe | +11 | Legendary | 140g | Monk, Level 10 |

## Potions

Potions are always stored in your bag. They are never consumed automatically.

| Name | Heal | Rarity | Price | Notes |
| --- | ---: | --- | ---: | --- |
| Health Potion | 15 HP | Common | 15g | Bag item |
| Greater Potion | 30 HP | Rare | 30g | Bag item |
| Elixir of Life | 60 HP | Legendary | 60g | Bag item |

Emergency potion prompts can offer your best potion automatically when the game predicts a fatal hit. If one potion is not enough, the prompt can chain multiple potions.

## Permanent Shop Upgrades

These upgrades are shop-only items and become available from floor 2 onward. Legendary upgrades do not appear until floor 4.

| Name | Effect | Rarity | Price | Availability |
| --- | --- | --- | ---: | --- |
| Strength Tonic | +2 ATK permanently | Rare | 50g | Floor 2+ |
| Iron Skin | +2 DEF permanently | Rare | 50g | Floor 2+ |
| Vitality Brew | +15 Max HP permanently | Rare | 45g | Floor 2+ |
| Blessing | +1 ATK, +1 DEF, +10 Max HP | Legendary | 120g | Floor 4+ |
| Vampiric Ring | Heal 1 HP per kill | Legendary | 150g | Floor 4+ |
| Troll Blood | Heal 1 HP every 10 turns | Legendary | 160g | Floor 4+ |
| Hermes Boots | Gain 1 free move every 15 turns | Legendary | 140g | Floor 4+ |

## Enemies

Enemy stats below are base floor 1 values. Floor scaling uses these profiles:

- Floor 1: tier 0-1, scale 1.0
- Floor 2: tier 1-2, scale 1.4
- Floor 3: tier 2-3, scale 1.75
- Floor 4: tier 3-4, scale 2.0
- Floor 5: tier 4-6, scale 2.4

| Enemy | Symbol | HP | ATK | DEF | XP | Gold | First Appears |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Rat | R | 5 | 2 | 0 | 3 | 2 | Floor 1 |
| Goblin | G | 10 | 4 | 1 | 6 | 4 | Floor 1 |
| Skeleton | S | 15 | 6 | 2 | 10 | 6 | Floor 1-2 |
| Orc | O | 25 | 8 | 3 | 15 | 10 | Floor 2-3 |
| Troll | T | 40 | 12 | 4 | 25 | 15 | Floor 3-4 |
| Demon | D | 55 | 15 | 5 | 35 | 22 | Floor 4-5 |
| Lich | L | 70 | 18 | 6 | 50 | 30 | Floor 4-5 |

## Systems Reference

### Combat Model

- Melee attacks happen when you walk into an adjacent enemy.
- Tap or click a visible enemy to attack from range.
- Ranger bows extend ranged taps to 3 tiles and skip the counterattack at range.
- Damage uses `max(1, ATK - DEF + random 0-2)`.
- DEF reduces incoming damage by 1 per point before randomness.
- Leveling up increases Max HP by 8, ATK by 1, DEF by 1, and the XP requirement scales up by 1.6x.
- Paladins gain an extra +2 Max HP on level up.

### Inventory and Gear

- Better weapons and armor auto-equip when picked up or bought.
- Older equipped gear is moved back into the bag.
- Potions remain bag items until used manually or triggered by the emergency prompt.
- Unequipped gear and potions carry over between floors.
- The `Sell Weaker Gear` button only checks current power, not future equip requirements.

### Shop Logic

- Merchants appear in middle rooms on a floor.
- Shop inventory scales with floor depth.
- Weapons and armor in the shop are filtered by floor-scaled power limits.
- Upgrades appear from floor 2 onward, with legendary upgrades starting on floor 4.
- Selling an item gives 50% of its shop price, rounded down with a minimum of 1 gold.

### Vision and Presentation

- The dungeon uses fog of war: unseen tiles are blacked out, seen tiles stay dimly remembered.
- The game uses DOM updates, CSS, and procedural drawing only.
- Sound effects are generated with the Web Audio API.
- Visual feedback includes damage flash, map shake, floating combat text, and enemy death fade-outs.

### Run Summary

On death or victory, the game shows a summary with:

- Final level
- Total kills
- Damage dealt
- Best weapon found
- Gold earned
- Floors reached
- Turns taken

## Map Symbols

| Symbol | Meaning |
| --- | --- |
| `@` | Player |
| `>` | Stairs |
| `$` | Merchant shop |
| `!` | Potion |
| `R`, `G`, `S`, `O`, `T`, `D`, `L` | Enemies |
| `^` | Bear trap |
| Wall tiles | Solid walls |
| Floor tiles | Walkable ground |

## PWA Install

DELVE is a Progressive Web App. After the first load, it can be installed like a native app and played offline.

### Android

1. Open the game in Chrome.
2. Use the browser menu and choose Add to Home Screen.
3. Launch the installed app from the home screen icon.

### iOS

1. Open the game in Safari.
2. Tap Share and choose Add to Home Screen.
3. Launch the installed app from the home screen icon.

## Development

- `src/index.html` is the development entry point.
- `build.js` inlines `src/css/style.css` and `src/js/*.js` into `dungeon.html`.
- `dungeon.html` is the generated production file.
- `sw.js` caches the production build, source files, and icons for offline play.
- If you add new static files, update `sw.js` so they are cached.
- Edit `src/js/data.js` for items and enemies.
- Edit `src/js/main.js` for class data and title/game-over screens.
- Edit `src/js/shop.js` for shop inventory and selling rules.
- Edit `src/js/items.js` for pickup, auto-equip, and potion behavior.
- Edit `src/js/combat.js` for attack, damage, and level-up logic.
- Edit `src/js/map.js` for floor generation and enemy placement.

## Tests

- `npm install` installs the test runner dependency.
- `npm test` runs `bot_brain_test.js`, `autoplay_runner_test.js`, `combat_test.js`, `map_test.js`, and `shop_test.js`.
- `node test.js` runs a browser smoke test against both `src/index.html` and `dungeon.html`.
- `node test.js` expects a local server at `http://127.0.0.1:8080/`.
- `bot_brain_test.js` and `autoplay_test.js` cover the automated playtester heuristics.

## Project Layout

| Path | Purpose |
| --- | --- |
| `dungeon.html` | Production single-file build |
| `src/index.html` | Development entry point |
| `src/css/style.css` | Source styles |
| `src/js/constants.js` | Map size, floor count, and key mappings |
| `src/js/data.js` | Weapons, armor, potions, upgrades, enemies |
| `src/js/main.js` | Class data, title screen, victory and death screens, and game flow |
| `src/js/state.js` | Game state and helpers |
| `src/js/map.js` | Floor generation and floor setup |
| `src/js/vision.js` | Fog of war and visibility |
| `src/js/render.js` | Map, HUD, inventory drawer, and action buttons |
| `src/js/combat.js` | Damage, attacks, abilities, leveling |
| `src/js/items.js` | Pickup, auto-equip, potions, floor descent |
| `src/js/shop.js` | Shop stock, buy/sell, upgrades |
| `src/js/movement.js` | Player movement and d-pad handling |
| `src/js/emergency.js` | Emergency potion prompt |
| `src/js/ui.js` | Tooltips, help, tips, long press handling |
| `src/js/sfx.js` | Web Audio sound effects |
| `src/js/fx.js` | Visual effects |
| `src/js/input.js` | Keyboard and swipe input |
| `src/js/pwa.js` | PWA install prompt |
| `build.js` | Generates `dungeon.html` from `src/` |
| `test.js` | Browser smoke test |
| `bot_brain.js` | Automated bot heuristics |
| `bot_brain_test.js` | Bot heuristic regression tests |
| `autoplay_test.js` | Bot startup and retry behavior |
| `autoplay_runner_test.js` | Bot runner regression tests |
| `combat_test.js` | Combat regression tests |
| `map_test.js` | Map and progression regression tests |
| `shop_test.js` | Shop regression tests |
| `manifest.json` | PWA metadata |
| `sw.js` | Service worker cache list |
| `icon-192.png`, `icon-512.png`, `favicon.ico`, `favicon-32.png` | App and tab icons |
| `DELVE_Roadmap.md` | Planned work and milestones |

## License

Personal project. All rights reserved.
