// ENDING screens (spec §10): title, a still, "What went wrong", "Lesson from history", the cost charged, then the
// Flight Report. Adrift (§10.3) is its own slow sequence with the safe-messaging rules: content warning (Role 1's menu),
// "Skip sensitive scenes" (save.skipSensitive), nothing graphic, and a helpline line on the screen.
import { audio } from '/src/audio/index.js';
import { graphics } from '/src/graphics/index.js';
import { contract, economy, events, requestState, save, ui } from '/src/core/index.js';
import { getProgress } from '/src/missions/index.js';
import data from './data.json';
import { button, el, fill, typeInto, wait } from './dom.js';
import { showView } from './views.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const familyOf = () => data.photos.find((p) => p.id === save.load().familyPhoto) ?? data.photos[0];

/**
 * Shows the ending. `ending` is the last ending:show payload. Returns a dispose function (stops the Adrift sequence).
 * Bankrupt is declared by the builder below balance.insolvencyFloor, or happens when money goes below $0.
 */
export function showEnding(ending) {
  const bankrupt = ending.endingId === contract.ENDINGS.bankrupt || economy.isBankrupt();
  if (ending.endingId === contract.ENDINGS.adrift && !bankrupt) return showAdrift(ending);
  const info = data.endings[ending.endingId] ?? { title: ending.endingId, tone: 'serious', scene: 'earth', text: '' };
  showView(info.scene === 'mars' ? 'mars' : info.scene === 'space' ? 'space' : 'earth');

  const root = el('div', `role4-screen role4-tone-${info.tone}`);
  root.dataset.screen = 'ENDING';
  const card = el('div', 'hud hud-panel role4-card');
  root.append(card);

  card.append(el('div', 'hud-label', ending.endingId === 'homecoming' ? 'Mission complete' : 'Ending'));
  card.append(el('div', 'role4-title', info.title));
  if (info.text) card.append(el('div', 'role4-text', info.text));

  if (ending.endingId === 'homecoming') {
    const progress = getProgress();
    if (progress.completed.includes('discovery')) card.append(el('div', 'role4-muted', 'Your data from the delta is now the most studied rock sample on Earth.'));
    const box = el('div', 'role4-box');
    box.append(el('div', 'hud-label', `Message from ${familyOf().from}`), el('div', 'role4-text', info.family));
    card.append(box);
  } else if (ending.cause && !bankrupt) {
    const box = el('div', 'role4-box');
    box.append(el('div', 'hud-label', 'What went wrong'), el('div', 'role4-text', ending.cause));
    card.append(box);
  }

  const lesson = data.lessons[ending.historyLessonId];
  if (lesson) {
    const box = el('div', 'role4-box');
    box.append(el('div', 'hud-label', `Lesson from history · ${lesson.title}`), el('div', 'role4-text', lesson.text), el('div', 'hud-value', lesson.lesson));
    box.lastChild.style.fontSize = 'var(--hud-text-md)';
    box.append(button('Read in the Guidebook', () => events.emit('guidebook:open', { entryId: lesson.entry })));
    card.append(box);
  }

  const costs = el('div', 'role4-row role4-muted');
  if (ending.cost) costs.append(el('span', null, `Cost charged: ${money(ending.cost)} (no refund)`));
  costs.append(el('span', null, bankrupt ? `Funds reset to ${money(economy.balance.startMoney)}` : `Funds: ${money(economy.getMoney())}`));
  card.append(costs);

  const entry = data.endingEntries[ending.endingId];
  const row = el('div', 'role4-row');
  row.append(button(bankrupt ? 'Start over' : 'Flight Report', () => {
    // Spec §3: Bankrupt means a full reset to the starting money, even when declared above $0.
    if (bankrupt) {
      economy.reset();
      requestState('HANGAR');
    } else {
      requestState('REPORT');
    }
  }, { key: 'Enter', primary: true }));
  if (entry && !lesson) row.append(button('Guidebook', () => events.emit('guidebook:open', { entryId: entry })));
  card.append(row);

  ui.mount(root);
  return () => {};
}

// ---------- Adrift: The Last Message ----------

