import {chromium} from 'playwright-core';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report={errors:[],rounds:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto('http://localhost:5280/sandbox/role1.hangar.html');await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});
  const choices=await page.evaluate(()=>{const h=window.hangarInspect;return ['nose','body','tail'].flatMap(sec=>h.realShip.sections[sec].shapes.slice(0,7).map(s=>[sec,s.id])).slice(0,20);});
  for(let round=0;round<2;round++){
    for(const [sec,id]of choices){await page.evaluate(async({sec,id})=>{const h=window.hangarInspect;await h.realShip.shape(sec,id);h.makeRocket();h.build();},{sec,id});await page.waitForTimeout(100);}
    await page.evaluate(async()=>{const h=window.hangarInspect;await h.realShip.preset('Reliable');h.makeRocket();h.build();h.actions.ground();});await page.waitForTimeout(1000);
    report.rounds.push(await page.evaluate(()=>({...window.hangarInspect.renderer.info.memory})));console.log(JSON.stringify(report.rounds.at(-1)));
  }
  await page.evaluate(()=>window.hangarInspect.consoleBank.sit('station_builder'));await page.waitForTimeout(800);await page.screenshot({path:'src/builder/tools/blender/hangar/refs/shots/v3-console-check.jpg'});
}finally{await browser.close();writeFileSync('src/builder/tools/blender/hangar/refs/memory-v3.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
