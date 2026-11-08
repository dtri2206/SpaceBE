// Sequential render-scale trial on one browser/page; writes only kit references.
import { chromium } from 'playwright-core';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const results=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});
  page.on('pageerror',e=>console.error(e));
  await page.goto('http://localhost:5280/sandbox/role1.hangar.html');await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});
  for(const scale of [.75,.6,.5,.45]){
    await page.evaluate(s=>window.hangarInspect.setResolution(s),scale);
    for(const view of ['ground','overview']){
      await page.evaluate(v=>window.hangarInspect.actions[v](),view);await page.waitForTimeout(2500);
      const p=await page.evaluate(()=>window.hangarInspect.capturePerformance());results.push({scale,view,...p});console.log(JSON.stringify(results.at(-1)));
    }
  }
}finally{writeFileSync('src/builder/tools/blender/hangar/refs/scale-trial.json',JSON.stringify(results,null,2));await browser.close();}
