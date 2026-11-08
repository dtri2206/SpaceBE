// Hangar v5 "access" part (pure Node): elevator mirror, landings, keep-out zones, deck-riding stairs, ids, budgets,
// and the crew arm reach logic of sandbox/role1.hangar.access-v5.js.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {armTipX,armExtension,hullRadius,hatchHeight,armFloor,ladderSpan,capsuleTop} from '../../../sandbox/role1.hangar.access-v5.js';

const ROOT='public/assets/models/builder/hangar/';
const read=f=>JSON.parse(readFileSync(ROOT+f,'utf8'));
const layout=read('layout.json'),access=read('v5/access.json');
const fragments=Object.fromEntries(['decks','access','stage','launcher'].map(n=>[n,existsSync(ROOT+'v5/'+n+'.json')?read('v5/'+n+'.json'):{}]));
let checks=0;const ok=(c,m)=>{assert.ok(c,m);checks++;};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;
const LEVELS=layout.levels.map(l=>l.y);

// --- modules: files exist, sizes as recorded, prefix, triangle budget; whole part <= 1.2 MB of new public files.
let bytes=statSync(ROOT+'v5/access.json').size;
for(const [id,m] of Object.entries(access.modules)){
  ok(id.startsWith('access_'),'module prefix '+id);
  ok(m.file.startsWith('v5/')&&/\/access_[^/]+\.glb$/.test(m.file),'module file '+m.file);
  const size=statSync(ROOT+m.file).size;ok(size===m.bytes,'bytes recorded for '+id);bytes+=size;
  ok(m.triangles<=60000&&size<=4*1024*1024,'per-module budget '+id);
}
ok(bytes<=1.2*1024*1024,`access part public bytes ${bytes} <= 1.2 MB`);
ok(!existsSync(ROOT+'v5/textures')||!readdirSync(ROOT+'v5/textures').some(f=>f.startsWith('access_')),'own external atlas copies deleted');

// --- elevator group: every hidden base placement has an exact mirror (x -> -x, same y/z/rotation/scale), no negative scale.
const base=new Map([...layout.placements,...layout.wrap.placements].map(p=>[p.id,p]));
const mine=new Map(access.placements.map(p=>[p.id,p]));
const elevatorGroup=layout.placements.filter(p=>['elevator','stair_run'].includes(p.module)||(p.module==='catwalk'&&p.position[0]< -15&&p.position[2]< -8));
ok(elevatorGroup.length===1+24+23,'elevator group size (shaft, 24 flights, 23 landings)');
for(const p of elevatorGroup){
  ok(access.hidePlacements.includes(p.id),'hidden '+p.id);
  const q=mine.get('access_m_'+p.id);ok(q,'mirror of '+p.id);
  ok(q.module===p.module&&near(q.position[0],-p.position[0],1e-3)&&near(q.position[1],p.position[1],1e-3)&&near(q.position[2],p.position[2],1e-3),'mirrored position '+p.id);
  ok(JSON.stringify(q.rotation)===JSON.stringify(p.rotation)&&JSON.stringify(q.scale)===JSON.stringify(p.scale),'same rotation/scale '+p.id);
}
const elevator=access.placements.filter(p=>p.dynamic==='elevator');
ok(elevator.length===1&&JSON.stringify(elevator[0].position)==='[17,0,-11]','one elevator at (17,0,-11)');
ok(access.placements.every(p=>(p.scale??[1,1,1]).every(s=>s>0)),'no negative scale');
for(const m of ['elevator','stair_run','catwalk']){const b=layout.modules[m].bounds;ok(near(b.min[0],-b.max[0],1e-3),m+' is X-symmetric, so the mirror is exact without scale');}

// --- colliders: originals hidden, mirrored landings at every stop, stair tower landing at every level.
const hidden=c=>Object.values(fragments).some(f=>(f.hideColliders??[]).some(h=>(!h.kind||h.kind===c.kind)&&(!h.region||c.center.every((v,i)=>v>=h.region.min[i]&&v<=h.region.max[i]))));
ok(layout.colliders.filter(c=>['elevator_landing','stairs'].includes(c.kind)&&c.center[0]< -15).every(hidden),'original elevator landing/stair colliders hidden');
ok(!layout.colliders.filter(c=>c.kind==='elevator_landing'&&c.center[0]>15).some(hidden),'nothing else hidden');
for(const y of LEVELS){
  ok(access.colliders.some(c=>c.kind==='elevator_landing'&&near(c.center[0],17)&&near(c.center[1],y-.12,1e-3)),'elevator landing at '+y);
  ok(access.colliders.some(c=>c.kind==='landing'&&!c.dynamic&&c.center[0]> -10.5&&c.center[0]< -9.2&&near(c.center[1]+.06,y,1e-3)),'stair tower level landing at '+y);
}
ok(access.colliders.filter(c=>c.kind==='elevator').length===3,'three elevator shaft walls');
ok(access.elevator.stops.join()===layout.elevator.stops.join(),'same elevator stops');