function showAdrift(ending) {
  const view = showView('space');
  let alive = true;
  const isAlive = () => alive;
  const skipSensitive = !!save.load().skipSensitive;
  const family = familyOf();
  const A = data.adrift;

  view.capsule.position.set(0, 0, 0);
  view.capsule.rotation.set(0.3, 0.6, 0.15);
  view.camera.position.set(0.6, 1.5, 4.2);
  view.camera.lookAt(0, 0.9, 0);
  view.capsule.userData.onFrame = (dt) => { view.capsule.rotation.y += dt * 0.02; view.capsule.rotation.x += dt * 0.006; };

  const root = el('div', 'role4-screen role4-adrift role4-tone-heartbreaking');
  root.dataset.screen = 'ENDING';
  const card = el('div', 'hud hud-panel role4-card');
  root.append(card);
  card.append(el('div', 'hud-label', 'Ending'), el('div', 'role4-title', data.endings.adrift.title));
  const cause = el('div', 'role4-muted', ending.cause || data.endings.adrift.text);
  card.append(cause);
  const lines = el('div');
  lines.style.cssText = 'display:grid;gap:12px';
  card.append(lines);
  const actions = el('div', 'role4-row');
  actions.style.justifyContent = 'center';
  card.append(actions);
  ui.mount(root);

  const say = async (text, className = 'role4-adrift-line') => {
    const line = el('div', className);
    lines.append(line);
    await typeInto(line, text, { cps: 28, alive: isAlive });
    return line;
  };
  const choose = (...opts) => new Promise((resolve) => {
    actions.replaceChildren(...opts.map(([label, value, key]) => button(label, () => { actions.replaceChildren(); resolve(value); }, { key, primary: key === 'Enter' })));
  });

  (async () => {
    audio.stop?.('radio.static');
    await wait(1500);
    if (!alive) return;
    const hq = await say(`${A.hq.from} · sent ${A.hq.delayMin} min ago`, 'hud-label');
    hq.style.color = 'var(--hud-muted)';
    await say(A.hq.text);

    // The player can keep trying until the air runs out, or accept.
    let air = 100;
    const airEl = el('div', 'role4-muted', 'Cabin air 100 %');
    card.insertBefore(airEl, actions);
    const tick = setInterval(() => { air = Math.max(0, air - 1); airEl.textContent = `Cabin air ${air} %`; }, 900);
    let tries = 0;
    while (alive && air > 0) {
      const pick = await Promise.race([
        choose(['Keep trying', 'try', 'KeyK'], ['Accept', 'accept', 'Enter']),
        new Promise((r) => { const w = setInterval(() => { if (air <= 0 || !alive) { clearInterval(w); r('air'); } }, 250); }),
      ]);
      if (pick !== 'try') break;
      lines.replaceChildren();
      await say(A.tries[tries++ % A.tries.length]);
      air = Math.max(0, air - 12);
    }
    clearInterval(tick);
    airEl.remove();
    if (!alive) return;

    // 1. Lights dim. 2. The family photo. 3. The message from before launch. 4. A final log entry.
    lines.replaceChildren();
    cause.remove();
    graphics.setEffects({ vignette: 0.85 });
    await say(A.dim);
    await wait(1800);
    await say(A.photo);
    const photo = el('div', 'role4-box');
    photo.append(el('div', 'hud-label', family.label), el('div', 'role4-muted', family.caption));
    lines.append(photo);
    await wait(2200);
    await say(A.message);
    const message = save.load().messageHome || data.prelaunch.defaultMessage;
    const msg = await say(`“${message}”`);
    msg.style.fontStyle = 'italic';
    await wait(2500);
    if (!alive) return;

    await say(A.logPrompt);
    const log = el('textarea');
    log.maxLength = 300;
    lines.append(log);
    log.focus();
    await choose(['Record', 'done']);
    save.update({ finalLog: log.value.trim() });
    if (!alive) return;

    // 5. Fade to black: nothing shown, nothing described. With "Skip sensitive scenes" the air simply runs out.
    lines.replaceChildren();
    if (skipSensitive) await say(A.airOut);
    await wait(skipSensitive ? 2500 : 600);
    root.classList.add('role4-black');
    card.style.transition = 'opacity 2.5s';
    card.style.opacity = '0';
    await wait(5000);
    if (!alive) return;

    // 6. Exterior: the ship drifts away among the stars.
    graphics.setEffects({ vignette: 0 });
    root.classList.remove('role4-black');
    root.style.background = 'transparent';
    view.camera.position.set(0, 1, 6);
    const start = performance.now();
    view.capsule.userData.onFrame = (dt) => {
      const t = (performance.now() - start) / 1000;
      view.camera.position.set(Math.sin(t * 0.05) * (6 + t * 3), 1 + t * 0.4, 6 + t * 6);
      view.camera.lookAt(0, 0, 0);
      view.capsule.rotation.y += dt * 0.03;
    };
    await wait(7000);
    if (!alive) return;

    // 7. The reply, 14 minutes late, to an empty cockpit.
    lines.replaceChildren();
    actions.replaceChildren();
    card.style.opacity = '1';
    await say(A.reply);
    await wait(1200);
    const from = el('div', 'hud-label', `Message from ${family.from}`);
    lines.append(from);
    const reply = await say(fill(A.replyText, { family: family.from }));
    reply.style.fontStyle = 'italic';
    await wait(1500);
    lines.append(el('div', 'role4-help', A.help));
    actions.append(button('Flight Report', () => requestState('REPORT'), { key: 'Enter', primary: true }));
  })();

  return () => {
    alive = false;
    graphics.setEffects({ vignette: 0 });
    view.capsule.userData.onFrame = null;
  };
}
