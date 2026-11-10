import * as THREE from 'three';

const material = (color, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
const sphere = (group, color, scale, position) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material(color)); m.scale.set(...scale); m.position.set(...position); group.add(m); return m; };

function makeProp(p) {
  p={color:'#78a85b',position:[0,0,-6],rotation:[0,0,0],scale:[1,1,1],motion:'still',...p};
  const root = new THREE.Group();
  if (p.kind === 'dinosaur') {
    sphere(root,p.color,[0.95,0.63,1.55],[0,1.35,0]);
    sphere(root,p.color,[0.42,0.45,0.55],[0,1.83,-1.13]);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(.35,1.9,6),material(p.color)); tail.rotation.x=-Math.PI/2; tail.position.set(0,1.3,1.55); root.add(tail);
    for (const x of [-.57,.57]) { const leg=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,.95,7),material(p.color)); leg.position.set(x,.55,.25); root.add(leg); }
    sphere(root,'#f0d47a',[.09,.09,.09],[.3,1.9,-1.52]);
  } else if (p.kind === 'human') {
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.25,.34,1.1,7),material(p.color)); body.position.y=1.05; root.add(body);
    sphere(root,'#d8ae88',[.28,.3,.28],[0,1.82,0]);
    for (const x of [-.22,.22]) { const limb=new THREE.Mesh(new THREE.CylinderGeometry(.09,.12,.85,6),material('#354257')); limb.position.set(x,.36,0); root.add(limb); }
  } else if (p.kind === 'tree' || p.kind === 'coral') {
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.12,.22,2.2,6),material(p.kind==='coral'?p.color:'#61472e')); trunk.position.y=1; root.add(trunk);
    for(let i=0;i<5;i++){ const b=new THREE.Mesh(new THREE.ConeGeometry(p.kind==='coral'?.34:.7,1.25,6),material(p.color)); b.position.set(Math.sin(i*2.4)*.34,1.5+i*.25,Math.cos(i*2.4)*.34); root.add(b); }
  } else if (p.kind === 'fish') {
    sphere(root,p.color,[.7,.32,.34],[0,0,0]); const tail=new THREE.Mesh(new THREE.ConeGeometry(.35,.65,5),material(p.color)); tail.rotation.z=-Math.PI/2; tail.position.x=-.78; root.add(tail);
  } else if (p.kind === 'bubble') {
    const m=new THREE.Mesh(new THREE.SphereGeometry(.35,12,8),new THREE.MeshStandardMaterial({color:p.color,transparent:true,opacity:.48,metalness:.15,roughness:.1})); root.add(m);
  } else if (p.kind === 'rock' || p.kind === 'crystal') {
    const m=new THREE.Mesh(p.kind==='crystal'?new THREE.OctahedronGeometry(.8,0):new THREE.DodecahedronGeometry(.8,0),material(p.color)); m.position.y=.45; root.add(m);
  } else if (p.kind === 'building') {
    const m=new THREE.Mesh(new THREE.BoxGeometry(2.2,3.4,1.8),material(p.color)); m.position.y=1.7; root.add(m);
    for(let y=.5;y<3;y+=.7)for(let x=-.7;x<=.7;x+=.7){const w=new THREE.Mesh(new THREE.BoxGeometry(.28,.35,.04),new THREE.MeshBasicMaterial({color:'#f7d889'}));w.position.set(x,y,.92);root.add(w);}
  } else if (p.kind === 'submarine' || p.kind === 'vehicle') {
    const hull=new THREE.Mesh(new THREE.CapsuleGeometry(.55,1.5,4,8),material(p.color)); hull.rotation.z=Math.PI/2; root.add(hull);
    const glass=new THREE.Mesh(new THREE.SphereGeometry(.32,10,8),new THREE.MeshStandardMaterial({color:'#81d9e5',metalness:.4,roughness:.15}));glass.position.set(0,.28,-.25);root.add(glass);
  }
  root.position.set(...p.position); root.rotation.set(...p.rotation); root.scale.set(...p.scale); root.userData.motion=p.motion; root.userData.baseY=root.position.y; root.userData.baseX=root.position.x;
  return root;
}