// --- keep-out: fixed parts never in the roll-out corridor or the console-bank ground; riders follow the fr deck.
const rotY=([x,y,z],deg)=>{const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [x*c+z*s,y,-x*s+z*c];};
function worldBox(p){
  const b=(layout.modules[p.module]??access.modules[p.module]).bounds,lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
  for(const x of [b.min[0],b.max[0]])for(const y of [b.min[1],b.max[1]])for(const z of [b.min[2],b.max[2]]){
    const r=rotY([x*p.scale[0],y*p.scale[1],z*p.scale[2]],p.rotation[1]);for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],r[i]+p.position[i]);hi[i]=Math.max(hi[i],r[i]+p.position[i]);}
  }
  return {lo,hi};
}
const overlaps=(a,min,max)=>[0,1,2].every(i=>a.lo[i]<max[i]&&a.hi[i]>min[i]);
const CORRIDOR={min:[-9,-1,-22],max:[9,90,-8]};
const BANK_GROUND={min:[-22,-1,-22],max:[-3,4,-3.5]};       // open front-left quarter floor beyond the stair tower strip: the console bank's ground
for(const p of access.placements){
  const box=worldBox(p);
  if(p.dynamic==='wrapSegment')continue;
  if(p.dynamic==='crewArm'){ok(box.lo[2]> -2.9&&box.hi[2]<0,'crew arm (and its ladder cage) stays between the slot face and z -2.9');continue;}
  ok(!overlaps(box,CORRIDOR.min,CORRIDOR.max),'not in the roll-out corridor: '+p.id);
  ok(!overlaps(box,BANK_GROUND.min,BANK_GROUND.max),'not on the open-quarter ground: '+p.id);
  if(box.lo[0]<0&&box.lo[2]<0&&box.hi[0]>-14&&box.hi[2]>-14&&box.hi[0]<0)ok(p.module.startsWith('access_stairtower')&&box.lo[0]>=-14.6&&box.hi[2]<=0.05,'only the stair tower stands in the open quarter: '+p.id);
}
const riders=access.placements.filter(p=>p.dynamic==='wrapSegment');
const deckFr=(fragments.decks.segments??[]).find(s=>s.id==='fr');
const retract=deckFr?.retracted??6;
ok(riders.length===10,'ten fr deck stairs');
for(const p of riders){
  ok(p.position[0]===0&&p.position[2]===0,'rider sits on the axis (update() writes x/z from the slide offset): '+p.id);
  ok(p.segment==='fr'&&JSON.stringify(p.axis)==='[1,0,0]'&&p.retracted===retract,'rider follows the fr deck: '+p.id);
  ok(near(p.position[1],LEVELS[p.level]),'rider at its level: '+p.id);
  const box=worldBox(p);ok(box.hi[0]<=0.01,'rider authored outside the fr deck (x <= 0): '+p.id);
  ok(Math.hypot(box.hi[0],box.hi[2])>4.8,'rider keeps clear of the ship: '+p.id);
}
for(const c of access.colliders.filter(c=>c.dynamic))ok(c.dynamic==='wrapSegment'&&c.segment==='fr'&&c.level>=0&&c.level<10,'rider colliders tagged');
ok(access.hidePlacements.filter(id=>base.get(id)?.module==='wrap_stair_v4').length===10,'Codex wrap stairs replaced');

// --- ids unique across the visible base and every fragment.
const visible=[...layout.placements.filter(p=>p.module!=='platform_half'),...layout.wrap.placements].filter(p=>!Object.values(fragments).some(f=>(f.hidePlacements??[]).includes(p.id)));
const ids=[...visible,...Object.values(fragments).flatMap(f=>f.placements??[])].map(p=>p.id);
ok(new Set(ids).size===ids.length,'placement ids unique');
ok(access.placements.every(p=>p.id.startsWith('access_')),'own ids prefixed');
ok(access.hidePlacements.every(id=>base.has(id)),'hidden ids exist');

