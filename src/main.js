import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x010406);scene.fog=new THREE.FogExp2(0x02070a,.017);
const camera=new THREE.PerspectiveCamera(58,innerWidth/innerHeight,.1,180);

const audio=new AudioSystem(), input=new Controls(), clock=new THREE.Clock();
const state={mode:'menu',time:0,health:100,cores:0,sectorCores:[0,0,0],online:[false,false,false],repair:[0,0,0],pulseCD:0,activation:0,best:+localStorage.getItem('afterlight-best')||0};
let yaw=0,pitch=-.25,lastHit=0,msgTimer=0;
const obstacles=[],cores=[],drones=[],sectorLights=[],sectorSurfaces=[[],[],[]],relays=[],pulseRings=[];

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

function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
  const g=x.createRadialGradient(64,64,2,64,64,64);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.14,'rgba(255,255,255,.82)');g.addColorStop(.42,'rgba(255,255,255,.2)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}
const glowMap=glowTexture();
const CORE_GLOW=new THREE.SpriteMaterial({map:glowMap,color:0x5de9ff,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false});
const DRONE_GLOW=new THREE.SpriteMaterial({map:glowMap,color:0xff3656,transparent:true,opacity:.62,blending:THREE.AdditiveBlending,depthWrite:false});

const MAX_PARTICLES=320,particlePositions=new Float32Array(MAX_PARTICLES*3),particleColors=new Float32Array(MAX_PARTICLES*3);
const particleVelocity=Array.from({length:MAX_PARTICLES},()=>new THREE.Vector3()),particleLife=new Float32Array(MAX_PARTICLES);
for(let i=0;i<MAX_PARTICLES;i++)particlePositions[i*3+1]=-999;
const particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));particleGeometry.setAttribute('color',new THREE.BufferAttribute(particleColors,3));
const particleCloud=new THREE.Points(particleGeometry,new THREE.PointsMaterial({size:.13,vertexColors:true,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
particleCloud.frustumCulled=false;scene.add(particleCloud);let particleCursor=0;

scene.add(new THREE.HemisphereLight(0x426f7d,0x071014,.92));
scene.add(new THREE.AmbientLight(0x1d3943,.48));
const moon=new THREE.DirectionalLight(0x9adcf2,.72);moon.position.set(12,25,8);moon.castShadow=true;moon.shadow.mapSize.set(1024,1024);moon.shadow.camera.left=-16;moon.shadow.camera.right=16;moon.shadow.camera.top=16;moon.shadow.camera.bottom=-16;moon.shadow.camera.near=1;moon.shadow.camera.far=48;scene.add(moon,moon.target);

function box(w,h,d,mat,x,y,z,cast=false){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=true;scene.add(m);return m}
function cylinder(r,h,mat,x,y,z,segments=20){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,segments),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;scene.add(m);return m}
function addObstacle(x,z,w,d,h=2.5){
  const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
  const body=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,.12),MAT.dark);body.position.y=h/2;body.receiveShadow=true;g.add(body);
  const cap=new THREE.Mesh(new RoundedBoxGeometry(w*.84,.12,d*.82,2,.04),MAT.metal);cap.position.y=h+.03;g.add(cap);
  const panel=new THREE.Mesh(new THREE.BoxGeometry(w*.48,h*.36,.055),MAT.amber);panel.position.set(0,h*.56,-d*.505);g.add(panel);
  const ventMat=new THREE.MeshStandardMaterial({color:0x05090b,roughness:.88,metalness:.4});
  for(let i=-1;i<=1;i++){const vent=new THREE.Mesh(new THREE.BoxGeometry(w*.1,h*.26,.06),ventMat);vent.position.set(i*w*.14,h*.29,-d*.51);g.add(vent)}
  obstacles.push({x,z,halfW:w*.5,halfD:d*.5,mesh:g});return g
}

