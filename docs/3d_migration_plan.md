# 3D Migration Plan for DELVE

## Executive Summary

This plan converts the current isometric Canvas 2D renderer to a WebGL-based 3D system using THREE.js, while maintaining the existing isometric visual aesthetic. The game will support camera rotation around the dungeon, allowing players to view the map from any angle.

**Key Decision**: Use THREE.js CDN dependency (simpler API, zero build step)  
**Scope**: Main viewport only — keep DOM-based HUD/minimap intact  
**Height Data**: Add height values per tile type for visual variety

---

## Phase 0: Prerequisites & Dependencies

### 0.1 Add THREE.js Dependency
```html
<!-- In src/index.html <head> -->
<script src="https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js"></script>
```

**Validation**: THREE.js v0.160.0 is stable, ~200KB gzipped, supports all modern browsers. No build step required — works with your "drop and run" philosophy.

### 0.2 Add Height Data to Constants
In `src/constants.js`, extend the TILE object:
```javascript
const TILE = {
  FLOOR: { id: 0, height: 0.0 },
  WALL:  { id: 1, height: 1.0 },
  STAIRS_DOWN:   { id: 2, height: -1.0 },
  SHOP:          { id: 3, height: 0.0 },
  LOCKED_DOOR:   { id: 4, height: 1.0 },
  SECRET_DOOR:   { id: 5, height: 1.0 },
  TRAP_SPIKE:    { id: 6, height: 0.2 }
};
```

**Rationale**: Height values enable proper 3D geometry. Stairs descend, walls rise. This is purely additive — existing `G.map[y][x]` tile IDs remain unchanged.

---

## Phase 1: New Module Creation — `src/js/three-scene.js`

### 1.1 Scene Initialization
```javascript
const ThreeScene = {
  scene: null,      // THREE.Scene
  camera: null,      // THREE.PerspectiveCamera
  renderer: null,    // THREE.WebGLRenderer
  mapGroup: null,    // Group containing all map tiles
  entityMeshes: [],  // Array of mesh references for entities
  
  // Camera controls
  rotationSpeed: 0.5,
  zoomLevel: 1.0,
  
  init(canvasElement) {
    // Setup THREE.js scene, camera, renderer attached to canvas
    // Initialize lighting (ambient + directional for dungeon atmosphere)
  },
  
  dispose() {
    // Cleanup WebGL context on navigation away from game
  }
}
```

**Critical**: This module manages the entire THREE.js lifecycle. All 3D rendering happens here.

### 1.2 Map Geometry Generation
Create a function that converts `G.map[y][x]` into THREE.js meshes:

```javascript
function buildMapGeometry() {
  const geometry = new THREE.BoxGeometry(1, 1, 1); // Unit cube
  
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const tileType = G.map[y][x];
      
      if (tileType === TILE.FLOOR.id) {
        // Flat floor plane
        addMesh(x, 0, y, geometry, floorMaterial);
      } else if ([TILE.WALL.id, TILE.LOCKED_DOOR.id, TILE.SECRET_DOOR.id].includes(tileType)) {
        // Raised wall (height=1)
        addMesh(x, 0.5, y, scaledGeometry(1, 2, 1), wallMaterial);
      } else if (tileType === TILE.STAIRS_DOWN.id) {
        // Depressed stairs (height=-1)
        addMesh(x, -0.5, y, scaledGeometry(1, 0.5, 1), stairMaterial);
      }
    }
  }
}

function addMesh(gridX, heightY, gridZ, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(gridX, heightY, gridZ);
  
  // Store metadata for entity placement
  mesh.userData = { tileType: G.map[gridZ][gridX] };
  
  ThreeScene.mapGroup.add(mesh);
}
```

**Validation Check**: 
- Current `G.map[y][x]` uses TILE constants — we're mapping these to heights, not changing the data structure
- BoxGeometry with scaling is efficient — single geometry reused for all walls/floors
- Mesh userData stores tile type for entity collision checks

### 1.3 Material System
```javascript
const materials = {
  floor: new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 }),
  wall: new THREE.MeshStandardMaterial({ color: 0x2d2d2d, roughness: 0.9 }),
  stairs: new THREE.MeshStandardMaterial({ color: 0x6b4c3e, roughness: 0.7 }),
  shop: new THREE.MeshStandardMaterial({ color: 0x8b6914, emissive: 0x2a1f00 })
};
```

**Note**: Colors chosen to match existing isometric palette (dark dungeon aesthetic). Can be updated later for visual polish.

---

## Phase 2: Entity Rendering Migration

