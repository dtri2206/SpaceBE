// Pure data API. level.y is WORLD metres; entries/hull y are metres above ML_TOP.
// Angles follow Assembly: 0=+X, 90=-Z. Sector tests include plate width, not just its centre.
const tau=2*Math.PI;
export function fitCollar(level,entries,segments,cfg){
  const y=(typeof level==='number'?level:level.y)-(cfg.ML_TOP??7),pitch=tau/cfg.plateCount;
  const top=Math.max(0,...entries.filter(e=>e.attach!=='radial').map(e=>e.y+e.height),...segments.map(s=>s.y1));
  const min=cfg.slideLimits[0],max=cfg.slideLimits[1],clearance=cfg.clearance;
  let retract=y<0||y>top+1e-6;
  const radiusAt=h=>{
    let r=0;
    for(const s of segments)if(h>=s.y0-1e-6&&h<=s.y1+1e-6)r=Math.max(r,s.r0+(s.r1-s.r0)*(h-s.y0)/Math.max(1e-9,s.y1-s.y0));
    for(const e of entries)if(e.attach!=='radial'&&!e.inside&&h>=e.y&&h<=e.y+e.height){
      // A segment is authoritative for adapters/fairings; exposed parts supply their own radius otherwise.
      const covered=segments.some(s=>s.covers?.includes(e.id));
      if(!covered&&!segments.some(s=>h>=s.y0&&h<=s.y1)){
        const profile=e.outline?.profile;
        if(profile){for(let i=0;i<profile.length-1;i++){const a=profile[i],b=profile[i+1];if(h>=a.y&&h<=b.y)r=Math.max(r,a.r+(b.r-a.r)*(h-a.y)/Math.max(1e-9,b.y-a.y));}}
        else r=Math.max(r,e.outline?.radius??e.radius??0);
      }
    }
    return r;
  };
  let core=Math.max(radiusAt(y-.15),radiusAt(y),radiusAt(y+.16));
  // Exposed core art can extend beyond its nominal attachment height (skirts/fairings).
  // Its measured section supplements hull.js so no nominal-data gap closes through real art.
  for(const e of entries)if(e.attach!=='radial'&&!e.inside){const section=e.outline?.sections?.find(s=>Math.abs(s.y-y)<1e-5);if(section)for(let i=0;i<section.segments.length;i+=2)core=Math.max(core,Math.hypot(section.segments[i],section.segments[i+1]));}
  const plateRadii=Array.from({length:cfg.plateCount},(_,i)=>{
    let radius=core;const angle=(i+.5)*pitch-Math.PI/2;
    for(const e of entries){
      if(e.attach!=='radial'||e.inside)continue;
      const o=e.outline;
      const h0=o?.y0??e.y,h1=o?.y1??e.y+e.height;
      if(y+.16<h0||y-.15>h1)continue;
      const width=o?.width??e.def?.model?.width??e.def?.width??(e.def?.booster?1:.6);
      const center=o?.centerRadius??(e.radius??0)+width*.5;
      const radialHalf=o?.radialHalf??width*.5,tangentHalf=o?.tangentHalf??width*.5;
      const da=angle-(e.angle??0)*Math.PI/180;
      const section=o?.sections?.find(s=>Math.abs(s.y-y)<1e-5);
      // Actual triangle/plane intersections when supplied by the art bridge. Otherwise an OBB
      // from catalogue dimensions. Clip each segment to this wedge, including both edge rays.
      const x0=center-radialHalf,x1=center+radialHalf,z0=-tangentHalf,z1=tangentHalf;
      const lines=section?.segments??[x0,z0,x1,z0,x1,z0,x1,z1,x1,z1,x0,z1,x0,z1,x0,z0];
      for(let j=0;j<lines.length;j+=4){
        const ax=lines[j],az=lines[j+1],bx=lines[j+2],bz=lines[j+3];
        for(const [x,z]of [[ax,az],[bx,bz]]){const delta=Math.atan2(Math.sin(Math.atan2(-z,x)-da),Math.cos(Math.atan2(-z,x)-da));if(Math.abs(delta)<=pitch/2+1e-8)radius=Math.max(radius,Math.hypot(x,z));}
        for(const t of [da-pitch/2,da+pitch/2]){
          const dx=Math.cos(t),dz=-Math.sin(t),sx=bx-ax,sz=bz-az,den=dx*sz-dz*sx;
          if(Math.abs(den)<1e-10)continue;
          const r=(ax*sz-az*sx)/den,u=(ax*dz-az*dx)/den;
          if(r>=0&&u>=-1e-8&&u<=1+1e-8)radius=Math.max(radius,r);
        }
      }
    }
    const target=radius+clearance;
    if(target>max+1e-6)retract=true;
    return Math.max(min,Math.min(max,target));
  });
  return {plateRadii:retract?plateRadii.map(()=>max):plateRadii,retract};
}
