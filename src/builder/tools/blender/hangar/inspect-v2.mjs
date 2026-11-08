// One Chrome process; no changes to the live game, Git, dependencies, or port 5173.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const refs=path.resolve('src/builder/tools/blender/hangar/refs');mkdirSync(path.join(refs,'shots'),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(String(e)));
const report={date:new Date().toISOString(),browser:browser.version(),viewport:[1440,860],errors,views:{}};
report.httpErrors=[];page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
const shot=async name=>{await page.waitForTimeout(1100);await page.locator('.lil-gui').first().evaluate(el=>el.style.visibility='hidden');await page.screenshot({path:path.join(refs,'shots',name+'.jpg'),type:'jpeg',quality:78});await page.locator('.lil-gui').first().evaluate(el=>el.style.visibility='visible');};
try{
  await page.goto('http://localhost:5280/sandbox/role1.hangar.html');
  await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:60000});
  await page.waitForTimeout(1500);
  report.gpu=await page.evaluate(()=>{const gl=window.hangarInspect.renderer.getContext();const ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixelRatio:window.hangarInspect.renderer.getPixelRatio()};});
  // Grey-box evidence uses exactly the same layout data as the detailed hall.
  for(const [name,preset]of [['blockout-ground','ground'],['blockout-overview','overview'],['blockout-platform','crewView']]){
    await page.evaluate(p=>window.hangarInspect.actions[p](),preset);
    // Toggle via the labelled GUI so the same code path is exercised as human inspection.
    if(name==='blockout-ground')await page.getByText('Grey-box massing',{exact:true}).locator('..').locator('input').check();
    await page.waitForTimeout(200);await shot(name);
  }
  await page.getByText('Grey-box massing',{exact:true}).locator('..').locator('input').uncheck();
  for(const radius of ['s','m','l'])for(const height of [8,36,60]){
    const positions=await page.evaluate(({radius,height})=>{const h=window.hangarInspect;h.params.radius=radius;h.params.height=height;h.makeRocket();h.build();h.actions.close();h.settle();return h.platforms().map(o=>({y:o.position.y,x:o.position.x}));},{radius,height});
    for(const p of positions)assert.ok(Math.abs(Math.abs(p.x)-(p.y>7+height?4:0))<.001,'correct slide offset for '+radius+'/'+height);
  }
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.radius='m';h.params.height=36;h.params.lod=true;h.makeRocket();h.build();h.actions.close();h.settle();h.actions.ground();});
  for(const [name,preset]of [['ground-look-up','ground'],['overview','overview'],['platform-close-up','platformView'],['collar','collarView'],['ceiling-vault','ceilingView']]){
    await page.evaluate(p=>window.hangarInspect.actions[p](),preset);await page.waitForTimeout(1800);
    report.views[name]={...await page.evaluate(()=>window.hangarInspect.stats()),performance:await page.evaluate(()=>window.hangarInspect.capturePerformance())};await shot(name);
  }
  await page.evaluate(()=>window.hangarInspect.actions.ground());
  await page.waitForTimeout(3500);report.lod=await page.evaluate(()=>window.hangarInspect.stats());await shot('ground-look-up');
  await page.evaluate(()=>window.hangarInspect.actions.overview());await page.waitForTimeout(1000);await shot('platforms-closed');
  await page.evaluate(()=>window.hangarInspect.actions.retract());await page.waitForTimeout(2000);await shot('platforms-retracted');
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.level=5;h.actions.elevator();h.settle();h.actions.elevatorView();});await page.waitForTimeout(300);await shot('elevator');
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.hatchHeight=38;h.actions.arm();h.settle();h.actions.crewView();});await page.waitForTimeout(300);await shot('crew-arm');
  // All faces present; no cutaway or hidden collider helpers when measuring budgets.
  for(const lod of [false,true]){
    await page.evaluate(v=>{const h=window.hangarInspect;h.params.cutaway=false;h.params.lod=v;h.build();h.actions.overview();},lod);await page.waitForTimeout(5000);
    report[lod?'completeLod':'completeFull']=await page.evaluate(()=>window.hangarInspect.stats());
  }
  assert.ok(report.completeFull.triangles<=1000000,'full triangles');assert.ok(report.completeLod.triangles<=1000000,'LOD triangles');assert.ok(report.completeFull.structuralCalls<=150,'draw calls');
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.gameLook=false;h.setLook();});await page.waitForTimeout(300);await shot('flat');
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.gameLook=true;h.setLook();});
  report.motion=await page.evaluate(()=>{const h=window.hangarInspect;h.params.level=7;h.actions.elevator();h.params.hatchHeight=50;h.actions.arm();h.params.trolley=6;h.params.hook=12;h.params.door=20;h.settle();const roots=h.roots();const node=name=>{for(const r of roots){const o=r.getObjectByName(name);if(o)return o;}};return {cabY:node('pose_cab').position.y,tipX:node('attach_tip').getWorldPosition(h.camera.position.clone()).x,trolleyX:node('pose_trolley').position.x,hookY:node('pose_hook').position.y,doorY:node('pose_door').position.y};});
  assert.equal(report.motion.cabY,47);assert.ok(Math.abs(report.motion.tipX+1.25)<.001);assert.equal(report.motion.trolleyX,6);assert.equal(report.motion.hookY,-12);assert.equal(report.motion.doorY,20);
  // Ground collision smoke test: walk toward the ML; the player must stop outside it.
  await page.evaluate(()=>{const h=window.hangarInspect;h.actions.ground();h.params.walk=true;h.camera.lookAt(0,1.7,0);});
  await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(3000);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');
  report.walk=await page.evaluate(()=>window.hangarInspect.camera.position.toArray());assert.ok(report.walk[2]<=-8.29,'ML collision');assert.equal(report.walk[1],1.7);
  report.sandboxErrors=[...errors];assert.equal(errors.length,0,'sandbox browser errors');
  // Original renders only. No reference photograph is copied into these comparison sheets.
  for(const [name,left,right]of [['massing','blockout-overview','platforms-closed'],['platform-motion','platforms-closed','platforms-retracted'],['detail','../before/ground-look-up','ground-look-up']]){
    const uri=n=>'data:image/jpeg;base64,'+readFileSync(path.join(refs,'shots',n+'.jpg')).toString('base64');
    await page.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#15212a;color:#eee;font:18px system-ui}h1{padding:15px;font-size:24px}main{display:flex}figure{margin:8px;width:50%}img{width:100%}</style><h1>SpaceB&E · High bay · ${name} · own renders</h1><main><figure><figcaption>${left}</figcaption><img src="${uri(left)}"></figure><figure><figcaption>${right}</figcaption><img src="${uri(right)}"></figure></main>`);
    await page.screenshot({path:path.join(refs,'compare-'+name+'.png')});
  }
  const gameErrorStart=errors.length;
  await page.goto('http://localhost:5280/?debug=1&state=HANGAR');
  try{await page.waitForFunction(()=>window.__game?.getState()==='HANGAR'&&window.__game.frames>5,{},{timeout:60000});report.game=await page.evaluate(()=>({state:window.__game.getState(),frames:window.__game.frames}));}catch(e){report.game={error:String(e)};}
  report.gameErrors=errors.slice(gameErrorStart);
  assert.equal(report.gameErrors.length,0,'game browser errors');assert.equal(report.httpErrors.length,0,'HTTP errors');assert.equal(report.game.state,'HANGAR');
}finally{writeFileSync(path.join(refs,'inspection.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
