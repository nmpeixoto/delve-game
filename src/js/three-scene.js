// ===================== 3D SCENE MANAGER =====================
// Handles THREE.js scene, camera, lighting, and animation loop for WebGL rendering.

const ThreeScene = {
  // Scene graph root node containing all game objects
  scene: null,

  // PerspectiveCamera with isometric-like positioning (high angle, looking down)
  camera: null,

  // WebGLRenderer attached to the game canvas element
  renderer: null,

  // Directional light for main illumination (simulates torchlight from above)
  directionalLight: null,

  // Ambient light for base visibility in dark dungeon areas
  ambientLight: null,

  // Animation frame ID for requestAnimationFrame loop cancellation
  animationFrameId: null,

  // Track whether renderer is actively running (for pause/resume support)
  isRunning: false,

  /** Group containing all map tile meshes (isolated from lights/scene objects) */
  mapGroup: null,

  /** Cached geometries shared across all tiles (created once, reused) */
  sharedGeos: {},

  /** Cached materials created once and reused across map builds */
  sharedMats: {},

  /** Track enemy state to avoid unnecessary mesh rebuilds */
  _lastEnemyKey: null,

  /** Track ground item state to avoid unnecessary mesh rebuilds */
  _lastItemKey: null,

  /** Bound event handler refs so we can removeEventListener on cleanup */
  _boundHandlers: {
    contextmenu: null,
    mousedown: null,
    mousemove: null,
    mouseup: null,
    wheel: null,
    click: null
  },

  /** Player representation mesh */
  playerMesh: null,

  /** Array of entity meshes (enemies + items) for raycasting and removal */
  entities: [],

  /** Initialize the THREE.js scene, camera, and WebGL renderer. */
  init(canvas) {
    // Dispose any previous WebGL resources before re-initializing
    this.dispose();

    this.scene = new THREE.Scene();

    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);

    // Position camera in isometric-like orientation (high angle, looking down)
    const isoAngle = Math.PI / 4; // 45 degrees elevation
    const isoDistance = 20;
    this.camera.position.set(
      Math.cos(isoAngle) * isoDistance,
      Math.sin(isoAngle) * isoDistance * 1.5,
      Math.sin(isoAngle) * isoDistance
    );

    this.camera.lookAt(new THREE.Vector3(0, 0, 0));

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false
    });

    // Add ambient light for base visibility (dim gray for dungeon atmosphere)
    this.ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(this.ambientLight);

    // Add directional light simulating overhead torchlight
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(10, 20, 10);
    this.scene.add(this.directionalLight);

    // Create isolated group for map geometry (so buildMapFromGrid doesn't clear lights)
    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);

    console.log('[ThreeScene] Initialized: Camera at', this.camera.position);
  },

  /** Clean up all WebGL resources and stop animation loop. */
  dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      this.isRunning = false;
    }
    // Remove all DOM event listeners (prevents leaks on death+restart)
    const canvas = this.renderer ? this.renderer.domElement : null;
    if (canvas) this._removeControlListeners(canvas);
    if (this.renderer) {
      this.renderer.dispose();
    }
    // Dispose shared geometries
    Object.values(this.sharedGeos).forEach(g => { if (g) g.dispose(); });
    this.sharedGeos = {};
    // Dispose shared materials
    Object.values(this.sharedMats).forEach(m => { if (m) m.dispose(); });
    this.sharedMats = {};
    console.log('[ThreeScene] Disposed');
  },

  /** Render a single frame: clear canvas and render scene from current camera perspective. */
  render() {
    if (!this.isRunning || !this.camera) return;

    // Camera position is updated by event handlers in setupCameraControls()
    // (mouse drag rotation, scroll wheel zoom). The render call just draws
    // the scene from whatever position the camera is currently at.
    this.renderer.render(this.scene, this.camera);
  },

  /** Start or resume animation loop with requestAnimationFrame. */
  start() {
    if (this.isRunning) return; // Already running

    const animate = () => {
      this.animationFrameId = requestAnimationFrame(animate);
      this.render();
    };

    this.isRunning = true;
    animate();
    console.log('[ThreeScene] Animation loop started');
  },

  /** Stop animation loop and release frame request. */
  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isRunning = false;
    console.log('[ThreeScene] Animation loop stopped');
  },

  /** Build 3D map geometry from G.map[y][x] tile data. */
  buildMapFromGrid() {
    if (!this.scene) {
      console.warn('[ThreeScene.buildMapFromGrid] Scene not initialized');
      return;
    }

    // Clear existing map meshes from mapGroup (does NOT touch lights/scene objects)
    while (this.mapGroup.children.length > 0) {
      const obj = this.mapGroup.children[0];
      this.mapGroup.remove(obj);
      // InstancedMesh: geometry + material are shared (cached), instance buffers GC.
      // Do NOT call obj.dispose() — Object3D has no dispose() in THREE.js.
      if (obj.geometry && !obj.geometry._shared) obj.geometry.dispose();
      // Materials are cached, don't dispose them here
    }

    // Create shared geometries once (reused across all tiles of same type)
    if (!this.sharedGeos.wall) {
      this.sharedGeos.wall = new THREE.BoxGeometry(1, 2, 1);
      this.sharedGeos.wall._shared = true;
    }
    if (!this.sharedGeos.floor) {
      this.sharedGeos.floor = new THREE.BoxGeometry(1, 0.2, 1);
      this.sharedGeos.floor._shared = true;
    }

    // Create shared materials once (cached)
    if (!this.sharedMats.floor) {
      this.sharedMats.floor = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.8 });
      this.sharedMats.wall  = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, roughness: 0.9 });
      this.sharedMats.stair = new THREE.MeshStandardMaterial({ color: 0x6b4c3e, roughness: 0.7 });
      this.sharedMats.shop  = new THREE.MeshStandardMaterial({ color: 0x8b6914, emissive: 0x2a1f00 });
      this.sharedMats.door  = new THREE.MeshStandardMaterial({ color: 0x5c3d2e, roughness: 0.9 });
    }

    const wGeom = this.sharedGeos.wall;
    const fGeom = this.sharedGeos.floor;

    // Count walls for instancing
    let wallCount = 0;
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        if (G.map[y][x] === TILE.WALL) wallCount++;

    // Use InstancedMesh for walls: single draw call instead of hundreds
    const wallMat = this.sharedMats.wall;
    const instancedWalls = new THREE.InstancedMesh(wGeom, wallMat, wallCount);
    const dummy = new THREE.Object3D();
    let wallIdx = 0;

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tileId = G.map[y][x];

        if (tileId === TILE.WALL) {
          dummy.position.set(x, 1.0, y);
          dummy.updateMatrix();
          instancedWalls.setMatrixAt(wallIdx++, dummy.matrix);

        } else if (tileId === TILE.LOCKED_DOOR || tileId === TILE.SECRET_DOOR) {
          // Doors are individual meshes (few of them, need distinct materials)
          const mat = tileId === TILE.LOCKED_DOOR ? this.sharedMats.door : this.sharedMats.wall;
          const mesh = new THREE.Mesh(wGeom, mat);
          mesh.position.set(x, 1.0, y);
          mesh.userData = { tileType: tileId, gridX: x, gridY: y };
          this.mapGroup.add(mesh);

        } else if (tileId === TILE.FLOOR || tileId === TILE.SHOP) {
          const mat = tileId === TILE.SHOP ? this.sharedMats.shop : this.sharedMats.floor;
          const mesh = new THREE.Mesh(fGeom, mat);
          mesh.position.set(x, 0.1, y);
          mesh.userData = { tileType: tileId, gridX: x, gridY: y };
          this.mapGroup.add(mesh);

        } else if (tileId === TILE.STAIRS) {
          const mesh = new THREE.Mesh(fGeom, this.sharedMats.stair);
          mesh.position.set(x, -0.15, y);
          mesh.userData = { tileType: tileId, gridX: x, gridY: y };
          this.mapGroup.add(mesh);
        }
      }
    }

    instancedWalls.instanceMatrix.needsUpdate = true;
    this.mapGroup.add(instancedWalls);

    console.log(`[ThreeScene] Built map: ${wallCount} instanced walls + tiles from G.map (${MAP_W}x${MAP_H})`);
  },

  /** Update player position based on G.player.x/y from global game state. */
  updatePlayerPosition() {
    if (!this.scene || !G?.player) return; // Guard: scene must exist, player data required

    const { x, y } = G.player;

    // Create player mesh on first call (cylinder geometry as humanoid approximation)
    if (!this.playerMesh) {
      const geometry = new THREE.CylinderGeometry(0.3, 0.3, 1.8, 16);
      const material = new THREE.MeshStandardMaterial({
        color: 0x4a9eff,
        emissive: 0x1a2b5f
      });

      this.playerMesh = new THREE.Mesh(geometry, material);
      this.scene.add(this.playerMesh); // Add to scene graph

      console.log('[ThreeScene] Player mesh created');
    }

    // Player cylinder (height=1.8) sits on floor surface (Y=0.2). Center = 0.2 + 0.9 = 1.1
    this.playerMesh.position.set(x, 1.1, y);
  },

  /** Update enemy positions by syncing sphere meshes with G.enemies array. */
  updateEnemies() {
    if (!this.scene || !G?.enemies) return; // Guard: scene + enemies data required

    // Dirty check: only rebuild if enemy positions/enabled changed (avoids GC churn every frame)
    const stateKey = G.enemies.map(e => `${e.x},${e.y},${e.hp},${e.dying ? 1 : 0}`).join('|');
    if (this._lastEnemyKey === stateKey) return;
    this._lastEnemyKey = stateKey;

    // Remove old enemy meshes (filter out non-enemy entities)
    this.entities = this.entities.filter(entity => {
      if (entity.userData.type === 'enemy') {
        this.scene.remove(entity);
        entity.geometry.dispose();
        entity.material.dispose();
        return false;
      }
      return true; // Keep non-enemy entities
    });

    // Create new enemy meshes from G.enemies data
    G.enemies.forEach(enemy => {
      const geometry = new THREE.SphereGeometry(0.4, 16, 16);

      const material = new THREE.MeshStandardMaterial({
        color: enemy.isElite ? 0xff0000 : 0xff4500, // Red for elite, orange otherwise
        emissive: 0x220000
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Enemy sphere (radius=0.4) sits on floor surface (Y=0.2). Center = 0.2 + 0.4 = 0.6
      mesh.position.set(enemy.x, 0.6, enemy.y);

      // Store metadata for raycasting interaction
      mesh.userData = {
        type: 'enemy',
        enemyId: enemy.id,
        hp: enemy.hp,
        maxHp: enemy.maxHp
      };

      this.scene.add(mesh);
      this.entities.push(mesh);
    });

    console.log(`[ThreeScene] Updated ${G.enemies.length} enemies`);
  },

  /** Update item positions by syncing meshes with G.items array (ground items only). */
  updateItems() {
    if (!this.scene || !G?.items) return; // Guard: scene + items data required

    // Dirty check: only rebuild if ground items changed (avoids GC churn every frame)
    const groundItems = G.items.filter(item => !item.carried);
    const stateKey = groundItems.map(i => `${i.x},${i.y},${i.name}`).join('|');
    if (this._lastItemKey === stateKey) return;
    this._lastItemKey = stateKey;

    // Remove old item meshes (filter out non-item entities)
    this.entities = this.entities.filter(entity => {
      if (entity.userData.type === 'item') {
        this.scene.remove(entity);
        entity.geometry.dispose();
        entity.material.dispose();
        return false;
      }
      return true; // Keep non-item entities
    });

    // Create new item meshes from ground items data
    groundItems.forEach(item => {
      let geometry;

      // Map item symbols to 3D geometries
      switch(item.sym) {
        case '†':  // Dagger
          geometry = new THREE.ConeGeometry(0.1, 0.6, 8);
          break;
        case '⚔':  // Sword/axe
          geometry = new THREE.BoxGeometry(0.1, 0.8, 0.3);
          break;
        case '🏹': // Bow
          geometry = new THREE.TorusGeometry(0.25, 0.05, 8, 12, Math.PI);
          break;
        case '♦':  // Staff/wand
        case '◆':  // Armor
          geometry = new THREE.CylinderGeometry(0.15, 0.25, 0.6, 8);
          break;
        case '!':  // Health potion
        case '🧪': // Buff potion
          geometry = new THREE.SphereGeometry(0.25, 12, 12);
          break;
        case '💍': // Ring/amulet
          geometry = new THREE.TorusGeometry(0.2, 0.05, 8, 12);
          break;
        case '📜': // Scroll
        case '📖': // Book
          geometry = new THREE.BoxGeometry(0.3, 0.05, 0.4);
          break;
        case '💣': // Bomb
          geometry = new THREE.SphereGeometry(0.3, 8, 8);
          break;
        default:
          geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3); // Generic box
      }

      const material = new THREE.MeshStandardMaterial({
        color: item.rarity === 'legendary' ? 0xffd700 : 0x8b4513,
        emissive: item.rarity === 'legendary' ? 0x4a3c00 : 0x2a1f00
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Items sit on floor surface (Y=0.2). Approximate center at 0.4 for varied geometries
      mesh.position.set(item.x, 0.4, item.y);

      // Store metadata for raycasting interaction
      mesh.userData = {
        type: 'item',
        itemId: item.id,
        itemName: item.name
      };

      this.scene.add(mesh);
      this.entities.push(mesh);
    });

    console.log(`[ThreeScene] Updated ${G.items.length} items`);
  },

  /** Update visibility of tiles and entities based on fog of war.
   *  Call this from render() every frame to keep fog-of-war in sync.
   */
  updateVisibility() {
    if (!this.scene || !G?.seen) return;

    // Toggle individual tile meshes based on G.seen (explored tiles visible,
    // unexplored hidden). InstancedMesh walls are always visible as dungeon shell.
    for (let i = 0; i < this.mapGroup.children.length; i++) {
      const child = this.mapGroup.children[i];
      // Skip InstancedMesh walls — we keep them always visible as the dungeon shell
      if (child.isInstancedMesh) continue;
      const ud = child.userData;
      if (ud.gridX !== undefined && ud.gridY !== undefined) {
        const key = ud.gridY * MAP_W + ud.gridX;
        child.visible = G.seen.has(key);
      }
    }

    // Hide enemies behind fog of war
    this.entities.forEach(entity => {
      if (entity.userData.type === 'enemy') {
        const key = Math.round(entity.position.z) * MAP_W + Math.round(entity.position.x);
        entity.visible = G.visible ? G.visible.has(key) : false;
      }
      if (entity.userData.type === 'item') {
        const key = Math.round(entity.position.z) * MAP_W + Math.round(entity.position.x);
        entity.visible = G.visible ? G.visible.has(key) : false;
      }
    });
  },

  /** Setup mouse/touch controls for camera rotation and zoom. */
  setupCameraControls(canvas) {
    if (!this.renderer || !canvas) return; // Guard: renderer must exist

    // Clean up any previous listeners to prevent leaks on death+restart
    this._removeControlListeners(canvas);

    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    // Store refs so removeEventListener works
    this._boundHandlers.contextmenu = (e) => e.preventDefault();
    this._boundHandlers.mousedown = (e) => {
      if (e.button === 2 || e.button === 1) { // Right-click or middle-click
        isDragging = true;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    };
    this._boundHandlers.mousemove = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - previousMousePosition.x;

      // Rotate camera around dungeon center (origin)
      const rotationSpeed = 0.01;
      this.camera.position.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        deltaX * rotationSpeed
      );
      // Re-point camera at dungeon center after position change
      this.camera.lookAt(0, 0, 0);

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };
    this._boundHandlers.mouseup = () => {
      isDragging = false;
    };
    this._boundHandlers.wheel = (e) => {
      e.preventDefault();

      const zoomSpeed = 0.1;
      const newPos = this.camera.position.clone().multiplyScalar(1 + e.deltaY * zoomSpeed * 0.01);
      const distance = newPos.length();

      // Clamp zoom distance between 5 and 80 units from origin
      if (distance >= 5 && distance <= 80) {
        this.camera.position.copy(newPos);
        this.camera.lookAt(0, 0, 0);
      }
    };

    // Prevent right-click context menu on the game canvas
    canvas.addEventListener('contextmenu', this._boundHandlers.contextmenu);
    // Mouse drag for rotation
    canvas.addEventListener('mousedown', this._boundHandlers.mousedown);
    // mouseup/mousemove bound to window to handle out-of-canvas release
    window.addEventListener('mousemove', this._boundHandlers.mousemove);
    window.addEventListener('mouseup', this._boundHandlers.mouseup);
    // Scroll wheel for zoom (clamped)
    canvas.addEventListener('wheel', this._boundHandlers.wheel, { passive: false });

    console.log('[ThreeScene] Camera controls attached');
  },

  /** Remove all previously added mouse/keyboard listeners. */
  _removeControlListeners(canvas) {
    const h = this._boundHandlers;
    if (h.contextmenu) canvas.removeEventListener('contextmenu', h.contextmenu);
    if (h.mousedown) canvas.removeEventListener('mousedown', h.mousedown);
    if (h.mousemove) window.removeEventListener('mousemove', h.mousemove);
    if (h.mouseup) window.removeEventListener('mouseup', h.mouseup);
    if (h.wheel) canvas.removeEventListener('wheel', h.wheel, { passive: false });
    if (h.click) canvas.removeEventListener('click', h.click);
    // Null all refs
    Object.keys(h).forEach(k => { h[k] = null; });
  },

  /** Handle clicks on entities/tiles via raycasting. */
  setupClickHandler(canvas) {
    if (!this.camera || !canvas || typeof THREE === 'undefined') return; // Guard: camera + canvas required

    // Clean up previous click handler to prevent leaks
    if (this._boundHandlers.click) {
      canvas.removeEventListener('click', this._boundHandlers.click);
    }

    this._boundHandlers.click = (e) => {
      // Convert screen coordinates to NDC (-1 to +1)
      const mouse = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      // Check intersections with entity meshes (enemies + items)
      const enemyIntersects = raycaster.intersectObjects(
        this.entities.filter(e => e.userData.type === 'enemy')
      );

      if (enemyIntersects.length > 0) {
        const enemyId = enemyIntersects[0].object.userData.enemyId;
        handleEnemyClick(enemyId); // Existing function from combat.js
        return;
      }

      // Check tile clicks for movement (only intersect map tiles, not lights/scene)
      const tileIntersects = raycaster.intersectObjects(this.mapGroup.children, false);

      if (tileIntersects.length > 0) {
        const point = tileIntersects[0].point;

        // Convert world coordinates back to grid coordinates.
        // Tiles are at unit positions matching grid indices (e.g. grid 5,10 = world 5,z,10).
        // Round to nearest integer and clamp to map bounds.
        const gridX = Math.round(point.x);
        const gridY = Math.round(point.z);

        // Bounds check — ignore clicks outside the map
        if (gridX >= 0 && gridX < MAP_W && gridY >= 0 && gridY < MAP_H) {
          handleTileClick(gridX, gridY);
        }
      }
    };

    canvas.addEventListener('click', this._boundHandlers.click);

    console.log('[ThreeScene] Click handler attached');
  },

  /** Check if WebGL is supported in the current browser. */
  supportsWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  },

  /** Detect headless browser (Puppeteer/Playwright) which can't render WebGL. */
  isHeadlessTest() {
    try {
      return navigator.userAgent.includes('Puppeteer') ||
             navigator.userAgent.includes('Playwright') ||
             navigator.userAgent.includes('HeadlessChrome');
    } catch (e) {
      return true; // If we can't check, assume headless (safe fallback)
    }
  },

  /** Initialize game with WebGL renderer if supported, fallback to legacy. */
  initGame(canvasElement) {
    if (this.supportsWebGL() && !this.isHeadlessTest()) {
      // Use new THREE.js renderer
      this.init(canvasElement);
      console.log('[ThreeScene] Using WebGL renderer');
    } else {
      console.warn('[ThreeScene] WebGL not supported or headless, falling back to legacy renderer');
      return false; // Signal caller that fallback should be used
    }
    return true;
  },

  /** Get the renderer's canvas element for event handling. */
  getCanvas() {
    return this.renderer ? this.renderer.domElement : null;
  },

  /** Reset all scene objects and clear meshes from the scene graph. */
  resetScene() {
    if (!this.scene) return;

    // Remove all children from mapGroup only (preserves lights, camera)
    while (this.mapGroup && this.mapGroup.children.length > 0) {
      const obj = this.mapGroup.children[0];
      this.mapGroup.remove(obj);
      // InstancedMesh: geometry + material are shared (cached), instance buffers GC.
      // Do NOT call obj.dispose() — Object3D has no dispose() in THREE.js.
      // Don't dispose shared geometries/materials — they're cached and reused
      if (obj.geometry && !obj.geometry._shared) obj.geometry.dispose();
    }

    // Remove player mesh from scene
    if (this.playerMesh) {
      this.scene.remove(this.playerMesh);
      if (this.playerMesh.geometry) this.playerMesh.geometry.dispose();
      if (this.playerMesh.material) this.playerMesh.material.dispose();
      this.playerMesh = null;
    }

    // Remove entity meshes from scene
    this.entities.forEach(entity => {
      this.scene.remove(entity);
      if (entity.geometry) entity.geometry.dispose();
      if (entity.material) entity.material.dispose();
    });

    // Clear entity references and state keys
    this.entities = [];
    this._lastEnemyKey = null;
    this._lastItemKey = null;

    console.log('[ThreeScene] Scene reset');
  },

  /** Toggle animation loop on/off. */
  toggle() {
    if (this.isRunning) {
      this.stop();
    } else {
      this.start();
    }
  },

  /** Update camera aspect ratio and renderer size on window resize.
   *  Call from the game's existing handleResize() so 3D viewport stays correct. */
  handleResize() {
    if (!this.camera || !this.renderer) return;
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
};