function environment(scene, spec) {
  scene.background=new THREE.Color(spec.background); scene.fog=new THREE.FogExp2(spec.fog_color,spec.fog_density);
  const hemi=new THREE.HemisphereLight(spec.light_color,spec.ground,spec.light_intensity*.55); scene.add(hemi);
  const key=new THREE.DirectionalLight(spec.light_color,spec.light_intensity);key.position.set(-6,12,8);scene.add(key);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(180,180),material(spec.ground));floor.rotation.x=-Math.PI/2;floor.position.y=-.1;scene.add(floor);
  const add=(mesh,x,y,z,s=1)=>{mesh.position.set(x,y,z);mesh.scale.setScalar(s);scene.add(mesh);};
  const rng=(seed)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}; const random=rng(742);
  if(spec.environment==='prehistoric_jungle'||spec.environment==='forest'){
    for(let i=0;i<38;i++){const x=(random()-.5)*42,z=-5-random()*50;const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.25,.5,5+random()*4,6),material('#493b2a'));add(trunk,x,2.5,z);const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(2+random(),1),material(spec.environment==='forest'?'#315c36':'#32623c'));add(crown,x,5.7,z,1);}
    if(spec.environment==='prehistoric_jungle') for(let i=0;i<22;i++){const fern=new THREE.Mesh(new THREE.ConeGeometry(.7,2.4,5),material('#397546'));add(fern,(random()-.5)*30,1,-3-random()*28);}
  } else if(spec.environment==='underwater_city'||spec.environment==='city'){
    for(let i=0;i<17;i++){const w=2+random()*3,h=4+random()*13;const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),material(spec.environment==='underwater_city'?'#246778':'#596477'));add(b,(random()-.5)*34,h/2,-8-random()*35);}
  }
  if(spec.environment==='ocean'||spec.environment==='underwater_city'){
    for(let i=0;i<34;i++){const coral=new THREE.Mesh(new THREE.ConeGeometry(.5+random(),1.5+random()*2,5),material(['#ed795d','#db568a','#e5b657'][i%3]));add(coral,(random()-.5)*28,.7,-3-random()*27);}
    for(let i=0;i<70;i++){const bubble=new THREE.Mesh(new THREE.SphereGeometry(.05+random()*.08,6,5),new THREE.MeshBasicMaterial({color:'#a6edff',transparent:true,opacity:.65}));add(bubble,(random()-.5)*28,random()*13,-2-random()*35);}
  } else if(spec.environment==='desert'){
    for(let i=0;i<20;i++){const dune=new THREE.Mesh(new THREE.SphereGeometry(1,8,6),material('#bd874b'));dune.scale.set(5,1.2,3);add(dune,(random()-.5)*50,-.5,-8-random()*45);}
  } else if(spec.environment==='space'){
    for(let i=0;i<260;i++){const star=new THREE.Mesh(new THREE.SphereGeometry(.035,5,4),new THREE.MeshBasicMaterial({color:'#dbe7ff'}));add(star,(random()-.5)*70,random()*35,-10-random()*70);}
  }
}

export function buildDynamicScene(data) {
  const scene=new THREE.Scene();
  const v={environment:'plain',background:'#101827',ground:'#27352d',props:[],camera_position:[0,2.2,12],camera_look_at:[0,1.4,0],camera_movement:'static',light_color:'#ffffff',light_intensity:1.5,fog_color:'#101827',fog_density:.012,transition:'fade',...(data.visual||{})};
  environment(scene,v);
  for(const prop of v.props||[]) scene.add(makeProp(prop));
  const camera=new THREE.PerspectiveCamera(45,9/16,.1,1000);camera.position.set(...(v.camera_position||[0,2.2,12]));camera.lookAt(...(v.camera_look_at||[0,1.4,0]));
  return {scene,camera,bloom:[.35,.45,.8],exposure:1,update(t,duration){const u=t/duration;camera.position.set(...(v.camera_position||[0,2.2,12]));if(v.camera_movement==='push')camera.position.z-=u*2;if(v.camera_movement==='pan')camera.position.x+=Math.sin(u*Math.PI)*2;if(v.camera_movement==='orbit'){camera.position.x+=Math.sin(u*Math.PI*2)*4;camera.position.z+=Math.cos(u*Math.PI*2)*4;}camera.lookAt(...(v.camera_look_at||[0,1.4,0]));scene.traverse(o=>{if(!o.userData.motion)return;const m=o.userData.motion;if(m==='bob'||m==='swim'||m==='fly')o.position.y=o.userData.baseY+Math.sin(t*2+o.userData.baseX)*.22;if(m==='spin')o.rotation.y=t*.5;if(m==='walk'||m==='fly')o.position.x=o.userData.baseX+Math.sin(t*1.3+o.userData.baseY)*.22;});}};
}
