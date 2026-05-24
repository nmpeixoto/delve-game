# DELVE — Browser Roguelike

> *The dungeon goes down forever. Death is permanent. Every run, a new story.*

**DELVE** is a procedurally generated roguelike dungeon crawler that runs entirely in the browser — no installation, no downloads, no account needed. Built as a single HTML file with vanilla JavaScript.

🎮 **Play now:** [nunopeixoto.pt/game/dungeon.html](https://www.nunopeixoto.pt/game/dungeon.html)

---

## What is it?

A turn-based dungeon crawler in the classic roguelike tradition. You descend 5 floors of a randomly generated dungeon, fighting enemies, collecting loot, spending gold at merchants, and trying not to die. When you die, you start over — but each run generates a completely different dungeon.

---

## Features

- **Procedurally generated dungeons** — BSP room placement with connected corridors, different every run
- **Fog of war** — raycasting field of vision, enemies hide in the dark
- **7 enemy types** that scale with floor depth — Rats, Goblins, Skeletons, Orcs, Trolls, Demons, Liches
- **Loot system** — weapons, armor, and potions in common / rare / legendary tiers
- **Gold economy** — enemies drop gold, spend it at the merchant on each floor
- **Shop with buy & sell** — purchase upgrades, weapons, armor, potions; sell unwanted gear for 50% value
- **Permanent stat upgrades** — Strength Tonic, Iron Skin, Vitality Brew, Blessing available from floor 2
- **XP and levelling** — gain ATK, DEF, and Max HP on level up
- **Bash ability** — double damage attack on a 5-turn cooldown
- **Auto-equip** — better gear equips automatically, old gear moves to your bag
- **Potion bag system** — potions stored in bag and used when you choose
- **Emergency potion prompt** — when a fatal hit is incoming, the game pauses and offers your best potion
- **Sound effects** — 8-bit Web Audio sounds for attacks, pickups, level-ups, shop, and death
- **Damage flash** — red screen vignette when the player takes a hit
- **Enemy death animation** — enemies flash and fade before disappearing
- **Run summary** — full stats on death/victory including damage dealt and best weapon found
- **Contextual tips** — first-time hints that fire at the right moment without getting in the way
- **In-game help** — `?` button opens a 4-tab reference (Controls, Combat, Items, Shop)

---

## How to Play

### Controls

| Input | Action |
|---|---|
| WASD / Arrow Keys | Move |
| Swipe (mobile) | Move |
| Walk into enemy | Attack (adjacent) |
| Tap / click enemy | Attack from up to 2 tiles away |
| Long press enemy (mobile) | Inspect HP and ATK without attacking |
| `B` | Bash — double damage, 5-turn cooldown |
| `.` or `>` | Descend stairs |
| `T` | Enter shop (stand next to `$`) |
| `I` | Open bag / inventory |
| `H` or `?` | Open help screen |

### Map Symbols

| Symbol | Meaning |
|---|---|
| `@` | You |
| `>` | Stairs to next floor |
| `$` | Merchant shop |
| `!` | Potion |
| `†` `⚔` `♦` | Weapons |
| `◈` | Armor |
| `R` | Rat |
| `G` | Goblin |
| `S` | Skeleton |
| `O` | Orc |
| `T` | Troll |
| `D` | Demon |
| `L` | Lich |

---

## Enemies

Enemy stats shown are **base values** (floor 1). Stats scale by **+40% per floor** — a Lich on floor 5 is significantly more dangerous than on floor 1.

| Enemy | Symbol | HP | ATK | DEF | XP | Gold Drop | First Appears |
|---|:---:|---:|---:|---:|---:|---:|---|
| Rat | `R` | 5 | 2 | 0 | 3 | 2 | Floor 1 |
| Goblin | `G` | 10 | 4 | 1 | 6 | 4 | Floor 1 |
| Skeleton | `S` | 15 | 6 | 2 | 10 | 6 | Floor 1–2 |
| Orc | `O` | 25 | 8 | 3 | 15 | 10 | Floor 2–3 |
| Troll | `T` | 40 | 12 | 4 | 25 | 15 | Floor 3–4 |
| Demon | `D` | 55 | 15 | 5 | 35 | 22 | Floor 4–5 |
| Lich | `L` | 70 | 18 | 6 | 50 | 30 | Floor 4–5 |

**DEF** reduces incoming damage by 1 per point — a Troll with DEF 4 requires at least 5 ATK to deal any damage. Stack armor and use **Bash** on high-DEF enemies.

---

## Items & Shop

### Weapons

| Name | ATK Bonus | Rarity | Shop Price |
|---|---:|---|---:|
| Rusty Dagger | +2 | Common | 20g |
| Short Sword | +4 | Common | 35g |
| Bone Staff | +5 | Common | 40g |
| Battle Axe | +7 | Rare | 60g |
| Arcane Rod | +9 | Rare | 75g |
| Shadow Blade | +10 | Rare | 90g |
| Soul Reaper | +15 | Legendary | 150g |

### Armor

| Name | DEF Bonus | Rarity | Shop Price |
|---|---:|---|---:|
| Leather Vest | +2 | Common | 20g |
| Chain Mail | +4 | Common | 35g |
| Shadow Cloak | +5 | Rare | 55g |
| Plate Armor | +7 | Rare | 65g |
| Dragon Scale | +12 | Legendary | 140g |

### Potions

Potions are **stored in your bag** when picked up or purchased — they are never consumed automatically. Use them manually from the BAG menu, or let the emergency prompt offer them when a hit could be fatal. Potions carry over between floors.

| Name | Heal | Rarity | Shop Price |
|---|---:|---|---:|
| Health Potion | 15 HP | Common | 15g |
| Greater Potion | 30 HP | Rare | 30g |
| Elixir of Life | 60 HP | Legendary | 60g |

### Permanent Upgrades *(available from floor 2)*

| Name | Effect | Shop Price |
|---|---|---:|
| Strength Tonic | +2 ATK (permanent) | 50g |
| Iron Skin | +2 DEF (permanent) | 50g |
| Vitality Brew | +15 Max HP (permanent) | 45g |
| Blessing | +1 ATK, +1 DEF, +10 Max HP | 120g |

Sold items return **50% of their shop price** — selling unused loot is a valid strategy for funding upgrades.

---

## Potions & Emergency System

Potions are stored in your bag and carry over between floors. Two ways to use them:

**Manual use** — open BAG at any time and tap a potion to drink it. Costs a turn.

**Emergency prompt** — when the game calculates that the next enemy hit could kill you, it pauses and shows a warning overlay before the hit lands. It offers your best available potion (or chains multiple potions if one isn't enough):
- **DRINK** — consume the potion(s) and then take the hit with your new HP
- **IGNORE** — take the hit without drinking; prompts again next turn if still in danger

If you have no potions in your bag, no prompt is shown.

---

## Run Summary

At the end of every run (death or victory) the game shows a full summary:

| Stat | Description |
|---|---|
| Level | Final level reached |
| Kills | Total enemies defeated |
| Damage dealt | Total damage inflicted across the run |
| Best weapon | Highest ATK weapon equipped during the run |
| Gold earned | Total gold accumulated |
| Floors reached | How deep you got |
| Turns taken | Total turns played |

---

## Tips

- Walk into enemies to attack, or tap them to attack from up to 2 tiles away
- **Long press** an enemy on mobile to inspect their HP and ATK without attacking
- Use **Bash** (`B`) on tough enemies — double damage on a 5-turn cooldown
- Stand on `>` and press STAIRS (or `.`) to descend to the next floor
- Stand next to `$` and press SHOP to open the merchant
- **Save potions** — they carry over between floors, so stock up on early floors
- Check your **BAG** — potions, unequipped weapons and armor are all stored there
- Save gold for **permanent stat upgrades** available from floor 2 onward
- Sell unused weapons and armor to fund better purchases
- **DEF stacking is powerful** — each DEF point reduces damage from every hit

---

## Installing as an App (PWA)

DELVE is a Progressive Web App. It installs like a native app and works offline after the first load.

**Android (Chrome):**
1. Open the game URL in Chrome
2. Tap **⋮ → Add to Home Screen**
3. Launches full screen, no browser bar

**iOS (Safari):**
1. Open the URL in Safari
2. Tap the **Share button → Add to Home Screen**

---

## Files

| File | Purpose |
|---|---|
| `dungeon.html` | The entire game — self-contained |
| `manifest.json` | PWA metadata for home screen installation |
| `sw.js` | Service worker — enables offline play |
| `icon-192.png` | Home screen icon (192×192) |
| `icon-512.png` | Splash screen icon (512×512) |
| `favicon.ico` | Browser tab icon (16×16 + 32×32) |
| `favicon-32.png` | Browser tab icon for modern browsers |

The game is intentionally a **single HTML file**. No build process, no dependencies, no framework. Drop it anywhere and it works.

---

## Versioning

| Version | Status | Highlights |
|---|---|---|
| v0.01 | Released | Base game — map gen, combat, FOV, inventory |
| v0.02 | Released | Shop system, gold economy, landscape layout |
| v0.03 | Released | Polish & feel — sounds, animations, potion system, help, tips, icons |
| v0.04 | Planned | Character classes, abilities |
| v0.05 | Planned | Minimap, traps, secret rooms |
| v0.06 | Planned | Floor 5 boss, legendary drops |
| v0.07 | Planned | Persistent scores, achievements, daily seed |
| v1.0 | Future | Android/iOS app store release |

See [`DELVE_Roadmap.docx`](DELVE_Roadmap.docx) for the full development plan with timelines.

---

## Technical Notes

- No dependencies — pure HTML, CSS, and vanilla JavaScript
- No build step — edit `dungeon.html` and upload
- Offline-capable via service worker after first load
- Mobile-first layout with portrait and landscape support
- Touch input via `ontouchend` + `preventDefault()` for reliable single-tap on Android
- `touch-action: manipulation` on all interactive elements eliminates 300ms tap delay
- Sound effects generated via Web Audio API — no audio files, works offline
- Tested on Chrome (Android), Safari (iOS), Firefox, and desktop browsers

---

## License

Personal project. All rights reserved.

---

*Built with [Claude](https://claude.ai)*
