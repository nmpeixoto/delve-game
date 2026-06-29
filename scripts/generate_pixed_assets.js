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

function pixel(pixels, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 4;
  pixels[idx] = color[0];
  pixels[idx + 1] = color[1];
  pixels[idx + 2] = color[2];
  pixels[idx + 3] = color[3];
}

function line(pixels, width, height, x0, y0, x1, y1, color, thickness = 1) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let err = dx + dy;
  const radius = Math.max(0, Math.floor((thickness - 1) / 2));
  for (;;) {
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) pixel(pixels, width, height, x + ox, y + oy, color);
    }
    if (x === endX && y === endY) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
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

function drawIsoBase(pixels, width, height, cx = 32, cy = 48, glow = '#fbbf24') {
  diamond(pixels, width, height, cx, cy + 3, 22, 8, rgba('#050507', 190));
  diamond(pixels, width, height, cx, cy, 18, 7, rgba(glow, 56));
  diamond(pixels, width, height, cx, cy + 1, 14, 5, rgba('#2b211b', 230));
  line(pixels, width, height, cx - 13, cy, cx, cy - 5, rgba('#6f5430', 180));
  line(pixels, width, height, cx, cy - 5, cx + 13, cy, rgba('#120d0c', 190));
}

function drawItemWeapon(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 49, '#fb923c');
  line(pixels, width, height, 25, 42, 39, 20, rgba('#eef2ff'), 3);
  line(pixels, width, height, 27, 42, 41, 20, rgba('#64748b'), 1);
  line(pixels, width, height, 22, 43, 31, 47, rgba('#d7b46a'), 3);
  rect(pixels, width, 19, 44, 5, 5, rgba('#5b3717'));
  pixel(pixels, width, height, 41, 18, rgba('#f8fafc'));
  pixel(pixels, width, height, 43, 16, rgba('#fbbf24'));
}

function drawItemArmor(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 50, '#60a5fa');
  rect(pixels, width, 24, 24, 16, 19, rgba('#334155'));
  rect(pixels, width, 20, 27, 7, 9, rgba('#475569'));
  rect(pixels, width, 37, 27, 7, 9, rgba('#1f2937'));
  rect(pixels, width, 27, 18, 10, 8, rgba('#94a3b8'));
  rect(pixels, width, 29, 15, 6, 3, rgba('#cbd5e1'));
  rect(pixels, width, 28, 28, 8, 14, rgba('#64748b'));
  line(pixels, width, height, 26, 29, 37, 39, rgba('#cbd5e1'));
  line(pixels, width, height, 38, 29, 27, 39, rgba('#0f172a'));
  pixel(pixels, width, height, 31, 22, rgba('#f8fafc'));
  pixel(pixels, width, height, 35, 22, rgba('#f8fafc'));
}

function drawItemPotion(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 50, '#ef4444');
  rect(pixels, width, 30, 18, 5, 8, rgba('#d7b46a'));
  rect(pixels, width, 28, 25, 10, 4, rgba('#fecaca'));
  rect(pixels, width, 25, 29, 16, 14, rgba('#7f1d1d'));
  rect(pixels, width, 27, 27, 12, 14, rgba('#ef4444'));
  rect(pixels, width, 29, 29, 4, 8, rgba('#fca5a5'));
  rect(pixels, width, 35, 34, 3, 5, rgba('#450a0a'));
  pixel(pixels, width, height, 26, 24, rgba('#fef2f2', 180));
  pixel(pixels, width, height, 39, 25, rgba('#fef2f2', 160));
}

function drawItemBomb(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 50, '#fb923c');
  rect(pixels, width, 24, 31, 17, 13, rgba('#111827'));
  rect(pixels, width, 22, 34, 21, 8, rgba('#030712'));
  rect(pixels, width, 27, 28, 10, 4, rgba('#374151'));
  rect(pixels, width, 30, 26, 5, 3, rgba('#6b7280'));
  line(pixels, width, height, 34, 26, 43, 18, rgba('#92400e'), 2);
  pixel(pixels, width, height, 44, 17, rgba('#fbbf24'));
  pixel(pixels, width, height, 46, 16, rgba('#f97316'));
  pixel(pixels, width, height, 43, 14, rgba('#fde68a'));
  rect(pixels, width, 28, 33, 4, 4, rgba('#4b5563'));
}

