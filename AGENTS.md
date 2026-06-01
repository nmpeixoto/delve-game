# Agent Guidelines for DELVE

Welcome! You are an AI agent assisting with the development of **DELVE**, a browser-based roguelike dungeon crawler.

Please adhere to the following best practices and architectural constraints when modifying the codebase.

## 1. Architectural Philosophy
- **Zero-Build, Single-File Production**: The core game is intentionally distributed as a single, self-contained HTML file (`dungeon.html`). It must not require Webpack, Vite, Babel, NPM packages, or external frameworks to run. Drop it anywhere, and it works.
- **Modular Development (`src/`)**: Development happens within the `src/` directory where the monolith has been logically split into smaller modules (`constants.js`, `combat.js`, `render.js`, etc.). Ensure you modify the `src/` files during development, and replicate your changes to `dungeon.html` if finalizing a production release.
- **No External Assets**: Sound effects (SFX) are generated procedurally via the Web Audio API. Visual effects (FX) and icons are generated via CSS, emoji, or procedural canvas drawing. Do not add `.mp3`, `.wav`, or massive image spritesheets.

## 2. Technical Standards
- **Global State**: The game state is maintained in a single global object `G` (`window.G`). Treat `G` as the source of truth for saving, loading, and state mutations.
- **Vanilla DOM**: We use Vanilla JS and DOM manipulation (`innerHTML`, `style`, `classList`). No React, Vue, or jQuery. Keep DOM updates efficient (e.g., only update the HUD when necessary).
- **Responsive Design**: DELVE is a Mobile-First PWA. Always test your CSS and UI logic to ensure it works on narrow portrait viewports and small landscape devices. The layout relies heavily on CSS Grid and Flexbox.

## 3. PWA Capabilities
- Ensure any new static assets are properly registered in the `sw.js` (Service Worker) cache array so offline functionality remains intact.
- Follow PWA best practices defined in `manifest.json`.

## 4. Skills & Tooling
- The project includes automated playtesting via Puppeteer (`scripts/autoplay_test.js` and `bot_brain.js`) and a faithful headless balance runner (`skills/headless-balance/scripts/headless_balance.js`) for seeded class-load sweeps.
- If you change core gameplay mechanics, you should run the automated tests to ensure no regressions occur.
- You can use the `play-delve-and-learn` skill to iterate on the bot's heuristic logic.
- Use the `headless-balance` skill for class balancing work, seeded batch comparisons, and load-testing multiple classes without Chromium. Prefer it when you want throughput; use Puppeteer autoplay when you need browser/runtime parity checks or UI interaction verification.
- When running parallel balance batches, launch one process per class and write each report to its own file.
- For bot or combat changes, prefer adding focused tests in `tests/bot_brain_test.js` or `tests/combat_test.js` before tuning heuristics. Run `npm test` for those regression tests.
- Use `node scripts/browser_smoke.js` as a browser smoke test for both `src/index.html` and `dungeon.html` when UI/game runtime behavior changes.

## 5. Test Artifacts & Cleanup
- Treat playtest outputs as temporary unless the user explicitly asks to keep them.
- Clean up generated artifacts before your final response, especially `bot_findings.json`, `screenshot_*.png`, ad-hoc trace logs, and one-off diagnostic files.
- If a generated artifact is useful for debugging, summarize the relevant evidence in your response or in `lessons_learned.md`, then remove the file.
- Do not leave local servers, background browser sessions, or temporary scripts running after verification.

## 6. Coding Style
- Prefer concise, modern ES6+ syntax (arrow functions, destructuring, template literals).
- Do not remove existing comments unless the associated code is removed.
- Keep CSS clean and namespaced if possible (e.g., `.tile-player`, `.act-btn`).
