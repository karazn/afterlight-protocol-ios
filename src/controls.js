export class Controls {
  constructor(){
    this.move={x:0,y:0};this.look={x:0,y:0};this.keys={};this.pulse=false;
    this.ring=document.querySelector('.joystick-ring');this.knob=document.querySelector('#joystick-knob');
    this.joy=document.querySelector('#joystick-zone');this.lookZone=document.querySelector('#look-zone');
    this.joyId=null;this.lookId=null;this.lookLast={x:0,y:0};
    addEventListener('keydown',e=>{this.keys[e.code]=true;if(e.code==='Space')this.pulse=true});
    addEventListener('keyup',e=>this.keys[e.code]=false);
    this.bindTouch();
  }
  bindTouch(){
    const stop=e=>e.preventDefault();
    for(const event of['contextmenu','selectstart','dragstart'])document.addEventListener(event,stop,{passive:false});
    this.joy.addEventListener('pointerdown',e=>{e.preventDefault();if(this.joyId!==null)return;this.joyId=e.pointerId;this.joy.setPointerCapture(e.pointerId);this.setJoy(e)},{passive:false});
    this.joy.addEventListener('pointermove',e=>{e.preventDefault();if(e.pointerId===this.joyId)this.setJoy(e)},{passive:false});
    const end=e=>{e.preventDefault();if(e.pointerId===this.joyId){this.joyId=null;this.move.x=this.move.y=0;this.knob.style.transform='translate(0,0)'}};
    this.joy.addEventListener('pointerup',end);this.joy.addEventListener('pointercancel',end);
    this.lookZone.addEventListener('pointerdown',e=>{e.preventDefault();if(this.lookId!==null)return;this.lookId=e.pointerId;this.lookLast={x:e.clientX,y:e.clientY};this.lookZone.setPointerCapture(e.pointerId)},{passive:false});
    this.lookZone.addEventListener('pointermove',e=>{e.preventDefault();if(e.pointerId!==this.lookId)return;this.look.x+=e.clientX-this.lookLast.x;this.look.y+=e.clientY-this.lookLast.y;this.lookLast={x:e.clientX,y:e.clientY}},{passive:false});
    const lookEnd=e=>{e.preventDefault();if(e.pointerId===this.lookId)this.lookId=null};this.lookZone.addEventListener('pointerup',lookEnd);this.lookZone.addEventListener('pointercancel',lookEnd);
  }
  setJoy(e){const r=this.ring.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width*.34;let dx=e.clientX-cx,dy=e.clientY-cy,d=Math.hypot(dx,dy);if(d>max){dx*=max/d;dy*=max/d}this.move.x=dx/max;this.move.y=dy/max;this.knob.style.transform=`translate(${dx}px,${dy}px)`}
  update(){
    const x=(this.keys.KeyD||this.keys.ArrowRight?1:0)-(this.keys.KeyA||this.keys.ArrowLeft?1:0);
    const y=(this.keys.KeyS||this.keys.ArrowDown?1:0)-(this.keys.KeyW||this.keys.ArrowUp?1:0);
    const move=x||y?{x:x/Math.hypot(x,y),y:y/Math.hypot(x,y)}:{...this.move};
    const out={move,look:{...this.look},pulse:this.pulse};this.look.x=this.look.y=0;this.pulse=false;return out;
  }
}
