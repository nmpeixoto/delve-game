# Pixed Diablo-Style Visual Overhaul Design

## Context

`pixed` is a new branch for a major DELVE overhaul. The current game is a vanilla HTML/CSS/JavaScript roguelike with a DOM grid renderer, symbolic tiles, procedural rooms, turn-based movement and combat, shops, items, class abilities, fog of war, and a single-file production build generated as `dungeon.html`.

The approved direction is to go beyond a reskin. The branch will make DELVE look and feel much closer to a gothic action-RPG dungeon crawler while preserving the existing game content as the foundation.

Approved decisions:

- Use a **Cathedral Crypt** visual direction: dark gothic stone, cold shadows, warm torch and gold highlights, readable silhouettes, restrained blood and magic.
- Move to a **Diablo-style isometric presentation** rather than the current top-down square glyph grid.
- Preserve existing DELVE classes, enemies, floors, gear, shops, progression, and combat stats as the content foundation.
- Use **vanilla Canvas 2D** for the dungeon scene, not a new runtime framework.
- Generate the required pixel-art assets for this branch and keep production capable of running from one standalone `dungeon.html` file.

## Goals

- Replace symbolic dungeon tiles with a rich, high-resolution pixel-art isometric dungeon scene.
- Make every player class, enemy, shop, item pickup, shrine, trap, stair, door, and major combat event visually identifiable.
- Add click/tap-to-move, click/tap targeting, and smoother animated action-RPG presentation.
- Keep `G` as the source of truth for saveable simulation state.
- Preserve offline/PWA behavior and standalone production delivery.
- Maintain mobile-first playability while improving desktop mouse input.
- Stage the work so `pixed` remains playable throughout the overhaul.

## Non-Goals

- Do not copy proprietary Diablo assets, UI, names, sounds, or exact layouts.
- Do not replace the current class/enemy/item/floor foundation in the first overhaul.
- Do not introduce React, Vue, Phaser, Pixi, Vite, Webpack, or other runtime/build frameworks.
- Do not move text-heavy menus entirely into canvas when DOM overlays are clearer.
- Do not rebalance the whole game before the new renderer and input feel are playable.
- Do not require external network assets at runtime.

## Architecture

The branch separates simulation from presentation.

`G` remains the source of truth for:

- player stats, class, equipment, HP, XP, gold, cooldowns, status effects
- map tiles, rooms, shops, traps, items, enemies, fog of war
- floor progression, death, victory, logs, and run summary state

The new presentation layer owns:

- isometric coordinate projection
- camera follow and viewport scaling
- sprite animation playback
- draw ordering and depth sorting
- canvas hit testing
- particles, lighting, shake, flashes, floating text, and impact timing

The DOM remains responsible for:

- title and class select
- HUD, ability belt, inventory, shop, help, shrine, emergency potion, death/victory overlays
- text-heavy item descriptions and control surfaces
- mobile-safe drawers and buttons

New or heavily revised modules:

- `src/js/assets.js`: sprite manifest, generated image loading, atlas metadata, image readiness state.
- `src/js/iso.js`: grid-to-screen projection, screen-to-grid hit testing, camera transforms, depth keys.
- `src/js/canvas-renderer.js`: canvas scene drawing for floor, walls, entities, items, fog, lighting, and minimap hooks.
- `src/js/pathing.js`: pathfinding for click/tap movement, enemy approach, loot pickup, shop approach, and stair approach.
- `src/js/animation.js`: entity animation state, frame timing, action locks, attack/hurt/death transitions.
- `src/js/render.js`: keep DOM HUD/inventory rendering, but delegate playfield drawing to `canvas-renderer.js`.
- `src/js/input.js`: route pointer, keyboard, and mobile controls through explicit game actions.
- `src/js/fx.js`: shift visual effects from DOM glyph popups to canvas-aware FX, while keeping DOM overlays where useful.

`scripts/build.js` inlines CSS, JS, and production asset data so `dungeon.html` remains standalone. `sw.js` caches development asset files and any generated source files needed by `src/index.html`.

## Visual Direction

The visual target is **Cathedral Crypt action-RPG pixel art**.

Core traits:

- 2:1 isometric floor diamonds targeting `64x32` source pixels for the first implementation.
- Taller wall and prop overlays that create depth without obscuring important entities.
- Character and monster sprites around `48-64px` tall in source frames, anchored bottom-center on the tile.
- Strong silhouette separation for enemies and classes.
- Dark stone, iron, bone, parchment, blood red, cold blue magic, muted green poison, and gold highlight accents.
- Fog of war that feels like darkness and occlusion, not simply black squares.
- Hit, spell, loot, and death effects that are dramatic but do not hide tactical information.

The first complete theme is the crypt/cathedral dungeon. Subsequent floor-theme expansion can introduce sub-themes, but the first implementation fully polishes one coherent theme before expanding.

## Asset Scope

Environment assets:

