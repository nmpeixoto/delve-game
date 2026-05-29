// ===================== PWA =====================
let _installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();_installPrompt=e;
  document.getElementById('install-banner').style.display='flex';
});
document.getElementById('install-btn').addEventListener('click',()=>{
  if(!_installPrompt)return;
  _installPrompt.prompt();
  _installPrompt.userChoice.then(()=>{_installPrompt=null;document.getElementById('install-banner').style.display='none';});
});
window.addEventListener('appinstalled',()=>{document.getElementById('install-banner').style.display='none';});
