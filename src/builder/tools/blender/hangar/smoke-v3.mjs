// UI regressions: fallback fit, camera-driven LOD, preserved cab pose and diagnostics.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
const report={errors:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:860},deviceScaleFactor:1});page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto('http://localhost:5280/sandbox/role1.hangar.html');await page.waitForFunction(()=>window.hangarInspect?.ready,{},{timeout:120000});
  await page.getByText('Real ship (fallback toggle)',{exact:true}).locator('..').locator('input').uncheck();
  await page.getByText('Ship height (m)',{exact:true}).locator('..').locator('input').fill('36');await page.keyboard.press('Enter');
  await page.getByText('Stack radius',{exact:true}).locator('..').locator('select').selectOption({label:'l'});
  report.fallback=await page.evaluate(()=>{const h=window.hangarInspect;return {height:h.params.height,radius:h.params.radius,fit:h.collars.fits[0]};});
  assert.equal(report.fallback.height,36);assert.equal(report.fallback.radius,'l');assert.ok(report.fallback.fit.plateRadii.every(r=>Math.abs(r-1.9375)<1e-6));
  await page.getByText('Real ship (fallback toggle)',{exact:true}).locator('..').locator('input').check();
  await page.evaluate(()=>{const h=window.hangarInspect;h.actions.ground();h.params.level=5;h.actions.elevator();});await page.waitForTimeout(300);
  const beforeCab=await page.evaluate(()=>window.hangarInspect.roots().find(r=>r.getObjectByName('pose_cab')).getObjectByName('pose_cab').position.y);
  await page.evaluate(()=>window.hangarInspect.camera.position.set(2,14,-3));
  await page.waitForFunction(()=>window.hangarInspect.roots().some(r=>r.userData.placement.module==='platform_half'&&r.userData.placement.level===0&&r.getObjectByName('platform_v3')),{},{timeout:5000});
  const afterCab=await page.evaluate(()=>window.hangarInspect.roots().find(r=>r.getObjectByName('pose_cab')).getObjectByName('pose_cab').position.y);
  assert.ok(afterCab>=beforeCab&&afterCab<35,'cab continues rather than resetting or teleporting during LOD change');report.cab={beforeCab,afterCab};
  await page.getByText('Grey-box massing',{exact:true}).locator('..').locator('input').check();assert.equal(await page.evaluate(()=>window.hangarInspect.collars.batches.every(m=>!m.visible)&&window.hangarInspect.consoleBank.objects.every(m=>!m.visible)),true);await page.getByText('Grey-box massing',{exact:true}).locator('..').locator('input').uncheck();
  await page.getByText('wireframe',{exact:true}).locator('..').locator('input').check();assert.equal(await page.evaluate(()=>window.hangarInspect.collars.batches.every(m=>m.material.wireframe)),true);await page.getByText('wireframe',{exact:true}).locator('..').locator('input').uncheck();
  await page.evaluate(()=>window.hangarInspect.actions.ground());await page.waitForTimeout(1000);await page.screenshot({path:'src/builder/tools/blender/hangar/refs/shots/v3-smoke-ground.jpg'});
  await page.evaluate(()=>window.hangarInspect.consoleBank.sit('station_builder'));await page.waitForTimeout(500);await page.screenshot({path:'src/builder/tools/blender/hangar/refs/shots/v3-smoke-console.jpg'});
  assert.equal(report.errors.length,0);report.pass=true;
}finally{await browser.close();writeFileSync('src/builder/tools/blender/hangar/refs/smoke-v3.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
