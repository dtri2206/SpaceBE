// Additive v4 API: the v3 helper and its callers remain byte-for-byte unchanged.
import {fitCollar} from './collarFit.mjs';
export function plateIndices(segment,cfg){
  const start=segment.arc[0],end=segment.arc[1];
  return Array.from({length:cfg.plateCount},(_,i)=>i).filter(i=>{
    let a=cfg.angleStart+(i+.5)*cfg.angularPitch;
    while(a<start)a+=360;while(a>=start+360)a-=360;
    return a>=start&&a<end;
  });
}
export function fitCollarArc(level,segment,entries,hull,cfg){
  const indices=plateIndices(segment,cfg);
  // Evaluate only this arc: an oversized part in the empty front slot must not retract the wrap.
  const full=fitCollar(level,entries,hull,{...cfg,slideLimits:[cfg.slideLimits[0],1e6]});
  const top=Math.max(0,...entries.filter(e=>e.attach!=='radial').map(e=>e.y+e.height),...hull.map(s=>s.y1));
  const y=(typeof level==='number'?level:level.y)-(cfg.ML_TOP??7);
  // A generous temporary limit prevents an excluded direction from globally retracting v3.
  let retract=y<0||y>top+1e-6;
  const radii=[];
  for(const index of indices){
    const r=full.plateRadii[index];
    if(r>cfg.slideLimits[1]+1e-6)retract=true;
    radii.push(Math.min(cfg.slideLimits[1],r));
  }
  return {plateIndices:indices,plateRadii:retract?radii.map(()=>cfg.slideLimits[1]):radii,retract};
}