// --- crew arm: hatch level and reach (pure functions shared with the sandbox plug-in).
const arm=access.crewArm;
const cyl=r=>({hull:[{y0:0,y1:40,r0:r,r1:r}],entries:[{attach:'axial',y:0,height:40,radius:r,def:{flags:{}}}]});
for(const r of [.9375,1.25,1.6875,2.5,3.5]){
  const tip=armTipX(cyl(r),23,arm),zNear=arm.root[1]+arm.halfWidth;
  ok(tip<= -Math.sqrt(Math.max(0,r*r-zNear*zNear))-.05&&tip> -r-.35,`tip meets the hull r=${r}: ${tip.toFixed(2)}`);
  const e=armExtension(tip,arm);ok(e>=arm.extensionRange[0]&&e<=arm.extensionRange[1],'extension in range r='+r);
  ok(near(arm.root[0]+e+arm.tipLocal,tip,1e-6),'tip reached r='+r);
}
const booster={...cyl(1.25),entries:[...cyl(1.25).entries,{attach:'radial',angle:180,outline:{y0:0,y1:30,centerRadius:2.3,radialHalf:.6,tangentHalf:.6}}]};
ok(armTipX(booster,23,arm)< -2.9,'arm stops at a booster on the -X side');
ok(armTipX(booster,40,arm)> -1.4,'above the booster the arm reaches the core');
ok(hullRadius({hull:[{y0:0,y1:10,r0:1,r1:2}],entries:[]},5,5)===1.5,'hull radius interpolates');
ok(near(hatchHeight({entries:[{y:20,height:3,def:{flags:{capsule:true}}}]}),7+20+1.35),'hatch from the capsule entry');
// --- crew arm height: not snapped to deck levels; floor ~1.1 m under the hatch, below the capsule top, ladder to landings.
const landings=arm.landings;
ok(JSON.stringify(landings)===JSON.stringify([0,5.5,...LEVELS]),'arm landings = stair tower landings');
for(const [hatch,top] of [[22.2,23.3],[30.4,32],[14.9,16],[41.3,43],[9.2,10.5]]){
  const f=armFloor(hatch,top,arm);
  ok(f<=top-1.5+1e-9,`floor ${f} below the capsule top ${top}`);
  ok(f>=7.6&&((hatch-f>=.95-1e-9&&hatch-f<=1.25+1e-9)||f===top-1.5||f===7.6),`hatch ${hatch} sits 0.95..1.25 m above the floor ${f}`);
  const {below,above}=ladderSpan(f,arm);ok(landings.includes(below)&&landings.includes(above)&&below<=f&&above>f,`ladder ${below}..${above} brackets floor ${f}`);
}
ok(armFloor(24.1,30,arm)===23&&armFloor(23.8,30,arm)===22.7,'snaps onto a tower landing only when the hatch stays 0.95..1.25 m above it');
ok(near(capsuleTop({entries:[{y:20,height:3,def:{flags:{capsule:true}}}]}),30),'capsule top');
ok(access.modules.access_crew_arm_v5&&access.crewArm.ladderNode==='ladder','arm ladder node');

// --- rail gates for the decks part: every step-off of my stairs onto a deck slot face.
const gates=access.railGates;
ok(Array.isArray(gates)&&gates.length===3,'three rail gates');
for(const g of gates)ok(['fr','bl'].includes(g.segment)&&g.along>5&&g.along<14&&g.width>=.6&&g.width<=1.2,'gate '+JSON.stringify(g));
ok(gates.some(g=>g.segment==='fr'&&near(g.along,13.45))&&gates.some(g=>g.segment==='bl'&&near(g.along,9.65)),'gates match the landings');

// --- retracted fr deck stairs never run into my fixed parts (elevator group, stair tower).
const fixedBoxes=access.placements.filter(p=>!p.dynamic||p.dynamic==='elevator').map(worldBox);
for(const p of riders){
  const b=worldBox(p);for(const o of [0,retract]){const m={lo:[b.lo[0]+o,b.lo[1],b.lo[2]],hi:[b.hi[0]+o,b.hi[1],b.hi[2]]};
    ok(!fixedBoxes.some(f=>overlaps(m,f.lo,f.hi)),`rider ${p.id} clear of fixed parts at slide ${o}`);}
}
console.log(`hangar-v5-access: ${checks} checks passed (${(bytes/1024).toFixed(0)} KiB of new files, fr retract ${retract} m)`);
