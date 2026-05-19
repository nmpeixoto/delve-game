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
- **Contextual tips** — first-time hints that fire at the right moment without getting in the way
- **In-game help** — `?` button opens a 4-tab reference (Controls, Combat, Items, Shop)

---

## How to Play

### Controls

| Input | Action |
|---|---|
| WASD / Arrow Keys | Move |
| Swipe (mobile) | Move |
| Walk into enemy | Attack |
| Tap enemy tile | Attack from up to 2 tiles away |
| B | Bash — double damage, 5-turn cooldown |
| . or > | Descend stairs |
| T | Enter shop (stand next to $) |
| I | Open bag / inventory |
| H or ? | Open help screen |

### Map symbols

| Symbol | Meaning |
|---|---|
| `@` | You |
| `>` | Stairs to next floor |
| `$` | Merchant shop |
| `!` | Potion |
| `†` `⚔` `♦` | Weapons |
| `◈` | Armor |
| `r g s o T D L` | Enemies (Rat → Lich) |

### Tips

- Walk into enemies to attack them, or tap them from a distance
- Use **Bash** on tough enemies — it deals double damage
- Stand on `>` and press STAIRS (or `.`) to descend
- Stand next to `$` and press SHOP to trade
- Check your **BAG** — items that didn't auto-equip are stored there
- Save gold for permanent stat upgrades from floor 2 onward
- Selling unused gear funds better purchases

---

## Installing as an App (PWA)

DELVE is a Progressive Web App. On Android:

1. Open the game URL in **Chrome**
2. Tap **⋮ → Add to Home Screen**
3. It installs like a native app — full screen, works offline

On iOS (Safari):

1. Open the URL in **Safari**
2. Tap the **Share** button → **Add to Home Screen**

---

## Files

| File | Purpose |
|---|---|
| `dungeon.html` | The entire game — self-contained |
| `manifest.json` | PWA metadata for home screen installation |
| `sw.js` | Service worker — enables offline play |
| `icon-192.png` | Home screen icon (192×192) |
| `icon-512.png` | Splash screen icon (512×512) |

The game is intentionally a **single HTML file**. No build process, no dependencies, no framework. Drop it anywhere and it works.

---

## Versioning

| Version | Status | Highlights |
|---|---|---|
| v0.01 | Released | Base game — map gen, combat, FOV, inventory |
| v0.02 | Released | Shop system, gold economy, landscape layout |
| v0.03 | In progress | Help system, tips, sell items, bug fixes |
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
- Tested on Chrome (Android), Safari (iOS), Firefox, and desktop browsers

---

## License

Personal project. All rights reserved.

---

*Built with [Claude](https://claude.ai)*
