import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { Controls } from './controls.js';
import { AudioSystem } from './audio.js';
import './style.css';

const $=s=>document.querySelector(s);
const canvas=$('#game'), startScreen=$('#start-screen'), hud=$('#hud'), controlsEl=$('#controls');
const pauseScreen=$('#pause-screen'), endScreen=$('#end-screen'), pauseButton=$('#pause-button');
const coreValue=$('#core-value'), objective=$('#objective'), healthFill=$('#health-fill'), messageEl=$('#message');
const interactHint=$('#interact-hint'), pulseButton=$('#pulse-button'), pulseCooldown=$('#pulse-cooldown');

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth<900?1.45:1.8));
renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x010406);scene.fog=new THREE.FogExp2(0x02070a,.017);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,180);
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.46,.48,.79);composer.addPass(bloom);

const audio=new AudioSystem(), input=new Controls(), clock=new THREE.Clock();
const state={mode:'menu',time:0,health:100,cores:0,sectorCores:[0,0,0],online:[false,false,false],pulseCD:0,activation:0,best:+localStorage.getItem('afterlight-best')||0};
let yaw=0,pitch=-.25,lastHit=0,msgTimer=0;
const obstacles=[],cores=[],drones=[],sectorLights=[],particles=[];

const MAT={
  dark:new THREE.MeshStandardMaterial({color:0x151f24,roughness:.72,metalness:.72}),
  metal:new THREE.MeshStandardMaterial({color:0x35434a,roughness:.48,metalness:.86}),
  trim:new THREE.MeshStandardMaterial({color:0x111a1e,roughness:.34,metalness:.95}),
  cyan:new THREE.MeshStandardMaterial({color:0x75edff,emissive:0x28cce8,emissiveIntensity:3.2,roughness:.2,metalness:.3}),
  amber:new THREE.MeshStandardMaterial({color:0xffa34e,emissive:0xff6b18,emissiveIntensity:2.4,roughness:.25}),
  red:new THREE.MeshStandardMaterial({color:0xff4a5f,emissive:0xff1738,emissiveIntensity:2.7}),
  suit:new THREE.MeshStandardMaterial({color:0xd9e5e6,roughness:.38,metalness:.48}),
  glass:new THREE.MeshPhysicalMaterial({color:0x5eddf5,emissive:0x0d6784,emissiveIntensity:2,roughness:.08,metalness:.2,transmission:.18})
};

function canvasTexture(kind){
  const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');
  x.fillStyle=kind==='floor'?'#26343a':'#202c31';x.fillRect(0,0,512,512);
  for(let i=0;i<7000;i++){const g=14+Math.random()*25;x.fillStyle=`rgba(${g},${g+7},${g+10},${Math.random()*.12})`;x.fillRect(Math.random()*512,Math.random()*512,Math.random()*3+1,Math.random()*3+1)}
  x.strokeStyle=kind==='floor'?'rgba(90,184,200,.16)':'rgba(160,195,202,.12)';x.lineWidth=3;
  if(kind==='floor'){for(let i=0;i<=512;i+=128){x.beginPath();x.moveTo(i,0);x.lineTo(i,512);x.stroke();x.beginPath();x.moveTo(0,i);x.lineTo(512,i);x.stroke()}x.strokeStyle='rgba(255,150,55,.24)';x.setLineDash([26,18]);x.strokeRect(16,16,480,480)}
  else{for(let y=0;y<512;y+=96){x.strokeRect(5,y+5,502,86);for(let q=0;q<512;q+=128){x.fillStyle='rgba(2,5,7,.6)';x.fillRect(q+10,y+14,7,7)}}}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;
}
const floorTex=canvasTexture('floor'),wallTex=canvasTexture('wall');

scene.add(new THREE.HemisphereLight(0x315765,0x05080a,.72));
scene.add(new THREE.AmbientLight(0x18313a,.38));
const moon=new THREE.DirectionalLight(0x9adcf2,.66);moon.position.set(12,25,8);moon.castShadow=true;moon.shadow.mapSize.set(1024,1024);moon.shadow.camera.left=-55;moon.shadow.camera.right=55;moon.shadow.camera.top=55;moon.shadow.camera.bottom=-55;scene.add(moon);

