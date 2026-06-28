const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'src', 'assets', 'pixed');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([len, name, data, crc]);
}

function writePng(filePath, width, height, pixels) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }
  fs.writeFileSync(filePath, Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function rgba(hex, alpha = 255) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
    alpha,
  ];
}

function makeCanvas(width, height) {
  return new Uint8Array(width * height * 4);
}

function rect(pixels, width, x, y, w, h, color) {
  for (let yy = Math.max(0, y); yy < y + h; yy++) {
    for (let xx = Math.max(0, x); xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= width) continue;
      const idx = (yy * width + xx) * 4;
      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
    }
  }
}

function diamond(pixels, width, height, cx, cy, rx, ry, color) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const d = Math.abs(x - cx) / rx + Math.abs(y - cy) / ry;
      if (d <= 1) {
        const idx = (y * width + x) * 4;
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = color[3];
      }
    }
  }
}

function writeTile(name, draw) {
  const width = 64;
  const height = 64;
  const pixels = makeCanvas(width, height);
  draw(pixels, width, height);
  writePng(path.join(outDir, `${name}.png`), width, height, pixels);
  return { src: `${name}.png`, frameWidth: width, frameHeight: height, frames: 1, anchorX: 32, anchorY: 48 };
}

function writeStrip(name, palette, frames = 5) {
  const frameWidth = 64;
  const frameHeight = 64;
  const pixels = makeCanvas(frameWidth * frames, frameHeight);
  for (let frame = 0; frame < frames; frame++) {
    const ox = frame * frameWidth;
    const bob = frame % 2;
    rect(pixels, frameWidth * frames, ox + 28, 20 + bob, 8, 8, rgba(palette.light));
    rect(pixels, frameWidth * frames, ox + 24, 28 + bob, 16, 20, rgba(palette.mid));
    rect(pixels, frameWidth * frames, ox + 20 + frame, 34 + bob, 8, 20, rgba(palette.dark));
    rect(pixels, frameWidth * frames, ox + 38 - frame, 34 + bob, 8, 20, rgba(palette.dark));
    rect(pixels, frameWidth * frames, ox + 26, 48, 5, 10, rgba('#151015'));
    rect(pixels, frameWidth * frames, ox + 35, 48, 5, 10, rgba('#151015'));
    rect(pixels, frameWidth * frames, ox + 30, 24 + bob, 2, 2, rgba('#f6e6b8'));
    rect(pixels, frameWidth * frames, ox + 35, 24 + bob, 2, 2, rgba('#f6e6b8'));
  }
  writePng(path.join(outDir, `${name}.png`), frameWidth * frames, frameHeight, pixels);
  return { src: `${name}.png`, frameWidth, frameHeight, frames, anchorX: 32, anchorY: 58 };
}

const classPalettes = {
  warrior: { light: '#d7b46a', mid: '#6b7280', dark: '#374151' },
  rogue: { light: '#a3a3a3', mid: '#27272a', dark: '#111827' },
  mage: { light: '#93c5fd', mid: '#4338ca', dark: '#1e1b4b' },
  paladin: { light: '#fde68a', mid: '#d6d3d1', dark: '#92400e' },
  ranger: { light: '#bbf7d0', mid: '#166534', dark: '#14532d' },
  barbarian: { light: '#fca5a5', mid: '#7f1d1d', dark: '#451a03' },
  necromancer: { light: '#c4b5fd', mid: '#312e81', dark: '#111827' },
  monk: { light: '#fed7aa', mid: '#9a3412', dark: '#431407' },
};

const enemyPalettes = {
  rat: { light: '#d6d3d1', mid: '#78716c', dark: '#292524' },
  goblin: { light: '#bef264', mid: '#4d7c0f', dark: '#1a2e05' },
  skeleton: { light: '#f8fafc', mid: '#cbd5e1', dark: '#64748b' },
  bones: { light: '#e2e8f0', mid: '#94a3b8', dark: '#475569' },
  orc: { light: '#a3e635', mid: '#365314', dark: '#1a2e05' },
  troll: { light: '#67e8f9', mid: '#0e7490', dark: '#164e63' },
  demon: { light: '#fb7185', mid: '#b91c1c', dark: '#450a0a' },
  lich: { light: '#ddd6fe', mid: '#7c3aed', dark: '#2e1065' },
  dungeonLord: { light: '#fecaca', mid: '#991b1b', dark: '#1f0303' },
};

