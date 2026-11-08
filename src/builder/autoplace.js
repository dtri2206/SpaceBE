// "Add to vehicle" from a card: puts a part in a sensible place on the stack, the way a technician would.
// The design page is where the player fine-tunes afterwards. Pure JS.

const GOLDEN = 137.5; // degrees between successive side parts on the same body, so they spread out

function axials(assembly) {
  return assembly.layout().filter((e) => e.attach === 'axial');
}
function lowestAxial(assembly) {
  const lay = axials(assembly);
  return lay.length ? lay.reduce((a, b) => (b.y < a.y ? b : a)) : null;
}
function highestAxial(assembly) {
  const lay = axials(assembly);
  return lay.length ? lay.reduce((a, b) => (b.y + b.height > a.y + a.height ? b : a)) : null;
}
function biggestTank(assembly) {
  const tanks = assembly.layout().filter((e) => e.def.fuel);
  return tanks.length ? tanks.reduce((a, b) => (b.def.fuel.mass > a.def.fuel.mass ? b : a)) : null;
}
function lowestTank(assembly) {
  return assembly.layout().filter((e) => e.def.fuel).sort((a, b) => a.y - b.y)[0] ?? null;
}

/** Returns { ids, message }. ids is empty when nothing could be placed. */
export function autoAttach(assembly, typeId, { symmetry = null } = {}) {
  const def = assembly.catalog.get(typeId);
  if (!def) return { ids: [], message: 'Unknown part.' };
  if (!assembly.parts.length) {
    if (def.attach !== 'axial') return { ids: [], message: 'Start with a capsule: side parts need a body to clamp to.' };
    return { ids: assembly.attach(typeId), message: `${def.name} placed on the stand.` };
  }

  if (def.attach === 'axial') {
    const low = lowestAxial(assembly);
    const high = highestAxial(assembly);
    const isNose = def.family === 'fairing' || (def.nodes.includes('bottom') && !def.nodes.includes('top')); // covers now take a tower on top
    if (isNose) {
      if (high && assembly.canAttach(typeId, high.id, 'top').ok) return { ids: assembly.attach(typeId, high.id, 'top'), message: `${def.name} fitted on top.` };
      return { ids: [], message: 'The top of the stack is taken. Remove the part up there first.' };
    }
    if (def.engine) {
      if (low && assembly.canAttach(typeId, low.id, 'bottom').ok) return { ids: assembly.attach(typeId, low.id, 'bottom'), message: `${def.name} mounted at the bottom.` };
      if (low?.def.engine) return { ids: [], message: 'There is already an engine at the bottom. Remove it, or change it in the workshop.' };
      return { ids: [], message: 'No free node at the bottom of the stack.' };
    }
    // structure rings and kick motors go under the capsule / shield, tanks and shields go under the stack, above an engine
    const upperStructure = def.family === 'stages' || def.booster;
    if (upperStructure) {
      const capsule = assembly.layout().find((e) => e.def.flags?.capsule);
      const below = capsule ? assembly.children(capsule.id, 'bottom')[0] : null;
      if (below && below.node === 'bottom') {
        const ids = assembly.insertAbove(below.id, typeId);
        if (ids.length) return { ids, message: `${def.name} fitted under the ${capsule.def.name}.` };
      }
    }
    if (low?.def.engine) {
      const ids = assembly.insertAbove(low.id, typeId);
      return ids.length ? { ids, message: `${def.name} inserted above the engine.` } : { ids: [], message: 'Could not insert above the engine.' };
    }
    if (low && assembly.canAttach(typeId, low.id, 'bottom').ok) return { ids: assembly.attach(typeId, low.id, 'bottom'), message: `${def.name} stacked below.` };
    if (high && assembly.canAttach(typeId, high.id, 'top').ok) return { ids: assembly.attach(typeId, high.id, 'top'), message: `${def.name} stacked on top.` };
    return { ids: [], message: 'No free node for that part.' };
  }

  // radial parts
  const low = lowestAxial(assembly);
  const lay = assembly.layout();
  const engine = lay.find((e) => e.def.engine);
  const tank = biggestTank(assembly);
  const capsule = lay.find((e) => e.def.flags?.capsule);
  const ring = lay.find((e) => e.def.family === 'stages' && e.def.nodes.includes('radial'));
  let host = null;
  if (def.flags?.legs) host = engine ?? low;
  else if (/fin/.test(def.id) || def.booster) host = lowestTank(assembly) ?? low;
  else if (def.flags?.gimbal) host = engine ?? low;
  else if (def.flags?.pressurant || /nitrogen/.test(def.id)) host = ring ?? tank ?? low;
  else if (/wiring/.test(def.id)) host = tank ?? low;
  else if (def.flags?.parachute || def.flags?.antenna || def.flags?.rcs || def.flags?.navigation || def.flags?.relay) host = capsule ?? tank ?? low;
  else host = tank ?? capsule ?? low;
  if (!host || !assembly.canAttach(typeId, host.id, 'radial').ok) {
    const any = assembly.freeNodes().find((n) => n.node === 'radial' && assembly.canAttach(typeId, n.partId, 'radial').ok);
    if (!any) return { ids: [], message: 'Nothing to clamp that part to yet.' };
    host = lay.find((e) => e.id === any.partId);
  }
  const siblings = assembly.children(host.id, 'radial').length;
  const angle = (siblings * GOLDEN + 20) % 360;
  const sym = symmetry ?? ((/fin/.test(def.id) && assembly.symmetry === 1) ? 4 : def.booster && assembly.symmetry === 1 ? 2 : assembly.symmetry);
  const ids = assembly.attach(typeId, host.id, 'radial', { angle, symmetry: sym });
  return { ids, message: ids.length ? `${def.name}${sym > 1 ? ` ×${sym}` : ''} clamped to the ${host.def.name}.` : 'Could not clamp that part.' };
}
