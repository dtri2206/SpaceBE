import {chromium} from 'playwright-core';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dir='src/builder/tools/blender/hangar/refs',report={errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://localhost:5280/sandbox/role1.hangar.html');await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});await page.waitForTimeout(10000);
 const pos=()=>page.evaluate(()=>window.hangarInspect.camera.position.toArray());
 await page.evaluate(()=>window.hangarInspect.actions.consoleWide());await page.keyboard.press('f');
 report.modifiers={};
 for(const [name,modifier]of [['normal',null],['fast','Shift'],['slow','Control']]){const a=await pos();if(modifier)await page.keyboard.down(modifier);await page.keyboard.down('d');await page.waitForTimeout(500);await page.keyboard.up('d');if(modifier)await page.keyboard.up(modifier);const b=await pos();report.modifiers[name]=Math.hypot(...a.map((v,i)=>v-b[i]));}
 assert.ok(report.modifiers.fast>report.modifiers.normal*2.5);assert.ok(report.modifiers.slow<report.modifiers.normal*.35);
 const a=await pos();await page.keyboard.down('q');await page.waitForTimeout(300);await page.keyboard.up('q');const b=await pos();assert.ok(b[1]<a[1]-.4,'Q descends');
 await page.keyboard.press('f');await page.evaluate(()=>window.hangarInspect.actions.slotView());await page.waitForTimeout(9000);
 report.rotation=await page.evaluate(async()=>{const h=window.hangarInspect;h.cameraRig.setMode('fly');const q=h.camera.quaternion.clone(),startBuilds=h.stats().buildCount,perf=h.capturePerformance();await new Promise(resolve=>{let start;function frame(now){start??=now;const t=Math.min(1,(now-start)/5500);h.camera.quaternion.copy(q);h.camera.rotateY(Math.sin(t*Math.PI*2)*.12);if(t<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});h.cameraRig.setMode('orbit');return {...await perf,rebatches:h.stats().buildCount-startBuilds,scale:h.params.renderScale};});assert.equal(report.rotation.rebatches,0);
 await page.evaluate(()=>{const h=window.hangarInspect;h.params.autoResolution=false;h.setResolution(1);});
 const style=await page.addStyleTag({content:'.lil-gui,header,#info,aside{visibility:hidden!important}'});
 for(const [name,action]of [['console-bank','consoleWide'],['station_builder-close','close_station_builder'],['station_window-close','close_station_window'],['station_testfire-close','close_station_testfire'],['station_launch-close','close_station_launch']]){await page.evaluate(action=>window.hangarInspect.actions[action](),action);await page.waitForTimeout(800);await page.screenshot({path:dir+'/shots/v4-'+name+'.png'});}
 await style.evaluate(e=>e.remove());assert.equal(report.errors.length,0);
}finally{await browser.close();writeFileSync(dir+'/camera-check-v4.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