function box(w,h,d,mat,x,y,z,cast=true){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=true;scene.add(m);return m}
function cylinder(r,h,mat,x,y,z,segments=20){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;scene.add(m);return m}
function addObstacle(x,z,w,d,h=2.5){const m=box(w,h,d,MAT.dark,x,h/2,z);obstacles.push({x,z,w:w*.5+.52,d:d*.5+.52,mesh:m});return m}

const zones=[
  {x:0,z:29,w:32,d:26,sector:0},{x:0,z:16,w:9,d:12,sector:0},
  {x:-29,z:0,w:27,d:30,sector:1},{x:-15,z:0,w:15,d:9,sector:1},
  {x:29,z:0,w:27,d:30,sector:2},{x:15,z:0,w:15,d:9,sector:2},
  {x:0,z:0,w:22,d:22,sector:3}
];
const sectorCenters=[new THREE.Vector3(0,0,29),new THREE.Vector3(-29,0,0),new THREE.Vector3(29,0,0)];
function insideZones(x,z){return zones.some(r=>Math.abs(x-r.x)<r.w*.5-.55&&Math.abs(z-r.z)<r.d*.5-.55)}
function makeRoom(r){
  floorTex.repeat.set(r.w/8,r.d/8);const floorMat=new THREE.MeshStandardMaterial({map:floorTex.clone(),color:0xd5e0e3,emissive:0x0b171b,emissiveIntensity:.38,roughness:.76,metalness:.66});floorMat.map.repeat.set(r.w/8,r.d/8);floorMat.map.needsUpdate=true;
  box(r.w,.3,r.d,floorMat,r.x,-.15,r.z,false);
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex.clone(),color:0x89979c,emissive:0x081013,emissiveIntensity:.22,roughness:.74,metalness:.62});wallMat.map.repeat.set(Math.max(1,r.w/8),1);wallMat.map.needsUpdate=true;
  const hw=r.w/2,hd=r.d/2;
  // segmented walls leave intentional corridor openings and make navigation readable
  for(let sx=-hw+2;sx<hw;sx+=4){if(insideZones(r.x+sx,r.z-hd-.7)||insideZones(r.x+sx,r.z+hd+.7))continue;box(3.85,4,.55,wallMat,r.x+sx,2,r.z-hd);box(3.85,4,.55,wallMat,r.x+sx,2,r.z+hd)}
  for(let sz=-hd+2;sz<hd;sz+=4){if(insideZones(r.x-hw-.7,r.z+sz)||insideZones(r.x+hw+.7,r.z+sz))continue;box(.55,4,3.85,wallMat,r.x-hw,2,r.z+sz);box(.55,4,3.85,wallMat,r.x+hw,2,r.z+sz)}
  for(let i=0;i<Math.max(2,r.w/8);i++){const lx=r.x-r.w*.38+i*(r.w*.76/Math.max(1,Math.floor(r.w/8)));const strip=box(.08,.035,3.4,MAT.amber,lx,.03,r.z-r.d*.34,false);strip.rotation.y=Math.PI/4}
}
zones.forEach(makeRoom);

// Distinct room silhouettes and physical cover.
addObstacle(-10,33,4,4,3.4);addObstacle(10,25,4,7,3.4);addObstacle(-7,23,3,5,2.3);
addObstacle(-33,-7,6,3,3.2);addObstacle(-25,6,3,6,3.2);addObstacle(-35,7,3,3,2.1);
addObstacle(33,-7,6,3,3.2);addObstacle(25,6,3,6,3.2);addObstacle(35,7,3,3,2.1);

