// Hangar v5 "stage" part: console bank on the front-left diagonal, turnaround reveal, cameras, light rig.
// Pure Node (no browser) unless --shots is given.
//   node src/builder/tools/blender/hangar/v5-stage-check.mjs --write   regenerate stage.json (keeps its "modules")
//   node src/builder/tools/blender/hangar/v5-stage-check.mjs           print clearances of the three bank distances
//   node src/builder/tools/blender/hangar/v5lock.mjs browser -- node src/builder/tools/blender/hangar/v5-stage-check.mjs --shots [--only distance|views|perf]
// The bank is Codex's v4 frontal arc (centre C0 = (0,0,-13.6), radius 4, desks at +-22.5 and +-67.5 degrees) rotated
// +45 degrees about the rocket axis (three.js Y), which maps -Z onto the front-left diagonal, and slid along the diagonal
// so that its arc centre sits on the turnaround eye point E = (-d/sqrt2, 1.7, -d/sqrt2).
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT='public/assets/models/builder/hangar';
const STAGE=path.join(ROOT,'v5/stage.json');
const SHOTS='src/builder/tools/blender/hangar/refs/shots';
// 15 m was tested and dropped: the bank hits the left tower corner (x<-13.7, z>-9.3) and shifting it sideways
// pushes the desks ~3 m into the launcher roll-out path. Kept as a camera-only comparison shot (VIEW_ONLY).
export const DISTANCES=[18,22],VIEW_ONLY=[15];
export const DEFAULT_DISTANCE=18;
const S=Math.SQRT1_2,C0=[0,0,-13.6],ROT=45;
const round=v=>Math.round(v*1e4)/1e4;
// three.js rotation about +Y by `deg`: x' = x cos + z sin, z' = -x sin + z cos.
export function rotY([x,y,z],deg){const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [x*c+z*s,y,-x*s+z*c];}
const add=(a,b)=>a.map((v,i)=>v+b[i]);
// Desk-local point (desk origin, rotation y) to world.
export function deskToWorld(st,local){return add(st.position,rotY(local,st.rotation[1]));}
export function bankCentre(d){return [-d*S,0,-d*S];}
// Seated eye over the chair, standing interaction point behind it, both in desk-local metres (+Z = operator side).
const SEAT_EYE=[0,1.2,1.35],SEAT_TARGET=[0,1.55,-1.6],INTERACT=[0,1.7,1.42],LOOK=[0,1.34,-.2];
// After standing up the operator takes a step back from the chair towards the arc centre and turns round.
const STAND_BACK=.9;
// Nominal ship for the stored default target (the runtime recomputes it for the real ship).
const NOMINAL_TOP=36,ML_TOP=7,EYE=1.7;
export function frameShip(eye,top,aspect=1440/860){
  const d=Math.hypot(eye[0],eye[2]);
  const base=Math.atan2(ML_TOP-eye[1],d),tip=Math.atan2(ML_TOP+top-eye[1],d);
  // Pitch at the angular midpoint, vertical FOV = span + ~9 % margin each side, 52..75 degrees.
  const pitch=(base+tip)/2,fov=Math.min(75,Math.max(52,(tip-base)*180/Math.PI*1.2));
  return {target:[0,round(eye[1]+d*Math.tan(pitch)),0],fov:round(fov),pitch:round(pitch*180/Math.PI),aspect};
}
export function bankLayout(d,layout){
  const C=bankCentre(d),eye=[C[0],EYE,C[2]];
  const consoles=layout.consoles.map(st=>{
    const rel=[st.position[0]-C0[0],0,st.position[2]-C0[2]];
    const pos=add(C,rotY(rel,ROT)),desk={position:pos.map(round),rotation:[0,st.rotation[1]+ROT,0]};
    const dir=rotY(rel,ROT),len=Math.hypot(dir[0],dir[2]);
    const stand=[C[0]+dir[0]/len*STAND_BACK,EYE,C[2]+dir[2]/len*STAND_BACK];
    const f=frameShip(stand,NOMINAL_TOP);
    return {id:st.id,module:'engineering_consoles_v4',position:desk.position,rotation:desk.rotation,screens:st.screens,
      interactPoint:deskToWorld(desk,INTERACT).map(round),lookTarget:deskToWorld(desk,LOOK).map(round),
      seatedEye:deskToWorld(desk,SEAT_EYE).map(round),seatedTarget:deskToWorld(desk,SEAT_TARGET).map(round),
      turnaroundView:{position:stand.map(round),target:f.target,fov:f.fov}};
  });
  const f=frameShip(eye,NOMINAL_TOP);
  return {distance:d,centre:C.map(round),eye:eye.map(round),island:{module:'bank_island_v5',position:C.map(round),rotation:[0,ROT,0]},
    slotView:{position:eye.map(round),target:f.target,fov:f.fov},consoles};
}
// Island outline in bank-local metres (forward = -Z); v5_stage.py builds the same polygon.
export const ISLAND_R=5.05,ISLAND_ARC=86,ISLAND_BACK=1.1,ISLAND_BACK_HALF=3.3;
export function islandOutline(steps=36){
  const pts=[];for(let i=0;i<=steps;i++){const a=(-ISLAND_ARC+2*ISLAND_ARC*i/steps)*Math.PI/180;pts.push([ISLAND_R*Math.sin(a),-ISLAND_R*Math.cos(a)]);}
  pts.push([ISLAND_BACK_HALF,ISLAND_BACK],[-ISLAND_BACK_HALF,ISLAND_BACK]);return pts;
}
// Desk footprint corners (desk-local) incl. chair and overhead truss.
export const DESK_BOX={min:[-1.49,-.57],max:[1.49,1.5]};
export function footprint(bank){
  const pts=[];
  for(const st of bank.consoles)for(const x of [DESK_BOX.min[0],DESK_BOX.max[0]])for(const z of [DESK_BOX.min[1],DESK_BOX.max[1]]){const w=deskToWorld(st,[x,0,z]);pts.push([w[0],w[2]]);}
  for(const [x,z] of islandOutline()){const w=add(bank.island.position,rotY([x,0,z],ROT));pts.push([w[0],w[2]]);}
  return pts;
}
export function clearances(bank){
  const pts=footprint(bank);
  const corridor=Math.max(0,...pts.filter(([,z])=>z< -8).map(([x])=>9-Math.abs(x)));
  const wall=Math.min(...pts.map(([x,z])=>Math.min(22+x,22+z)));
  // Side tower block x -20.3..-13.7, z -9.3..9.3 (6.6 m bays at x=-17).
  const tower=Math.max(0,...pts.map(([x,z])=>Math.min(x+20.3,-13.7-x,z+9.3,9.3-z)));
  return {corridorIntrusion:round(corridor),wallClearance:round(wall),towerIntrusion:round(tower)};
}
// Ground placements the bank replaces: the old frontal island and the left roll-out stripes that the island covers.
export const HIDE=['console_island_v4','safety_stripe_829','safety_stripe_830','safety_stripe_831','safety_stripe_832','safety_stripe_833','safety_stripe_834'];

