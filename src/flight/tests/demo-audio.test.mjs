import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DUCK_LEVEL, EVENT_CUES, QUEUE_GAP_S, RETURN_CUES, SQUELCH_S, availableActions, cue, duckGain, dueCues, hasId,
  isRadioVoice, lineOrder, lineSeconds, playLine, playMusic, playSfx, segmentCues, speakerLabel, stopAll, wantsRadio,
} from '../demo/audio.js';
import { RETURN_SCRIPT, panicPressTimes } from '../demo/returnHome.js';

const manifest = JSON.parse(readFileSync(new URL('../../../public/assets/audio/demo/manifest.json', import.meta.url), 'utf8'));
const lines = (name) => EVENT_CUES[name].filter((a) => a.line).map((a) => a.line);
const dur = Object.fromEntries(RETURN_SCRIPT.segments.map((s) => [s.id, s.dur]));
const at = (seg, id) => RETURN_CUES[seg].find((c) => c.line === id || c.sfx === id)?.at;

// ---- cue sheet order, per beat ----
{
  assert.deepEqual(lines('beat:title'), ['n_open']);
  assert.ok(EVENT_CUES['beat:title'].some((a) => a.music === 'mus_opening' && a.fadeIn > 0));
  // beat 1: message from home (a card), then the poll as it shows, then the override; the opening music fades
  const hangar = ['beat:hangar', 'gonogo', 'pollGo', 'pollNoGo', 'override'].flatMap(lines);
  assert.deepEqual(hangar, ['w_message', 'fd_poll_open', 'fd_poll_go', 'fd_poll_recovery', 'fd_override']);
  assert.equal(EVENT_CUES['beat:hangar'].find((a) => a.line === 'w_message').card, 'MESSAGE FROM HOME');
  assert.ok(EVENT_CUES['beat:hangar'].some((a) => a.sfx === 'sfx_control_room' && a.loop));
  assert.ok(EVENT_CUES.override.some((a) => a.fade === 'mus_opening' && a.to === 0));
  // beat 2: countdown ends on "Liftoff!" at T-0 (10 s after it starts), rumble at ignition, roar + "here we go" at liftoff
  const countdown = EVENT_CUES.countdown[0];
  assert.equal(countdown.line, 'c_countdown');
  assert.equal(countdown.syncEnd, 10);
  assert.equal(countdown.overlap, true); // never pushed late by the queue
  assert.ok(lineSeconds(manifest, 'c_countdown', true) <= 10, 'the countdown fits before T-0');
  assert.deepEqual(EVENT_CUES.ignition.map((a) => a.sfx), ['sfx_launch_rumble']);
  assert.ok(EVENT_CUES.liftoff.some((a) => a.sfx === 'sfx_liftoff_roar'));
  assert.deepEqual(lines('liftoff'), ['a_herewego']);
  assert.deepEqual(lines('notice:maxq_warning'), ['c_maxq']);
  assert.ok(EVENT_CUES['notice:maxq_warning'].some((a) => a.sfx === 'sfx_maxq_buffet'));
  assert.deepEqual(lines('manualOffer'), ['c_gravity']);
  // beat 3: debris
  assert.deepEqual(EVENT_CUES.debris.map((a) => a.sfx ?? a.line), ['sfx_master_alarm', 'c_debris']);
  assert.deepEqual(EVENT_CUES.whoosh.map((a) => a.sfx), ['sfx_debris_whoosh']);
  assert.deepEqual(lines('debrisClear'), ['c_clear']);
  // beats 4-6
  assert.deepEqual(lines('beat:cruise'), ['n_days']);
  assert.deepEqual(lines('beat:entry'), ['n_delay']);
  assert.ok(EVENT_CUES.marsAtmosphere.some((a) => a.sfx === 'sfx_mars_entry_roar'));
  assert.ok(EVENT_CUES.chute.some((a) => a.sfx === 'sfx_chute_deploy') && lines('chute').includes('a_touchdown'));
  assert.ok(EVENT_CUES.landingBurn.some((a) => a.sfx === 'sfx_landing_engine'));
  assert.ok(EVENT_CUES['fh:start'].some((a) => a.sfx === 'sfx_suit_breath' && a.loop));
  assert.deepEqual(['fh:touch', 'fh:gohome'].flatMap(lines), ['a_jezero', 'a_gohome']);
  assert.equal(EVENT_CUES['fh:gohome'][0].subtitle, false); // the caption is on screen with it
  assert.ok(EVENT_CUES['fh:land'].some((a) => a.sfx === 'sfx_footsteps_gravel'));
  assert.ok(EVENT_CUES['fh:unfurl'].some((a) => a.sfx === 'sfx_flag_fabric'));
  // impact: everything cut, then the explosion
  assert.deepEqual(EVENT_CUES.impactHit.map((a) => (a.stopAll !== undefined ? 'stopAll' : a.sfx)), ['stopAll', 'sfx_explosion']);
  assert.ok(EVENT_CUES.scroll.some((a) => a.music === 'mus_memorial' && a.fadeIn > 0));
}

