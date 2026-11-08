import phase0Data from '../phase0.json' with { type: 'json' };
const copy = phase0Data.copy;

// HUD for LAUNCH Phase 0 (strap-in): checklist panel, fact line, GO / NO-GO poll and the GO / SCRUB prompt.
// Plain DOM in the flight HUD's look (cyan / amber, ui-monospace). Pointer events stay off except on the two buttons.
export function createPhase0Panel({ parent, flightHud }) {
  const root = document.createElement('div');
  root.className = 'p0';
  root.innerHTML = `<style>
.p0{position:absolute;inset:0;pointer-events:none;color:#d8eff1;font:12px/1.5 ui-monospace,monospace;--cyan:#72e6e0;--amber:#ffbe75;--green:#7dffa8;--red:#ff6978}
.p0 *{box-sizing:border-box}
.flight-presentation.p0-on>*:not(.objective){display:none!important}
.p0 .box{position:absolute;left:32px;top:96px;width:340px;padding:14px 16px;border:1px solid #72e6e044;background:#071419d0;opacity:0;transform:translateY(6px);transition:opacity .6s,transform .6s}
.p0 .box.on{opacity:1;transform:none}
.p0 .box small{display:block;color:#8daeb8;font-size:10px;letter-spacing:.18em;margin-bottom:8px}
.p0 .step{display:flex;gap:12px;align-items:center;padding:6px 8px;margin:3px 0;color:#8daeb8;font-size:13px;letter-spacing:.06em;border-left:2px solid transparent;transition:color .3s,background .3s}
.p0 .step .key{display:inline-grid;place-items:center;width:22px;height:22px;border:1px solid currentColor;border-radius:3px;font-size:12px}
.p0 .step .tick{margin-left:auto;font-size:15px;opacity:0}
.p0 .step.current{color:#fff;background:#ffbe7518;border-left-color:var(--amber)}.p0 .step.current .key{color:var(--amber)}
.p0 .step.done{color:var(--green)}.p0 .step.done .tick{opacity:1}
.p0 .fact{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);width:min(680px,86%);padding:11px 18px;text-align:center;border:1px solid #72e6e033;background:#071419e0;font-size:14px;letter-spacing:.04em;line-height:1.55;opacity:0;transition:opacity .5s}
.p0 .fact.on{opacity:1}.p0 .fact.hint{border-color:#ffbe7566;color:#ffe3b3}
.p0 .keys{position:absolute;left:32px;right:32px;bottom:30px;text-align:center;color:#8daeb8;font-size:11px;letter-spacing:.14em;opacity:0;transition:opacity .5s}.p0 .keys.on{opacity:1}
.p0 .skip{position:absolute;right:32px;top:26px;padding:4px 12px;border:1px solid #72e6e044;background:#071419d0;color:var(--cyan);font-size:11px;letter-spacing:.14em;opacity:0;transition:opacity .4s}.p0 .skip.on{opacity:1}
.p0 .caption{position:absolute;left:0;right:0;bottom:15%;text-align:center;letter-spacing:.34em;font-size:13px;color:#d8eff1;text-shadow:0 0 12px #000;opacity:0;transition:opacity 1s}.p0 .caption.on{opacity:1}
.p0 .caption b{display:block;font-weight:400;font-size:10px;color:var(--cyan);letter-spacing:.3em;margin-bottom:6px}
.p0 .poll{max-height:calc(100% - 280px);overflow-y:auto;pointer-events:auto;scrollbar-width:thin}
.p0 .poll .line{display:flex;gap:10px;padding:2px 0;font-size:14px;letter-spacing:.04em;animation:p0in .35s both}
.p0 .poll .line .go{color:var(--green)}.p0 .poll .line .no{color:var(--red)}.p0 .poll .line.no .why{color:#ffc2c8}
.p0 .poll .line .st{min-width:112px;color:#b3d3da}
.p0 .poll .why{display:block;font-size:12px;letter-spacing:.02em;margin:0 0 4px 122px;color:#ffc2c8;max-width:200px}
.p0 .ask{margin-top:14px;padding-top:12px;border-top:1px solid #72e6e033;color:#fff;font-size:15px;letter-spacing:.06em;animation:p0in .5s both}
.p0 .ask .row{display:flex;gap:12px;margin-top:12px}
.p0 .ask button{pointer-events:auto;cursor:pointer;font:inherit;font-size:13px;letter-spacing:.14em;padding:9px 16px;border:1px solid var(--green);background:#7dffa81a;color:var(--green)}
.p0 .ask button:hover,.p0 .ask button:focus-visible{background:#7dffa833;outline:none}
.p0 .ask button.scrub{border-color:var(--amber);background:#ffbe7512;color:var(--amber)}.p0 .ask button.scrub:hover{background:#ffbe7530}
.p0 .ask .ok{color:var(--green)}.p0 .ask .note{color:#ffe3b3;font-size:13px;line-height:1.5}
@keyframes p0in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
@media(max-width:700px){.p0 .box{left:16px;top:84px;width:min(300px,calc(100% - 32px))}.p0 .fact{bottom:80px;font-size:12px}.p0 .keys{font-size:9px}}
</style>
<div class="box checklist"></div><div class="box poll"></div><div class="fact"></div><div class="keys"></div><div class="skip"></div><div class="caption"></div>`;
  parent.append(root);
  flightHud?.root?.classList.add('p0-on');
  const q = (c) => root.querySelector(`.${c}`);
  const els = { list: q('checklist'), poll: q('poll'), fact: q('fact'), keys: q('keys'), skip: q('skip'), caption: q('caption') };
  let factTimer = 0;
  let ask = null;
  const text = (tag, cls, str) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = str; return e; };

  return {
    root,
    // steps: [{ key, label, status }]
    setChecklist(steps, visible = true) {
      els.list.classList.toggle('on', visible);
      if (!visible) return;
      const rows = steps.map((st) => {
        const row = document.createElement('div');
        row.className = `step ${st.status}`;
        row.append(text('span', 'key', st.key), text('span', null, st.label), text('span', 'tick', '✓'));
        return row;
      });
      els.list.replaceChildren(text('small', null, copy.checklistHeading), ...rows);
    },
    setFact(str, { hint = false, seconds = 6 } = {}) {
      clearTimeout(factTimer);
      els.fact.textContent = str ?? '';
      els.fact.classList.toggle('hint', hint);
      els.fact.classList.toggle('on', !!str);
      if (str && seconds) factTimer = setTimeout(() => els.fact.classList.remove('on'), seconds * 1000);
    },
    setKeys(str) { els.keys.textContent = str ?? ''; els.keys.classList.toggle('on', !!str); },
    setSkip(str) { els.skip.textContent = str ?? ''; els.skip.classList.toggle('on', !!str); },
    setCaption(top, bottom) {
      els.caption.replaceChildren(...(top ? [text('b', null, top), document.createTextNode(bottom ?? '')] : []));
      els.caption.classList.toggle('on', !!top);
    },
    // lines: poll entries to show (title row first); heading: small label
    setPoll(lines, { heading = copy.pollHeading, visible = true } = {}) {
      els.poll.classList.toggle('on', visible);
      if (!visible) return;
      const shown = els.poll.querySelectorAll('.line').length;
      if (!els.poll.querySelector('small') || els.poll.dataset.heading !== heading || shown > lines.length) {
        els.poll.replaceChildren(text('small', null, heading));
        els.poll.dataset.heading = heading;
        ask = null;
      }
      const have = els.poll.querySelectorAll('.line').length;
      for (let i = have; i < lines.length; i++) {
        const p = lines[i];
        const line = document.createElement('div');
        line.className = `line ${p.go ? 'ok' : 'no'}`;
        const head = document.createElement('div');
        head.style.display = 'flex';
        head.style.gap = '10px';
        head.append(text('span', 'st', p.station), text('span', p.go ? 'go' : 'no', p.go ? 'GO' : 'NO-GO'));
        line.style.display = 'block';
        line.append(head);
        if (!p.go) line.append(text('span', 'why', p.reason));
        if (ask) ask.box.before(line);
        else els.poll.append(line);
      }
    },
    // the GO / SCRUB prompt under the poll. cb: { onGo, onScrub } ; scrub: bool
    showAsk({ scrub, onGo, onScrub }) {
      const box = document.createElement('div');
      box.className = 'ask';
      box.append(text('div', null, copy.ask));
      const row = document.createElement('div');
      row.className = 'row';
      const go = text('button', 'go', copy.goButton);
      go.type = 'button';
      go.addEventListener('click', () => onGo?.());
      row.append(go);
      if (scrub) {
        const sc = text('button', 'scrub', copy.scrubButton);
        sc.type = 'button';
        sc.addEventListener('click', () => onScrub?.());
        row.append(sc);
      }
      box.append(row);
      els.poll.append(box);
      ask = { box, row, go };
    },
    // replace the prompt by a one-line answer
    answer(str, cls = 'ok') {
      els.poll.querySelector('.ask')?.remove();
      const box = document.createElement('div');
      box.className = 'ask';
      box.append(text('div', cls, str));
      els.poll.append(box);
    },
    hidePoll() { els.poll.classList.remove('on'); },
    finish() { // the countdown takes over the screen: let the flight HUD back in, fade our panels
      flightHud?.root?.classList.remove('p0-on');
      for (const e of Object.values(els)) e.classList.remove('on');
    },
    dispose() { clearTimeout(factTimer); flightHud?.root?.classList.remove('p0-on'); root.remove(); },
  };
}