const zones=[
  {x:0,z:29,w:32,d:26,sector:0},{x:0,z:16,w:9,d:12,sector:0},
  {x:-29,z:0,w:27,d:30,sector:1},{x:-15,z:0,w:15,d:9,sector:1},
  {x:29,z:0,w:27,d:30,sector:2},{x:15,z:0,w:15,d:9,sector:2},
  {x:0,z:0,w:22,d:22,sector:3}
];
const sectorCenters=[new THREE.Vector3(0,0,29),new THREE.Vector3(-29,0,0),new THREE.Vector3(29,0,0)];
function insideZones(x,z,margin=.34){return zones.some(r=>Math.abs(x-r.x)<r.w*.5-margin&&Math.abs(z-r.z)<r.d*.5-margin)}
function makeRoom(r){
  floorTex.repeat.set(r.w/8,r.d/8);const floorMat=new THREE.MeshStandardMaterial({map:floorTex.clone(),color:0xd5e0e3,emissive:0x0d1d22,emissiveIntensity:.44,roughness:.76,metalness:.66});floorMat.map.repeat.set(r.w/8,r.d/8);floorMat.map.needsUpdate=true;
  box(r.w,.3,r.d,floorMat,r.x,-.15,r.z,false);
  const wallMat=new THREE.MeshStandardMaterial({map:wallTex.clone(),color:0x89979c,emissive:0x081013,emissiveIntensity:.22,roughness:.74,metalness:.62});wallMat.map.repeat.set(Math.max(1,r.w/8),1);wallMat.map.needsUpdate=true;
  if(r.sector<3)sectorSurfaces[r.sector].push({floorMat,wallMat});
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
const reactorFrames=[];
function hexFrame(radius,y,material){
  const frame=new THREE.Group(),beamGeo=new RoundedBoxGeometry(radius,.16,.18,2,.035);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,b=(i+1)*Math.PI/3;
    const x1=Math.cos(a)*radius,z1=Math.sin(a)*radius,x2=Math.cos(b)*radius,z2=Math.sin(b)*radius;
    const beam=new THREE.Mesh(beamGeo,material);beam.position.set((x1+x2)/2,y,(z1+z2)/2);beam.rotation.y=-Math.atan2(z2-z1,x2-x1);frame.add(beam);
  }
  reactor.add(frame);reactorFrames.push(frame);return frame;
}
hexFrame(3.25,1.15,MAT.cyan);hexFrame(3.85,2.05,MAT.metal);hexFrame(4.45,3.05,MAT.trim);
for(let i=0;i<6;i++){
  const a=i*Math.PI/3,brace=new THREE.Mesh(new RoundedBoxGeometry(2.4,.12,.12,2,.025),i%2?MAT.metal:MAT.cyan);
  brace.position.set(Math.cos(a)*1.8,2.08,Math.sin(a)*1.8);brace.rotation.y=-a;reactor.add(brace);
  const pylon=new THREE.Mesh(new THREE.CylinderGeometry(.21,.34,3.2,6),MAT.dark);pylon.position.set(Math.cos(a)*3.35,1.6,Math.sin(a)*3.35);reactor.add(pylon);
  const node=new THREE.Mesh(new THREE.CylinderGeometry(.33,.33,.24,6),MAT.amber);node.position.set(Math.cos(a)*3.35,3.2,Math.sin(a)*3.35);reactor.add(node);
}
const coreMesh=new THREE.Mesh(new THREE.DodecahedronGeometry(1.18,0),MAT.glass);coreMesh.scale.y=1.35;coreMesh.position.y=2.3;reactor.add(coreMesh);
const coreInner=new THREE.Mesh(new THREE.OctahedronGeometry(.65,0),MAT.cyan);coreInner.position.y=2.3;reactor.add(coreInner);
const reactorGlow=new THREE.Sprite(CORE_GLOW);reactorGlow.scale.set(4.6,4.6,1);reactorGlow.position.y=2.3;reactor.add(reactorGlow);
const reactorLight=new THREE.PointLight(0x58e7ff,0,18,2);reactorLight.position.y=2.3;reactor.add(reactorLight);
for(let a=0;a<8;a++){const p=addObstacle(Math.cos(a*Math.PI/4)*7,Math.sin(a*Math.PI/4)*7,1.2,1.2,3.4);p.rotation.y=-a*Math.PI/4}