function drawItemScroll(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 50, '#d7b46a');
  rect(pixels, width, 23, 23, 18, 23, rgba('#f5e6bf'));
  rect(pixels, width, 21, 25, 5, 19, rgba('#c9954c'));
  rect(pixels, width, 38, 25, 5, 19, rgba('#c9954c'));
  line(pixels, width, height, 27, 29, 36, 27, rgba('#7c2d12'));
  line(pixels, width, height, 27, 34, 35, 33, rgba('#7c2d12'));
  line(pixels, width, height, 27, 39, 33, 38, rgba('#7c2d12'));
  rect(pixels, width, 31, 35, 6, 6, rgba('#b91c1c'));
  pixel(pixels, width, height, 33, 37, rgba('#fee2e2'));
}

function drawItemKey(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 50, '#fbbf24');
  rect(pixels, width, 20, 29, 10, 10, rgba('#d7b46a'));
  rect(pixels, width, 23, 32, 4, 4, rgba('#1c1917'));
  rect(pixels, width, 29, 33, 17, 4, rgba('#fbbf24'));
  rect(pixels, width, 41, 37, 4, 6, rgba('#d7b46a'));
  rect(pixels, width, 46, 35, 4, 4, rgba('#d7b46a'));
  rect(pixels, width, 31, 31, 11, 2, rgba('#fde68a'));
  pixel(pixels, width, height, 21, 28, rgba('#fef3c7'));
}

function drawItemUpgrade(pixels, width, height) {
  drawIsoBase(pixels, width, height, 32, 50, '#c084fc');
  diamond(pixels, width, height, 32, 29, 10, 16, rgba('#6d28d9'));
  diamond(pixels, width, height, 32, 25, 6, 10, rgba('#c084fc'));
  diamond(pixels, width, height, 32, 43, 8, 7, rgba('#4c1d95'));
  line(pixels, width, height, 32, 14, 32, 45, rgba('#f5d0fe', 120));
  pixel(pixels, width, height, 25, 26, rgba('#f5d0fe'));
  pixel(pixels, width, height, 40, 21, rgba('#fbbf24'));
  pixel(pixels, width, height, 43, 35, rgba('#f5d0fe'));
}

function drawFxFrame(pixels, sheetWidth, ox, frame, palette) {
  const bob = frame % 2;
  rect(pixels, sheetWidth, ox + 28, 20 + bob, 8, 8, rgba(palette.light));
  rect(pixels, sheetWidth, ox + 24, 28 + bob, 16, 20, rgba(palette.mid));
  rect(pixels, sheetWidth, ox + 20 + frame, 34 + bob, 8, 20, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + 38 - frame, 34 + bob, 8, 20, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + 26, 48, 5, 10, rgba('#151015'));
  rect(pixels, sheetWidth, ox + 35, 48, 5, 10, rgba('#151015'));
  rect(pixels, sheetWidth, ox + 30, 24 + bob, 2, 2, rgba('#f6e6b8'));
  rect(pixels, sheetWidth, ox + 35, 24 + bob, 2, 2, rgba('#f6e6b8'));
}

function drawShadow(pixels, sheetWidth, ox, y = 56, color = '#050507') {
  rect(pixels, sheetWidth, ox + 20, y, 24, 3, rgba(color, 165));
  rect(pixels, sheetWidth, ox + 25, y + 3, 14, 2, rgba(color, 140));
}

function drawHead(pixels, sheetWidth, ox, x, y, color, eye = '#f8e8b8') {
  rect(pixels, sheetWidth, ox + x, y, 10, 9, rgba(color));
  rect(pixels, sheetWidth, ox + x + 2, y + 3, 2, 2, rgba(eye));
  rect(pixels, sheetWidth, ox + x + 7, y + 3, 2, 2, rgba(eye));
}

function drawWeapon(pixels, sheetWidth, ox, x, y, kind, active = false) {
  const metal = active ? '#f8fafc' : '#c7c2b5';
  const wood = '#5b3717';
  if (kind === 'sword') {
    rect(pixels, sheetWidth, ox + x, y - 16, 3, 18, rgba(metal));
    rect(pixels, sheetWidth, ox + x - 2, y, 7, 2, rgba('#d7b46a'));
  } else if (kind === 'dagger') {
    rect(pixels, sheetWidth, ox + x, y - 8, 2, 11, rgba(metal));
    rect(pixels, sheetWidth, ox + x - 1, y + 3, 4, 2, rgba('#6b4f1d'));
  } else if (kind === 'staff') {
    rect(pixels, sheetWidth, ox + x, y - 24, 3, 30, rgba(wood));
    rect(pixels, sheetWidth, ox + x - 3, y - 28, 9, 7, rgba(active ? '#f59e0b' : '#a78bfa'));
  } else if (kind === 'mace') {
    rect(pixels, sheetWidth, ox + x, y - 16, 3, 20, rgba(wood));
    rect(pixels, sheetWidth, ox + x - 4, y - 21, 11, 7, rgba(metal));
  } else if (kind === 'axe') {
    rect(pixels, sheetWidth, ox + x, y - 22, 3, 27, rgba(wood));
    rect(pixels, sheetWidth, ox + x - 8, y - 22, 9, 9, rgba(metal));
    rect(pixels, sheetWidth, ox + x + 3, y - 20, 8, 7, rgba(metal));
  } else if (kind === 'bow') {
    rect(pixels, sheetWidth, ox + x, y - 22, 2, 28, rgba('#8b5a2b'));
    rect(pixels, sheetWidth, ox + x + 4, y - 16, 2, 18, rgba('#d7b46a'));
  }
}

