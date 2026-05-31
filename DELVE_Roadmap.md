__DELVE__

*Game Development Roadmap*

Future Updates & Implementation Timeline

# __Overview__

This document outlines the planned development roadmap for DELVE, a browser-based roguelike dungeon crawler. Updates are grouped by version, with each version building on the last. Effort estimates assume a single developer working in focused sessions of 2–4 hours.

__Version__

__Name__

__Status__

__Effort__

__v0.01__

Base Game

Released

—

__v0.02__

Shops & Landscape

Released

—

__v0.03__

Polish & Feel

Released

Completed

__v0.04__

Character Depth

Planned

2–3 sessions

__v0.05__

World Depth

Planned

2–3 sessions

__v0.06__

Boss & Endgame

Planned

1–2 sessions

__v0.07__

Persistence & Meta

Planned

2–3 sessions

__v1.0__

App Store Release

Future

3–5 sessions

# __Version 0.03 — Polish & Feel (Released)__

__v0.03__

__Polish & Feel__

*RELEASED*

Version 0.03 is fully released. Below is the complete feature list as delivered.

__Feature__

__Description__

__Damage Flash__

Red vignette overlay flashes over the full screen when the player takes a hit. Triggered from both direct counter-attacks and enemy pursuit attacks.

__Sound Effects__

8-bit sounds generated via Web Audio API with no audio files: attack hit, Bash impact, player takes damage, enemy death, item pickup, level up (4-note arpeggio), shop buy, shop sell, player death (5-note descending sequence).

__Enemy Death Animation__

Enemies flash bright white and fade to black over 300ms before disappearing. Item drops and level up checks fire after the animation completes. Dying tiles are non-interactive.

__Run Summary__

Death and victory screens now show: level, kills, total damage dealt, best weapon equipped during the run, gold earned, floors reached, and turns taken.

__Potion Bag System__

Potions no longer auto-consume on pickup or purchase. They go to the bag and carry over between floors. Manual use from BAG costs a turn.

__Emergency Potion Prompt__

When the next enemy hit could be fatal, the game pauses before applying the hit and offers the best potion(s). DRINK consumes and takes the hit. IGNORE dismisses for that hit only and re-prompts next turn if still in danger.

__Help System__

? button in HUD opens a 4-tab modal (Controls, Combat, Items, Shop). All keyboard shortcuts documented. Accessible via H or ? at any time.

__Contextual Tips__

8 tips fire once per run at the right moment: first enemy spotted, first item picked up, first potion picked up, first gold earned, first level up, stairs visible, shop visible, first bag open.

__Long Press Inspect__

Hold finger on an enemy for 480ms to view HP and ATK in a tooltip without attacking. Haptic vibration confirms. Short tap still attacks.

__Shop Sell Tab__

Merchant has BUY and SELL tabs. Sell any carried or equipped item for 50% of buy value. Gold updates in real time.

__Gold Economy__

Enemies drop gold on death. Shown in HUD (GP label) and on death/victory summary screens.

__D Lettermark Icons__

Pixel-art D lettermark in Press Start 2P style. favicon.ico and favicon-32.png added for browser tabs.

__Pixelated Title__

DELVE title rendered at 16px and scaled with CSS transform to preserve chunky block look at all screen sizes.

__Landscape Layout__

Optimised side-by-side layout for mobile landscape (max-height 600px). Desktop layout unchanged.

__Bug Fixes__

Fast-click exploit, item softlock (worse items go to bag), shop touch reliability, enemy spawn visibility, PWA path fixes, sw.js cache bumped to v2, autoEquip ghost copy cleanup, applyUpgrade crash fix, bag items preserved across floors.

# __Version 0.04 — Character & Build Depth__

__v0.04__

__Character & Build Depth__

*2–3 sessions*

Adds replayability by giving the player meaningful choices from the very start of each run.

__Feature__

__Description__

__Character Classes__

Three classes at the title screen. Warrior: high HP, starts with Chain Mail, Bash deals extra damage. Rogue: high ATK, starts with Dagger and Dash ability. Mage: lower HP but magic weapons deal double damage, starts with Bone Staff.

