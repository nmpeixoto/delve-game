// ===================== FX =====================
function getFxPoint(gx, gy){
  const renderer = typeof window !== 'undefined' ? window.PixedRenderer : null;
  if(renderer && renderer.initialized && renderer.camera && typeof getIsoTileCenter === 'function' && typeof worldToScreen === 'function'){
    const area = document.getElementById('map-area');
    if(area){
      const screen = worldToScreen(getIsoTileCenter(gx, gy), renderer.camera);
      const rect = area.getBoundingClientRect();
      return { left: rect.left + screen.x, top: rect.top + screen.y, halfW: ISO_HALF_W, halfH: ISO_HALF_H, mode: 'pixed' };
    }
  }

  const wrap = document.getElementById('map-wrap');
  const cs = typeof getCellSize === 'function' ? getCellSize() : 32;
  const rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
  const half = cs / 2;
  return { left: rect.left + gx * cs + half, top: rect.top + gy * cs + half, halfW: half, halfH: half, mode: 'legacy' };
}

function shakeMap(){
  const renderer = typeof window !== 'undefined' ? window.PixedRenderer : null;
  const target = renderer && renderer.initialized && renderer.canvas ? renderer.canvas : document.getElementById('map-wrap');
  const fallback = target === document.getElementById('game-canvas') ? document.getElementById('map-wrap') : document.getElementById('game-canvas');
  if(!target) return;
  if(fallback) fallback.classList.remove('shake');
  target.classList.remove('shake');void target.offsetWidth;target.classList.add('shake');
}
function flashDamage(){
  let el=document.getElementById('damage-flash');
  el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
}
function floatText(txt,gx,gy,color){
  const p = getFxPoint(gx, gy);
  let el=document.createElement('div');
  el.className='float-text';el.textContent=txt;el.style.color=color;
  el.style.left=p.left+'px';el.style.top=(p.top-p.halfH)+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),880);
}
function popText(txt,gx,gy){
  const p = getFxPoint(gx, gy);
  let el=document.createElement('div');
  el.className='pop-text';el.textContent=txt;
  // center on tile
  el.style.left=(p.left-p.halfW/2)+'px';el.style.top=(p.top-(p.halfH*1.5))+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),400);
}