- floor diamonds
- cracked floors and edge variation
- wall blocks, wall tops, corners, and occlusion pieces
- locked door, secret door hint, open doorway
- stairs down
- shop stall and merchant
- shrine
- spike, gas, alarm, and bear traps
- fog, darkness, torch glow, item glints

Player class assets:

- Warrior
- Rogue
- Mage
- Paladin
- Ranger
- Barbarian
- Necromancer
- Monk

Each class has at least:

- idle
- walk
- attack
- hurt
- death or defeat pose

Enemy assets:

- Rat
- Goblin
- Skeleton
- Bones pile
- Orc
- Troll
- Demon
- Lich
- Dungeon Lord

Each enemy has at least:

- idle
- move
- attack
- hurt
- death or collapse

Item and UI icon assets:

- weapon pickup
- armor pickup
- potion pickup
- bomb
- scroll
- key
- permanent upgrade
- rare and legendary glow overlays
- HP, XP, ATK, DEF, perception, gold, bag, stairs, shop, class abilities, hard mode

Ability and combat FX:

- Warrior Bash and Shield Wall
- Rogue Dash and Vanish
- Mage Fireball and Blink
- Paladin Smite and Lay on Hands
- Ranger Piercing Shot and Bear Trap
- Barbarian Cleave and Bloodlust
- Necromancer Siphon Life and Raise Dead
- Monk Push Kick and Flurry of Blows
- poison, alarm, crit, dodge, level-up, death, loot pop, shrine activation

## Asset Pipeline

Use generated pixel-art assets, normalized through a repeatable local pipeline.

Workflow:

1. Generate or create one approved seed frame for each class and enemy.
2. Build transparent reference canvases around each seed frame.
3. Generate whole animation strips in one pass per animation to reduce frame drift.
4. Normalize each strip to fixed frame dimensions and one shared bottom-center anchor.
5. Preview strips before wiring them into the manifest.
6. Keep source PNGs under `src/assets/`.
7. Generate compact atlas metadata and load through stable manifest keys.
8. Extend `scripts/build.js` to inline the production asset data into `dungeon.html`.

The runtime refers to manifest keys such as `class.warrior.idle`, `enemy.lich.attack`, or `fx.fireball.impact`, not raw filenames scattered through gameplay code.

Quality rules:

- Transparent backgrounds for sprites and FX.
- Consistent scale within each character family.
- Stable bottom-center anchor.
- Identifiable class costumes and enemy silhouettes at actual game scale.
- No decorative detail that makes hit targets unreadable.
- Shared palettes and trimmed sprite sheets to control single-file size.

## Gameplay Feel And Input

The simulation remains grid-based initially, but the player interacts with it through a more action-RPG-like input layer.

Primary inputs:

- Click/tap a walkable tile to path there.
- Click/tap an enemy to path into range and attack.
- Click/tap loot to path to it and pick it up.
- Click/tap stairs to path to them and descend when reached.
- Click/tap a shop or merchant to path adjacent and open the shop when close.
- Use keyboard hotkeys for abilities, inventory, shop, help, and fallback movement.
- Keep optional mobile movement controls as a fallback, not the primary interaction.

Combat preserves current stats and ability rules at first, and presentation adds:

- attack windups and hit frames
- enemy flinch
- hurt/death animation
- floating damage and healing
- impact particles
- loot pop timing
- camera shake for strong hits
- short hit-stop or slow impact for crits and major kills

Enemy AI remains turn-based initially. Enemy movement and attacks are visually smoothed after player actions so the scene feels animated rather than instant.

Real-time cooldown combat is a possible future direction, but it is not part of the first implementation plan because it would combine renderer, input, AI, and balance risk in one change.

## UI And Responsive Layout

The UI becomes a low-chrome gothic action-RPG interface that protects the playfield.

Desktop layout:

- Bottom-left HP orb or compact gothic HP panel.
- Bottom-center ability belt with class ability 1, class ability 2, potion/bomb/context slots.
- Bottom-right compact XP, gold, floor, and class cluster.
- Top-right minimap with fog and markers.
- Compact combat log that fades or collapses after recent messages.
- Inventory, shop, help, class select, shrine, emergency, death, and victory as DOM overlays.

Mobile layout:

- Tap-to-move/tap-to-attack as the main interaction.
- Bottom strip with ability 1, ability 2, potion/bomb, bag, and interact.
- HP/XP/floor in a tight top or bottom edge cluster.
- Shop and inventory as full-height drawers with large touch rows.
- D-pad available as optional fallback or compact setting.

UI style:

- Dark carved stone, iron trim, muted parchment, gold accents.
- Blood red HP and cold blue/purple magic or XP.
- Pixel or arcade type only for short labels and buttons.
- More legible text for descriptions, logs, and item details.
- Icon-first ability buttons with cooldown rings or overlays.
- Class select shows class sprite previews and starting gear icons.
- Shop shows a merchant scene, item icons, rarity borders, and affordability states.

## Data Flow

