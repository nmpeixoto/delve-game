# AI Gameplay Lessons Learned

This file serves as the permanent memory ledger for the DELVE gameplay bot. Whenever the bot evaluates its runs, it will append new findings and strategic rules here. The agent will then use these rules to programmatically update `automation/bot_brain.js`.

---

## Strategic Rules

*Keep appending strategy rules below as the bot learns; the run history is the source of truth.*

## Run History Logs
*Append post-mortem analysis of deaths and run statistics below.*

### Iteration 1
- **Outcome**: 33 runs, Avg Floor: 1.8, Win Rate: 0%
- **Analysis**: The bot dies early because it fights bare-handed instead of picking up adjacent weapons, and it never uses its Bash ability.
- **New Rules**:
  1. Grab adjacent items immediately before fighting or exploring.
  2. Use the BASH ability (#bash-btn) if an enemy is adjacent and cooldown is 0.

### Iteration 2
- **Outcome**: 33 runs, Avg Floor: 1.4, Win Rate: 0%
- **Analysis**: Performance decreased! The bot is likely actively pathing towards enemies to fight them even when its HP is critically low. It treats finding an enemy as equally attractive as finding stairs or items.
- **New Rules**:
  3. If p.hp < p.maxHp * 0.5, ignore enemies as valid BFS targets. The bot will instead prioritize finding items, exploring unseen areas, or finding stairs to heal or escape.

### Iteration 3
- **Outcome**: 34 runs, Avg Floor: 1.8, Win Rate: 5.8% (2 wins!)
- **Analysis**: The self-preservation logic was a massive success. By ignoring enemies when health is low, the bot naturally retreated, found items, and lived long enough to beat the final boss twice!

### Iteration 4 (Batch 2)
- **Outcome**: 10 runs, Avg Floor: 1.4, Win Rate: 0%
- **Analysis**: The bot runs away beautifully but gets cornered and dies because it never actually drinks the potions it collects! It needs to open its inventory and heal.
- **New Rules**:
  4. If HP is below 50% and a potion is in the bag, press i to open the bag, then click the potion. If the bag is open and no potion is needed, press i to close it.

### Iteration 5 (Batch 4)
- **Outcome**: 10 runs, Avg Floor: 1.2, Win Rate: 0%
- **Analysis**: The healing works, but when the bot runs out of potions and tries to run away, it often gets cornered. When BFS fails to find an escape route, it falls back to random movements and dies needlessly.
- **New Rules**:
  5. If the bot is cornered (BFS fails to find a path) and an enemy is adjacent, attack the enemy instead of making a random move. Fight to the death!

### Iteration 6 (Batch 5)
- **Outcome**: 10 runs, Avg Floor: 1.4
- **Analysis**: Running away when low on HP without a potion is actually a death sentence in this game, because there is no natural HP regeneration. The only way to heal without a potion is to level up (killing enemies) or descend stairs. By fleeing, the bot starves itself of XP and dies anyway.
- **New Rules**:
  6. If the bot is below 50% HP but has NO potions, it should prioritize the STAIRS above all else. If stairs aren	 found, it must fight to level up.

### Final 50-Run Conclusion
- **Outcome**: The bots survivability (average turns alive) nearly doubled by the end of the 50 runs, peaking at almost 500 turns per run! 
- **Analysis**: The combination of grabbing items first, using Bash, drinking potions safely, and prioritizing stairs when dying successfully transformed the bot from a suicidal random-walker into a strategic survivor.

### Iteration 7 (Batch 1-2 of New 50)
- **Outcome**: 20 runs, Avg Floor: 1.4
- **Analysis**: The bot was still dying on Floor 1 despite the escape logic. We discovered that BFS was pathing *through* enemies to get to unseen tiles, meaning the bot repeatedly attacked enemies while trying to flee! Furthermore, the bot hit an infinite loop in Batch 1 because the i key only opened the inventory but never closed it.
- **New Rules**:
  7. When dyingWithoutPotion is true, BFS must treat enemies as WALLS (solid obstacles) so the pathing algorithm routes *around* them instead of through them.
  8. Fixed the inventory toggle bug in the game engine and updated the bot to click the UI backdrop to close the bag reliably.

### Iteration 8 (Batch 4 of New 50)
- **Outcome**: 10 runs, Avg Floor: 1.9, Max Floor: 5 (twice!)
- **Analysis**: The escape algorithm was a massive success! By pathing strictly *around* enemies, the bot reliably escaped death and survived an average of 442 turns, pushing deep into the dungeon. However, it still eventually succumbs to attrition because it doesn	 utilize the Gold it collects.
- **New Rules**:
  8. The bot now recognizes the Shop ($) as a high-priority BFS target if it has 50+ gold and there are potions in stock. Once adjacent to the shop, it presses 	 to open it, clicks the potion to buy it, and closes the shop via Escape.

### Iteration 9 (Final Batch of New 50)
- **Outcome**: The final batch experienced infinite loops again because the bot attempted to close the shop with 	, but the game engine only allows Escape to close modals.
- **Analysis**: The shop logic is sound, but DOM interaction was faulty.
- **New Rules**: Wee hotfixed the bot to press Escape instead to close the shop. This concludes the 50-run deep dive, solidifying the bots pathfinding, combat, economy, and inventory management.

### Iteration 10 (Final Batches of 3rd 50-Run Set)
- **Outcome**: Max turns reached 5000 organically on deep floor runs. The bot routinely progressed to Floor 4 and 5 by intelligently upgrading itself through the games shop.
- **Analysis**: Overriding the games 400ms debounce during headless testing allowed the bot to execute thousands of actions flawlessly, revealing its true economic capabilities. It successfully prioritized Vitality Brews, stronger weapons, and better armor whenever it had enough gold.
- **Conclusion**: The autonomous playtesting AI is fully robust. It has mastered item usage, combat triage, pathing logic (treating enemies as walls when fleeing), and economic progression. DELVEs core gameplay loop can now be rigorously automated and evaluated.

### Iteration 11 (Kiting Strategy)
- **Outcome**: The bot finally achieved **VICTORY** (status: WON) twice in a batch of 10 runs! It completely cleared Floor 5 and descended to the victory screen.
- **Analysis**: Implementing the users suggested Kiting strategy was the missing link. By maintaining a distance of 2 tiles and running away while Bash was on cooldown, the bot minimized damage taken. This allowed it to full-clear Floor 1 without dying as often, maximizing XP and Gold to fuel its snowball effect in later floors.
- **Conclusion**: The game is entirely beatable, but the player *must* kite enemies and properly utilize the 2-tile range of Bash. Tanking enemies in melee on Floor 1 is mathematically a losing strategy due to lack of health regeneration.

### Iteration 12 (Smart Out-of-Combat Potion Logic)
- **Outcome**: The bot achieved a **30% Win Rate** (3 WON out of 10 runs) and another 2 runs reached Floor 2 and 3 with 5000 turns (MAX_TURNS). Floor 1 deaths dropped to only 30%.
- **Analysis**: Prior to this, the bot manually drank potions whenever it fell below 50% HP, regardless of the potion size, causing massive overhealing waste. By dynamically calculating the HP deficit out-of-combat and picking the largest potion that would not overheal, the bot conserved valuable healing resources. The high turn count (MAX_TURNS) is a byproduct of the bot playing extremely safely: kiting every single enemy and fully exploring every floor takes hundreds of turns.
- **Conclusion**: Meticulous potion matching dramatically increases survival. The combination of range-2 Bashing, tactical Kiting, full map clearing, and optimal out-of-combat potion selection creates an elite playstyle.

### Iteration 13 (Two-Pass BFS Escape and Descend Fix)
- **Outcome**: The bot maintained a **15% Win Rate** (3 WON out of 20 runs) with an average floor reached of **3.3**! Floor 1 deaths dropped to only 30%, and many runs pushed deep into Floor 5.
- **Analysis**: We resolved the "Walking Punching Bag" loop by adding Rule 3.5, which forces the bot to fight adjacent enemies if it cannot kite them. This prevented it from getting chased and hit in the back while trying to flee. We also corrected the descend condition to allow descending stairs immediately when dying, even if an enemy is adjacent, escaping Floor 1 easily.
- **Conclusion**: The bot is now extremely optimal. It is fully capable of beating DELVE regularly and survives deep into later floors on almost every run unless overwhelmed by late-game combat attrition.

### Iteration 14 (Stable Runner, Resupply, and Floor 5 Win Rush)
- **Outcome**: After fixing the runner exploit, a strict 10-run batch reached **Avg Floor 4.5** with **1 WON** and one external Chromium resource error; a follow-up clean 5-run batch had no harness bugs and averaged **Floor 3.8**. The results are stricter than earlier batches because repeated dying-enemy rewards were removed.
- **Analysis**: The previous playtest runner could send inputs while enemies were in the 320ms death animation. Because dying enemies still lived in `G.enemies`, the bot could repeatedly attack the same corpse, stack XP/gold, and queue extra enemy turns. This inflated progression and also caused fake attrition deaths. Once fixed, Floor 1 mostly stopped being the real issue; late-game deaths now come from being pinned adjacent to Trolls/Demons.
- **New Rules**:
 9. Dying enemies are inert: the engine ignores attacks, Bash targets, movement bumps, and enemy turns for `e.dying`.
 10. The bot treats `hp < 70%` with no carried potion as an exit/resupply state. Known stairs outrank exploration, and affordable shops with useful stock outrank stairs before Floor 5.
 11. If critically hurt in combat, drink a carried potion before taking voluntary combat actions.
 12. On Floor 5, known stairs are the win condition. Stop full-clearing and descend immediately when standing on them.
- **Conclusion**: The bot is now evaluated by a much more honest harness. It reliably reaches late floors, can still win, and the next target is late-game adjacency escape: avoid or break multi-enemy pins before Troll/Demon double-hits drain all potions.

### Iteration 15 (Class-Aware Strategy Profiles)
- **Outcome**: Bot brain regressions and the full test suite passed after consolidating class strategy logic.
- **Analysis**: The bot had two competing strategy schemas, which made class behavior brittle and masked bugs in shop selection, trap caution, and ability usage. Consolidating into one class-aware profile fixed the duplication and let the heuristics line up with real class roles.
- **New Rules**:
  13. Keep one canonical strategy profile per class. It must cover exit HP, combat caution, trap caution, gold reserve, consumable targets, and gear bias.
  14. Ranger bow attacks can target up to 3 tiles away, and Mage Blink must exclude the current tile and only trigger when a real visible safe destination exists.
  15. Shop logic should respect class-specific gold reserves, but still buy high-value upgrades or emergency consumables when the purchase is strategically justified.
  16. Class-weighted gear valuation matters: Warrior should bias DEF, Ranger should bias Perception and mobility, and other classes should lean into their own survivability or offense profile.

### Iteration 16 (Recover Before Combat)
- **Outcome**: On the same deterministic audit seed, low-HP combat-no-healing events dropped from 414 to 140 after tightening recovery behavior for low-health runs.
- **Analysis**: The bot was still willing to keep fighting while wounded, especially for Rogue, Ranger, and Paladin. Making recovery mode strictly prefer items, shops, stairs, and unexplored tiles before enemies cut down the worst low-HP combat loops, but it also increased overclear/timeouts because the bot now spends more turns escaping instead of converting that advantage into a win.
- **New Rules**:
  17. When recovering at low HP, do not target enemies as BFS goals. Prefer items, shops, stairs, and unseen tiles; if none are reachable, fall back to non-combat movement instead of forcing a fight.
  18. Rogue, Ranger, and Paladin should recover earlier than the baseline classes. Their exploration and exit thresholds need to be more conservative than the melee-heavy classes because they lose too many runs while trying to keep tempo at low HP.

### Iteration 16 (Class-Aware Combat, Economy, and Shrine Fixes)
- **Outcome**: `npm test` passed, and a seeded 8-class audit finished cleanly with no timeouts or loader crashes. The audit averaged **Floor 3.8** across one run per class at 5000 turns.
- **Analysis**: The active bot strategy was missing the low-hp combat floor in the live table, detection scroll targeting had drifted, shrine acceptance was comparing the wrong case, and ranger ranged targeting still truncated the bow at 2 tiles. Those bugs made the bot too timid in some places and too blind in others.
- **New Rules**:
  17. Keep the live strategy table complete: exit HP, combat HP floor, exploration threshold, gold reserve, and consumable targets must all exist in the same active scope.
  18. Detection scrolls are strategic exploration tools and should be used when secrets remain.
  19. Shrine types should be normalized before decision logic so overlay text casing does not change acceptance behavior.
  20. Ranger bows should evaluate 3-tile ranged attacks before falling back to movement or kiting.
- **Audit Notes**: The 8-run audit still shows residual pressure, especially **low-hp combat without healing** and a handful of missed buff opportunities, so the next tuning pass should focus on buff usage and escape thresholds rather than basic navigation.

### Iteration 17 (Mage Buff Aggression Fix)
- **Outcome**: Bot regressions and the full test suite still passed after making mage buffs more aggressive and pinning the behavior with a mage-specific strength-buff regression.
- **Analysis**: The audit isolated missed buffs to mage. Raising mage buff willingness fixed that class-specific blind spot without regressing the rest of the roster. The latest audit shows `missedBuff = 0` across all classes.
- **New Rules**:
  21. Mage should treat strength buffs as a real combat tool, not a last resort. If a buff saves attacks against a durable visible threat, use it.
  22. Class exploration thresholds can be tuned independently from combat logic; do not use one class’s routeing needs to justify another class’s clear pattern.
- **Audit Notes**: The latest one-run-per-class audit still shows substantial **low-hp combat without healing** and some **overclearSteps**, especially on mage, barbarian, and rogue. Those are now the next strategic tuning targets.

### Iteration 18 (Consumable Stock and Combat Floor Tuning)
- **Outcome**: `npm test` passed after adding class-specific shop stock regressions and combat-floor healing checks. A small seeded audit improved to **Floor 3.9**, **floor5 12.5%**, and **low-hp combat no healing 160**; the matching headless balance batch reached **Floor 3.8** on average with **floor5 12.5%** and no wins.
- **Analysis**: The bot was still spending upgrades before it had enough escape stock, and some classes were waiting too long to drink potions in live combat. Making shop scores respect class potion/teleport targets and giving each class its own combat potion floor fixed the most obvious escape-stock blind spot without breaking the existing class-specific movement tests.
- **New Rules**:
 23. If a class has not met its potion or teleport target, those consumables should outrank normal upgrades in shops.
 24. Combat potion thresholds are class-specific. Rogue, Ranger, and Paladin should heal earlier than Warrior, while fragile ranged classes should not wait for the global critical-low cutoff.
 25. If a class is out of potions and below its combat floor while enemies are visible, an emergency teleport is a valid escape action.
- **Audit Notes**: The remaining gaps are now mostly late-floor pressure and missed buff opportunities, not basic pathing or shop priority bugs.

### Iteration 19 (Combat Buffs Beat Shop Detours)
- **Outcome**: `npm test` passed, and the same seeded 8-class audit dropped `missedBuff` from 2 to 0. The audit finished at **Floor 3.9** average with **floor5 0%** on this seed, while the win/loss shape stayed unchanged.
- **Analysis**: The remaining buff misses were not a raw strength-gate problem. They came from the bot opening or staying in shops while combat buffs were already the better move, then spending the next step escaping before it could use inventory. The fix was to treat visible-combat strength buffs as a hard shop detour stop and to stop buying shop strength buffs while enemies are already on screen.
- **New Rules**:
 26. If a visible combat buff is valuable, do not open or continue a shop detour for normal upgrades or gear. Use the buff first, then revisit the shop if the fight survives.
 27. Do not buy strength buffs from shops while enemies are already visible. Shop-bought combat buffs are downtime purchases, not emergency combat actions.
- **Audit Notes**: `missedBuff = 0` across all classes on the final one-run-per-class audit. The remaining tuning work is now concentrated in `lowHpCombatNoHealing`, especially for Monk.

### Iteration 20 (Known Stairs Beat Panic Kiting)
- **Outcome**: `npm test` passed, and the seed-9000 headless balance sweep improved to **Floor 3.8** average with no timeouts. The new low-HP stair-escape regression stayed green.
- **Analysis**: The bot was panic-kiting away from a known stair escape when it had no potions, which let visible pressure snowball into avoidable deaths. The fix is narrower than a global stair rush: keep the visible-enemy gate on stair targeting, but let panic mode yield when a known-stairs escape is already available and the player is not adjacent to danger.
- **New Rules**:
 28. Panic kiting must not override a known-stairs escape when the player is out of potions, below the exit threshold, and not adjacent to enemies.
 29. Do not broaden `shouldHeadForStairs()` globally to fix one escape seed; keep the conservative visible-pressure gate and handle emergency exits in the panic path instead.
- **Audit Notes**: The bot still is not winning these samples, but the stair escape no longer regresses the balance sweep and the low-HP no-potion case now behaves predictably.

### Iteration 21 (Rogue and Paladin Commit Earlier)
- **Outcome**: `npm test` passed, and the seed-9000 one-run-per-class audit settled at **Floor 3.0** average with **low-hp combat no healing 152** and no missed heals, teleports, bombs, or buffs.
- **Analysis**: Rogue and paladin were spending too long on cleared floors after stairs were known, which kept them exposed at low HP for too many turns. Lowering their exploration thresholds makes them commit to stairs earlier without changing their combat or shop priorities.
- **New Rules**:
 30. Fragile classes should commit to known stairs earlier once the floor is sufficiently explored; do not keep roaming for marginal value after an escape path is already available.
 31. Route timing should be class-specific. A threshold that is safe for one class can be too greedy for another.
- **Audit Notes**: The remaining pressure is now mostly class-by-class combat survivability, not missed buffs, shrines, or basic shop logic.

### Iteration 22 (Rogue Dash Respects Escape Mode)
- **Outcome**: `npm test` passed after making rogue dash skip escape-mode turns when stairs are already known. The 8-run seed-9000 sweep kept `low-hp combat no healing` at **152** and rogue no longer converts a known escape into a dash follow-up.
- **Analysis**: Rogue was still using `dash` as an aggressive melee follow-up while already in escape mode. That is the wrong priority once the stairs are known and the run has no potions left. The fix suppresses only the rogue dash branch and lets the rest of the decision pipeline pick a real escape action.
- **New Rules**:
 32. Rogue dash should not trigger when `shouldExitWithoutPotion()` is true and the stairs are already known.
 33. Suppressing a risky ability should fall through to the normal movement logic; do not return `null` and stall the turn.
- **Audit Notes**: The bot still has no wins in the seed-9000 sweep, but the rogue escape behavior is safer and the low-HP count did not regress.
