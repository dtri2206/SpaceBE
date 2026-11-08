// One browser, one page, sequential checks; sandbox inspection hooks only.
import {chromium} from 'playwright-core';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const refs='src/builder/tools/blender/hangar/refs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report={date:new Date().toISOString(),browser:browser.version(),viewport:[1440,860],views:{},versions:{},shots:{},errors:[],httpErrors:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
 const pause=ms=>page.waitForTimeout(ms);
 async function open(suffix){await page.goto('http://localhost:5280/sandbox/role1.hangar.html'+suffix);await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});await pause(1600);}
 async function shot(name){
  const style=await page.addStyleTag({content:'.lil-gui,header,#info,aside{visibility:hidden!important}'});
  const buffer=await page.screenshot({path:refs+'/shots/v4-'+name+'.png'});await style.evaluate(e=>e.remove());
  const clipping=await page.evaluate(async encoded=>{const im=new Image();im.src='data:image/png;base64,'+encoded;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data,n=c.width*c.height,mask=new Uint8Array(n),queue=new Int32Array(n);let white=0,biggest=0;
   for(let i=0;i<n;i++)if(d[4*i]>=250&&d[4*i+1]>=250&&d[4*i+2]>=250){mask[i]=1;white++;}
   for(let i=0;i<n;i++){if(mask[i]!==1)continue;let head=0,tail=1;queue[0]=i;mask[i]=2;while(head<tail){const p=queue[head++];for(const j of [p-1,p+1,p-c.width,p+c.width])if(j>=0&&j<n&&mask[j]===1&&(!(j===p-1||j===p+1)||Math.floor(p/c.width)===Math.floor(j/c.width))){mask[j]=2;queue[tail++]=j;}}biggest=Math.max(biggest,tail);}return {whitePixels:white,whitePercent:white/n*100,largestClippedRegionPixels:biggest};},buffer.toString('base64'));
  report.shots[name]=clipping;return clipping;
 }
 async function action(name){await page.evaluate(name=>window.hangarInspect.actions[name](),name);await pause(800);}
 async function snapshot(){return page.evaluate(()=>{const h=window.hangarInspect;return {...h.stats(),renderScale:h.params.renderScale,memory:{...h.renderer.info.memory}};});}
 async function view(actionName,shotName){await action(actionName);await pause(10000);const performance=await page.evaluate(()=>window.hangarInspect.capturePerformance());const value={...await snapshot(),performance,clipping:await shot(shotName)};console.log(actionName,JSON.stringify(value));return value;}
 async function drag(){
  await action('overview');const before=await page.evaluate(()=>window.hangarInspect.camera.position.toArray());
  await page.mouse.move(640,420);await page.mouse.down();await page.mouse.move(800,460,{steps:16});await page.mouse.up();await pause(700);
  const after=await page.evaluate(()=>window.hangarInspect.camera.position.toArray());const distance=Math.hypot(...before.map((v,i)=>v-after[i]));assert.ok(distance>.1,'actual canvas drag reaches OrbitControls');return {before,after,distance};
 }
 for(const version of ['2','3']){console.log('Compatibility',version);await open('?v='+version);report.versions[version]={drag:await drag(),stats:await snapshot(),errors:[...report.errors]};assert.equal(report.errors.length,0,'saved version '+version);}
 await open('');report.versions[4]={drag:await drag()};
 report.gpu=await page.evaluate(()=>{const h=window.hangarInspect,gl=h.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(e?e.UNMASKED_RENDERER_WEBGL:gl.RENDERER),pixelRatio:h.renderer.getPixelRatio()};});
 assert.equal(await page.evaluate(()=>!!window.hangarInspect.realShip&&window.hangarInspect.params.realShip),true);
 report.views.slot=await view('slotView','slot-view');report.views.overview=await view('wrapOverview','wrap-overview');
 assert.ok(Object.values(report.views).every(v=>v.renderScale>=.8));
 assert.ok(report.views.slot.performance.average>=55,'slot sustained average >=55 FPS');
 assert.ok(report.views.overview.performance.average>=60,'overview sustained average >=60 FPS');
 // Real input, rather than synthetic calls to movement math.
 await action('consoleWide');await page.keyboard.press('f');
 const start=await page.evaluate(()=>window.hangarInspect.camera.position.toArray());await page.keyboard.down('w');await pause(450);await page.keyboard.up('w');await page.keyboard.down('e');await pause(300);await page.keyboard.up('e');
 const moved=await page.evaluate(()=>window.hangarInspect.camera.position.toArray());assert.ok(moved[1]>start[1]+.3,'E flies upward');assert.ok(Math.hypot(...start.map((v,i)=>v-moved[i]))>1);
 const q0=await page.evaluate(()=>window.hangarInspect.camera.quaternion.toArray());await page.mouse.move(640,430);await page.mouse.down({button:'right'});await page.mouse.move(760,390,{steps:12});await page.mouse.up({button:'right'});
 const q1=await page.evaluate(()=>window.hangarInspect.camera.quaternion.toArray());assert.ok(Math.hypot(...q0.map((v,i)=>v-q1[i]))>.05,'RMB looks');
 const speed0=await page.evaluate(()=>window.hangarInspect.params.flySpeed);await page.mouse.wheel(0,-120);await pause(100);assert.ok(await page.evaluate(s=>window.hangarInspect.params.flySpeed>s,speed0));
 report.freeFly={start,moved,rmbQuaternionDelta:Math.hypot(...q0.map((v,i)=>v-q1[i])),near:await page.evaluate(()=>window.hangarInspect.camera.near)};assert.equal(report.freeFly.near,.05);await page.keyboard.press('f');
 await action('consoleWide');const target0=await page.evaluate(()=>window.hangarInspect.cameraRig.target.toArray());await page.mouse.dblclick(720,470);await pause(350);const target1=await page.evaluate(()=>window.hangarInspect.cameraRig.target.toArray());assert.ok(Math.hypot(...target0.map((v,i)=>v-target1[i]))>.1,'double click focuses visible surface');report.orbitFocus={before:target0,after:target1};
 report.collars={};
 for(const name of ['Reliable','Apollo','Workhorse']){
  await page.evaluate(async name=>{const h=window.hangarInspect;await h.realShip.preset(name);h.params.preset=name;h.makeRocket();h.refit();h.actions.close();h.settle();h.look([7.5,16,-12],[0,11,0],65);},name);await pause(1700);
  report.collars[name]=await page.evaluate(()=>{const h=window.hangarInspect;return {height:h.shipData.top,parts:h.shipData.entries.length,radials:h.shipData.entries.filter(e=>e.attach==='radial'&&!e.inside).map(e=>({type:e.type,angle:e.angle})),fits:h.collars.fits,failures:h.realShip.data.failures};});assert.deepEqual(report.collars[name].failures,{});await shot('collar-'+name.toLowerCase());
 }
 await page.evaluate(async()=>{const h=window.hangarInspect;await h.realShip.preset('Reliable');h.params.preset='Reliable';h.makeRocket();h.actions.close();h.settle();});
 for(const mode of ['closed','retracted']){
  await page.evaluate(mode=>{const h=window.hangarInspect;h.actions[mode==='closed'?'close':'retract']();h.settle();},mode);
  for(const [segment,pos]of [['right',[20,20,-16]],['left',[-20,20,-16]],['back',[0,22,20]]]){await page.evaluate(pos=>window.hangarInspect.look(pos,[0,11,0],68),pos);await pause(600);await shot(segment+'-'+mode);}
  const poses=await page.evaluate(()=>window.hangarInspect.platforms().filter(p=>p.userData.placement.level===0).map(p=>({segment:p.userData.placement.segment,position:p.position.toArray(),offset:p.userData.offset})));report[mode]=poses;
  for(const p of poses){const axis={left:[-1,0,0],right:[1,0,0],back:[0,0,1]}[p.segment];for(const i of [0,2])assert.ok(Math.abs(p.position[i]-axis[i]*(mode==='closed'?0:4))<.01,'segment slide '+p.segment);}
 }
 await page.evaluate(()=>{const h=window.hangarInspect;h.actions.close();h.settle();});
 // Native-resolution portfolio captures; performance views above use the real automatic controller.
 await page.evaluate(()=>{const h=window.hangarInspect;h.params.autoResolution=false;h.setResolution(1);});
 await action('consoleWide');await shot('console-bank');
 for(const id of ['station_window','station_builder','station_testfire','station_launch']){await action('close_'+id);await shot(id+'-close');}
 // The console editor still rebuilds both real art and the live collar outline.
 await page.evaluate(()=>window.hangarInspect.consoleBank.sit('station_builder'));const revision=await page.evaluate(()=>window.hangarInspect.shipData.revision);await page.locator('aside select').nth(1).selectOption({index:2});await page.waitForFunction(r=>window.hangarInspect.shipData.revision>r,revision,{timeout:60000});report.builderSync={before:revision,after:await page.evaluate(()=>window.hangarInspect.shipData.revision)};
 await page.evaluate(async()=>{const h=window.hangarInspect;await h.realShip.preset('Reliable');h.params.preset='Reliable';h.makeRocket();h.actions.close();h.settle();h.consoleBank.sit('station_builder');});await pause(600);await page.evaluate(()=>window.hangarInspect.consoleBank.stand());await pause(1800);await shot('turnaround-reveal');
 report.reveal=await page.evaluate(()=>{const h=window.hangarInspect;return {position:h.camera.position.toArray(),direction:h.camera.getWorldDirection(h.camera.position.clone()).toArray()};});assert.ok(report.reveal.direction[2]>0);assert.ok(Math.abs(report.reveal.position[1]-1.7)<1e-5);
 await page.evaluate(()=>{const h=window.hangarInspect;h.params.autoResolution=true;h.look([Math.sin(.2)*60,39,-Math.cos(.2)*60],[0,38,0],68);});await pause(1800);await shot('far-orbit-60');
 report.slowOrbit=await page.evaluate(async()=>{const h=window.hangarInspect;h.cameraRig.setMode('fly');const builds=h.stats().buildCount,capture=h.capturePerformance();await new Promise(resolve=>{let start;function frame(now){start??=now;const t=Math.min(1,(now-start)/5500),a=.2+.15*t;h.camera.position.set(Math.sin(a)*60,39,-Math.cos(a)*60);h.camera.lookAt(0,38,0);if(t<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});h.cameraRig.setMode('orbit');return {...await capture,rebatches:h.stats().buildCount-builds};});assert.equal(report.slowOrbit.rebatches,0,'far orbit does not rebuild batches');
 // Full visible kit bound, with the real ship and post-processing included.
 await page.evaluate(()=>{const h=window.hangarInspect;h.params.cutaway=false;h.params.lod=false;h.actions.overview();h.build();});await pause(1500);report.completeFull=await snapshot();assert.ok(report.completeFull.triangles<=1000000,'drawn full kit + ship <1M');
 // Two identical twenty-shape sequences distinguish first-use model caches from leaks.
 report.memory=[];const choices=await page.evaluate(()=>['nose','body','tail'].flatMap(sec=>window.hangarInspect.realShip.sections[sec].shapes.slice(0,7).map(s=>[sec,s.id])).slice(0,20));
 for(let round=0;round<2;round++){
  for(const [sec,id]of choices){await page.evaluate(async({sec,id})=>{const h=window.hangarInspect;await h.realShip.shape(sec,id);h.makeRocket();},{sec,id});await pause(70);}
  await page.evaluate(async()=>{const h=window.hangarInspect;await h.realShip.preset('Reliable');h.makeRocket();h.params.lod=true;h.params.cutaway=true;h.actions.slotView();});await pause(1000);report.memory.push(await page.evaluate(()=>({...window.hangarInspect.renderer.info.memory})));
 }
 assert.deepEqual(report.memory[1],report.memory[0],'same resident geometry/texture count after repeated twenty-shape sequence');
 report.sandboxErrors=[...report.errors];assert.equal(report.errors.length,0);
 const errorStart=report.errors.length;await page.goto('http://localhost:5280/?debug=1&state=HANGAR');await page.waitForFunction(()=>window.__game?.getState()==='HANGAR'&&window.__game.frames>5,{},{timeout:60000});report.game=await page.evaluate(()=>({state:window.__game.getState(),frames:window.__game.frames}));report.gameErrors=report.errors.slice(errorStart);assert.equal(report.gameErrors.length,0);assert.equal(report.httpErrors.length,0);
 console.log('PASS: all versions drag; fly, focus, collars, segment slides, editor sync, reveal and game smoke.');
}finally{writeFileSync(refs+'/inspection-v4.json',JSON.stringify(report,null,2));console.log(JSON.stringify({views:report.views,errors:report.errors,httpErrors:report.httpErrors,game:report.game,full:report.completeFull},null,2));await browser.close();}