### 2.1 Player Representation
Replace DOM-based player tile with a THREE.js mesh:
```javascript
function updatePlayerPosition() {
  if (!ThreeScene.playerMesh) {
    const geometry = new THREE.CylinderGeometry(0.3, 0.3, 1.8, 16); // Humanoid approximation
    const material = new THREE.MeshStandardMaterial({ color: 0x4a9eff });
    ThreeScene.playerMesh = new THREE.Mesh(geometry, material);
    ThreeScene.scene.add(ThreeScene.playerMesh);
  }
  
  const { x, y } = G.player;
  ThreeScene.playerMesh.position.set(x, 1.0, y); // Standing on floor (height=0 + player height)
}
```

**Critical**: Player position updates every frame. Use `G.player.x/y` from global state — no changes to game logic needed.

### 2.2 Enemy Rendering
Migrate enemy DOM elements to THREE.js meshes:
```javascript
function updateEnemies() {
  // Remove old enemy meshes
  ThreeScene.enemies.forEach(mesh => {
    ThreeScene.scene.remove(mesh);
  });
  ThreeScene.enemies = [];
  
  G.enemies.forEach(enemy => {
    const geometry = new THREE.SphereGeometry(0.4, 16, 16); // Simple orb representation
    const material = new THREE.MeshStandardMaterial({ 
      color: enemy.isElite ? 0xff0000 : 0xff4500, // Red for elite, orange otherwise
      emissive: 0x220000
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(enemy.x, 1.5, enemy.y); // Floating slightly above ground
    
    // Store enemy reference for click handling
    mesh.userData = { enemyId: enemy.id };
    
    ThreeScene.scene.add(mesh);
    ThreeScene.enemies.push(mesh);
  });
}
```

**Validation**: Enemy data structure `{ id, x, y, hp, ... }` already exists. We're just adding a visual representation layer — game logic unchanged.

### 2.3 Item Rendering
```javascript
function updateItems() {
  // Similar pattern: iterate G.items, create mesh per item
  // Use different geometries based on item type (sword, potion, etc.)
}
```

---

## Phase 3: Camera System with Rotation

### 3.1 Isometric-to-3D Camera Transition
The current `createIsoCamera()` in iso.js creates a 2D offset camera. We need to replace this with THREE.PerspectiveCamera:

```javascript
function setupCamera() {
  const aspect = canvas.clientWidth / canvas.clientHeight;
  ThreeScene.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
  
  // Start in isometric-like position (high angle, looking down)
  const isoAngle = Math.PI / 4; // 45 degrees
  const isoDistance = 20;
  
  ThreeScene.camera.position.set(
    Math.cos(isoAngle) * isoDistance,
    Math.sin(isoAngle) * isoDistance * 1.5, // Higher Y for top-down view
    Math.sin(isoAngle) * isoDistance
  );
  
  ThreeScene.camera.lookAt(0, 0, 0); // Look at dungeon center
}
```

### 3.2 Camera Controls (Mouse/Touch Rotation)
```javascript
function setupCameraControls() {
  let isDragging = false;
  let previousMousePosition = { x: 0, y: 0 };
  
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.button === 1) { // Right-click or middle-click
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    }
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;
    
    // Rotate around dungeon center
    const rotationSpeed = 0.005;
    ThreeScene.scene.rotation.y += deltaX * rotationSpeed;
    
    // Vertical tilt (optional — can be disabled for strict isometric feel)
    // camera.position.y += deltaY * 0.1;
    
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });
  
  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });
  
  // Zoom with scroll wheel
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    ThreeScene.zoomLevel += e.deltaY * 0.001;
    ThreeScene.zoomLevel = Math.max(0.5, Math.min(3.0, ThreeScene.zoomLevel));
  });
}
```

**Validation**: Mouse/keyboard controls don't conflict with existing movement keys (WASD/arrows for player movement). Right-click drag is standard for camera rotation in 3D viewers.

### 3.3 Render Loop Integration
Replace the current `render()` function's map rendering:
```javascript
function renderLoop() {
  // Update entity positions (player, enemies, items)
  updatePlayerPosition();
  updateEnemies();
  updateItems();
  
  // Render THREE.js scene
  ThreeScene.renderer.render(ThreeScene.scene, ThreeScene.camera);
  
  requestAnimationFrame(renderLoop);
}
```

**Critical**: This runs alongside existing HUD updates — the DOM-based UI remains unchanged. Only the map viewport switches to WebGL.

---

## Phase 4: Interaction Layer Updates

### 4.1 Entity Click Handling
Currently, clicks on tiles trigger movement/attacks. With 3D rendering, we need raycasting:

```javascript
function setupEntityClicks() {
  canvas.addEventListener('click', (e) => {
    if (!ThreeScene.camera) return; // Not yet initialized
    
    const mouse = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, ThreeScene.camera);
    
    // Check intersections with entity meshes
    const intersects = raycaster.intersectObjects(ThreeScene.enemies);
    if (intersects.length > 0) {
      const enemyId = intersects[0].object.userData.enemyId;
      handleEnemyClick(enemyId);
      return;
    }
    
    // Check tile clicks for movement
    const tileIntersects = raycaster.intersectObjects(ThreeScene.mapGroup.children, true);
    if (tileIntersects.length > 0) {
      const point = tileIntersects[0].point;
      const gridPos = worldToGrid(point.x, point.z); // Convert world → grid coords
      handleTileClick(gridPos.x, gridPos.y);
    }
  });
}

function worldToGrid(worldX, worldZ) {
  // Approximate conversion (exact math depends on camera angle)
  const tileCount = Math.floor(worldX + MAP_W / 2);
  return { x: tileCount, y: tileCount }; // Simplified — refine based on actual projection
}
```

**Validation**: Existing `handleTileClick(x, y)` and `handleEnemyClick(id)` functions remain unchanged. We're just bridging screen coordinates → grid coordinates via raycasting instead of DOM event positioning.

### 4.2 Minimap Compatibility
The minimap (`drawMinimap()` in render.js) uses Canvas 2D — leave it untouched. It reads `G.map[y][x]` directly for its 2×2 pixel representation.

**Rationale**: No need to migrate minimap to 3D — it's already a functional top-down overview.

---

## Phase 5: Transition & Fallback Strategy

### 5.1 Feature Detection
```javascript
function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && 
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}
```

### 5.2 Fallback to Legacy Renderer
```javascript
function initGame(canvasElement) {
  if (supportsWebGL() && !isHeadlessTest()) {
    // Use new THREE.js renderer
    ThreeScene.init(canvasElement);
  } else {
    // Fall back to existing Canvas 2D or DOM-based rendering
    console.warn('[DELVE] WebGL not supported, falling back to legacy renderer');
    renderLegacyMap(true);
  }
}

function isHeadlessTest() {
  return navigator.userAgent.includes('Puppeteer') || 
         navigator.userAgent.includes('Playwright');
}
```

**Validation Check**: Existing tests (`scripts/autoplay_test.js`, `automation/headless-balance/`) run headless — they need the legacy renderer. Our fallback ensures no test regressions.

---

## Phase 6: Performance Optimizations

### 6.1 Instanced Meshes for Repetitive Geometry
```javascript
// Instead of creating individual meshes per wall tile, use instancing
function buildInstancedWalls() {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x2d2d2d });
  
  const meshCount = MAP_W * MAP_H; // Worst case all walls
  const instancedMesh = new THREE.InstancedMesh(geometry, material, meshCount);
  
  let index = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (G.map[y][x] === TILE.WALL.id) {
        const matrix = new THREE.Matrix4();
        matrix.setPosition(x, 1.0, y); // Wall at height=1
        instancedMesh.setMatrixAt(index++, matrix);
      }
    }
  }
  
  ThreeScene.scene.add(instancedMesh);
}
```

**Performance Impact**: Reduces draw calls from O(n) to O(1) for walls — critical for large dungeons (e.g., 50×50 = 2500 tiles).

### 6.2 Frustum Culling (Default THREE.js Behavior)
Three.js automatically culls objects outside the camera frustum — no action needed. Verify by checking `mesh.visible` after rotation.

---

## Phase 7: Testing & Validation Checklist

### Unit Tests (`tests/three_scene_test.js`)
```javascript
describe('ThreeScene', () => {
  test('initializes without crashing in headless environment', () => {
    // Test that init() doesn't throw when WebGL unavailable
  });
  
  test('buildMapGeometry creates correct mesh count', () => {
    // Verify mesh count matches tile counts from G.map
  });
  
  test('camera rotation updates scene.rotation.y correctly', () => {
    // Mock mouse events, verify camera position changes
  });
});
```

### Browser Smoke Test (`scripts/browser_smoke.js`)
Run existing smoke tests against `src/index.html` with new renderer enabled. Verify:
- Game loads without WebGL errors in console
- Player movement still works (WASD/arrows)
- Combat triggers correctly (click enemies)
- HUD updates persist alongside 3D viewport

### Performance Benchmarks
Measure before/after:
- FPS at steady-state (no camera rotation)
- FPS during rapid camera rotation
- Memory usage with 50×50 dungeon + 20+ entities
- Load time for initial mesh generation

---

## Phase 8: Rollout & Migration Path

### Step-by-Step Implementation Order

1. **Create `src/js/three-scene.js`** — Empty shell, export interface
2. **Add THREE.js CDN to `src/index.html`** — In `<head>`
3. **Implement `ThreeScene.init()`** — Setup scene, camera, renderer
4. **Implement `buildMapGeometry()`** — Convert G.map → THREE meshes
5. **Add height data to `src/constants.js`** — Extend TILE object
6. **Migrate player rendering** — Replace DOM tile with cylinder mesh
7. **Migrate enemy rendering** — Replace sprite placeholders with sphere meshes
8. **Implement camera rotation controls** — Mouse drag + scroll zoom
9. **Add raycasting for entity clicks** — Bridge screen → grid coords
10. **Update `render()` loop** — Call ThreeScene.renderer.render() instead of Canvas 2D draw calls
11. **Add fallback logic** — Check WebGL support, use legacy renderer if unavailable
12. **Write tests** — Unit + integration tests for new renderer
13. **Run smoke tests** — Verify no regressions in game logic

