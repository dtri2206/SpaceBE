// Hangar v5 "access" part: browser check and screenshots (one Chrome, through the lock).
//   node src/builder/tools/blender/hangar/v5lock.mjs browser -- node src/builder/tools/blender/hangar/v5-access-check.mjs [--only a,b] [--perf] [--preset Workhorse]
// Views: turnaround (eye on the bank diagonal), overview (high diagonal), crew (arm close-up), elevator (front-right corner),
// stairs (stair tower close-up), frstairs (deck-riding stairs), retracted (fr stairs ride with the decks),
// presets (crew close-up + overview for --presets Reliable,Apollo,Workhorse), elevator-retracted (fr deck retracted at the elevator).
// Writes refs/shots/v5-access-<view>.jpg and prints triangles / draw calls / FPS per view. Never starts a server.
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SHOTS='src/builder/tools/blender/hangar/refs/shots';
const argv=process.argv.slice(2);
const opt=k=>argv.includes(k)?argv[argv.indexOf(k)+1]:null;
const only=opt('--only')?.split(',')??null,perf=argv.includes('--perf'),preset=opt('--preset')??'Reliable',bank=Number(opt('--bank')??18);
const want=n=>only?only.includes(n):!['presets','elevator-retracted'].includes(n)||argv.includes('--all');
const {chromium}=await import('playwright-core');
mkdirSync(SHOTS,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
const result={errors:[],views:{}};
try{
  const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
  page.on('pageerror',e=>result.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')result.errors.push(m.text());});
  await page.goto('http://localhost:5280/sandbox/role1.hangar.html');
  await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:240000});await page.waitForTimeout(3000);
  if(preset!=='Reliable'){await page.evaluate(async n=>{const h=window.hangarInspect;await h.realShip.preset(n);h.makeRocket();h.build();},preset);await page.waitForTimeout(2500);}
  // Other agents' edits make Vite reload the page: wait for the scene again and retry the view once.
  const ready=async()=>{await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:240000});await page.waitForTimeout(3000);await page.evaluate(()=>window.hangarInspect.actions.arm());await page.waitForTimeout(2000);};
  const shot=async(name,fn,arg,opts={})=>{try{await shotOnce(name,fn,arg,opts);}catch(e){console.log('retry',name,String(e).split(String.fromCharCode(10))[0]);await ready();await shotOnce(name,fn,arg,opts);}};
  const shotOnce=async(name,fn,arg,{wait=1800,measure=false}={})=>{
    await page.evaluate(fn,arg);await page.waitForTimeout(wait);
    await page.evaluate(()=>window.hangarInspect.settle());await page.waitForTimeout(500);
    const file=path.join(SHOTS,'v5-access-'+name+'.jpg');await page.screenshot({path:file,type:'jpeg',quality:85});
    const stats=await page.evaluate(()=>window.hangarInspect.stats());
    const capture=measure?await page.evaluate(()=>window.hangarInspect.capturePerformance()):null;
    const scale=await page.evaluate(()=>window.hangarInspect.params.renderScale);
    result.views[name]={file,...stats,scale,capture};
    console.log(name,JSON.stringify(result.views[name]));
  };
  const arm=await page.evaluate(()=>{const h=window.hangarInspect;h.actions.arm();return {hatch:h.params.hatchHeight,top:h.shipData?.top};});
  await page.waitForTimeout(2500);
  result.arm={...arm,...await page.evaluate(()=>{const a=window.hangarInspect.access;return {y:a.state.y,extension:a.state.extension,target:a.state.target,tipX:a.state.tipX};})};
  console.log('arm',JSON.stringify(result.arm));
  const eye=[-bank/Math.SQRT2,1.7,-bank/Math.SQRT2];
  if(want('turnaround'))await shot('turnaround',e=>{const h=window.hangarInspect;h.look(e,h.consoleBank?.turnaroundTarget?.(e)??(()=>{const d=Math.hypot(e[0],e[2]),top=h.shipData?.top??36,a=(Math.atan2(7-e[1],d)+Math.atan2(7+top-e[1],d))/2;return [0,e[1]+d*Math.tan(a),0];})(),62);},eye,{wait:3000,measure:perf});
  if(want('overview'))await shot('overview',()=>window.hangarInspect.actions.accessOverview(),null,{wait:3000,measure:perf});
  if(want('crew'))await shot('crew',()=>window.hangarInspect.actions.crewView(),null,{wait:2500});
  if(want('elevator'))await shot('elevator',()=>{const h=window.hangarInspect;h.params.level=3;h.actions.elevator();h.actions.elevatorView();},null,{wait:5000});
  if(want('stairs'))await shot('stairs',()=>window.hangarInspect.actions.stairsView(),null,{wait:2500});
  if(want('frstairs'))await shot('frstairs',()=>window.hangarInspect.actions.frStairsView(),null,{wait:2500});
  // Crew arm per ship: close-up and high overview (floor ~1.1 m under the hatch, below the capsule top).
  if(want('presets')){
    result.presets={};
    for(const name of (opt('--presets')??'Reliable,Apollo,Workhorse').split(',')){
      await page.evaluate(async n=>{const h=window.hangarInspect;await h.realShip.preset(n);h.makeRocket();h.build();},name);await page.waitForTimeout(3500);
      result.presets[name]=await page.evaluate(()=>{const h=window.hangarInspect,s=h.access.state;return {top:h.shipData?.top,hatch:s.hatch,floor:s.floor,ladder:s.ladder,tipX:s.tipX,extension:s.extension};});
      console.log('preset',name,JSON.stringify(result.presets[name]));
      const tag=name.toLowerCase().replace(/\W+/g,'');
      await shot('crew-'+tag,()=>window.hangarInspect.actions.crewView(),null,{wait:2500});
      await shot('overview-'+tag,()=>window.hangarInspect.actions.accessOverview(),null,{wait:2500});
    }
    await page.evaluate(async()=>{const h=window.hangarInspect;await h.realShip.preset('Reliable');h.makeRocket();h.build();});await page.waitForTimeout(3000);
  }
  if(want('elevator-retracted')){
    await page.evaluate(()=>window.hangarInspect.actions.retract());await page.waitForTimeout(3500);
    await shot('elevator-retracted',()=>{const h=window.hangarInspect;h.look([4,30,-19.5],[17,22,-9],62);},null,{wait:2000});
    await page.evaluate(()=>window.hangarInspect.actions.close());await page.waitForTimeout(3000);
  }
  if(want('retracted')){
    await page.evaluate(()=>window.hangarInspect.actions.retract());await page.waitForTimeout(3500);
    await shot('retracted',()=>window.hangarInspect.actions.accessOverview(),null,{wait:2000});
    await page.evaluate(()=>window.hangarInspect.actions.close());await page.waitForTimeout(3000);
  }
}finally{await browser.close();}
writeFileSync(path.join(os.tmpdir(),'v5-access-check.json'),JSON.stringify(result,null,1));
console.log('errors',result.errors.length,JSON.stringify(result.errors.slice(0,6)));
