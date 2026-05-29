// ===================== SOUND EFFECTS =====================
const SFX=(function(){
  let ctx=null;
  function getCtx(){
    if(!ctx) ctx=new (window.AudioContext||window.webkitAudioContext)();
    return ctx;
  }
  function play(freq,type,duration,volume=0.3,freqEnd=null){
    try{
      let c=getCtx(),o=c.createOscillator(),g=c.createGain();
      o.connect(g);g.connect(c.destination);
      o.type=type;o.frequency.setValueAtTime(freq,c.currentTime);
      if(freqEnd) o.frequency.linearRampToValueAtTime(freqEnd,c.currentTime+duration);
      g.gain.setValueAtTime(volume,c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+duration);
      o.start();o.stop(c.currentTime+duration);
    }catch(e){}
  }
  return{
    hit:        ()=>play(220,'square',0.08,0.2),
    damage:     ()=>play(80,'sawtooth',0.15,0.3,60),
    enemyDeath: ()=>play(150,'sawtooth',0.2,0.25,60),
    pickup:     ()=>play(880,'sine',0.12,0.2),
    levelUp:    ()=>{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>play(f,'sine',0.2,0.25),i*80));},
    buy:        ()=>play(660,'sine',0.15,0.2),
    sell:       ()=>play(440,'sine',0.12,0.15),
    bash:       ()=>{play(150,'sawtooth',0.1,0.4);setTimeout(()=>play(100,'square',0.15,0.3),50);},
    playerDeath:()=>{[300,250,200,150,100].forEach((f,i)=>setTimeout(()=>play(f,'sawtooth',0.3,0.3),i*120));},
  };
})();