function write(){
  const layout=JSON.parse(readFileSync(path.join(ROOT,'layout.json'),'utf8'));
  const old=existsSync(STAGE)?JSON.parse(readFileSync(STAGE,'utf8')):{};
  const banks=Object.fromEntries(DISTANCES.map(d=>[d,bankLayout(d,layout)]));
  const out={
    note:'v5 stage part (stage agent). Console bank on the front-left diagonal; operators sit with their backs to the ship. Generated by v5-stage-check.mjs --write; modules by v5_stage.py.',
    modules:old.modules??{},
    hidePlacements:HIDE,
    bankDistance:DEFAULT_DISTANCE,bankDistances:DISTANCES,
    consoles:banks[DEFAULT_DISTANCE].consoles,
    banks,
    turnaround:{seconds:1.5,eyeHeight:EYE,seatedEyeHeight:SEAT_EYE[1],fovRange:[52,75],note:'target and fov are for a 36 m ship; the sandbox reframes for the real ship (pitch = angular midpoint of base Y 7 and tip).'},
  };
  writeFileSync(STAGE,JSON.stringify(out,null,1)+'\n');
  console.log('wrote',STAGE);
}
function report(){
  const layout=JSON.parse(readFileSync(path.join(ROOT,'layout.json'),'utf8'));
  for(const d of DISTANCES){const b=bankLayout(d,layout);console.log(d,'m',JSON.stringify(clearances(b)),'eye',b.eye.join(','),'slot',JSON.stringify(b.slotView));}
}