function pipe(x,z,vertical=false){const g=new THREE.Group();for(let i=0;i<3;i++){const m=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,7,10),i===2?MAT.amber:MAT.metal);m.rotation.z=Math.PI/2;m.position.y=3.1;m.position.z=(i-1)*.34;g.add(m)}g.position.set(x,0,z);g.rotation.y=vertical?Math.PI/2:0;scene.add(g)}
pipe(-29,-13);pipe(29,13);pipe(-10,29,true);pipe(10,29,true);

// Central reactor.
const reactor=new THREE.Group();scene.add(reactor);reactor.position.set(0,0,0);
for(let i=0;i<3;i++){const tor=new THREE.Mesh(new THREE.TorusGeometry(3.3+i*.7,.12,12,54),i===0?MAT.cyan:MAT.metal);tor.rotation.x=Math.PI/2;tor.position.y=1.2+i*.82;reactor.add(tor)}
const coreMesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1.25,2),MAT.glass);coreMesh.position.y=2.3;reactor.add(coreMesh);
const reactorLight=new THREE.PointLight(0x58e7ff,0,18,2);reactorLight.position.y=2.3;reactor.add(reactorLight);
for(let a=0;a<8;a++){const p=addObstacle(Math.cos(a*Math.PI/4)*7,Math.sin(a*Math.PI/4)*7,1.2,1.2,3.4);p.rotation.y=-a*Math.PI/4}

function makePlayer(){
  const g=new THREE.Group();const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.48,.82,6,12),MAT.suit);torso.position.y=1.35;torso.castShadow=true;g.add(torso);
  const chest=new THREE.Mesh(new THREE.BoxGeometry(.58,.5,.18),MAT.dark);chest.position.set(0,1.5,-.42);g.add(chest);
  const light=new THREE.Mesh(new THREE.BoxGeometry(.32,.09,.04),MAT.cyan);light.position.set(0,1.58,-.52);g.add(light);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.38,20,12),MAT.trim);head.position.y=2.22;head.scale.z=.85;g.add(head);
  const visor=new THREE.Mesh(new THREE.SphereGeometry(.32,20,10,0,Math.PI*2,0,Math.PI*.48),MAT.glass);visor.position.set(0,2.22,-.16);visor.rotation.x=Math.PI*.52;g.add(visor);
  const limbs=[];for(const side of[-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.66,4,8),MAT.suit);arm.position.set(side*.6,1.3,0);arm.rotation.z=side*.12;g.add(arm);const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.17,.66,4,8),MAT.suit);leg.position.set(side*.26,.42,0);g.add(leg);limbs.push(arm,leg)}
  const lamp=new THREE.PointLight(0x67ddff,3.1,12,1.65);lamp.position.set(0,1.5,-.7);g.add(lamp);g.userData={limbs,lamp};scene.add(g);return g;
}
const player=makePlayer();player.position.set(0,0,36);

function makeCore(pos,sector){
  const g=new THREE.Group();const shell=new THREE.Mesh(new THREE.OctahedronGeometry(.62,0),MAT.cyan);shell.castShadow=true;g.add(shell);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.88,.055,8,32),MAT.cyan);ring.rotation.x=Math.PI/2;g.add(ring);
  const light=new THREE.PointLight(0x4fe7ff,2.1,5,2);g.add(light);g.position.copy(pos);g.position.y=1.05;g.userData={sector,baseY:g.position.y,collected:false,ring};scene.add(g);cores.push(g);
}
[
  [-11,36,0],[11,35,0],[0,21,0],[-37,-9,1],[-34,9,1],[-20,0,1],[37,-9,2],[34,9,2],[20,0,2]
].forEach(([x,z,s])=>makeCore(new THREE.Vector3(x,0,z),s));

