// Regenerate only the metrics section, keeping handwritten integration notes.
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
if(process.argv.includes('--v4')){await import('./report-v4.mjs');process.exit(0);}
const dir='src/builder/tools/blender/hangar',asset='public/assets/models/builder/hangar';
const layout=JSON.parse(readFileSync(asset+'/layout.json','utf8'));
const qa=JSON.parse(readFileSync(dir+'/refs/inspection.json','utf8'));
const memory=JSON.parse(readFileSync(dir+'/refs/memory-v3.json','utf8'));
const size=folder=>readdirSync(folder,{withFileTypes:true}).reduce((n,e)=>n+(e.isDirectory()?size(path.join(folder,e.name)):statSync(path.join(folder,e.name)).size),0);
const num=n=>n.toLocaleString('en-US');
const lines=['<!-- GENERATED_METRICS -->','',
'| File | GLB triangles, all variants | KiB | Atlas / normal px |','|---|---:|---:|---|',
...Object.entries(layout.modules).map(([id,m])=>'| '+m.file+' | '+num(m.triangles)+' | '+(m.bytes/1024).toFixed(1)+' | '+(id==='lamp'?'none':id==='tower_bay'||id==='platform_half'?'1024 / 512':'512')+' |'),' ',
Object.keys(layout.modules).length+' GLBs, '+layout.placements.length+' placements. GLBs: **'+num(Object.values(layout.modules).reduce((n,m)=>n+m.bytes,0))+' bytes**. Entire directory with external bake atlases and layout: **'+num(size(asset))+' bytes ('+(size(asset)/1e6).toFixed(2)+' MB)** / 20 MB. Every GLB below 60,000 triangles; no hero exemption.','',
'| Game look ON, real Reliable ship, distance LOD | Triangles (all passes) | Total calls | Kit batches incl. collar/bank | Scale | 5 s avg FPS | Instantaneous min FPS | p95 ms |',
'|---|---:|---:|---:|---:|---:|---:|---:|',
...Object.entries(qa.views??{}).map(([view,m])=>'| '+[view,num(m.triangles),m.drawCalls,m.kitCalls??m.structuralCalls,m.renderScale??qa.gpu?.pixelRatio,m.performance.average.toFixed(1),m.performance.minimum.toFixed(1),m.performance.p95FrameMs.toFixed(1)].join(' | ')+' |'),' ',
'| Complete envelope | Triangles (all passes) | Total calls | Structure batches | FPS sample |','|---|---:|---:|---:|---:|',
...[['Full detail',qa.completeFull],['Height LOD',qa.completeLod]].filter(([,m])=>m).map(([name,m])=>'| '+[name,num(m.triangles),m.drawCalls,m.structuralCalls,m.fps.toFixed(1)].join(' | ')+' |'),' ',
'Measured '+qa.date+', Chrome '+qa.browser+', viewport '+qa.viewport.join(' × ')+', device scale 1, initial pixel ratio **'+qa.gpu?.pixelRatio+'**, with automatic resolution enabled (floor 0.8). GPU: '+qa.gpu?.renderer+'. Renderer totals include fullscreen post-processing and the actual ship. Kit batches exclude ship art and include both collar meshes and the console bank. Minimum is the slowest individual RAF interval, not a rolling one-second average.','',
'| Same-cylinder lighting comparison | Scale | Average FPS | Minimum FPS | Clipped white pixels | Largest clipped region, px |',
'|---|---:|---:|---:|---:|---:|',
...[['Before ground',qa.before?.ground],['After ground',qa.glareGround],['Before overview',qa.before?.overview],['After overview',qa.glareOverview]].filter(([,m])=>m).map(([label,m])=>'| '+[label,m.renderScale,m.performance.average.toFixed(1),m.performance.minimum.toFixed(1),m.clipping.whitePixels,m.clipping.largestClippedRegionPixels].join(' | ')+' |'),' ',
'Clipping threshold: all RGB channels >=250/255 in clean native viewport screenshots. This measures bright areas, not a subjective glare score. Comparison PNGs use only our own renders. Brief frame-time dips remain visible in minimum/p95 metrics; sustained average performance is the requested target.','',
'Memory after two identical 20-shape sequences, returning to Reliable: '+memory.rounds.map(m=>m.geometries+' geometries / '+m.textures+' textures').join(' → ')+'. Browser errors during memory trial: '+memory.errors.length+'.',
'Console bank: '+num(layout.modules.engineering_consoles.instancedTriangles)+' drawn triangles / 80,000, '+num(layout.modules.engineering_consoles.bytes)+' GLB bytes / 2,000,000. Five bank draws total. Stored mesh triangles are lower because all four chassis nodes share one geometry.','',
...['hangar-test.log','models-test.log','builder-test.log','static-check.log'].map(f=>{const t=readFileSync(dir+'/refs/'+f,'utf8').replaceAll('\u0000','');return '- '+f+': '+(/PASS:|All model checks passed|All builder checks passed|check:static passed/.test(t)?'PASS':'NOT CONFIRMED; inspect log')+'.';}),
'- Sandbox console/page errors: '+qa.sandboxErrors?.length+'. HTTP failures: '+qa.httpErrors?.length+'.',
'- Game HANGAR smoke test on 5280: '+qa.game?.state+', '+qa.game?.frames+' advancing frames, '+qa.gameErrors?.length+' browser errors.',
'- Nine height/radius combinations, independent moving nodes and ground ML collision are asserted in inspect.mjs. Static tests compare original layout data, placement IDs/transforms, colliders, dimensions, Draco, budgets and LOD ratios.','',
'Screenshots (PNG): refs/shots/{before-glare-ground,after-glare-ground,before-glare-overview,after-glare-overview,after-ground-real,after-overview-real,collar-reliable,collar-apollo,collar-workhorse,console-bank,station_window,station_builder,station_testfire,station_launch,turnaround-mid,turnaround-reveal,far-orbit-40,far-orbit-60,far-orbit-80}. Comparison sheets: refs/compare-glare-ground.png and refs/compare-glare-overview.png. Historical v2 evidence remains under refs/v2 and refs/before.','',
'Regenerate: node src/builder/tools/blender/hangar/report.mjs',''];
writeFileSync(dir+'/README.md',readFileSync(dir+'/README.md','utf8').split('<!-- GENERATED_METRICS -->')[0]+lines.join('\n'));
console.log('Refreshed README metrics.');
