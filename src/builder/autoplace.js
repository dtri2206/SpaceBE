// "Add to vehicle" from a workshop card: puts a part in a sensible place on the stack, the way a technician would.
// The integration console is where the player fine-tunes afterwards. Pure JS.

const GOLDEN = 137.5; // degrees between successive side parts on the same body, so they spread out

function lowestAxial(assembly) {
  const lay = assembly.layout().filter((e) => e.attach === 'axial');
  return lay.length ? lay.reduce((a, b) => (b.y < a.y ? b : a)) : null;
}
function highestAxial(assembly) {
  const lay = assembly.layout().filter((e) => e.attach === 'axial');
  return lay.length ? lay.reduce((a, b) => (b.y + b.height > a.y + a.height ? b : a)) : null;
}
function biggestTank(assembly) {
  const tanks = assembly.layout().filter((e) => e.def.fuel);
  return tanks.length ? tanks.reduce((a, b) => (b.def.fuel.mass > a.def.fuel.mass ? b : a)) : null;
}

/** Returns { ids, message }. ids is empty when nothing could be placed. */
export function autoAttach(assembly, typeId) {
  const def = assembly.catalog.get(typeId);
  if (!def) return { ids: [], message: 'Unknown part.' };
  if (!assembly.parts.length) {
    if (def.attach !== 'axial') return { ids: [], message: 'Start with a capsule: side parts need a body to clamp to.' };
    return { ids: assembly.attach(typeId), message: `${def.name} placed on the stand.` };
  }

  if (def.attach === 'axial') {
    const low = lowestAxial(assembly);
    const high = highestAxial(assembly);
    const isNose = def.nodes.includes('bottom') && !def.nodes.includes('top');
    if (isNose) {
      if (high && assembly.canAttach(typeId, high.id, 'top').ok) return { ids: assembly.attach(typeId, high.id, 'top'), message: `${def.name} fitted on top.` };
      return { ids: [], message: 'The top of the stack is taken. Remove the part up there first.' };
    }
    if (def.engine) {
      if (low && assembly.canAttach(typeId, low.id, 'bottom').ok) return { ids: assembly.attach(typeId, low.id, 'bottom'), message: `${def.name} mounted at the bottom.` };
      if (low?.def.engine) return { ids: [], message: 'There is already an engine at the bottom. Remove it, or change it in the workshop.' };
      return { ids: [], message: 'No free node at the bottom of the stack.' };
    }
    // tanks, shields, capsules: go under the stack, above an engine if one is there
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
  const engine = assembly.layout().find((e) => e.def.engine);
  const tank = biggestTank(assembly);
  const capsule = assembly.layout().find((e) => e.def.flags?.capsule);
  let host = null;
  if (def.flags?.legs) host = engine ?? low;
  else if (/fin/.test(def.id)) host = assembly.layout().filter((e) => e.def.fuel).sort((a, b) => a.y - b.y)[0] ?? low;
  else if (def.flags?.parachute || def.flags?.antenna || def.flags?.rcs) host = capsule ?? tank ?? low;
  else host = tank ?? capsule ?? low;
  if (!host || !assembly.canAttach(typeId, host.id, 'radial').ok) {
    const any = assembly.freeNodes().find((n) => n.node === 'radial' && assembly.canAttach(typeId, n.partId, 'radial').ok);
    if (!any) return { ids: [], message: 'Nothing to clamp that part to yet.' };
    host = assembly.layout().find((e) => e.id === any.partId);
  }
  const siblings = assembly.children(host.id, 'radial').length;
  const angle = (siblings * GOLDEN + 20) % 360;
  const symmetry = (/fin/.test(def.id) && assembly.symmetry === 1) ? 4 : assembly.symmetry;
  const ids = assembly.attach(typeId, host.id, 'radial', { angle, symmetry });
  return { ids, message: ids.length ? `${def.name} clamped to the ${host.def.name}.` : 'Could not clamp that part.' };
}