function makeDrone(x,z,sector){
  const g=new THREE.Group();const body=new THREE.Mesh(new THREE.SphereGeometry(.62,18,10),MAT.trim);body.scale.set(1,.55,1);body.castShadow=true;g.add(body);
  const eye=new THREE.Mesh(new THREE.SphereGeometry(.24,14,8),MAT.red);eye.position.set(0,0,-.52);g.add(eye);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.8,.08,8,24),MAT.metal);halo.rotation.x=Math.PI/2;g.add(halo);
  for(const s of[-1,1]){const wing=new THREE.Mesh(new THREE.BoxGeometry(.85,.12,.35),MAT.metal);wing.position.x=s*.83;wing.rotation.z=s*.18;g.add(wing)}
  const light=new THREE.PointLight(0xff2949,1.2,5,2);light.position.z=-.4;g.add(light);g.position.set(x,1.75,z);g.userData={sector,home:new THREE.Vector3(x,1.75,z),speed:2.3+Math.random()*.5,stun:0,phase:Math.random()*10,halo};scene.add(g);drones.push(g);
}
[[-9,29,0],[8,33,0],[-30,-8,1],[-34,7,1],[29,-8,2],[34,7,2]].forEach(v=>makeDrone(...v));

for(let s=0;s<3;s++){
  const group=[];const c=sectorCenters[s];for(let i=0;i<5;i++){const l=new THREE.PointLight(0xff8b35,.44,10,2);l.position.set(c.x+(i-2)*5,3.4,c.z+(i%2?4:-4));scene.add(l);group.push(l);const fixture=box(2,.08,.22,MAT.amber,l.position.x,3.65,l.position.z,false);group.push(fixture)}sectorLights.push(group);
}

function emit(pos,color=0x66efff,count=24,speed=4){for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.035+Math.random()*.035,5,4),new THREE.MeshBasicMaterial({color,transparent:true}));m.position.copy(pos);m.userData={vel:new THREE.Vector3((Math.random()-.5)*speed,Math.random()*speed,(Math.random()-.5)*speed),life:.5+Math.random()*.55};scene.add(m);particles.push(m)}}
function showMessage(text,time=2){messageEl.textContent=text;messageEl.classList.add('show');msgTimer=time}
function setMode(mode){state.mode=mode;const playing=mode==='playing';hud.classList.toggle('hidden',!playing);controlsEl.classList.toggle('hidden',!playing);pauseButton.classList.toggle('hidden',!playing);pauseScreen.classList.toggle('visible',mode==='paused');endScreen.classList.toggle('visible',mode==='won')}

function resetGame(){
  state.time=0;state.health=100;state.cores=0;state.sectorCores=[0,0,0];state.online=[false,false,false];state.pulseCD=0;state.activation=0;yaw=0;pitch=-.25;player.position.set(0,0,36);
  cores.forEach(c=>{c.visible=true;c.userData.collected=false});drones.forEach(d=>{d.visible=true;d.position.copy(d.userData.home);d.userData.stun=0});
  sectorLights.forEach(g=>g.forEach(o=>{if(o.isLight){o.color.set(0xff8b35);o.intensity=.44}else o.material=MAT.amber}));reactorLight.intensity=0;coreValue.textContent='0';healthFill.style.width='100%';document.querySelectorAll('.sector').forEach((e,i)=>{e.className='sector'+(i===0?' active':'')+(i===3?' reactor':'')});objective.textContent='Найдите ядра в секторе A';setMode('playing');
}

function powerSector(s){
  state.online[s]=true;audio.power();emit(sectorCenters[s].clone().setY(1.3),0x76efff,58,7);sectorLights[s].forEach(o=>{if(o.isLight){o.color.set(0x60eaff);o.intensity=1.15}else o.material=MAT.cyan});
  const el=document.querySelector(`.sector[data-sector="${s}"]`);el.classList.remove('active');el.classList.add('online');showMessage(`СЕКТОР ${'ABC'[s]}: ПИТАНИЕ ВОССТАНОВЛЕНО`,3);
  const next=state.online.findIndex(v=>!v);if(next>=0){document.querySelector(`.sector[data-sector="${next}"]`).classList.add('active');objective.textContent=`Найдите ядра в секторе ${'ABC'[next]}`}else{document.querySelector('.sector.reactor').classList.add('active');objective.textContent='Вернитесь к центральному реактору'}
}