function makePlayer(){
  const g=new THREE.Group();
  const armor=(w,h,d,mat=MAT.suit,r=.05)=>{const m=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,r),mat);m.receiveShadow=true;return m};
  const pelvis=armor(.72,.34,.46,MAT.trim,.07);pelvis.position.y=.9;g.add(pelvis);
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(.43,.56,.82,6),MAT.suit);torso.position.y=1.4;torso.castShadow=true;g.add(torso);
  const chest=armor(.76,.5,.17,MAT.dark,.035);chest.position.set(0,1.47,-.43);g.add(chest);
  const chestPlate=armor(.48,.24,.07,MAT.metal,.025);chestPlate.position.set(0,1.5,-.54);g.add(chestPlate);
  const light=armor(.32,.065,.035,MAT.cyan,.012);light.position.set(0,1.55,-.59);g.add(light);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.16,.18,.18,8),MAT.trim);neck.position.y=1.92;g.add(neck);
  const head=armor(.62,.48,.55,MAT.trim,.09);head.position.y=2.22;g.add(head);
  const helmet=armor(.68,.16,.58,MAT.suit,.05);helmet.position.set(0,2.4,.02);g.add(helmet);
  const visor=armor(.47,.2,.055,MAT.glass,.035);visor.position.set(0,2.22,-.3);g.add(visor);
  for(const side of[-1,1]){const sensor=armor(.07,.11,.04,MAT.cyan,.01);sensor.position.set(side*.21,2.24,-.335);g.add(sensor)}
  const pack=armor(.58,.68,.25,MAT.dark,.05);pack.position.set(0,1.43,.43);g.add(pack);
  for(const side of[-1,1]){const cell=armor(.16,.46,.13,MAT.metal,.035);cell.position.set(side*.19,1.43,.59);g.add(cell);const slit=armor(.06,.25,.025,MAT.cyan,.008);slit.position.set(side*.19,1.43,.67);g.add(slit)}
  const limbs=[];
  for(const side of[-1,1]){
    const arm=new THREE.Group();arm.position.set(side*.61,1.68,0);g.add(arm);
    const shoulder=armor(.3,.28,.4,MAT.suit,.07);shoulder.position.x=side*.04;arm.add(shoulder);
    const upper=armor(.2,.48,.22,MAT.metal,.04);upper.position.y=-.32;upper.rotation.z=side*.05;arm.add(upper);
    const elbow=new THREE.Mesh(new THREE.CylinderGeometry(.13,.13,.21,8),MAT.trim);elbow.rotation.z=Math.PI/2;elbow.position.y=-.61;arm.add(elbow);
    const fore=armor(.23,.43,.25,MAT.suit,.045);fore.position.set(0,-.82,-.035);arm.add(fore);
    const wrist=armor(.19,.12,.2,MAT.dark,.03);wrist.position.y=-1.1;arm.add(wrist);
    const leg=new THREE.Group();leg.position.set(side*.25,.86,0);g.add(leg);
    const thigh=armor(.29,.5,.34,MAT.suit,.055);thigh.position.y=-.28;leg.add(thigh);
    const knee=armor(.31,.2,.18,MAT.dark,.04);knee.position.set(0,-.57,-.11);leg.add(knee);
    const shin=armor(.25,.48,.3,MAT.metal,.045);shin.position.y=-.82;leg.add(shin);
    const boot=armor(.32,.2,.48,MAT.trim,.055);boot.position.set(0,-1.1,-.08);leg.add(boot);
    limbs.push(arm,leg);
  }
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(.72,24),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.46,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.012;g.add(shadow);
  const glow=new THREE.Sprite(CORE_GLOW);glow.position.set(0,1.55,-.64);glow.scale.set(.95,.42,1);g.add(glow);
  g.userData={limbs};scene.add(g);return g;
}
const player=makePlayer();player.position.set(0,0,36);
const suitLamp=new THREE.SpotLight(0xc8f8ff,44,30,.72,.52,1.08),suitLampTarget=new THREE.Object3D();suitLamp.castShadow=false;scene.add(suitLamp,suitLampTarget);suitLamp.target=suitLampTarget;

function makeCore(pos,sector){
  const g=new THREE.Group(),spinner=new THREE.Group();g.add(spinner);
  const cell=new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.92,6),MAT.glass);spinner.add(cell);
  for(const y of[-.5,.5]){const collar=new THREE.Mesh(new THREE.CylinderGeometry(.5,.42,.16,6),MAT.metal);collar.position.y=y;spinner.add(collar)}
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;const rail=new THREE.Mesh(new RoundedBoxGeometry(.1,1.18,.1,2,.025),MAT.cyan);rail.position.set(Math.cos(a)*.47,0,Math.sin(a)*.47);spinner.add(rail)}
  const capTop=new THREE.Mesh(new THREE.CylinderGeometry(.16,.32,.22,6),MAT.dark);capTop.position.y=.68;spinner.add(capTop);
  const capBottom=capTop.clone();capBottom.position.y=-.68;capBottom.rotation.z=Math.PI;spinner.add(capBottom);
  const glow=new THREE.Sprite(CORE_GLOW);glow.scale.set(2.6,2.6,1);g.add(glow);
  g.position.copy(pos);g.position.y=1.08;g.userData={sector,baseY:g.position.y,collected:false,ring:spinner};scene.add(g);cores.push(g);
}
[
  [-11,36,0],[11,35,0],[0,21,0],[-37,-9,1],[-34,9,1],[-20,0,1],[37,-9,2],[34,9,2],[20,0,2]
].forEach(([x,z,s])=>makeCore(new THREE.Vector3(x,0,z),s));