function drawClassFrame(pixels, sheetWidth, ox, frame, palette, profile) {
  const cls = profile.slug;
  const anim = profile.anim;
  const bob = anim === 'walk' ? frame % 2 : anim === 'hurt' ? 1 : 0;
  const attack = anim === 'attack';
  const dead = anim === 'death';
  const y = dead ? 47 : 25 + bob;
  const x = dead ? 21 : 27;
  drawShadow(pixels, sheetWidth, ox, 57);

  if (dead) {
    rect(pixels, sheetWidth, ox + 19, 44, 26, 8, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + 42, 42, 8, 8, rgba(palette.light));
    rect(pixels, sheetWidth, ox + 24, 53, 22, 3, rgba(palette.dark));
    return;
  }

  if (cls === 'barbarian' || cls === 'paladin') rect(pixels, sheetWidth, ox + x - 3, y + 12, 20, 23, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + x - 1, y + 11, 14, 21, rgba(palette.mid));
  rect(pixels, sheetWidth, ox + x + 1, y + 13, 10, 5, rgba(palette.light));

  if (cls === 'mage' || cls === 'necromancer') {
    rect(pixels, sheetWidth, ox + x - 3, y + 26, 20, 10, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + x + 5, y + 16, 3, 23, rgba(palette.light));
  }

  if (cls === 'rogue' || cls === 'ranger') {
    rect(pixels, sheetWidth, ox + x - 3, y - 1, 16, 9, rgba(palette.dark));
    rect(pixels, sheetWidth, ox + x - 7, y + 5, 5, 17, rgba(palette.dark));
  }

  drawHead(pixels, sheetWidth, ox, x + 1, y + 1, cls === 'necromancer' ? '#d8d0c0' : '#c9b08d');
  if (cls === 'warrior') {
    rect(pixels, sheetWidth, ox + x - 1, y - 2, 14, 5, rgba('#64748b'));
    rect(pixels, sheetWidth, ox + x + 3, y - 5, 6, 4, rgba('#cbd5e1'));
  } else if (cls === 'rogue') {
    rect(pixels, sheetWidth, ox + x - 2, y - 3, 15, 9, rgba('#111827'));
    rect(pixels, sheetWidth, ox + x + 2, y + 5, 7, 2, rgba('#6b7280'));
  } else if (cls === 'mage') {
    rect(pixels, sheetWidth, ox + x - 4, y, 20, 4, rgba('#312e81'));
    diamond(pixels, sheetWidth, 64, ox + x + 7, y - 6, 7, 7, rgba('#4338ca'));
    pixel(pixels, sheetWidth, 64, ox + x + 7, y - 10, rgba('#fbbf24'));
  } else if (cls === 'paladin') {
    rect(pixels, sheetWidth, ox + x - 1, y - 2, 14, 5, rgba('#d7b46a'));
    rect(pixels, sheetWidth, ox + x + 6, y - 7, 3, 5, rgba('#fde68a'));
  } else if (cls === 'ranger') {
    rect(pixels, sheetWidth, ox + x - 3, y - 2, 16, 7, rgba('#14532d'));
    rect(pixels, sheetWidth, ox + x + 11, y + 8, 7, 18, rgba('#422006'));
  } else if (cls === 'barbarian') {
    rect(pixels, sheetWidth, ox + x - 1, y - 3, 15, 5, rgba('#7f1d1d'));
    rect(pixels, sheetWidth, ox + x + 2, y - 6, 8, 4, rgba('#451a03'));
  } else if (cls === 'necromancer') {
    rect(pixels, sheetWidth, ox + x - 2, y - 2, 15, 11, rgba('#111827'));
    rect(pixels, sheetWidth, ox + x + 3, y + 4, 7, 2, rgba('#a78bfa'));
  } else if (cls === 'monk') {
    pixel(pixels, sheetWidth, 64, ox + x + 3, y + 1, rgba('#fed7aa'));
    rect(pixels, sheetWidth, ox + x - 2, y + 11, 16, 3, rgba('#f97316'));
  }

  rect(pixels, sheetWidth, ox + x - 4, y + 17, 5, 18, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + x + 12, y + 17, 5, 18, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + x + 1, y + 31, 4, 14, rgba('#151015'));
  rect(pixels, sheetWidth, ox + x + 9, y + 31, 4, 14, rgba('#151015'));

  const rightArmX = attack ? x + 20 : x + 15;
  rect(pixels, sheetWidth, ox + x - 7, y + 16, 5, 17, rgba(palette.mid));
  rect(pixels, sheetWidth, ox + rightArmX, y + 15, 5, 17, rgba(palette.mid));

  if (cls === 'warrior') {
    rect(pixels, sheetWidth, ox + x - 6, y + 15, 8, 14, rgba('#667085'));
    rect(pixels, sheetWidth, ox + x - 8, y + 17, 9, 12, rgba('#1f2937'));
    rect(pixels, sheetWidth, ox + x - 6, y + 19, 5, 5, rgba('#94a3b8'));
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 3, y + 19, 'sword', attack);
  } else if (cls === 'rogue') {
    drawWeapon(pixels, sheetWidth, ox, x - 8, y + 25, 'dagger', attack);
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 3, y + 25, 'dagger', attack);
    rect(pixels, sheetWidth, ox + x + 3, y + 22, 7, 3, rgba('#a3a3a3'));
  } else if (cls === 'mage') {
    rect(pixels, sheetWidth, ox + x + 2, y + 24, 10, 10, rgba('#1d4ed8'));
    pixel(pixels, sheetWidth, 64, ox + rightArmX + 5, y - 7, rgba('#fde68a'));
    pixel(pixels, sheetWidth, 64, ox + rightArmX + 8, y - 5, rgba('#93c5fd'));
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 4, y + 22, 'staff', attack);
  } else if (cls === 'paladin') {
    rect(pixels, sheetWidth, ox + x - 8, y + 15, 9, 15, rgba('#d7b46a'));
    rect(pixels, sheetWidth, ox + x - 6, y + 18, 5, 7, rgba('#fde68a'));
    rect(pixels, sheetWidth, ox + x + 4, y + 17, 5, 11, rgba('#ffffff'));
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 3, y + 22, 'mace', attack);
  } else if (cls === 'ranger') {
    line(pixels, sheetWidth, 64, ox + x - 8, y + 11, ox + x - 2, y + 30, rgba('#d7b46a'));
    line(pixels, sheetWidth, 64, ox + x - 6, y + 12, ox + x - 6, y + 31, rgba('#fef3c7'));
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 3, y + 24, 'bow', attack);
  } else if (cls === 'barbarian') {
    rect(pixels, sheetWidth, ox + x - 8, y + 17, 5, 14, rgba('#fca5a5'));
    rect(pixels, sheetWidth, ox + x + 17, y + 17, 5, 14, rgba('#fca5a5'));
    rect(pixels, sheetWidth, ox + x + 2, y + 19, 10, 5, rgba('#451a03'));
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 4, y + 23, 'axe', attack);
  } else if (cls === 'necromancer') {
    drawWeapon(pixels, sheetWidth, ox, rightArmX + 3, y + 23, 'staff', attack);
    rect(pixels, sheetWidth, ox + x + 2, y - 3, 8, 5, rgba('#111827'));
    pixel(pixels, sheetWidth, 64, ox + rightArmX + 5, y - 7, rgba('#a78bfa'));
    rect(pixels, sheetWidth, ox + x + 1, y + 21, 11, 3, rgba('#c4b5fd'));
  } else if (cls === 'monk') {
    rect(pixels, sheetWidth, ox + x - 9, y + 24, 7, 5, rgba('#fed7aa'));
    rect(pixels, sheetWidth, ox + rightArmX + 2, y + 24, 7, 5, rgba('#fed7aa'));
    rect(pixels, sheetWidth, ox + x + 1, y + 26, 12, 3, rgba('#fed7aa'));
  }
}

