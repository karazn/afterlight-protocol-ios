export class AudioSystem {
  constructor(){ this.ctx=null; this.master=null; this.ambience=null; }
  start(){
    if(this.ctx){ this.ctx.resume(); return; }
    this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=this.ctx.createGain(); this.master.gain.value=.22; this.master.connect(this.ctx.destination);
    const o=this.ctx.createOscillator(), g=this.ctx.createGain(), f=this.ctx.createBiquadFilter();
    o.type='sawtooth'; o.frequency.value=42; f.type='lowpass'; f.frequency.value=120; g.gain.value=.055;
    o.connect(f); f.connect(g); g.connect(this.master); o.start(); this.ambience={o,g};
  }
  tone(freq=440,duration=.2,type='sine',volume=.2,slide=0){
    if(!this.ctx)return; const now=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,now);o.frequency.exponentialRampToValueAtTime(Math.max(20,freq+slide),now+duration);
    g.gain.setValueAtTime(volume,now);g.gain.exponentialRampToValueAtTime(.001,now+duration);o.connect(g);g.connect(this.master);o.start(now);o.stop(now+duration);
  }
  collect(){this.tone(350,.12,'sine',.28,280);setTimeout(()=>this.tone(710,.24,'sine',.18,420),80)}
  pulse(){this.tone(105,.55,'sawtooth',.35,520)}
  hit(){this.tone(130,.25,'square',.2,-70)}
  power(){[180,260,390,570].forEach((f,i)=>setTimeout(()=>this.tone(f,.45,'sine',.22,90),i*115))}
  win(){[260,330,440,660,880].forEach((f,i)=>setTimeout(()=>this.tone(f,.65,'sine',.22,120),i*150))}
}