function makeRelay(center,sector){
  const g=new THREE.Group();g.position.copy(center);
  const base=new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.55,.34,6),MAT.dark);base.position.y=.17;base.receiveShadow=true;g.add(base);
  const deck=new THREE.Mesh(new THREE.CylinderGeometry(1.08,1.24,.16,6),MAT.metal);deck.position.y=.42;g.add(deck);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3,arm=new THREE.Mesh(new RoundedBoxGeometry(.18,1.32,.18,2,.03),MAT.trim);arm.position.set(Math.cos(a)*.72,1.08,Math.sin(a)*.72);arm.rotation.z=Math.cos(a)*-.2;g.add(arm)}
  const node=new THREE.Mesh(new THREE.OctahedronGeometry(.48,0),MAT.amber);node.position.y=1.35;g.add(node);
  const crown=new THREE.Mesh(new THREE.CylinderGeometry(.76,.76,.1,6),MAT.amber);crown.position.y=1.92;g.add(crown);
  const glow=new THREE.Sprite(CORE_GLOW.clone());glow.material.color.set(0xff8c3d);glow.material.opacity=.46;glow.position.y=1.35;glow.scale.set(2.7,2.7,1);g.add(glow);
  const beaconMat=new THREE.MeshBasicMaterial({color:0xff8c3d,transparent:true,opacity:.08,blending:THREE.AdditiveBlending,depthWrite:false});
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.16,.55,7,6,1,true),beaconMat);beacon.position.y=4.8;g.add(beacon);
  g.userData={sector,node,crown,glow,beacon,ready:false};scene.add(g);relays.push(g);
}
sectorCenters.forEach((c,s)=>makeRelay(c,s));

function makeDrone(x,z,sector,reserve=false){
  const g=new THREE.Group(),rotors=[];
  const bodyGeo=new THREE.BufferGeometry();bodyGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,.34,0,0,-.28,.06,0,0,-.88,0,0,.62,-.78,0,.08,.78,0,.08],3));bodyGeo.setIndex([0,2,4,0,5,2,0,3,5,0,4,3,1,4,2,1,2,5,1,5,3,1,3,4]);bodyGeo.computeVertexNormals();
  const body=new THREE.Mesh(bodyGeo,MAT.trim);body.castShadow=true;g.add(body);
  const spine=new THREE.Mesh(new RoundedBoxGeometry(.28,.28,1.12,2,.05),MAT.metal);spine.position.z=-.02;g.add(spine);
  for(const side of[-1,1]){
    const boom=new THREE.Mesh(new RoundedBoxGeometry(1.02,.13,.25,2,.035),MAT.metal);boom.position.set(side*.78,.03,.02);boom.rotation.z=side*.08;boom.rotation.y=side*.08;g.add(boom);
    const bladeGroup=new THREE.Group();bladeGroup.position.set(side*1.25,.08,.05);g.add(bladeGroup);rotors.push(bladeGroup);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.15,.18,.16,8),MAT.dark);hub.position.y=.02;bladeGroup.add(hub);
    for(let b=0;b<2;b++){const blade=new THREE.Mesh(new RoundedBoxGeometry(.82,.035,.1,2,.018),MAT.suit);blade.rotation.y=b*Math.PI/2;bladeGroup.add(blade)}
    const tip=new THREE.Mesh(new THREE.CylinderGeometry(.11,.17,.32,6),MAT.red);tip.rotation.z=Math.PI/2;tip.position.set(side*1.42,-.08,.05);g.add(tip);
  }
  const eye=new THREE.Mesh(new THREE.CylinderGeometry(.18,.22,.11,6),MAT.red);eye.rotation.x=Math.PI/2;eye.position.set(0,0,-.86);g.add(eye);
  const brow=new THREE.Mesh(new RoundedBoxGeometry(.58,.1,.15,2,.025),MAT.suit);brow.position.set(0,.18,-.7);g.add(brow);
  const glow=new THREE.Sprite(DRONE_GLOW);glow.position.set(0,0,-.91);glow.scale.set(1.5,1.1,1);g.add(glow);
  g.position.set(x,1.75,z);g.visible=!reserve;g.userData={sector,home:new THREE.Vector3(x,1.75,z),speed:(reserve?2.75:2.3)+Math.random()*.35,stun:0,phase:Math.random()*10,rotors,reserve,maxHp:reserve?3:2,hp:reserve?3:2,dead:false};if(reserve)g.scale.setScalar(1.14);scene.add(g);drones.push(g);
}
[[-9,29,0],[8,33,0],[-30,-8,1],[-34,7,1],[29,-8,2],[34,7,2]].forEach(v=>makeDrone(...v));
[[0,19,0],[-19,0,1],[19,0,2]].forEach(v=>makeDrone(...v,true));