function drawEnemyFrame(pixels, sheetWidth, ox, frame, palette, profile) {
  const enemy = profile.slug;
  const anim = profile.anim;
  const bob = anim === 'move' ? frame % 2 : anim === 'hurt' ? 1 : 0;
  const attack = anim === 'attack';
  const dead = anim === 'death';
  drawShadow(pixels, sheetWidth, ox, enemy === 'rat' || enemy === 'bones' ? 55 : 57);

  if (enemy === 'rat') {
    const y = dead ? 47 : 42 + bob;
    rect(pixels, sheetWidth, ox + 20, y, 22, 9, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + 39, y - 3, 8, 8, rgba(palette.light));
    rect(pixels, sheetWidth, ox + 16, y + 4, 8, 2, rgba(palette.dark));
    line(pixels, sheetWidth, 64, ox + 20, y + 6, ox + 9, y + 1, rgba('#78716c'));
    rect(pixels, sheetWidth, ox + 41, y - 7, 3, 4, rgba(palette.dark));
    rect(pixels, sheetWidth, ox + 45, y - 6, 3, 4, rgba(palette.dark));
    rect(pixels, sheetWidth, ox + 24, y + 8, 4, 4, rgba('#1c1917'));
    rect(pixels, sheetWidth, ox + 35, y + 8, 4, 4, rgba('#1c1917'));
    rect(pixels, sheetWidth, ox + 45, y, 2, 2, rgba('#f8e8b8'));
    return;
  }

  if (enemy === 'bones') {
    const y = 43 + bob;
    rect(pixels, sheetWidth, ox + 23, y - 12, 10, 8, rgba(palette.light));
    rect(pixels, sheetWidth, ox + 25, y - 9, 2, 2, rgba('#111827'));
    rect(pixels, sheetWidth, ox + 30, y - 9, 2, 2, rgba('#111827'));
    line(pixels, sheetWidth, 64, ox + 19, y, ox + 43, y + 8, rgba(palette.light), 3);
    line(pixels, sheetWidth, 64, ox + 21, y + 8, ox + 43, y - 1, rgba(palette.mid), 3);
    rect(pixels, sheetWidth, ox + 28, y + 5, 12, 4, rgba(palette.light));
    return;
  }

  const scale = enemy === 'troll' || enemy === 'dungeonLord' ? 1 : 0;
  const x = enemy === 'dungeonLord' ? 22 : 27;
  const y = dead ? 46 : 24 + bob - scale * 4;

  if (dead) {
    rect(pixels, sheetWidth, ox + 18, 45, 28, 8, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + 39, 42, 9, 8, rgba(palette.light));
    return;
  }

  if (enemy === 'skeleton') {
    drawHead(pixels, sheetWidth, ox, x + 1, y + 1, palette.light, '#111827');
    rect(pixels, sheetWidth, ox + x + 3, y + 7, 8, 2, rgba('#111827'));
    rect(pixels, sheetWidth, ox + x + 5, y + 10, 3, 19, rgba(palette.light));
    rect(pixels, sheetWidth, ox + x - 4, y + 17, 20, 3, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + x + 1, y + 21, 4, 2, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + x + 9, y + 21, 4, 2, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + x + 1, y + 25, 13, 2, rgba(palette.mid));
    rect(pixels, sheetWidth, ox + x + 1, y + 30, 4, 15, rgba(palette.light));
    rect(pixels, sheetWidth, ox + x + 10, y + 30, 4, 15, rgba(palette.light));
    drawWeapon(pixels, sheetWidth, ox, attack ? x + 20 : x + 15, y + 26, 'sword', attack);
    return;
  }

  if (enemy === 'demon' || enemy === 'dungeonLord') {
    rect(pixels, sheetWidth, ox + x - 5, y - 2, 6, 8, rgba('#1f0303'));
    rect(pixels, sheetWidth, ox + x + 13, y - 2, 6, 8, rgba('#1f0303'));
    rect(pixels, sheetWidth, ox + x - 10, y + 18, 8, 20, rgba(palette.dark));
    rect(pixels, sheetWidth, ox + x + 18, y + 18, 8, 20, rgba(palette.dark));
    line(pixels, sheetWidth, 64, ox + x - 7, y + 3, ox + x - 14, y - 8, rgba('#7f1d1d'), 3);
    line(pixels, sheetWidth, 64, ox + x + 16, y + 3, ox + x + 25, y - 8, rgba('#7f1d1d'), 3);
    diamond(pixels, sheetWidth, 64, ox + x - 12, y + 23, 7, 16, rgba('#450a0a', 220));
    diamond(pixels, sheetWidth, 64, ox + x + 28, y + 23, 7, 16, rgba('#450a0a', 220));
  }

  if (enemy === 'lich') {
    rect(pixels, sheetWidth, ox + x - 4, y, 18, 37, rgba(palette.dark));
    rect(pixels, sheetWidth, ox + x - 1, y + 8, 12, 26, rgba(palette.mid));
    drawHead(pixels, sheetWidth, ox, x + 1, y + 2, '#d8d0c0', '#67e8f9');
    rect(pixels, sheetWidth, ox + x - 1, y - 1, 14, 4, rgba('#c084fc'));
    pixel(pixels, sheetWidth, 64, ox + x + 2, y - 4, rgba('#67e8f9'));
    pixel(pixels, sheetWidth, 64, ox + x + 7, y - 5, rgba('#67e8f9'));
    pixel(pixels, sheetWidth, 64, ox + x + 12, y - 4, rgba('#67e8f9'));
    rect(pixels, sheetWidth, ox + x + 3, y + 20, 8, 3, rgba('#ddd6fe'));
    drawWeapon(pixels, sheetWidth, ox, attack ? x + 21 : x + 16, y + 26, 'staff', attack);
    pixel(pixels, sheetWidth, 64, ox + (attack ? x + 21 : x + 16) + 2, y - 2, rgba('#67e8f9'));
    return;
  }

  drawHead(pixels, sheetWidth, ox, x + 1, y + 1, palette.light);
  rect(pixels, sheetWidth, ox + x - 2, y + 11, 16 + scale * 8, 22 + scale * 6, rgba(palette.mid));
  rect(pixels, sheetWidth, ox + x + 1, y + 14, 10 + scale * 5, 6, rgba(palette.light));
  rect(pixels, sheetWidth, ox + x - 8, y + 16, 6, 19 + scale * 4, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + x + 15 + scale * 7, y + 16, 6, 19 + scale * 4, rgba(palette.dark));
  rect(pixels, sheetWidth, ox + x + 1, y + 31 + scale * 3, 5, 14, rgba('#151015'));
  rect(pixels, sheetWidth, ox + x + 10 + scale * 3, y + 31 + scale * 3, 5, 14, rgba('#151015'));

  if (enemy === 'goblin') {
    rect(pixels, sheetWidth, ox + x - 6, y + 4, 5, 4, rgba(palette.light));
    rect(pixels, sheetWidth, ox + x + 10, y + 4, 5, 4, rgba(palette.light));
    rect(pixels, sheetWidth, ox + x + 4, y + 7, 3, 2, rgba('#fde68a'));
    rect(pixels, sheetWidth, ox + x + 10, y + 7, 3, 2, rgba('#fde68a'));
    rect(pixels, sheetWidth, ox + x + 3, y + 22, 10, 4, rgba('#7c2d12'));
    drawWeapon(pixels, sheetWidth, ox, attack ? x + 21 : x + 16, y + 27, 'dagger', attack);
  } else if (enemy === 'orc' || enemy === 'troll') {
    rect(pixels, sheetWidth, ox + x + 3, y + 8, 3, 3, rgba('#f8fafc'));
    rect(pixels, sheetWidth, ox + x + 10, y + 8, 3, 3, rgba('#f8fafc'));
    rect(pixels, sheetWidth, ox + x + 3, y + 13, 3, 4, rgba('#f8fafc'));
    rect(pixels, sheetWidth, ox + x + 12, y + 13, 3, 4, rgba('#f8fafc'));
    rect(pixels, sheetWidth, ox + x - 5, y + 12, 25 + scale * 8, 5, rgba(palette.dark));
    if (enemy === 'troll') rect(pixels, sheetWidth, ox + x - 3, y - 3, 22, 5, rgba('#164e63'));
    drawWeapon(pixels, sheetWidth, ox, attack ? x + 24 + scale * 4 : x + 18 + scale * 4, y + 28, 'mace', attack);
  } else if (enemy === 'demon' || enemy === 'dungeonLord') {
    rect(pixels, sheetWidth, ox + x + 4, y + 7, 3, 2, rgba('#fef2f2'));
    rect(pixels, sheetWidth, ox + x + 11, y + 7, 3, 2, rgba('#fef2f2'));
    if (enemy === 'dungeonLord') {
      rect(pixels, sheetWidth, ox + x - 2, y - 8, 20, 4, rgba('#fbbf24'));
      pixel(pixels, sheetWidth, 64, ox + x + 2, y - 11, rgba('#fde68a'));
      pixel(pixels, sheetWidth, 64, ox + x + 8, y - 12, rgba('#fde68a'));
      pixel(pixels, sheetWidth, 64, ox + x + 15, y - 11, rgba('#fde68a'));
    }
    drawWeapon(pixels, sheetWidth, ox, attack ? x + 26 : x + 20, y + 30, 'sword', attack);
  }
}