### Rollout Timeline Estimate
| Phase | Estimated Effort | Risk Level |
|-------|------------------|------------|
| Prerequisites (THREE.js CDN, height constants) | 30 min | Low |
| Scene initialization + map geometry | 2-3 hours | Medium — mesh generation bugs likely |
| Entity rendering migration | 2 hours | Low — straightforward mesh creation |
| Camera controls | 1-2 hours | Medium — interaction conflicts possible |
| Raycasting bridge | 1 hour | Low — math validation needed |
| Fallback + testing | 1 hour | Low |

**Total Estimated Effort**: 8-10 hours of implementation + 2-3 hours testing

---

## Critical Risks & Mitigations

### Risk 1: Performance Degradation on Mobile
**Problem**: WebGL rendering + many entities could tank FPS on low-end devices.  
**Mitigation**: 
- Use instanced meshes for walls/floors (Phase 6)
- Limit visible entities via frustum culling (default THREE.js behavior)
- Add performance monitor in dev mode to detect bottlenecks

### Risk 2: Camera Rotation Conflicts with Touch Controls
**Problem**: Mobile touch gestures (swipe to move, tap to attack) might conflict with camera rotation.  
**Mitigation**: 
- Reserve right-click/middle-click for camera rotation on desktop
- Use pinch-to-zoom on mobile instead of scroll wheel
- Add toggle in settings: "Enable Camera Rotation" (default OFF — keeps isometric feel)

### Risk 3: Existing DOM Event Handlers Break
**Problem**: Current `tile-player`, `tile-enemy` click handlers rely on DOM event propagation. With WebGL canvas, clicks go to the canvas element directly.  
**Mitigation**: 
- Remove all tile-specific onclick/onmouseenter handlers
- Replace with unified raycasting-based click handler in three-scene.js
- Validate by testing: movement, attacks, item pickups all still trigger correctly

### Risk 4: THREE.js CDN Availability
**Problem**: If user has no internet access, CDN won't load.  
**Mitigation**: 
- Bundle THREE.js minified into `src/lib/three.min.js` (optional — ~200KB)
- Or use fallback to legacy Canvas 2D renderer when CDN unavailable

### Risk 5: Height Data Backwards Compatibility
**Problem**: Existing save files/JSON data structures don't include height values.  
**Mitigation**: 
- Default height=0 for unknown tile types (graceful degradation)
- Migration script in `scripts/migrate_save_files.js` to add heights on load

---

## Post-Migration Checklist

Once 3D rendering is complete:

1. ✅ Update `dungeon.html` to include THREE.js CDN + new renderer integration
2. ✅ Verify `sw.js` caches THREE.js CDN (or bundle it)
3. ✅ Run `npm test` — ensure no regressions in combat, movement, save/load logic
4. ✅ Run `scripts/browser_smoke.js` — validate UI still functional alongside 3D viewport
5. ✅ Document new controls: "Right-click drag to rotate camera, scroll wheel to zoom"
6. ✅ Add settings toggle for camera rotation (can be disabled)

---

## Alternative Approaches Considered & Rejected

### Approach A: Raw WebGL (No Dependencies)
**Pros**: Zero external dependencies  
**Cons**: 10x more boilerplate code, matrix math complexity, longer implementation time  
**Verdict**: Rejected — THREE.js simplifies dramatically with negligible network cost

### Approach B: CSS 3D Transforms
**Pros**: No WebGL required, works in all modern browsers  
**Cons**: Limited to box/cube geometries, poor performance with many entities, no smooth rotation  
**Verdict**: Rejected — insufficient flexibility for a roguelike with complex terrain

### Approach C: Babylon.js or PlayCanvas
**Pros**: Game-engine features (physics, animations)  
**Cons**: Heavier (~500KB+), steeper learning curve  
**Verdict**: Rejected — THREE.js is lighter and sufficient for static dungeon rendering

---

## Conclusion

This plan converts DELVE from a 2.5D isometric renderer to a full 3D WebGL experience while:
- Maintaining existing game logic (G.map, G.player, G.enemies structures unchanged)
- Preserving DOM-based HUD/minimap functionality
- Adding camera rotation as an optional feature (can be disabled)
- Fallback to legacy Canvas 2D renderer if WebGL unavailable

The migration is incremental — you can test each phase independently before committing to the next. Estimated effort: **8-10 hours implementation + 2-3 hours testing**.
