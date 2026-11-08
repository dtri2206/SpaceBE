import {chromium} from 'playwright-core';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report={errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(['error','warning'].includes(m.type()))console.log(m.type(),m.text());if(m.type()==='error')report.errors.push(m.text());});
 await page.goto('http://localhost:5280/sandbox/role1.hangar.html');await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});await page.waitForTimeout(8000);
 report.initial=await page.evaluate(()=>{const h=window.hangarInspect;return {stats:h.stats(),scale:h.params.renderScale,segments:h.platforms().map(p=>({id:p.userData.placement.segment,pos:p.position.toArray()}))};});
 for(const [name,action]of [['slot','slotView'],['overview','wrapOverview'],['bank','consoleWide'],['desk','close_station_builder']]){
   await page.evaluate(a=>window.hangarInspect.actions[a](),action);await page.waitForTimeout(800);await page.screenshot({path:'src/builder/tools/blender/hangar/refs/shots/v4-smoke-'+name+'.png'});
 }
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();writeFileSync('src/builder/tools/blender/hangar/refs/smoke-v4.json',JSON.stringify(report,null,2));}