function writeStrip(name, palette, frames = 5, profile = {}) {
  const frameWidth = 64;
  const frameHeight = 64;
  const pixels = makeCanvas(frameWidth * frames, frameHeight);
  for (let frame = 0; frame < frames; frame++) {
    const ox = frame * frameWidth;
    if (profile.type === 'class') drawClassFrame(pixels, frameWidth * frames, ox, frame, palette, profile);
    else if (profile.type === 'enemy') drawEnemyFrame(pixels, frameWidth * frames, ox, frame, palette, profile);
    else drawFxFrame(pixels, frameWidth * frames, ox, frame, palette);
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
  manifest['environment.doorLocked'] = writeTile('environment_door_locked', (p, w, h) => {
    diamond(p, w, h, 32, 50, 20, 7, rgba('#050507', 180));
    rect(p, w, 20, 13, 24, 34, rgba('#3f2412'));
    rect(p, w, 23, 16, 18, 29, rgba('#5b3717'));
    rect(p, w, 19, 12, 26, 4, rgba('#111827'));
    rect(p, w, 20, 31, 24, 3, rgba('#111827'));
    rect(p, w, 23, 19, 3, 24, rgba('#1f2937'));
    rect(p, w, 38, 19, 3, 24, rgba('#1f2937'));
    rect(p, w, 30, 28, 6, 6, rgba('#d7b46a'));
    pixel(p, w, h, 32, 30, rgba('#fef3c7'));
  });
  manifest['environment.doorSecret'] = writeTile('environment_door_secret', (p, w, h) => {
    rect(p, w, 16, 10, 32, 38, rgba('#252634'));
    rect(p, w, 18, 14, 28, 5, rgba('#36394b'));
    rect(p, w, 18, 28, 28, 4, rgba('#151827'));
    rect(p, w, 24, 20, 3, 25, rgba('#111827'));
    rect(p, w, 38, 20, 3, 25, rgba('#111827'));
    line(p, w, h, 22, 39, 41, 25, rgba('#4b5563'));
  });
  manifest['environment.stairs'] = writeTile('environment_stairs', (p, w, h) => {
    diamond(p, w, h, 32, 44, 28, 13, rgba('#111827'));
    for (let i = 0; i < 5; i++) {
      rect(p, w, 18 + i * 3, 27 + i * 4, 28 - i * 4, 3, rgba(i % 2 ? '#334155' : '#1f2937'));
      line(p, w, h, 19 + i * 3, 27 + i * 4, 45 - i, 27 + i * 4, rgba('#86efac', 120));
    }
    diamond(p, w, h, 32, 45, 12, 5, rgba('#4ade80', 75));
  });
  manifest['environment.shop'] = writeTile('environment_shop', (p, w, h) => {
    diamond(p, w, h, 32, 51, 25, 8, rgba('#050507', 190));
    diamond(p, w, h, 32, 47, 21, 6, rgba('#8a5b20', 120));
    rect(p, w, 14, 31, 36, 15, rgba('#4a2f16'));
    rect(p, w, 17, 28, 30, 5, rgba('#8a5b20'));
    rect(p, w, 18, 17, 28, 9, rgba('#7c2d12'));
    rect(p, w, 22, 17, 5, 9, rgba('#d7b46a'));
    rect(p, w, 33, 17, 5, 9, rgba('#d7b46a'));
    rect(p, w, 15, 25, 4, 20, rgba('#2a180d'));
    rect(p, w, 45, 25, 4, 20, rgba('#2a180d'));
    rect(p, w, 25, 20, 14, 12, rgba('#22150f'));
    drawHead(p, w, 0, 27, 20, '#c9b08d', '#fef3c7');
    rect(p, w, 24, 18, 17, 5, rgba('#3f2412'));
    rect(p, w, 21, 35, 8, 7, rgba('#5b3717'));
    rect(p, w, 36, 34, 7, 8, rgba('#111827'));
    rect(p, w, 38, 30, 3, 4, rgba('#ef4444'));
    rect(p, w, 27, 35, 4, 3, rgba('#fbbf24'));
    rect(p, w, 31, 36, 4, 3, rgba('#fbbf24'));
    pixel(p, w, h, 43, 20, rgba('#fde68a'));
  });
  manifest['environment.shrine'] = writeTile('environment_shrine', (p, w, h) => {
    drawIsoBase(p, w, h, 32, 50, '#c084fc');
    rect(p, w, 19, 37, 26, 9, rgba('#374151'));
    rect(p, w, 23, 31, 18, 7, rgba('#4b5563'));
    diamond(p, w, h, 32, 22, 9, 17, rgba('#6d28d9'));
    diamond(p, w, h, 32, 17, 5, 9, rgba('#ddd6fe'));
    line(p, w, h, 32, 8, 32, 37, rgba('#f5d0fe', 140));
  });
  manifest['environment.trapSpike'] = writeTile('environment_trap_spike', (p, w, h) => {
    diamond(p, w, h, 32, 42, 24, 10, rgba('#252634'));
    rect(p, w, 20, 38, 24, 3, rgba('#111827'));
    line(p, w, h, 25, 39, 28, 26, rgba('#d1d5db'), 2);
    line(p, w, h, 33, 40, 36, 25, rgba('#e5e7eb'), 2);
    line(p, w, h, 42, 39, 45, 29, rgba('#9ca3af'), 2);
  });
  manifest['environment.trapGas'] = writeTile('environment_trap_gas', (p, w, h) => {
    diamond(p, w, h, 32, 42, 24, 10, rgba('#14532d'));
    rect(p, w, 20, 35, 24, 6, rgba('#052e16'));
    diamond(p, w, h, 26, 28, 7, 5, rgba('#86efac', 150));
    diamond(p, w, h, 36, 24, 8, 6, rgba('#4ade80', 145));
    diamond(p, w, h, 41, 33, 6, 5, rgba('#bbf7d0', 120));
  });
  manifest['environment.trapAlarm'] = writeTile('environment_trap_alarm', (p, w, h) => {
    diamond(p, w, h, 32, 42, 24, 10, rgba('#7f1d1d'));
    rect(p, w, 28, 22, 8, 20, rgba('#991b1b'));
    rect(p, w, 26, 18, 12, 6, rgba('#ef4444'));
    rect(p, w, 30, 26, 4, 10, rgba('#fbbf24'));
    pixel(p, w, h, 25, 16, rgba('#fef2f2'));
    pixel(p, w, h, 39, 15, rgba('#fef2f2'));
  });
  manifest['environment.trapBear'] = writeTile('environment_trap_bear', (p, w, h) => {
    diamond(p, w, h, 32, 42, 24, 10, rgba('#292524'));
    rect(p, w, 19, 35, 26, 4, rgba('#d1d5db'));
    rect(p, w, 22, 30, 4, 8, rgba('#9ca3af'));
    rect(p, w, 30, 30, 4, 8, rgba('#9ca3af'));
    rect(p, w, 38, 30, 4, 8, rgba('#9ca3af'));
    rect(p, w, 28, 38, 8, 4, rgba('#111827'));
  });

  const itemDrawers = {
    weapon: drawItemWeapon,
    armor: drawItemArmor,
    potion: drawItemPotion,
    bomb: drawItemBomb,
    scroll: drawItemScroll,
    key: drawItemKey,
    upgrade: drawItemUpgrade,
  };
  Object.entries(itemDrawers).forEach(([name, draw]) => {
    manifest[`item.${name}`] = writeTile(`item_${name}`, draw);
  });

  ['hp', 'xp', 'gold'].forEach((name, index) => {
    const colors = ['#ef4444', '#60a5fa', '#d7b46a'];
    manifest[`ui.${name}`] = writeTile(`ui_${name}`, (p, w) => rect(p, w, 18, 18, 28, 28, rgba(colors[index])));
  });

  ['hit', 'fireball', 'heal', 'poison', 'levelUp'].forEach((name, index) => {
    const colors = ['#f87171', '#fb923c', '#4ade80', '#a855f7', '#fbbf24'];
    manifest[`fx.${name}`] = writeStrip(`fx_${name}`, { light: '#ffffff', mid: colors[index], dark: '#111827' }, 4, { type: 'fx' });
  });

  for (const [cls, palette] of Object.entries(classPalettes)) {
    for (const anim of ['idle', 'walk', 'attack', 'hurt', 'death']) {
      manifest[`class.${cls}.${anim}`] = writeStrip(`class_${cls}_${anim}`, palette, 5, { type: 'class', slug: cls, anim });
    }
  }

  for (const [enemy, palette] of Object.entries(enemyPalettes)) {
    for (const anim of ['idle', 'move', 'attack', 'hurt', 'death']) {
      manifest[`enemy.${enemy}.${anim}`] = writeStrip(`enemy_${enemy}_${anim}`, palette, 5, { type: 'enemy', slug: enemy, anim });
    }
  }

  fs.writeFileSync(path.join(outDir, 'pixed_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Generated ${Object.keys(manifest).length} pixed assets in ${outDir}`);
}

main();
