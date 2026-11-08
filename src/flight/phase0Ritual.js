import { CABIN_OPTIONS, CHECKLIST_STEPS, PHASE0_TIMING as T, aimInfo, boardingPath, buildPoll, createChecklist, fallbackLabel, nextButtonId, phase0Plan, pollLinesShown, promptAt, scrubAvailable, scrubFee } from './phase0.js';
import phase0Data from './phase0.json' with { type: 'json' };
const copy = phase0Data.copy;

import { createPhase0Panel } from './hud/phase0Panel.js';

// Wall-clock timing is deliberate: the game loop clamps dt on slow renderers.
export function createPhase0Ritual({ parent, hud, input, audio, graphics, cinematic, contract, economy, ship, attempt, data, getSite, getCockpit, hasButton, setBoardingView, onCountdown, onScrub, now = () => performance.now() / 1000, createPanel = createPhase0Panel }) {
  const panel = createPanel({ parent, flightHud: hud });
  const checklist = createChecklist();
  const needDv = Object.values(economy.balance.deltaVKmS ?? {}).reduce((a, b) => a + b, 0) * 1000 || 5400;
  let poll = buildPoll(ship, { needDv });
  const plan = phase0Plan({ attempt, data });
  let stage = 'waiting', since = now(), disposed = false, generation = 0, shown = 0;
  let o2FlowStarted = false;
  // Apollo 1: the cabin atmosphere is the player's choice. Pure oxygen + the wiring caution carried on + GO = the pad fire.
  let atmosphere = null, purged = false, cautionOn = false, cabinStep = null, fillFor = null;
  const fireRisk = () => atmosphere === 'pure' && !purged;
  const sound = (id) => {
    const chosen = audio.ids().includes(id) ? id : 'ui.click';
    if (chosen === 'suit.o2flow') o2FlowStarted = true;
    audio.play(chosen);
  };
  const stopO2Flow = () => { if (o2FlowStarted) { audio.stop('suit.o2flow'); o2FlowStarted = false; } };
  const setStage = (value) => { stage = value; since = now(); panel.root.dataset.stage = value; if (value !== 'checklist') panel.setReticle?.(null); };
  const buttons = () => (getCockpit?.() ?? getSite()?.cockpit)?.userData;
  const found = (step) => !hasButton || hasButton(step.id) !== false; // no mesh found for this id: that item falls back to its key
  let aimId = null, pending = null, pulseOn = null;
  const drawChecklist = () => {
    const status = (i) => (stage === 'cabin' || stage === 'fill' ? (i < 1 ? 'done' : i === 1 ? 'current' : 'todo') : checklist.status(i)); // the cabin item stays open until its air is in
    panel.setChecklist(CHECKLIST_STEPS.map((step, i) => ({ ...step, status: status(i), fallback: !found(step), fallbackText: fallbackLabel(step).split(' · ')[1] })));
    pulseOn = null;
    CHECKLIST_STEPS.forEach((step, i) => buttons()?.setButton?.(step.button, status(i) === 'done' ? (step.id === 'arm' ? 'red' : 'green') : status(i) === 'current' ? 'amber' : 'off'));
  };
  const stopBoarding = () => { generation++; if (stage === 'boarding') cinematic.stop(); panel.setCaption(null); };
  const seat = () => {
    stopBoarding(); setStage('seat'); panel.setKeys(null); panel.setSkip(plan.offerSkip ? copy.skip : null);
    const token = generation;
    Promise.resolve(graphics.fade({ to: 1, duration: T.seatDark })).then(() => {
      if (!disposed && token === generation && stage === 'seat') graphics.fade({ to: 0, duration: T.seatFade });
    });
    sound('crew.harness'); panel.setFact(copy.seatFact, { seconds: 0 });
  };
  const clearCabinUi = () => { panel.setChoice?.(null); panel.setProgress?.(null); panel.setCaution?.(null); };
  const finish = () => {
    if (disposed || stage === 'done') return;
    stopO2Flow(); clearCabinUi(); setStage('done'); panel.finish(); onCountdown({ padFire: fireRisk() });
  };
  const quick = () => {
    if (disposed || stage === 'done' || stage === 'quick' || stage === 'cleared') return;
    stopBoarding(); stopO2Flow(); clearCabinUi(); atmosphere = null; cautionOn = false; // the fast path never carries the fire risk
    setStage('quick'); graphics.fade({ to: 0, duration: 0 });
    panel.setChecklist([], false); panel.setFact(null); panel.setKeys(null); panel.setSkip(null);
    const warnings = poll.filter((line) => !line.go);
    panel.setPoll(warnings, { heading: warnings.length ? copy.quickWarnings : copy.quickHeading });
    panel.answer(warnings.length ? copy.quickWarningAnswer : copy.quickAnswer, warnings.length ? 'note' : 'ok');
  };
  const go = () => {
    if (disposed || stage !== 'ask') return;
    setStage('cleared'); panel.setKeys(null); panel.setSkip(null); panel.answer(copy.cleared); sound('radio.blip');
  };
  const scrub = () => {
    if (disposed || stage !== 'ask' || !scrubAvailable(contract)) return;
    const fee = scrubFee(economy.balance);
    if (!economy.canAfford(fee)) { panel.setFact(copy.insufficientFunds, { hint: true }); return; }
    economy.spend(fee, 'launch scrub'); onScrub();
  };
  // Hand animation hook (Role 3's glove): cockpit.userData.reach?.(id) -> seconds until the glove touches the button; the cockpit
  // then presses it itself. Without it the button is pressed here, at once.
  const reachSeconds = (step) => {
    const r = buttons()?.reach?.(step.id);
    return Number.isFinite(r) && r > 0 ? { delay: r, handled: true } : { delay: 0, handled: typeof buttons()?.reach === 'function' };
  };
  const fillText = (kind, left) => copy[kind === 'pure' ? 'fillPure' : 'fillAir'].replace('{s}', Math.max(0, Math.ceil(left)));
  const choose = (kind) => {
    if (disposed || stage !== 'cabin' || !CABIN_OPTIONS[kind]) return;
    atmosphere = kind; panel.setChoice?.(null);
    sound(cabinStep.step.sound); if (!cabinStep.handled) buttons()?.press?.(cabinStep.step.button);
    fillFor = { kind, duration: kind === 'pure' ? T.fillPure : T.fillAir, sim: CABIN_OPTIONS[kind].simSeconds };
    setStage('fill'); drawChecklist(); panel.setFact(copy[kind === 'pure' ? 'pureFact' : 'airFact']);
    panel.setProgress?.({ label: fillText(kind, fillFor.sim), frac: 0 });
  };
  const endFill = () => {
    fillFor = null; panel.setProgress?.(null); setStage('checklist'); drawChecklist(); showAim();
  };
  const purge = () => {
    if (disposed || stage !== 'checklist' || pending || !cautionOn) return;
    cautionOn = false; panel.setCaution?.(null); sound('cockpit.pressurise');
    fillFor = { kind: 'purge', duration: T.purge, sim: 60 };
    setStage('purge'); panel.setFact(copy.purging.replace('{s}', 60), { seconds: 0 });
    panel.setProgress?.({ label: copy.purging.replace('{s}', 60), frac: 0 });
  };
  const apply = (step, handled) => {
    if (disposed || stage !== 'checklist') return;
    if (step.id === 'cabin') { // the player decides what fills the cabin before the item completes
      cabinStep = { step, handled }; setStage('cabin'); drawChecklist(); panel.setFact(copy.cabinFact, { seconds: 0 });
      panel.setChoice?.({ title: copy.cabinTitle, options: Object.entries(CABIN_OPTIONS).map(([kind, o]) => ({ kind, key: o.key, label: o.label, onPick: () => choose(kind) })) });
      return;
    }
    sound(step.sound); if (!handled) buttons()?.press?.(step.button); drawChecklist(); panel.setFact(step.fact);
    if (step.id === 'o2' && fireRisk() && !checklist.done) { // a quiet amber lamp: the player may purge, or carry on
      cautionOn = true; sound('alarm.caution');
      panel.setCaution?.({ text: copy.cautionLamp, button: `${copy.cautionPurge} · ${copy.cautionKey}`, onPurge: purge });
    }
    if (checklist.done) { cautionOn = false; panel.setCaution?.(null); poll = buildPoll(ship, { needDv, pureOxygenFault: fireRisk() }); setStage('poll'); panel.setChecklist([], false); panel.setReticle?.(null); panel.setKeys(null); panel.setSkip(null); panel.setPoll([]); }
  };
  // i: 0-based item. Shared by the aim-and-click path and the hidden number-key fallback.
  const trigger = (i) => {
    if (stage === 'cabin') { const kind = ['air', 'pure'][i]; if (kind) choose(kind); return; } // keys 1 / 2 pick the option
    if (disposed || stage !== 'checklist' || pending) return;
    const result = checklist.press(i + 1);
    if (result.result === 'wrong') {
      sound('ui.error'); panel.setFact(copy.wrongOrder.replace('{next}', result.expected.name), { hint: true });
    }
    if (result.result !== 'ok') return;
    const { delay, handled } = reachSeconds(result.step);
    if (delay > 0) { pending = { at: now() + delay, step: result.step, handled }; setAim(aimId); }
    else apply(result.step, handled);
  };
  const showAim = () => {
    if (stage !== 'checklist' || pending) { panel.setReticle?.(stage === 'checklist' ? { tone: null, label: null } : null); return; }
    const step = CHECKLIST_STEPS.find((st) => st.id === aimId);
    const info = aimInfo(checklist, aimId);
    panel.setReticle?.({ tone: info.tone, label: info.label && step && found(step) ? info.label : null });
  };
  const setAim = (id) => { aimId = id ?? null; showAim(); };
  const click = () => {
    if (disposed || stage !== 'checklist' || !aimId) return false;
    const i = CHECKLIST_STEPS.findIndex((st) => st.id === aimId);
    if (i < 0 || !found(CHECKLIST_STEPS[i])) return false;
    trigger(i);
    return true;
  };
  const pulse = () => { // the next button blinks between its pending lamp colour and off
    const step = CHECKLIST_STEPS[checklist.index];
    if (!step || pending || !found(step)) return;
    const on = Math.floor(now() * 2.5) % 2 === 0;
    if (on !== pulseOn) { pulseOn = on; buttons()?.setButton?.(step.button, on ? 'amber' : 'off'); }
  };
  const offs = CHECKLIST_STEPS.map((step, i) => input.onPress(`Digit${step.key}`, () => trigger(i)));
  offs.push(input.onPress('Mouse0', click));
  offs.push(input.onPress('Enter', () => {
    if (disposed) return;
    if (stage === 'ask') go();
    else if (plan.offerSkip) quick();
    else if (stage === 'boarding' || stage === 'waiting') seat();
  }), input.onPress('KeyS', scrub), input.onPress('KeyF', purge));
  panel.setCaption(copy.captionTop, copy.caption);
  panel.setKeys(copy.boardNow);
  panel.setSkip(plan.offerSkip ? copy.skip : null);
  if (plan.quick) quick();
  return {
    get active() { return !disposed && stage !== 'done'; },
    get stage() { return stage; },
    get boarding() { return stage === 'boarding'; },
    get objective() { return ['poll', 'ask', 'cleared', 'quick'].includes(stage) ? copy.objectiveGo : copy.objectiveChecklist; },
    skip: quick,
    setAim, click,
    get nextButton() { return nextButtonId(checklist); },
    get cabin() { return { atmosphere, purged, caution: cautionOn, fireRisk: fireRisk() }; },
    chooseCabin: choose, purge,
    update() {
      if (disposed || stage === 'done') return;
      if (pending && now() >= pending.at) { const p = pending; pending = null; apply(p.step, p.handled); showAim(); }
      if (stage === 'checklist') pulse();
      const elapsed = now() - since;
      if (stage === 'waiting') {
        const site = getSite();
        if (site) {
          setStage('boarding'); setBoardingView(site); panel.setKeys(copy.boardSkip);
          const token = ++generation;
          cinematic.play({ camera: site.camera, cameraPath: boardingPath(site.rocketBase, site.eyeY), duration: T.board })
            .then(() => { if (!disposed && token === generation && stage === 'boarding') seat(); });
        } else if (elapsed >= 5) seat(); // failed or slow site warm-up must never trap the player
      } else if (stage === 'boarding' && elapsed >= T.board) seat();
      else if (stage === 'seat' && elapsed >= T.seatDark + T.seatFade + T.seatSettle) {
        setStage('checklist'); panel.setFact(copy.checklistFact, { seconds: 0 }); drawChecklist(); panel.setKeys(copy.checklistKeys); showAim();
      } else if (stage === 'fill' || stage === 'purge') {
        const frac = Math.min(1, elapsed / fillFor.duration);
        panel.setProgress?.({ label: stage === 'purge' ? copy.purging.replace('{s}', Math.ceil(fillFor.sim * (1 - frac))) : fillText(fillFor.kind, fillFor.sim * (1 - frac)), frac });
        if (frac >= 1) {
          if (stage === 'fill') endFill();
          else { purged = true; atmosphere = 'air'; fillFor = null; panel.setProgress?.(null); setStage('checklist'); panel.setFact(copy.purgedFact); showAim(); }
        }
      } else if (stage === 'poll') {
        const count = pollLinesShown(elapsed, poll.length);
        if (count > shown) { shown = count; panel.setPoll(poll.slice(0, shown)); sound('gonogo.tick'); }
        if (elapsed >= promptAt(poll.length)) {
          setStage('ask'); panel.setFact(poll.some((p) => !p.go) ? copy.warningFact : copy.goFact, { seconds: 0 });
          panel.showAsk({ scrub: scrubAvailable(contract), onGo: go, onScrub: scrub });
        }
      } else if (stage === 'cleared' && elapsed >= T.cleared) finish();
      else if (stage === 'quick' && elapsed >= T.quickNoGo) finish();
    },
    dispose() { if (disposed) return; stopBoarding(); stopO2Flow(); disposed = true; offs.forEach((off) => off?.()); panel.dispose(); graphics.fade({ to: 0, duration: 0 }); },
  };
}
