// ===================== FX =====================
function shakeMap(){
  let m=document.getElementById('map-wrap');
  m.classList.remove('shake');void m.offsetWidth;m.classList.add('shake');
}
function flashDamage(){
  let el=document.getElementById('damage-flash');
  el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');
}
function floatText(txt,gx,gy,color){
  let r=document.getElementById('map-wrap').getBoundingClientRect();
  let cs=getCellSize();
  let el=document.createElement('div');
  el.className='float-text';el.textContent=txt;el.style.color=color;
  el.style.left=(r.left+gx*cs+cs/2)+'px';el.style.top=(r.top+gy*cs)+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),880);
}
