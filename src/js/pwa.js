// ===================== PWA =====================
let _installPrompt=null;
function syncInstallBanner(){
  const banner=document.getElementById('install-banner');
  if(!banner) return;
  const game=document.getElementById('game-screen');
  const inRun=game && !game.classList.contains('hidden');
  banner.style.display=_installPrompt && !inRun ? 'flex' : 'none';
}
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();_installPrompt=e;
  syncInstallBanner();
});
document.getElementById('install-btn').addEventListener('click',()=>{
  if(!_installPrompt)return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(()=>{_installPrompt=null;document.getElementById('install-banner').style.display='none';});
});
window.addEventListener('appinstalled',()=>{document.getElementById('install-banner').style.display='none';});
window.addEventListener('load',()=>{
  const game=document.getElementById('game-screen');
  if(game && typeof MutationObserver !== 'undefined'){
    new MutationObserver(syncInstallBanner).observe(game,{attributes:true,attributeFilter:['class']});
  }
  syncInstallBanner();
});