for(let s=0;s<3;s++){
  const group=[],c=sectorCenters[s],l=new THREE.PointLight(0xff8b35,.48,18,1.7);l.position.set(c.x,3.4,c.z);scene.add(l);group.push(l);
  for(let i=0;i<5;i++){const fixture=box(2,.08,.22,MAT.amber,c.x+(i-2)*5,3.65,c.z+(i%2?4:-4),false);group.push(fixture)}sectorLights.push(group);
}

function emit(pos,color=0x66efff,count=24,speed=4){
  const c=new THREE.Color(color),n=Math.min(count,MAX_PARTICLES);
  for(let q=0;q<n;q++){const i=particleCursor++%MAX_PARTICLES,o=i*3;particlePositions[o]=pos.x;particlePositions[o+1]=pos.y;particlePositions[o+2]=pos.z;particleColors[o]=c.r;particleColors[o+1]=c.g;particleColors[o+2]=c.b;particleVelocity[i].set((Math.random()-.5)*speed,Math.random()*speed,(Math.random()-.5)*speed);particleLife[i]=.5+Math.random()*.55}
  particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;
}
function showMessage(text,time=2){messageEl.textContent=text;messageEl.classList.add('show');msgTimer=time}
function setMode(mode){state.mode=mode;const playing=mode==='playing';hud.classList.toggle('hidden',!playing);controlsEl.classList.toggle('hidden',!playing);pauseButton.classList.toggle('hidden',!playing);pauseScreen.classList.toggle('visible',mode==='paused');endScreen.classList.toggle('visible',mode==='won')}
function setRelayVisual(s,mode){const r=relays[s],online=mode==='online',ready=mode==='ready';r.userData.ready=ready;r.userData.node.material=online?MAT.cyan:MAT.amber;r.userData.crown.material=online?MAT.cyan:MAT.amber;r.userData.glow.material.color.set(online?0x62efff:ready?0xffb24e:0xff7a32);r.userData.glow.material.opacity=online?.82:ready?.68:.34;r.userData.beacon.material.color.set(online?0x62efff:0xff8c3d);r.userData.beacon.material.opacity=online?.2:ready?.17:.05}
function refreshObjective(){
  const ready=state.sectorCores.findIndex((n,s)=>n===3&&!state.online[s]);
  if(ready>=0){objective.textContent=`Стабилизируйте энергoузел ${'ABC'[ready]}`;return}
  const next=state.online.findIndex((v,s)=>!v&&state.sectorCores[s]<3);
  if(next>=0){objective.textContent=`Найдите ядра в секторе ${'ABC'[next]}`;return}
  objective.textContent='Вернитесь к центральному реактору';
}

function resetGame(){
  state.time=0;state.health=100;state.cores=0;state.sectorCores=[0,0,0];state.online=[false,false,false];state.repair=[0,0,0];state.pulseCD=0;state.activation=0;yaw=0;pitch=-.25;player.position.set(0,0,36);
  cores.forEach(c=>{c.visible=true;c.userData.collected=false});drones.forEach(d=>{d.visible=!d.userData.reserve;d.position.copy(d.userData.home);d.userData.stun=0;d.userData.dead=false;d.userData.hp=d.userData.maxHp;d.rotation.z=0});
  relays.forEach((_,s)=>setRelayVisual(s,'idle'));sectorSurfaces.forEach(group=>group.forEach(({floorMat,wallMat})=>{floorMat.emissive.set(0x0d1d22);floorMat.emissiveIntensity=.44;wallMat.emissive.set(0x081013);wallMat.emissiveIntensity=.22}));
  sectorLights.forEach(g=>g.forEach(o=>{if(o.isLight){o.color.set(0xff8b35);o.intensity=.48;o.distance=18}else o.material=MAT.amber}));reactorLight.intensity=0;coreValue.textContent='0';healthFill.style.width='100%';document.querySelectorAll('.sector').forEach((e,i)=>{e.className='sector'+(i===0?' active':'')+(i===3?' reactor':'')});objective.textContent='Найдите ядра в секторе A';setMode('playing');
}

