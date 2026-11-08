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
.p0 .reticle{position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border:2px solid #ffffffcc;border-radius:50%;box-shadow:0 0 6px #000a;opacity:0;transition:opacity .4s,transform .15s,border-color .15s,background .15s}
.p0 .reticle.on{opacity:1}.p0 .reticle.ok{transform:scale(2.2);border-color:var(--cyan);background:#72e6e033}.p0 .reticle.warn{transform:scale(2.2);border-color:var(--amber);background:#ffbe7522}.p0 .reticle.done{transform:scale(1.6);border-color:var(--green)}
.p0 .rlabel{position:absolute;left:calc(50% + 26px);top:50%;transform:translateY(-50%);padding:4px 10px;border:1px solid #72e6e066;background:#071419e6;color:var(--cyan);font-size:12px;letter-spacing:.08em;white-space:nowrap;opacity:0;transition:opacity .15s}
.p0 .rlabel.on{opacity:1}.p0 .rlabel.warn{border-color:#ffbe7588;color:var(--amber)}.p0 .rlabel.done{border-color:#7dffa866;color:var(--green)}
.p0 .choice{top:300px;border-color:#ffbe7566}.p0 .choice button{display:block;width:100%;margin:6px 0;text-align:left;pointer-events:auto;cursor:pointer;font:inherit;font-size:13px;letter-spacing:.04em;padding:9px 12px;border:1px solid var(--cyan);background:#72e6e014;color:#d8eff1}
.p0 .choice button:hover,.p0 .choice button:focus-visible{background:#72e6e033;outline:none}.p0 .choice button b{color:var(--amber);margin-right:8px}
.p0 .caution{left:auto;right:32px;top:96px;width:320px;border-color:var(--amber);background:#2a1a05d8}.p0 .caution .lamp{color:var(--amber);font-size:13px;letter-spacing:.06em;animation:p0blink 1.4s ease-in-out infinite}
.p0 .caution button{pointer-events:auto;cursor:pointer;margin-top:10px;font:inherit;font-size:12px;letter-spacing:.06em;padding:8px 12px;border:1px solid var(--amber);background:#ffbe7512;color:var(--amber)}.p0 .caution button:hover{background:#ffbe7530}
.p0 .progress{position:absolute;left:50%;bottom:160px;transform:translateX(-50%);width:min(420px,80%);text-align:center;color:var(--cyan);font-size:13px;letter-spacing:.06em;opacity:0;transition:opacity .3s}.p0 .progress.on{opacity:1}
.p0 .progress i{display:block;height:4px;margin-top:8px;background:#72e6e033}.p0 .progress i b{display:block;height:100%;width:0;background:var(--cyan)}
@keyframes p0blink{50%{opacity:.45}}
@keyframes p0in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
@media(max-width:700px){.p0 .box{left:16px;top:84px;width:min(300px,calc(100% - 32px))}.p0 .fact{bottom:80px;font-size:12px}.p0 .keys{font-size:9px}}
</style>
<div class="box checklist"></div><div class="box poll"></div><div class="box choice"></div><div class="box caution"></div><div class="progress"></div><div class="fact"></div><div class="keys"></div><div class="skip"></div><div class="caption"></div><div class="reticle"></div><div class="rlabel"></div>`;
  parent.append(root);
  flightHud?.root?.classList.add('p0-on');
  const q = (c) => root.querySelector(`.${c}`);
  const els = { list: q('checklist'), poll: q('poll'), fact: q('fact'), keys: q('keys'), skip: q('skip'), caption: q('caption'), reticle: q('reticle'), rlabel: q('rlabel'), choice: q('choice'), caution: q('caution'), progress: q('progress') };
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
        row.append(text('span', 'key', st.fallback ? st.key : '•'), text('span', null, st.fallback ? `${st.label} · ${st.fallbackText}` : st.label), text('span', 'tick', '✓'));
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
    // reticle: null hides it; else { tone: null|'ok'|'warn'|'done', label }
    setReticle(r) {
      els.reticle.classList.toggle('on', !!r);
      for (const t of ['ok', 'warn', 'done']) els.reticle.classList.toggle(t, r?.tone === t);
      els.rlabel.textContent = r?.label ?? '';
      els.rlabel.classList.toggle('on', !!r?.label);
      for (const t of ['warn', 'done']) els.rlabel.classList.toggle(t, r?.tone === t);
    },
    // the cabin atmosphere choice: { title, options: [{ key, label, onPick }] } or null
    setChoice(c) {
      els.choice.classList.toggle('on', !!c);
      if (!c) return;
      const rows = c.options.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.append(text('b', null, o.key), document.createTextNode(o.label));
        b.addEventListener('click', () => o.onPick?.());
        return b;
      });
      els.choice.replaceChildren(text('small', null, c.title), ...rows);
    },
    // the amber caution lamp with its purge button: { text, button, onPurge } or null
    setCaution(c) {
      els.caution.classList.toggle('on', !!c);
      if (!c) return;
      const b = text('button', null, c.button);
      b.type = 'button';
      b.addEventListener('click', () => c.onPurge?.());
      els.caution.replaceChildren(text('div', 'lamp', `● ${c.text}`), b);
    },
    // a fill / purge progress bar: { label, frac } or null
    setProgress(p) {
      els.progress.classList.toggle('on', !!p);
      if (!p) return;
      const bar = document.createElement('i'), fill = document.createElement('b');
      fill.style.width = `${Math.round(p.frac * 100)}%`;
      bar.append(fill);
      els.progress.replaceChildren(document.createTextNode(p.label), bar);
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