__Dash Ability (Rogue)__

Move 2 tiles in one turn. Useful for escaping or closing distance. Replaces Bash for Rogue.

__Expanded Abilities__

Each class unlocks a second ability at level 5. Warrior: Taunt (forces nearby enemies to target player for 3 turns). Mage: Blink (teleport to random visible tile).

__Class Stat Differences__

Warrior: 30 HP, 3 ATK, 3 DEF. Rogue: 18 HP, 6 ATK, 1 DEF. Mage: 15 HP, 5 ATK, 1 DEF, magic multiplier x2.

# __Version 0.05 — World Depth__

__v0.05__

__World Depth__

*2–3 sessions*

Makes the dungeon itself more interesting to explore with secrets, hazards, and varied rooms.

__Feature__

__Description__

__Minimap__

Small corner overlay showing explored rooms. Dim for seen areas, bright for currently visible. Especially useful on mobile.

__Traps__

Hidden floor tiles — spike pits, poison gas, alarm tiles. Look like normal floor until triggered. Remain visible for the rest of the run once found.

__Secret Rooms__

Hidden wall passages that appear when the player walks adjacent. Always contain bonus loot.

__Locked Doors__

Some rooms sealed by doors requiring a key found elsewhere. Forces exploration before descending.

__Varied Room Types__

Treasure rooms (more loot, no enemies), armory rooms (weapons only), crypt rooms (high enemy density, better XP), shrine rooms (stat boost or curse).

# __Version 0.06 — Boss & Endgame__

__v0.06__

__Boss & Endgame__

*1–2 sessions*

Replaces the instant floor 5 victory with a proper final boss encounter.

__Feature__

__Description__

__Floor 5 Boss__

Named boss: the Dungeon Lord. Multi-phase health pool, unique attack patterns. Stairs only appear after defeat.

__Unique Legendary Drops__

Boss-only items: Ring of the Fallen (\+5 all stats), Cloak of Shadows (25% dodge), Necronomicon (1.5x magic damage). these should only be found in secret rooms and such.

__Hard Mode Unlock__

Completing Normal unlocks Hard: tougher enemies, 30% less gold, only 1 shop per floor, boss has an extra phase.

__Victory Score__

Final score: floors cleared x kills x level, adjusted by difficulty. Shown on victory screen.

# __Version 0.07 — Persistence & Meta__

__v0.07__

__Persistence & Meta__

*2–3 sessions*

Adds long-term progression using localStorage — no backend needed.

__Feature__

__Description__

__High Score Board__

Top 10 runs saved locally. Score: kills x floor x level. Shown on title screen with date, class, and cause of death.

__Unlockable Classes__

Warrior default. Rogue unlocks after first win. Mage unlocks after winning with Rogue. Stored in localStorage.

__Achievement System__

In-run achievements on summary screen: First Blood, Hoarder, Merchant's Favourite, Untouchable, Speed Runner.

__Daily Seed__

Fixed random seed from current date. All players get the same dungeon each day for fair comparison.

# __Version 1.0 — App Store Release__

__v1.0__

__App Store Release__

*3–5 sessions*

Packages the game as a native app for Android and iOS.

__Feature__

__Description__

__Android APK (Capacitor)__

Native Android shell via Capacitor. Play Store listing. Requires Android Studio and Google Play developer account ($25 one-time).

__iOS App__

Same Capacitor build for iOS. Requires Xcode and Apple Developer account ($99/year).

__Online Leaderboard__

Global leaderboard via Firebase Firestore free tier. Players submit scores with a chosen name.

__Full Soundtrack__

Procedurally generated ambient music via Web Audio API and Tone.js. No audio files needed.

# __Implementation Notes__

Principles to keep in mind across all versions:

- Each version should be fully playable and deployable on its own.
- Mobile-first: every feature tested on a real phone before marked complete.
- Single HTML file architecture preserved through v0.07 at minimum.
- Daily seed (v0.07) pairs naturally with the online leaderboard (v1.0).

*Current deployment: www.nunopeixoto.pt/game/dungeon.html*