1. Gameplay code mutates `G`.
2. Movement, combat, item pickup, shop, and ability actions emit enough state changes for renderer and animation systems to interpret.
3. `animation.js` tracks non-saveable presentation state keyed by entity IDs and action events.
4. `canvas-renderer.js` reads `G`, asset readiness, animation state, and camera state to draw the scene.
5. DOM render functions update HUD, drawers, overlays, logs, and button states.
6. Pointer input uses `iso.js` hit testing to resolve a screen click into tile, entity, item, shop, or UI action.
7. `pathing.js` computes paths against `G.map`, enemies, doors, and target interaction rules.
8. Build tooling inlines all production CSS, JS, and required asset data into `dungeon.html`.

Save data serializes simulation state only. Renderer camera position, animation frame, particles, and transient visual effects do not become save state.

## Rollout

The branch moves in milestones:

1. **Renderer foundation**
   - Add canvas element to the map area.
   - Implement isometric projection, camera, tile drawing, and debug grid.
   - Keep current gameplay behavior.

2. **Pathing and pointer input**
   - Add pathfinding and click/tap action routing.
   - Support tile movement, enemy approach, loot pickup, shop approach, and stairs.
   - Preserve keyboard fallback.

3. **Asset system**
   - Add asset manifest and loader.
   - Add a complete first-pass generated atlas covering every required asset key.
   - Update build and service worker handling.

4. **Environment art**
   - Replace debug tiles with Cathedral Crypt floor, walls, doors, stairs, traps, shop, shrine, and fog.
   - Verify depth sorting and occlusion.

5. **Entity art**
   - Add all class and enemy sprites.
   - Add idle, move, attack, hurt, and death states.
   - Make every existing enemy and class identifiable.

6. **FX and combat polish**
   - Move hit flashes, floating text, death fades, spell effects, and ability visuals into the new presentation layer.
   - Add camera shake and impact timing where useful.

7. **HUD and overlay redesign**
   - Build ARPG-style HUD.
   - Restyle class select, shop, inventory, help, shrine, emergency, death, and victory surfaces.
   - Verify mobile and desktop layouts.

8. **Production build and PWA verification**
   - Generate `dungeon.html`.
   - Verify source and production builds.
   - Verify offline caching.

9. **Balance and feel pass**
   - Tune pathing speed, animation timing, enemy response pacing, and hit feedback.
   - Only rebalance stats after the new feel is playable.

## Testing

Focused automated tests:

- Isometric coordinate projection and inverse hit testing.
- Pathfinding around walls, locked doors, enemies, shops, traps, loot, and stairs.
- Input routing from pointer target to intended action.
- Preservation of key existing movement, combat, item, shop, and map tests.

Regression commands:

- `npm test`
- `npm run build`
- `node scripts/browser_smoke.js` with the expected local server

Browser QA:

- Desktop boot, class select, movement, combat, ability use, shop, inventory, stairs, death, victory.
- Mobile portrait and mobile landscape tap movement and HUD layout.
- Screenshot review for playfield obstruction and sprite readability.
- Canvas visual checks for nonblank render, correct camera framing, and entity draw order.
- PWA/offline behavior after first load.

Playtest checks:

- Main verbs are obvious and responsive.
- Click/tap movement feels natural.
- Enemy targeting does not misfire.
- Loot and shops are discoverable.
- HUD remains readable without dominating the playfield.
- Effects never hide tactical decisions.

## Acceptance Criteria

The overhaul is successful when:

- DELVE no longer reads as a symbol grid; it reads as a gothic isometric pixel dungeon.
- Every current class, enemy, shop, item pickup, stair, trap, shrine, and door has an identifiable visual.
- Click/tap movement, targeting, pickup, shop interaction, and stair use are reliable.
- Existing game content and progression remain recognizable.
- The game remains playable on desktop and mobile.
- `src/index.html` and `dungeon.html` both run correctly.
- `dungeon.html` remains standalone.
- Offline/PWA behavior still works after first load.
- Existing simulation tests pass or are intentionally updated with matching new behavior tests.

## Risks

- **Asset scope is large.** Start with complete first-pass sprites for every required entity, then upgrade quality in passes.
- **Single-file size can grow.** Use compact sheets, shared palettes, trimmed transparent bounds, and atlas discipline.
- **Isometric hit testing can feel wrong.** Test projection and inverse mapping early with automated and browser checks.
- **Canvas renderer can break DOM UI interactions.** Keep input boundaries explicit and pause scene input under overlays.
- **Depth sorting can hide actors behind walls.** Build wall occlusion rules and debug overlays early.
- **Animation timing can accidentally change difficulty.** Keep simulation timing separate from presentation timing until a deliberate balance pass.
- **Mobile HUD can cover too much of the scene.** Treat playfield visibility as a release gate.

## Implementation Handoff

After this design is approved, create a detailed implementation plan in `docs/superpowers/plans/`. The plan will be milestone-based, test-first where practical, and split into commits small enough that the branch remains reviewable.
