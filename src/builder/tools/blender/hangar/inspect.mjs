// One browser/page, sequential phases. No Git/dependency/server mutations.
import {chromium} from 'playwright-core';
import {writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const refs='src/builder/tools/blender/hangar/refs';
if(process.argv.includes('--v4')){await import('./inspect-v4.mjs');process.exit(0);}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report={date:new Date().toISOString(),browser:browser.version(),viewport:[1440,860],views:{},before:{},errors:[],httpErrors:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
  async function open(suffix='?v=3'){await page.goto('http://localhost:5280/sandbox/role1.hangar.html'+suffix);await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});await page.waitForTimeout(2000);}
  async function shot(name){
    await page.addStyleTag({content:'.lil-gui,header,#info,aside {visibility:hidden!important}'});
    const buffer=await page.screenshot({path:refs+'/shots/'+name+'.png',type:'png'});
    const clipping=await page.evaluate(async encoded=>{
      const im=new Image();im.src='data:image/png;base64,'+encoded;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const d=x.getImageData(0,0,c.width,c.height).data,n=c.width*c.height,mask=new Uint8Array(n),q=new Int32Array(n);let white=0,biggest=0;
      for(let i=0;i<n;i++)if(d[4*i]>=250&&d[4*i+1]>=250&&d[4*i+2]>=250){mask[i]=1;white++;}
      for(let i=0;i<n;i++){if(mask[i]!==1)continue;let head=0,tail=1;q[0]=i;mask[i]=2;while(head<tail){const p=q[head++];for(const j of [p-1,p+1,p-c.width,p+c.width])if(j>=0&&j<n&&mask[j]===1&&(!(j===p-1||j===p+1)||Math.floor(p/c.width)===Math.floor(j/c.width))){mask[j]=2;q[tail++]=j;}}biggest=Math.max(biggest,tail);}
      return {whitePixels:white,whitePercent:white/n*100,largestClippedRegionPixels:biggest};
    },buffer.toString('base64'));
    await page.locator('style').last().evaluate(e=>e.remove());return clipping;
  }
  async function view(preset,name){
    await page.evaluate(v=>window.hangarInspect.actions[v](),preset);await page.waitForTimeout(10000);
    const performance=await page.evaluate(()=>window.hangarInspect.capturePerformance());
    const data=await page.evaluate(()=>{const h=window.hangarInspect;return {...h.stats(),renderScale:h.params.renderScale,memory:{...h.renderer.info.memory}};});
    return {...data,performance,clipping:await shot(name)};
  }
  await open('?v=2');
  report.before.ground=await view('ground','before-glare-ground');report.before.overview=await view('overview','before-glare-overview');
  await open();
  report.gpu=await page.evaluate(()=>{const h=window.hangarInspect,gl=h.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),pixelRatio:h.renderer.getPixelRatio()};});
  assert.equal(await page.evaluate(()=>!!window.hangarInspect.realShip&&window.hangarInspect.params.realShip),true,'real art loaded, not fallback');
  report.views['ground-look-up']=await view('ground','after-ground-real');report.views.overview=await view('overview','after-overview-real');
  for(const m of Object.values(report.views))assert.ok(m.renderScale>=.8,'resolution floor 0.8');
  // Same cylinder/height as the v2 baseline: isolate lighting/LOD from the new ship art.
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.realShip=false;h.params.height=36;h.makeRocket();h.refit();h.build();});
  report.glareGround=await view('ground','after-glare-ground');report.glareOverview=await view('overview','after-glare-overview');
  await page.evaluate(()=>{const h=window.hangarInspect;h.params.realShip=true;h.makeRocket();});
  report.collars={};
  for(const preset of ['Reliable','Apollo','Workhorse']){
    await page.evaluate(async name=>{const h=window.hangarInspect;h.params.preset=name;await h.realShip.preset(name);h.makeRocket();h.refit();h.build();h.actions.close();h.settle();const level=h.layout.levels.find(l=>!h.collars.fits[h.layout.levels.indexOf(l)].retract);const y=level?.y??11;h.look([9,y+6,-11],[0,y,0],65);},preset);
    await page.waitForTimeout(2000);
    report.collars[preset]=await page.evaluate(()=>{const h=window.hangarInspect;return {top:h.shipData.top,parts:h.shipData.entries.length,radials:h.shipData.entries.filter(e=>e.attach==='radial'&&!e.inside).map(e=>({type:e.type,angle:e.angle,outline:e.outline})),fits:h.collars.fits,failures:h.realShip.data.failures};});
    assert.deepEqual(report.collars[preset].failures,{},'NASA model preload failures');
    await shot('collar-'+preset.toLowerCase());
  }
  await page.evaluate(()=>{const h=window.hangarInspect;h.look([0,5,-10.5],[0,1.2,-16],68);});await page.waitForTimeout(600);await shot('console-bank');
  for(const id of ['station_window','station_builder','station_testfire','station_launch']){await page.evaluate(id=>window.hangarInspect.consoleBank.sit(id),id);await page.waitForTimeout(700);await shot(id);}
  await page.evaluate(()=>window.hangarInspect.consoleBank.sit('station_builder'));
  const oldRevision=await page.evaluate(()=>window.hangarInspect.shipData.revision);
  await page.locator('aside select').nth(1).selectOption({index:2});
  await page.waitForFunction(revision=>window.hangarInspect.shipData.revision>revision,oldRevision,{timeout:60000});
  report.builderSync={before:oldRevision,after:await page.evaluate(()=>window.hangarInspect.shipData.revision)};
  // Optional retraction is an explicit existing sandbox control, not an automatic game action.
  await page.evaluate(async()=>{const h=window.hangarInspect;await h.realShip.preset('Apollo');h.actions.retract();h.settle();h.consoleBank.sit('station_builder');});
  await page.waitForTimeout(500);await page.evaluate(()=>window.hangarInspect.consoleBank.stand());await page.waitForTimeout(750);await shot('turnaround-mid');await page.waitForTimeout(1000);await shot('turnaround-reveal');
  report.reveal=await page.evaluate(()=>({position:window.hangarInspect.camera.position.toArray(),direction:window.hangarInspect.camera.getWorldDirection(window.hangarInspect.camera.position.clone()).toArray()}));assert.ok(report.reveal.direction[2]>0,'reveal looks rocketward');assert.ok(Math.abs(report.reveal.position[1]-1.7)<1e-6);
  await page.evaluate(()=>{const h=window.hangarInspect;h.actions.overview();h.scene.userData.orbitTime=0;});
  report.orbitMotion=await page.evaluate(async()=>{
    const h=window.hangarInspect;h.actions.overview();const perf=h.capturePerformance();
    await new Promise(resolve=>{let start;function frame(now){start??=now;const t=Math.min(1,(now-start)/5500),r=40+40*t,a=-.3+.6*t;h.camera.position.set(Math.sin(a)*r,39,-Math.cos(a)*r);h.camera.lookAt(0,38,0);if(t<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});return perf;
  });
  report.orbit=[];
  for(const radius of [40,60,80]){await page.evaluate(r=>{const h=window.hangarInspect;h.actions.overview();h.look([Math.sin(.25)*r,39,-Math.cos(.25)*r],[0,38,0],68);},radius);await page.waitForTimeout(400);await shot('far-orbit-'+radius);report.orbit.push({radius,stats:await page.evaluate(()=>window.hangarInspect.stats())});}
  report.lod=report.views['ground-look-up'];
  for(const lod of [false,true]){
    await page.evaluate(v=>{const h=window.hangarInspect;h.params.cutaway=false;h.params.lod=v;h.actions.ground();h.build();},lod);await page.waitForTimeout(2000);report[lod?'completeLod':'completeFull']=await page.evaluate(()=>window.hangarInspect.stats());
  }
  report.sandboxErrors=[...report.errors];assert.equal(report.errors.length,0,'sandbox console errors');
  const errorStart=report.errors.length;await page.goto('http://localhost:5280/?debug=1&state=HANGAR');await page.waitForFunction(()=>window.__game?.getState()==='HANGAR'&&window.__game.frames>5,{},{timeout:60000});report.game=await page.evaluate(()=>({state:window.__game.getState(),frames:window.__game.frames}));report.gameErrors=report.errors.slice(errorStart);assert.equal(report.gameErrors.length,0);assert.equal(report.httpErrors.length,0);
  // Own before/after renders only; no reference photograph is copied.
  for(const mode of ['ground','overview']){
    const uri=name=>'data:image/png;base64,'+readFileSync(refs+'/shots/'+name+'.png').toString('base64');
    await page.setContent('<link rel="icon" href="data:,"><style>body{margin:0;background:#10191c;color:#d3dddd;font:18px system-ui}main{display:flex}figure{margin:8px;width:50%}img{width:100%}</style><h2>Glare / clarity — original sandbox renders</h2><main><figure>v2, fixed 0.60 scale<img src="'+uri('before-glare-'+mode)+'"></figure><figure>v3, native start + automatic resolution<img src="'+uri('after-glare-'+mode)+'"></figure></main>');await page.screenshot({path:refs+'/compare-glare-'+mode+'.png'});
  }
  assert.equal(report.errors.length,0,'all inspection console errors');
}finally{writeFileSync(refs+'/inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify({errors:report.errors,httpErrors:report.httpErrors,views:report.views,game:report.game},null,2));await browser.close();}
