// Hangar v5 "stage" part: console bank on the front-left diagonal. Pure Node, no browser.
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {bankLayout,clearances,footprint,DISTANCES,DEFAULT_DISTANCE,HIDE,ISLAND_R} from '../tools/blender/hangar/v5-stage-check.mjs';

const root='public/assets/models/builder/hangar';
const layout=JSON.parse(readFileSync(path.join(root,'layout.json'),'utf8'));
const stage=JSON.parse(readFileSync(path.join(root,'v5/stage.json'),'utf8'));
const S=Math.SQRT1_2,near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;
const rotY=([x,y,z],deg)=>{const a=deg*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [x*c+z*s,y,-x*s+z*c];};
// Operator facing direction: desk-local -Z (the screens), operators sit on local +Z.
const facing=st=>rotY([0,0,-1],st.rotation[1]);

// The generator and the committed JSON agree.
assert.deepEqual(stage.bankDistances,DISTANCES);assert.deepEqual(DISTANCES,[18,22],'15 m dropped: hits the left tower corner');
assert.equal(stage.bankDistance,DEFAULT_DISTANCE);assert.equal(DEFAULT_DISTANCE,18);
for(const d of DISTANCES)assert.deepEqual(JSON.parse(JSON.stringify(bankLayout(d,layout))),stage.banks[d],'stage.json banks.'+d+' is current (run v5-stage-check.mjs --write)');
assert.deepEqual(stage.consoles,stage.banks[18].consoles,'consoles = default bank');

for(const d of DISTANCES){
  const b=stage.banks[d];
  // Turnaround eye point on the front-left diagonal at distance d.
  assert.ok(near(b.eye[0],-d*S)&&near(b.eye[2],-d*S)&&near(b.eye[1],1.7),'eye '+d);
  assert.ok(near(Math.hypot(b.slotView.position[0],b.slotView.position[2]),d),'slot view distance '+d);
  assert.deepEqual([b.slotView.target[0],b.slotView.target[2]],[0,0],'slot view looks at the axis');
  assert.ok(b.slotView.target[1]>7&&b.slotView.fov<=75&&b.slotView.fov>=50,'slot view framing '+d);
  assert.equal(b.consoles.length,4);
  assert.deepEqual(b.consoles.map(c=>c.id),['station_window','station_builder','station_testfire','station_launch']);
  assert.deepEqual(b.consoles.map(c=>c.screens),layout.consoles.map(c=>c.screens),'screen node names kept');
  for(const st of b.consoles){
    const [x,,z]=st.position;
    // On the diagonal side: inside the open front-left quarter.
    assert.ok(x<0&&z<0,st.id+' in the open quarter');
    // Operators face away from the rocket axis (backs to the ship): facing direction points away from the axis.
    const f=facing(st),out=[st.seatedEye[0],st.seatedEye[2]],len=Math.hypot(...out);
    assert.ok((f[0]*out[0]+f[2]*out[1])/len>.35,st.id+' operator faces away from the ship');
    // Facing roughly towards the hall's front-left corner (within 70 degrees of the diagonal).
    assert.ok((f[0]*-S+f[2]*-S)>Math.cos(70*Math.PI/180),st.id+' faces the front-left corner');
    // Seated eye is between the desk and the axis, standing eye is 1.7 m.
    assert.ok(Math.hypot(st.seatedEye[0],st.seatedEye[2])<Math.hypot(x,z),st.id+' sits on the ship side of the desk');
    assert.ok(st.seatedEye[1]>1&&st.seatedEye[1]<1.4,'seated eye height');
    // Turnaround: standing, looking towards the axis, about d from it.
    const tv=st.turnaroundView;assert.equal(tv.position[1],1.7);
    assert.deepEqual([tv.target[0],tv.target[2]],[0,0],st.id+' turnaround looks at the axis');
    const r=Math.hypot(tv.position[0],tv.position[2]);assert.ok(r>=d-.01&&r<=d+1.2,st.id+' turnaround distance '+r);
    assert.ok(tv.fov<=75,'fov');
  }
  // Island rotated with the bank, centred on the eye point.
  assert.deepEqual(b.island.rotation,[0,45,0]);assert.ok(near(b.island.position[0],b.eye[0])&&near(b.island.position[2],b.eye[2]));
  const c=clearances(b);
  assert.ok(c.wallClearance>.5,'bank inside the hall walls at '+d);
  assert.equal(c.corridorIntrusion,0,'bank keeps out of the roll-out corridor at '+d);assert.equal(c.towerIntrusion,0,'bank clear of the left tower at '+d);
}

// No ground clutter left inside any bank footprint (only floor tiles and the hall shell may be under it).
const hidden=new Set(stage.hidePlacements);for(const id of HIDE)assert.ok(hidden.has(id));
assert.ok(hidden.has('console_island_v4'),'old frontal island hidden');
const groundAllowed=new Set(['floor_tile','wall_bay','tower_bay','standpipe','lamp','roof_truss']);
const base=[...layout.placements,...layout.wrap.placements];
for(const d of DISTANCES){
  const pts=footprint(stage.banks[d]),cx=stage.banks[d].centre[0],cz=stage.banks[d].centre[2];
  for(const p of base){
    if(hidden.has(p.id)||groundAllowed.has(p.module)||p.position[1]>3)continue;
    if(['elevator','stair_run','catwalk','caged_ladder'].includes(p.module))continue;// access agent moves the elevator and its stairs
    const r=Math.hypot(p.position[0]-cx,p.position[2]-cz);
    assert.ok(r>ISLAND_R+.3,`ground clutter ${p.id} (${p.module}) inside the ${d} m bank`);
  }
  assert.ok(pts.length>16);
}

// Budgets: the island GLB and the whole stage part.
const island=stage.modules.bank_island_v5;assert.ok(island,'island module');
const file=path.join(root,island.file),bytes=statSync(file).size;assert.equal(bytes,island.bytes);
assert.ok(island.triangles<=60000&&bytes<=4*1024*1024);
const g=readFileSync(file);assert.equal(g.readUInt32LE(0),0x46546c67);
const json=JSON.parse(g.subarray(20,20+g.readUInt32LE(12)).toString());
assert.ok(json.meshes.every(m=>m.name.startsWith('m_')&&m.primitives.every(p=>p.extensions?.KHR_draco_mesh_compression)),'Draco, m_ names');
const partBytes=bytes+statSync(path.join(root,'v5/stage.json')).size;
assert.ok(partBytes<=1.2*1024*1024,'stage part <= 1.2 MB: '+partBytes);
console.log('hangar-v5-stage: OK',{islandTriangles:island.triangles,partBytes,clearances:Object.fromEntries(DISTANCES.map(d=>[d,clearances(stage.banks[d])]))});
