// ===================== PIXED ANIMATION STATE =====================
const PIXED_ROOT = typeof globalThis !== 'undefined' ? globalThis : this;
var PIXED_ANIM = PIXED_ROOT.PIXED_ANIM || {
  entities: {},
  fx: [],
  nextFxId: 1,
};
PIXED_ROOT.PIXED_ANIM = PIXED_ANIM;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function setEntityAnimation(key, name, durationMs = 180) {
  PIXED_ANIM.entities[key] = {
    name,
    startedAt: nowMs(),
    durationMs,
  };
}

function getEntityAnimation(key) {
  return PIXED_ANIM.entities[key] || null;
}

function spawnPixedFx({ key, x, y, color = '#ffffff', text = '', durationMs = 500 }) {
  const id = `fx-${PIXED_ANIM.nextFxId++}`;
  PIXED_ANIM.fx.push({ id, key, x, y, color, text, startedAt: nowMs(), durationMs });
  return id;
}

function advanceAnimations(time = nowMs()) {
  Object.keys(PIXED_ANIM.entities).forEach(key => {
    const anim = PIXED_ANIM.entities[key];
    if (time - anim.startedAt >= anim.durationMs) delete PIXED_ANIM.entities[key];
  });
  PIXED_ANIM.fx = PIXED_ANIM.fx.filter(fx => time - fx.startedAt < fx.durationMs);
}

PIXED_ROOT.setEntityAnimation = setEntityAnimation;
PIXED_ROOT.getEntityAnimation = getEntityAnimation;
PIXED_ROOT.spawnPixedFx = spawnPixedFx;
PIXED_ROOT.advanceAnimations = advanceAnimations;
