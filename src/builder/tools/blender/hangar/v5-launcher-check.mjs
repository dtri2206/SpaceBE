// Hangar v5 launcher: browser check and screenshots. Run through the lock from the repo root:
//   node src/builder/tools/blender/hangar/v5lock.mjs browser -- node src/builder/tools/blender/hangar/v5-launcher-check.mjs [--only name,name] [--no-fps]
// Uses the Vite server already on 5280. Writes refs/shots/v5-launcher-*.jpg and prints the report (JSON) to stdout.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const dir='src/builder/tools/blender/hangar/refs';
const argv=process.argv.slice(2);
const only=argv.includes('--only')?argv[argv.indexOf('--only')+1].split(','):null;
const fpsWanted=!argv.includes('--no-fps');
const preset=argv.includes('--preset')?argv[argv.indexOf('--preset')+1]:null;
const report={errors:[],shots:{},fps:{}};
const s2=Math.SQRT1_2;
// Eye points on the viewing diagonal (turnaround eye for bank distance d is (-d/sqrt2, 1.7, -d/sqrt2)).
const eye=d=>[-d*s2,1.7,-d*s2];
const views={
  eye18:{pos:eye(18),target:'slot',fov:68},
  eye15:{pos:eye(15),target:'slot',fov:68},
  eye22:{pos:eye(22),target:'slot',fov:68},
  base18:{pos:eye(18),target:[0,8.5,0],fov:50},
  wide:{pos:[-19.5,13,-20.5],target:[0,9,0],fov:62},
  hero:{pos:[-12.6,3.6,-9.4],target:[-4.6,4.1,-5.2],fov:60},
  deck:{pos:[-8.5,15.5,-9.5],target:[1,7,1.5],fov:62},
};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto('http://localhost:5280/sandbox/role1.hangar.html');
  await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:180000});
  if(preset)await page.evaluate(p=>window.hangarInspect.realShip.preset(p),preset);
  await page.waitForFunction(()=>window.hangarInspect.shipData,{},{timeout:120000});
  await page.waitForTimeout(4000);
  // Geometry checks on the drawn launcher batches (exact triangles, world space).
  report.geometry=await page.evaluate(()=>{
    const h=window.hangarInspect;const out={module:h.fragments.launcher.launcherModule,batches:0,triangles:0,min:[1e9,1e9,1e9],max:[-1e9,-1e9,-1e9],maxYInsideClear:-1e9};
    const m=new h.camera.matrixWorld.constructor(),v=new h.camera.position.constructor(),tri=[];
    const minR=pts=>{let inside=false;for(let i=0;i<3;i++){const [x1,z1]=pts[i],[x2,z2]=pts[(i+1)%3];if((z1>0)!==(z2>0)&&0<x1+(0-z1)*(x2-x1)/(z2-z1))inside=!inside;}if(inside)return 0;let best=1e9;for(let i=0;i<3;i++){const [x1,z1]=pts[i],[x2,z2]=pts[(i+1)%3],dx=x2-x1,dz=z2-z1,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,-(x1*dx+z1*dz)/l)):0;best=Math.min(best,Math.hypot(x1+t*dx,z1+t*dz));}return best;};
    h.scene.traverse(o=>{
      if(!o.isInstancedMesh||!/launcher_ml_v5|launcher_v5_/.test(o.material.name))return;
      out.batches++;o.getMatrixAt(0,m);const p=o.geometry.attributes.position,idx=o.geometry.index,n=idx?idx.count:p.count;out.triangles+=n/3;
      for(let i=0;i<n;i+=3){
        for(let k=0;k<3;k++){v.fromBufferAttribute(p,idx?idx.getX(i+k):i+k).applyMatrix4(m);tri[k]=[v.x,v.y,v.z];for(let a=0;a<3;a++){out.min[a]=Math.min(out.min[a],tri[k][a]);out.max[a]=Math.max(out.max[a],tri[k][a]);}}
        if(minR(tri.map(t=>[t[0],t[2]]))<6.5)out.maxYInsideClear=Math.max(out.maxYInsideClear,...tri.map(t=>t[1]));
      }
    });
    return out;
  });
  report.ship=await page.evaluate(()=>{const h=window.hangarInspect,s=h.scene.getObjectByName('real_player_ship');if(!s)return null;s.updateMatrixWorld(true);let lo=1e9,hi=-1e9,r=0;const v=new h.camera.position.constructor();s.traverse(o=>{if(!o.isMesh||!o.visible)return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i+=3){v.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);lo=Math.min(lo,v.y);hi=Math.max(hi,v.y);if(v.y<9)r=Math.max(r,Math.hypot(v.x,v.z));}});return {preset:h.params.preset,minY:lo,maxY:hi,baseOutlineRadius:r,top:h.shipData?.top};});
  report.colliders=await page.evaluate(()=>window.hangarInspect.activeColliders.filter(c=>c.kind==='ml'||c.kind==='stairs').length);
  // Vite may full-reload the page when another part agent saves a file: wait for the scene again before each step.
  const ready=async(native=true)=>{
    await page.waitForFunction(()=>window.hangarInspect?.ready&&window.hangarInspect.shipData,{},{timeout:180000});
    if(await page.evaluate(()=>!window.__launcherCheck)){
      report.reloads=(report.reloads??-1)+1;await page.waitForTimeout(3000);
      await page.addStyleTag({content:'.lil-gui,header,#info,aside{visibility:hidden!important}'});
      await page.evaluate(()=>{window.__launcherCheck=true;});
    }
    await page.evaluate(native=>{const h=window.hangarInspect;h.params.autoResolution=!native;h.setResolution(1);},native);
  };
  for(const [name,v] of Object.entries(views)){
    if(only&&!only.includes(name))continue;
    await ready();
    await page.evaluate(({pos,target,fov})=>{const h=window.hangarInspect;const t=target==='slot'?h.actions&&(()=>{const d=Math.hypot(pos[0],pos[2]),top=h.shipData?.top??20;const a=(Math.atan2(7-pos[1],d)+Math.atan2(7+top-pos[1],d))/2;return [0,pos[1]+d*Math.tan(a),0];})():target;h.look(pos,t,fov);},v);
    await page.waitForTimeout(1500);
    const path=`${dir}/shots/v5-launcher-${name}${preset?'-'+preset.toLowerCase():''}.jpg`;
    await page.screenshot({path,type:'jpeg',quality:85});report.shots[name]=path;
  }
  if(fpsWanted){
    for(const [name,pos,target] of [['eye18',eye(18),null],['overview',null,null]]){
      await ready(false);
      await page.evaluate(({name,pos})=>{const h=window.hangarInspect;if(name==='overview')h.actions.overview();else{const d=Math.hypot(pos[0],pos[2]),top=h.shipData?.top??20;const a=(Math.atan2(7-pos[1],d)+Math.atan2(7+top-pos[1],d))/2;h.look(pos,[0,pos[1]+d*Math.tan(a),0],68);}},{name,pos});
      await page.waitForTimeout(7000);   // let the automatic resolution settle
      const r=await page.evaluate(async()=>{const h=window.hangarInspect;const res=await h.capturePerformance();return {...res,scale:h.params.renderScale,...h.stats()};});
      report.fps[name]={average:r.average,minimum:r.minimum,scale:r.scale,triangles:r.triangles,drawCalls:r.drawCalls};
    }
  }
  if(argv.includes('--ab')){
    // A/B cost of the launcher alone: same eye-18 view, native resolution, launcher batches shown vs hidden.
    await ready(true);
    await page.evaluate(pos=>{const h=window.hangarInspect,d=Math.hypot(pos[0],pos[2]),top=h.shipData?.top??20;const a=(Math.atan2(7-pos[1],d)+Math.atan2(7+top-pos[1],d))/2;h.look(pos,[0,pos[1]+d*Math.tan(a),0],68);},eye(18));
    report.ab={};
    for(const shown of [true,false,true]){
      const r=await page.evaluate(async shown=>{const h=window.hangarInspect;h.scene.traverse(o=>{if(o.isInstancedMesh&&/launcher_ml_v5|launcher_v5_/.test(o.material.name))o.visible=shown;});await new Promise(r=>setTimeout(r,2500));const res=await h.capturePerformance();return {average:res.average,triangles:h.stats().triangles};},shown);
      report.ab[(shown?'with':'without')+(report.ab.with&&shown?'2':'')]=r;
    }
  }
  const g=report.geometry;
  assert.equal(g.module,'launcher_ml_v5');assert.ok(g.batches>=4,'launcher batches drawn');
  assert.ok(g.maxYInsideClear<=7.4,'nothing above Y 7.4 inside r 6.5: '+g.maxYInsideClear);
  assert.ok(Math.max(...g.max.filter((_,i)=>i!==1).map(Math.abs),...g.min.filter((_,i)=>i!==1).map(Math.abs))<=8.1,'footprint within 8.1 m');
}finally{
  await browser.close();
  console.log(JSON.stringify(report,null,2));
}