// ---- return home: order inside each segment, inside its duration, lamps on the lines that call them ----
{
  assert.deepEqual(lineOrder(RETURN_CUES.flyby), ['a_hello_earth', 'c_welcome', 'a_lily']);
  assert.deepEqual(lineOrder(RETURN_CUES.entry), ['c_entry', 'a_rollercoaster', 'a_coffee']);
  assert.deepEqual(lineOrder(RETURN_CUES.parachute), ['pc_deploy', 'a_main_now', 'pc_drogue', 'pc_nodeploy', 'a_huh']);
  assert.deepEqual(lineOrder(RETURN_CUES.panic), ['pc_failure', 'a_mayday1', 'c_breaking', 'a_mayday2', 'pc_reserve', 'a_please', 'pc_tangled', 'c_withyou']);
  assert.deepEqual(lineOrder(RETURN_CUES.reminder), ['c_doyoucopy', 'c_capsule', 'w_echo', 'fd_poll_recovery', 'fd_said_go']);
  for (const [seg, list] of Object.entries(RETURN_CUES)) for (const c of list) assert.ok(c.at >= 0 && c.at < dur[seg], `${seg} ${c.line ?? c.sfx} at ${c.at}`);
  // queued (non-overlap) lines do not run into each other, so nothing drifts behind the picture
  for (const [seg, list] of Object.entries(RETURN_CUES)) {
    const q = list.filter((c) => c.line && !c.overlap && hasId(manifest, c.line)).sort((a, b) => a.at - b.at);
    for (let i = 1; i < q.length; i += 1) {
      const end = q[i - 1].at + lineSeconds(manifest, q[i - 1].line, q[i - 1].radio);
      assert.ok(end + QUEUE_GAP_S <= q[i].at + 0.05, `${seg}: ${q[i - 1].line} ends ${end.toFixed(2)}, ${q[i].line} at ${q[i].at}`);
    }
  }
  // the chute lamps light with the computer's calls; the slow press lands on "now"
  const P = RETURN_SCRIPT.parachute;
  assert.equal(P.lamps.find((l) => l.text.startsWith('DROGUE')).at, at('parachute', 'pc_drogue'));
  assert.equal(P.lamps.find((l) => l.text.startsWith('MAIN')).at, at('parachute', 'pc_nodeploy'));
  const now = at('parachute', 'a_main_now');
  assert.ok(P.pressAt > now + 1 && P.pressAt < now + lineSeconds(manifest, 'a_main_now') + 0.3, 'press on "now"');
  const lamps = RETURN_SCRIPT.panic.lamps;
  assert.equal(lamps.find((l) => l.text.endsWith('DEPLOYED')).at, at('panic', 'pc_reserve'));
  assert.equal(lamps.find((l) => l.text.endsWith('TANGLED')).at, at('panic', 'pc_tangled'));
  // the panic covers both maydays and lasts at least 6 s; presses still fit inside it
  assert.ok(dur.panic >= 6);
  for (const id of ['a_mayday1', 'a_mayday2']) assert.ok(at('panic', id) + lineSeconds(manifest, id) <= dur.panic, id);
  assert.ok(panicPressTimes().at(-1) < dur.panic);
  // the reminder: 2 s of silence first; the replayed NO-GO with the amber line, "You said GO." after its line appears
  const R = RETURN_SCRIPT.reminder;
  assert.ok(Math.min(...RETURN_CUES.reminder.filter((c) => c.line).map((c) => c.at)) >= R.blackSilence);
  assert.equal(at('reminder', 'fd_poll_recovery'), R.lines.find((l) => l.id === 'nogo').at);
  assert.ok(at('reminder', 'fd_said_go') >= R.lines.find((l) => l.id === 'said-go').at);
  assert.ok(at('reminder', 'w_echo') < R.lines[0].at); // the echo from home before the text
  const echo = RETURN_CUES.reminder.find((c) => c.line === 'w_echo');
  assert.ok(!echo.radio && echo.volume <= 0.4); // dry and very soft
}