function powerSector(s){
  state.online[s]=true;state.repair[s]=6;audio.power();emit(sectorCenters[s].clone().setY(1.3),0x76efff,90,8);setRelayVisual(s,'online');sectorLights[s].forEach(o=>{if(o.isLight){o.color.set(0xb8f8ff);o.intensity=6.2;o.distance=28}else o.material=MAT.cyan});
  sectorSurfaces[s].forEach(({floorMat,wallMat})=>{floorMat.emissive.set(0x174957);floorMat.emissiveIntensity=1.05;wallMat.emissive.set(0x123943);wallMat.emissiveIntensity=.78});
  drones.filter(d=>d.userData.sector===s&&!d.userData.dead).forEach(d=>disableDrone(d,false));
  const el=document.querySelector(`.sector[data-sector="${s}"]`);el.classList.remove('active');el.classList.add('online');showMessage(`СЕКТОР ${'ABC'[s]}: ПИТАНИЕ ВОССТАНОВЛЕНО`,3);
  const next=state.online.findIndex(v=>!v);if(next>=0)document.querySelector(`.sector[data-sector="${next}"]`).classList.add('active');else document.querySelector('.sector.reactor').classList.add('active');refreshObjective();
}

function collectCore(c){
  c.userData.collected=true;c.visible=false;state.cores++;state.sectorCores[c.userData.sector]++;coreValue.textContent=state.cores;audio.collect();emit(c.position,0x65eaff,32,5);showMessage(`ЭНЕРГОЯДРО СТАБИЛИЗИРОВАНО  ${state.cores}/9`,1.8);
  if(state.sectorCores[c.userData.sector]===3){const s=c.userData.sector;setRelayVisual(s,'ready');drones.filter(d=>d.userData.sector===s&&d.userData.reserve).forEach(d=>{d.visible=true;d.userData.dead=false;d.userData.hp=d.userData.maxHp});showMessage(`ПЕРЕГРУЗКА УЗЛА ${'ABC'[s]} // ЗАЩИЩАЙТЕ РЕЛЕ`,3.2)}refreshObjective();
}