async function shots(only){
  const {chromium}=await import('playwright-core');
  mkdirSync(SHOTS,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
  const result={errors:[],views:{}};
  try{
    const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
    page.on('pageerror',e=>result.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});
    // Clean captures: hide the GUI, the info box and the title (survives Vite reloads caused by other agents' edits).
    await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent='.lil-gui,#info,header{display:none!important}';document.head.append(st);}));
    await page.goto('http://localhost:5280/sandbox/role1.hangar.html');
    await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:180000});await page.waitForTimeout(4000);
    const presets=await page.evaluate(()=>{const h=window.hangarInspect;return {current:h.params.preset,list:[...document.querySelectorAll('select')].map(s=>[...s.options].map(o=>o.value))};});
    result.presets=presets;
    const shot=async(name,fn,arg,{wait=1800,perf=false}={})=>{
      await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:180000});
      await page.evaluate(fn,arg);await page.waitForTimeout(wait);
      await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:180000});
      await page.evaluate(()=>window.hangarInspect.settle());await page.waitForTimeout(400);
      const file=path.join(SHOTS,'v5-stage-'+name+'.jpg');await page.screenshot({path:file,type:'jpeg',quality:85});
      const stats=await page.evaluate(()=>window.hangarInspect.stats());
      let fps=null;if(perf)fps=await page.evaluate(()=>window.hangarInspect.capturePerformance());
      result.views[name]={file,...stats,capture:fps,camera:await page.evaluate(()=>({p:window.hangarInspect.camera.position.toArray().map(v=>+v.toFixed(2)),fov:window.hangarInspect.camera.fov}))};
      console.log(name,JSON.stringify(result.views[name]));
    };
    const setPreset=async name=>{await page.evaluate(async n=>{await window.hangarInspect.realShip.preset(n);window.hangarInspect.makeRocket();window.hangarInspect.build();},name);await page.waitForTimeout(2500);return page.evaluate(()=>window.hangarInspect.shipData?.top);};
    if(only==='smoke'){
      result.tops={};for(const p of ['Reliable','Workhorse','Cold Morning','Thin Skin','Apollo'])result.tops[p]=await setPreset(p);
      console.log('tops',JSON.stringify(result.tops));await setPreset('Reliable');
      await shot('smoke',()=>window.hangarInspect.actions.slotView());
    }
    const tallest=process.env.TALL??'Apollo';
    if(!only||only==='distance'){
      for(const preset of ['Reliable',tallest]){
        const top=await setPreset(preset);result[preset+'Top']=top;console.log(preset,'top',top);
        for(const d of [...VIEW_ONLY,...DISTANCES].sort((a,b)=>a-b))await shot('distance-'+d+'-'+preset.toLowerCase().replace(/\W+/g,''),d=>{
          const h=window.hangarInspect,b=h.consoleBank;
          // Camera-only comparison for distances the bank cannot occupy (bank stays at 18 m behind the camera).
          if(!h.fragments.stage.banks[d]){b.setDistance(18);const e=[-d*Math.SQRT1_2,1.7,-d*Math.SQRT1_2],f=b.frameShip(e,h.shipData.top);h.params.cutaway=false;h.look(e,f.target,f.fov);}
          else{b.setDistance(d);h.actions.slotView();}
        },d,{perf:only==='distance'&&process.env.PERF==='1'});
      }
      await setPreset('Reliable');
    }
    if(!only||only==='views'){
      await page.evaluate(()=>window.hangarInspect.consoleBank.setDistance(18));
      await shot('bank-wide',()=>window.hangarInspect.actions.consoleWide());
      for(const id of ['station_window','station_builder','station_testfire','station_launch'])await shot('desk-'+id.replace('station_',''),id=>window.hangarInspect.actions['close_'+id](),id);
      await shot('seated',()=>window.hangarInspect.actions.seatedView());
      await page.evaluate(()=>window.hangarInspect.actions.seatedView());await page.waitForTimeout(800);
      await page.evaluate(()=>window.hangarInspect.consoleBank.stand());await page.waitForTimeout(700);
      await page.screenshot({path:path.join(SHOTS,'v5-stage-turnaround-mid.jpg'),type:'jpeg',quality:85});
      await page.waitForTimeout(1600);
      await shot('turnaround-end',()=>{},null,{wait:200});
      await shot('wrap-overview',()=>window.hangarInspect.actions.wrapOverview());
    }
    if(!only||only==='perf'){
      await page.evaluate(()=>window.hangarInspect.consoleBank.setDistance(18));
      await shot('perf-slot',()=>window.hangarInspect.actions.slotView(),null,{wait:4000,perf:true});
      await shot('perf-overview',()=>window.hangarInspect.actions.wrapOverview(),null,{wait:4000,perf:true});
    }
  }finally{await browser.close();}
  writeFileSync(path.join(os.tmpdir(),'v5-stage-check.json'),JSON.stringify(result,null,1));
  console.log('errors',result.errors.length,result.errors.slice(0,5));
}

const argv=process.argv.slice(2);
if(import.meta.url===`file:///${path.resolve(process.argv[1]).replace(/\\/g,'/')}`||process.argv[1]?.endsWith('v5-stage-check.mjs')){
  if(argv.includes('--write'))write();
  else if(argv.includes('--shots'))await shots(argv.includes('--only')?argv[argv.indexOf('--only')+1]:null);
  else report();
}