// ---- dueCues: each row once, in time order, rows at 0 on entry ----
{
  const list = [{ at: 2, line: 'b' }, { at: 0, line: 'a' }, { at: 5, line: 'c' }];
  assert.deepEqual(dueCues(list, -1, 0).map((c) => c.line), ['a']);
  assert.deepEqual(dueCues(list, 0, 2).map((c) => c.line), ['b']);
  assert.deepEqual(dueCues(list, 2, 4.9).map((c) => c.line), []);
  assert.deepEqual(dueCues(list, -1, 9).map((c) => c.line), ['a', 'b', 'c']); // a long frame fires them in order
}

// ---- ducking ----
{
  assert.equal(DUCK_LEVEL, 0.35);
  assert.equal(duckGain(1, 0), 1);
  assert.equal(duckGain(1, 1), 0.35);
  assert.equal(duckGain(1, 3), 0.35); // not deeper with more lines
  assert.ok(Math.abs(duckGain(0.5, 1) - 0.175) < 1e-12);
}

// ---- missing ids are skipped ----
{
  const m = { n_open: { file: 'n_open.mp3', voice: 'narrator', durationSec: 6 } };
  assert.equal(hasId(m, 'n_open'), true);
  assert.equal(hasId(m, 'sfx_nothing'), false);
  assert.equal(hasId(null, 'n_open'), false);
  assert.equal(hasId({ x: {} }, 'x'), false); // listed without a file
  const kept = availableActions([{ line: 'n_open' }, { sfx: 'sfx_nothing' }, { music: 'mus_x' }, { stop: 'breath' }], m);
  assert.deepEqual(kept, [{ line: 'n_open' }, { stop: 'breath' }]);
  assert.equal(lineSeconds(m, 'missing'), 0);
  // the engine does nothing (and throws nothing) before the demo starts it, and in Node
  await playLine('n_open');
  await playLine('does_not_exist', { radio: true });
  playSfx('sfx_nothing').stop(100);
  playMusic('mus_x').stop(100);
  cue('beat:title');
  cue('no-such-cue');
  segmentCues('panic', 3);
  stopAll(0);
}

// ---- radio: only CAPCOM and FLIGHT get the filter; every radio row is one of them ----
{
  assert.equal(isRadioVoice('capcom'), true);
  assert.equal(isRadioVoice('flight_director'), true);
  assert.equal(isRadioVoice('astronaut'), false);
  assert.equal(wantsRadio({ voice: 'capcom' }, true), true);
  assert.equal(wantsRadio({ voice: 'capcom' }, false), false);
  assert.equal(wantsRadio({ voice: 'astronaut' }, true), false); // the flag alone is not enough
  assert.equal(lineSeconds({ c: { voice: 'capcom', durationSec: 2 } }, 'c', true), 2 + 2 * SQUELCH_S);
  assert.equal(lineSeconds({ a: { voice: 'astronaut', durationSec: 2 } }, 'a', true), 2);
  const rows = [...Object.values(EVENT_CUES).flat(), ...Object.values(RETURN_CUES).flat(), { line: 'n_komarov' }].filter((a) => a.line && manifest[a.line]);
  const dryByDesign = new Set(['fd_said_go']); // the last word, close and dry
  for (const a of rows) {
    const voice = manifest[a.line].voice;
    if (a.radio) assert.ok(isRadioVoice(voice), `${a.line} is radio but ${voice}`);
    if (isRadioVoice(voice) && !dryByDesign.has(a.line)) assert.equal(a.radio, true, `${a.line} (${voice}) should be on the radio`);
    if (!isRadioVoice(voice)) assert.ok(!a.radio, `${a.line} (${voice}) must stay dry`);
  }
}

// ---- subtitle labels ----
{
  assert.equal(speakerLabel('narrator'), 'NARRATOR');
  assert.equal(speakerLabel('flight_director'), 'FLIGHT');
  assert.equal(speakerLabel('capcom'), 'CAPCOM');
  assert.equal(speakerLabel('astronaut'), 'ASTRONAUT');
  assert.equal(speakerLabel('computer'), 'COMPUTER');
  assert.equal(speakerLabel('wife'), 'HOME');
  assert.equal(speakerLabel('lilys_mom'), 'HOME');
}

// ---- every voice line the sheet names is in the manifest (sfx/music may still be on their way) ----
{
  const named = new Set([...Object.values(EVENT_CUES).flat(), ...Object.values(RETURN_CUES).flat()].map((a) => a.line).filter(Boolean));
  const pending = new Set(['w_message', 'w_echo']);
  for (const id of named) if (!pending.has(id)) assert.ok(manifest[id], `${id} missing from the manifest`);
}

console.log('audio tests passed');