function disableDrone(d,reward=true){if(d.userData.dead)return;d.userData.dead=true;d.visible=false;emit(d.position.clone(),0xff4965,36,6);if(reward){state.health=Math.min(100,state.health+7);healthFill.style.width=`${state.health}%`;showMessage('ДРОН ВЫВЕДЕН ИЗ СТРОЯ // +7 БРОНИ',1.4)}}
function pulse(){
  if(state.pulseCD>0)return;state.pulseCD=3.2;audio.pulse();emit(player.position.clone().add(new THREE.Vector3(0,1,0)),0x8ff8ff,65,10);
  drones.forEach(d=>{if(!d.visible||d.userData.dead)return;const dist=d.position.distanceTo(player.position);if(dist<10){d.userData.stun=dist<7.5?4.1:2.2;if(dist<7.5)d.userData.hp--;const push=d.position.clone().sub(player.position).setY(0);if(push.lengthSq()>.01)d.position.add(push.normalize().multiplyScalar(2.8));if(d.userData.hp<=0)disableDrone(d)}});
  const ring=new THREE.Mesh(new THREE.RingGeometry(.6,.75,32),new THREE.MeshBasicMaterial({color:0x7af3ff,transparent:true,opacity:.85,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.copy(player.position).setY(.15);ring.userData={life:.55};scene.add(ring);pulseRings.push(ring);
}

function collides(x,z){
  if(!insideZones(x,z))return true;
  const radius=.34;
  return obstacles.some(o=>{const dx=x-o.x,dz=z-o.z,a=-o.mesh.rotation.y,c=Math.cos(a),s=Math.sin(a),lx=dx*c-dz*s,lz=dx*s+dz*c,qx=Math.max(Math.abs(lx)-o.halfW,0),qz=Math.max(Math.abs(lz)-o.halfD,0);return qx*qx+qz*qz<radius*radius});
}
function updatePlayer(dt,ctl){
  yaw-=ctl.look.x*.0042;pitch=Math.max(-.85,Math.min(.35,pitch-ctl.look.y*.0035));
  const f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),r=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const dir=f.multiplyScalar(-ctl.move.y).add(r.multiplyScalar(ctl.move.x));const moving=dir.lengthSq()>.02;if(moving)dir.normalize();
  const speed=6.6,dx=dir.x*speed*dt,dz=dir.z*speed*dt;if(!collides(player.position.x+dx,player.position.z))player.position.x+=dx;if(!collides(player.position.x,player.position.z+dz))player.position.z+=dz;
  if(moving){const target=Math.atan2(dir.x,dir.z)-Math.PI;let delta=((target-player.rotation.y+Math.PI)%(Math.PI*2))-Math.PI;player.rotation.y+=delta*Math.min(1,dt*10)}
  const stride=moving?Math.sin(state.time*12)*.45:0;player.userData.limbs[0].rotation.x=stride;player.userData.limbs[1].rotation.x=-stride;player.userData.limbs[2].rotation.x=-stride;player.userData.limbs[3].rotation.x=stride;player.position.y=moving?Math.abs(Math.sin(state.time*12))*.035:0;
  const target=camera.position.set(player.position.x+Math.sin(yaw)*7*Math.cos(pitch),player.position.y+3.1+Math.sin(-pitch)*6,player.position.z+Math.cos(yaw)*7*Math.cos(pitch));
  camera.position.copy(target);camera.lookAt(player.position.x,player.position.y+1.25,player.position.z);
  suitLamp.position.set(player.position.x,player.position.y+1.72,player.position.z);suitLampTarget.position.set(player.position.x-Math.sin(yaw)*18,player.position.y+.9,player.position.z-Math.cos(yaw)*18);suitLampTarget.updateMatrixWorld();
  moon.position.set(player.position.x+12,player.position.y+25,player.position.z+8);moon.target.position.set(player.position.x,0,player.position.z);moon.target.updateMatrixWorld();
  if(ctl.pulse)pulse();
}

function updateDrones(dt){
  drones.forEach(d=>{if(!d.visible)return;d.userData.phase+=dt;d.userData.rotors.forEach((r,i)=>r.rotation.y+=dt*(i?18:-18));d.position.y=1.75+Math.sin(d.userData.phase*2.1)*.16;
    if(d.userData.stun>0){d.userData.stun-=dt;d.rotation.z=Math.sin(state.time*18)*.12;return}d.rotation.z*=.9;
    const alert=state.sectorCores[d.userData.sector]===3&&!state.online[d.userData.sector],delta=player.position.clone().sub(d.position);delta.y=0;const dist=delta.length();if(dist<(alert?28:13)&&state.mode==='playing'){
      delta.normalize();const boost=alert?1.34:1,nx=d.position.x+delta.x*d.userData.speed*boost*dt,nz=d.position.z+delta.z*d.userData.speed*boost*dt;if(insideZones(nx,nz,.18)){d.position.x=nx;d.position.z=nz}d.rotation.y=Math.atan2(delta.x,delta.z)+Math.PI;
      if(dist<1.3&&state.time-lastHit>.75){state.health-=12;lastHit=state.time;audio.hit();healthFill.style.width=`${Math.max(0,state.health)}%`;emit(player.position.clone().add(new THREE.Vector3(0,1,0)),0xff3355,18,4);if(state.health<=0){state.health=100;healthFill.style.width='100%';player.position.set(0,0,36);showMessage('КОСТЮМ ПЕРЕЗАПУЩЕН // ВОЗВРАТ К ШЛЮЗУ',3)}}
    }else{const home=d.userData.home.clone().sub(d.position);home.y=0;if(home.length()>1){home.normalize();d.position.addScaledVector(home,dt*.8)}}
  })
}

function updateObjectives(dt){
  cores.forEach(c=>{if(c.userData.collected)return;c.rotation.y+=dt*.7;c.userData.ring.rotation.y-=dt*1.35;c.position.y=c.userData.baseY+Math.sin(state.time*2+c.position.x)*.13;if(c.position.distanceTo(player.position)<1.45)collectCore(c)});
  let relayActive=false;
  relays.forEach((r,s)=>{r.userData.crown.rotation.y+=dt*(state.online[s]?1.8:.55);r.userData.node.rotation.y-=dt*.9;r.userData.node.position.y=1.35+Math.sin(state.time*2.6+s)*.07;if(state.sectorCores[s]!==3||state.online[s])return;const dist=r.position.distanceTo(player.position);if(dist<3.35){relayActive=true;state.repair[s]=Math.min(6,state.repair[s]+dt);interactHint.classList.add('show');interactHint.textContent=`УЗЕЛ ${'ABC'[s]} // СТАБИЛИЗАЦИЯ ${Math.floor(state.repair[s]/6*100)}%`;objective.textContent=`Защищайте реле ${'ABC'[s]} от дронов`;r.userData.beacon.material.opacity=.24+Math.sin(state.time*9)*.08;if(state.repair[s]>=6)powerSector(s)}else if(state.repair[s]>0){state.repair[s]=Math.max(0,state.repair[s]-dt*.3)}});
  const all=state.online.every(Boolean),dist=Math.hypot(player.position.x,player.position.z);if(all&&dist<4.1){state.activation+=dt;interactHint.classList.add('show');interactHint.textContent=`СИНХРОНИЗАЦИЯ РЕАКТОРА ${Math.min(100,Math.floor(state.activation/3*100))}%`;reactorLight.intensity=Math.min(6,state.activation*2);if(state.activation>=3)win()}else{state.activation=Math.max(0,state.activation-dt*.8);if(!relayActive)interactHint.classList.remove('show')}
  coreMesh.rotation.y+=dt*.35;coreMesh.rotation.x+=dt*.18;coreInner.rotation.y-=dt*.7;coreInner.rotation.z+=dt*.32;reactorFrames.forEach((r,i)=>r.rotation.y+=dt*(i%2?-.16:.11));
}

function win(){if(state.mode==='won')return;audio.win();state.mode='won';reactorLight.intensity=9;emit(new THREE.Vector3(0,2,0),0xa8f8ff,110,12);const best=!state.best||state.time<state.best; if(best){state.best=state.time;localStorage.setItem('afterlight-best',state.time)}$('#end-stats').innerHTML=`Станция N-13 снова дышит.<br>Время: <strong>${formatTime(state.time)}</strong>${best?' · НОВЫЙ РЕКОРД':''}`;setTimeout(()=>setMode('won'),900)}
function formatTime(t){const m=Math.floor(t/60),s=Math.floor(t%60);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function updateParticles(dt){
  let dirty=false;
  for(let i=0;i<MAX_PARTICLES;i++){if(particleLife[i]<=0)continue;particleLife[i]-=dt;const o=i*3;if(particleLife[i]<=0){particlePositions[o+1]=-999}else{particlePositions[o]+=particleVelocity[i].x*dt;particlePositions[o+1]+=particleVelocity[i].y*dt;particlePositions[o+2]+=particleVelocity[i].z*dt;particleVelocity[i].y-=dt*3}dirty=true}
  if(dirty)particleGeometry.attributes.position.needsUpdate=true;
  for(let i=pulseRings.length-1;i>=0;i--){const p=pulseRings[i];p.userData.life-=dt;p.scale.addScalar(dt*13);p.material.opacity=Math.max(0,p.userData.life*1.5);if(p.userData.life<=0){scene.remove(p);p.geometry.dispose();p.material.dispose();pulseRings.splice(i,1)}}
}

function animate(){const dt=Math.min(.033,clock.getDelta());if(state.mode==='playing'){state.time+=dt;const ctl=input.update();updatePlayer(dt,ctl);updateDrones(dt);updateObjectives(dt);state.pulseCD=Math.max(0,state.pulseCD-dt);pulseButton.classList.toggle('cooling',state.pulseCD>0);pulseCooldown.textContent=state.pulseCD>0?state.pulseCD.toFixed(1):'ГОТОВ';if(msgTimer>0){msgTimer-=dt;if(msgTimer<=0)messageEl.classList.remove('show')}}updateParticles(dt);renderer.render(scene,camera)}
renderer.setAnimationLoop(animate);

$('#start-button').addEventListener('click',()=>{audio.start();startScreen.classList.remove('visible');resetGame()});
pauseButton.addEventListener('click',()=>setMode('paused'));$('#resume-button').addEventListener('click',()=>setMode('playing'));$('#restart-button').addEventListener('click',resetGame);$('#again-button').addEventListener('click',()=>{endScreen.classList.remove('visible');resetGame()});
pulseButton.addEventListener('pointerdown',e=>{e.preventDefault();input.pulse=true});
addEventListener('keydown',e=>{if(e.code==='Escape'){if(state.mode==='playing')setMode('paused');else if(state.mode==='paused')setMode('playing')}});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')setMode('paused')});

// Lightweight runtime counters help verify performance on real iPhones without a debug build.
globalThis.__afterlightDiagnostics=()=>{
  let meshes=0,lights=0,shadowCasters=0;scene.traverse(o=>{if(o.isMesh){meshes++;if(o.castShadow)shadowCasters++}if(o.isLight)lights++});
  return {meshes,lights,shadowCasters,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),player:{x:+player.position.x.toFixed(2),z:+player.position.z.toFixed(2)},repair:state.repair.map(v=>+v.toFixed(2))};
};