function collectCore(c){
  c.userData.collected=true;c.visible=false;state.cores++;state.sectorCores[c.userData.sector]++;coreValue.textContent=state.cores;audio.collect();emit(c.position,0x65eaff,32,5);showMessage(`ЭНЕРГОЯДРО СТАБИЛИЗИРОВАНО  ${state.cores}/9`,1.8);
  if(state.sectorCores[c.userData.sector]===3)powerSector(c.userData.sector);
}

function pulse(){
  if(state.pulseCD>0)return;state.pulseCD=5;audio.pulse();emit(player.position.clone().add(new THREE.Vector3(0,1,0)),0x8ff8ff,65,10);
  drones.forEach(d=>{const dist=d.position.distanceTo(player.position);if(dist<8){d.userData.stun=3.2;const push=d.position.clone().sub(player.position).setY(0).normalize().multiplyScalar(3);d.position.add(push)}});
  const ring=new THREE.Mesh(new THREE.RingGeometry(.6,.75,48),new THREE.MeshBasicMaterial({color:0x7af3ff,transparent:true,opacity:.85,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(player.position).setY(.15);ring.userData={pulseRing:true,life:.55};scene.add(ring);particles.push(ring);
}

function collides(x,z){if(!insideZones(x,z))return true;return obstacles.some(o=>Math.abs(x-o.x)<o.w&&Math.abs(z-o.z)<o.d)}
function updatePlayer(dt,ctl){
  yaw-=ctl.look.x*.0042;pitch=Math.max(-.85,Math.min(.35,pitch-ctl.look.y*.0035));
  const f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),r=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const dir=f.multiplyScalar(-ctl.move.y).add(r.multiplyScalar(ctl.move.x));const moving=dir.lengthSq()>.02;if(moving)dir.normalize();
  const speed=6.6,dx=dir.x*speed*dt,dz=dir.z*speed*dt;if(!collides(player.position.x+dx,player.position.z))player.position.x+=dx;if(!collides(player.position.x,player.position.z+dz))player.position.z+=dz;
  if(moving){const target=Math.atan2(dir.x,dir.z)-Math.PI;let delta=((target-player.rotation.y+Math.PI)%(Math.PI*2))-Math.PI;player.rotation.y+=delta*Math.min(1,dt*10)}
  const stride=moving?Math.sin(state.time*12)*.45:0;player.userData.limbs[0].rotation.x=stride;player.userData.limbs[1].rotation.x=-stride;player.userData.limbs[2].rotation.x=-stride;player.userData.limbs[3].rotation.x=stride;player.position.y=moving?Math.abs(Math.sin(state.time*12))*.035:0;
  const target=camera.position.set(player.position.x+Math.sin(yaw)*7*Math.cos(pitch),player.position.y+3.1+Math.sin(-pitch)*6,player.position.z+Math.cos(yaw)*7*Math.cos(pitch));
  camera.position.copy(target);camera.lookAt(player.position.x,player.position.y+1.25,player.position.z);
  if(ctl.pulse)pulse();
}

function updateDrones(dt){
  drones.forEach(d=>{if(!d.visible)return;d.userData.phase+=dt;d.userData.halo.rotation.z+=dt*1.8;d.position.y=1.75+Math.sin(d.userData.phase*2.1)*.16;
    if(d.userData.stun>0){d.userData.stun-=dt;d.rotation.z=Math.sin(state.time*18)*.12;return}d.rotation.z*=.9;
    const delta=player.position.clone().sub(d.position);delta.y=0;const dist=delta.length();if(dist<13&&state.mode==='playing'){
      delta.normalize();const nx=d.position.x+delta.x*d.userData.speed*dt,nz=d.position.z+delta.z*d.userData.speed*dt;if(insideZones(nx,nz)){d.position.x=nx;d.position.z=nz}d.rotation.y=Math.atan2(delta.x,delta.z)+Math.PI;
      if(dist<1.3&&state.time-lastHit>.75){state.health-=12;lastHit=state.time;audio.hit();healthFill.style.width=`${Math.max(0,state.health)}%`;emit(player.position.clone().add(new THREE.Vector3(0,1,0)),0xff3355,18,4);if(state.health<=0){state.health=100;healthFill.style.width='100%';player.position.set(0,0,36);showMessage('КОСТЮМ ПЕРЕЗАПУЩЕН // ВОЗВРАТ К ШЛЮЗУ',3)}}
    }else{const home=d.userData.home.clone().sub(d.position);home.y=0;if(home.length()>1){home.normalize();d.position.addScaledVector(home,dt*.8)}}
  })
}

function updateObjectives(dt){
  cores.forEach(c=>{if(c.userData.collected)return;c.rotation.y+=dt*1.25;c.userData.ring.rotation.z+=dt*.65;c.position.y=c.userData.baseY+Math.sin(state.time*2+c.position.x)*.13;if(c.position.distanceTo(player.position)<1.45)collectCore(c)});
  const all=state.cores===9,dist=Math.hypot(player.position.x,player.position.z);if(all&&dist<4.1){state.activation+=dt;interactHint.classList.add('show');interactHint.textContent=`СИНХРОНИЗАЦИЯ РЕАКТОРА ${Math.min(100,Math.floor(state.activation/3*100))}%`;reactorLight.intensity=Math.min(6,state.activation*2);if(state.activation>=3)win()}else{state.activation=Math.max(0,state.activation-dt*.8);interactHint.classList.remove('show')}
  coreMesh.rotation.y+=dt*.35;coreMesh.rotation.x+=dt*.18;reactor.children.filter(c=>c.geometry?.type==='TorusGeometry').forEach((r,i)=>r.rotation.z+=dt*(i%2?-.22:.16));
}

function win(){if(state.mode==='won')return;audio.win();state.mode='won';reactorLight.intensity=9;bloom.strength=1.05;emit(new THREE.Vector3(0,2,0),0xa8f8ff,110,12);const best=!state.best||state.time<state.best; if(best){state.best=state.time;localStorage.setItem('afterlight-best',state.time)}$('#end-stats').innerHTML=`Станция N-13 снова дышит.<br>Время: <strong>${formatTime(state.time)}</strong>${best?' · НОВЫЙ РЕКОРД':''}`;setTimeout(()=>setMode('won'),900)}
function formatTime(t){const m=Math.floor(t/60),s=Math.floor(t%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function updateParticles(dt){for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.userData.life-=dt;if(p.userData.pulseRing){p.scale.addScalar(dt*13);p.material.opacity=Math.max(0,p.userData.life*1.5)}else{p.position.addScaledVector(p.userData.vel,dt);p.userData.vel.y-=dt*3;p.material.opacity=Math.max(0,p.userData.life*1.5)}if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();p.material.dispose();particles.splice(i,1)}}}

function animate(){requestAnimationFrame(animate);const dt=Math.min(.033,clock.getDelta());if(state.mode==='playing'){state.time+=dt;const ctl=input.update();updatePlayer(dt,ctl);updateDrones(dt);updateObjectives(dt);state.pulseCD=Math.max(0,state.pulseCD-dt);pulseButton.classList.toggle('cooling',state.pulseCD>0);pulseCooldown.textContent=state.pulseCD>0?state.pulseCD.toFixed(1):'ГОТОВ';if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0)messageEl.classList.remove('show')}}updateParticles(dt);composer.render()}
animate();

$('#start-button').addEventListener('click',()=>{audio.start();startScreen.classList.remove('visible');resetGame()});
pauseButton.addEventListener('click',()=>setMode('paused'));$('#resume-button').addEventListener('click',()=>setMode('playing'));$('#restart-button').addEventListener('click',resetGame);$('#again-button').addEventListener('click',()=>{endScreen.classList.remove('visible');bloom.strength=.46;resetGame()});
pulseButton.addEventListener('pointerdown',e=>{e.preventDefault();input.pulse=true});
addEventListener('keydown',e=>{if(e.code==='Escape'){if(state.mode==='playing')setMode('paused');else if(state.mode==='paused')setMode('playing')}});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight)});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')setMode('paused')});