function main() {
  ensureDir(outDir);
  const manifest = {};
  manifest['environment.floor'] = writeTile('environment_floor', (p, w, h) => diamond(p, w, h, 32, 32, 30, 15, rgba('#252634')));
  manifest['environment.floorCracked'] = writeTile('environment_floor_cracked', (p, w, h) => {
    diamond(p, w, h, 32, 32, 30, 15, rgba('#252634'));
    rect(p, w, 24, 31, 18, 2, rgba('#101018'));
  });
  manifest['environment.wall'] = writeTile('environment_wall', (p, w, h) => {
    diamond(p, w, h, 32, 40, 30, 15, rgba('#171923'));
    rect(p, w, 12, 8, 40, 32, rgba('#303346'));
    rect(p, w, 16, 12, 32, 6, rgba('#484b63'));
  });
  manifest['environment.doorLocked'] = writeTile('environment_door_locked', (p, w, h) => { rect(p, w, 22, 14, 20, 34, rgba('#5b3717')); rect(p, w, 30, 28, 5, 5, rgba('#d7b46a')); });
  manifest['environment.doorSecret'] = writeTile('environment_door_secret', (p, w, h) => { rect(p, w, 16, 10, 32, 38, rgba('#252634')); rect(p, w, 26, 25, 12, 2, rgba('#4b5563')); });
  manifest['environment.stairs'] = writeTile('environment_stairs', (p, w, h) => { diamond(p, w, h, 32, 38, 28, 14, rgba('#1f2937')); rect(p, w, 20, 30, 24, 3, rgba('#86efac')); rect(p, w, 24, 36, 20, 3, rgba('#4ade80')); });
  manifest['environment.shop'] = writeTile('environment_shop', (p, w, h) => { rect(p, w, 12, 24, 40, 22, rgba('#5b3717')); rect(p, w, 16, 15, 32, 10, rgba('#d7b46a')); rect(p, w, 28, 18, 8, 18, rgba('#27272a')); });
  manifest['environment.shrine'] = writeTile('environment_shrine', (p, w, h) => { rect(p, w, 20, 34, 24, 12, rgba('#4b5563')); rect(p, w, 26, 14, 12, 22, rgba('#7c3aed')); rect(p, w, 30, 8, 4, 8, rgba('#ddd6fe')); });
  manifest['environment.trapSpike'] = writeTile('environment_trap_spike', (p, w, h) => { diamond(p, w, h, 32, 38, 22, 10, rgba('#252634')); rect(p, w, 28, 28, 4, 14, rgba('#d1d5db')); rect(p, w, 36, 30, 4, 12, rgba('#d1d5db')); });
  manifest['environment.trapGas'] = writeTile('environment_trap_gas', (p, w, h) => { diamond(p, w, h, 32, 38, 22, 10, rgba('#14532d')); rect(p, w, 20, 24, 24, 14, rgba('#86efac', 160)); });
  manifest['environment.trapAlarm'] = writeTile('environment_trap_alarm', (p, w, h) => { diamond(p, w, h, 32, 38, 22, 10, rgba('#7f1d1d')); rect(p, w, 28, 20, 8, 20, rgba('#ef4444')); });
  manifest['environment.trapBear'] = writeTile('environment_trap_bear', (p, w, h) => { diamond(p, w, h, 32, 38, 22, 10, rgba('#292524')); rect(p, w, 20, 30, 24, 4, rgba('#d1d5db')); });

  ['weapon', 'armor', 'potion', 'bomb', 'scroll', 'key', 'upgrade'].forEach((name, index) => {
    const colors = ['#d1d5db', '#94a3b8', '#ef4444', '#111827', '#f8fafc', '#d7b46a', '#c084fc'];
    manifest[`item.${name}`] = writeTile(`item_${name}`, (p, w) => rect(p, w, 24, 24, 16, 22, rgba(colors[index])));
  });

  ['hp', 'xp', 'gold'].forEach((name, index) => {
    const colors = ['#ef4444', '#60a5fa', '#d7b46a'];
    manifest[`ui.${name}`] = writeTile(`ui_${name}`, (p, w) => rect(p, w, 18, 18, 28, 28, rgba(colors[index])));
  });

  ['hit', 'fireball', 'heal', 'poison', 'levelUp'].forEach((name, index) => {
    const colors = ['#f87171', '#fb923c', '#4ade80', '#a855f7', '#fbbf24'];
    manifest[`fx.${name}`] = writeStrip(`fx_${name}`, { light: '#ffffff', mid: colors[index], dark: '#111827' }, 4);
  });

  for (const [cls, palette] of Object.entries(classPalettes)) {
    for (const anim of ['idle', 'walk', 'attack', 'hurt', 'death']) manifest[`class.${cls}.${anim}`] = writeStrip(`class_${cls}_${anim}`, palette, 5);
  }

  for (const [enemy, palette] of Object.entries(enemyPalettes)) {
    for (const anim of ['idle', 'move', 'attack', 'hurt', 'death']) manifest[`enemy.${enemy}.${anim}`] = writeStrip(`enemy_${enemy}_${anim}`, palette, 5);
  }

  fs.writeFileSync(path.join(outDir, 'pixed_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Generated ${Object.keys(manifest).length} pixed assets in ${outDir}`);
}

main();
