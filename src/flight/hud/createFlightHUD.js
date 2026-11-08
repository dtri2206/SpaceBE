const number = (v, digits = 0) => Number.isFinite(v) ? v.toFixed(digits) : "—";
function createFlightHUD({ parent = document.body } = {}) {
  const root = document.createElement("div");
  root.className = "flight-presentation";
  root.innerHTML = `<style>
.flight-presentation{position:absolute;inset:0;pointer-events:none;color:#d8eff1;font:12px/1.5 ui-monospace,monospace;--cyan:#72e6e0;--amber:#ffbe75}
.flight-presentation *{box-sizing:border-box;text-shadow:0 1px 2px #000}.flight-presentation .top{position:absolute;top:30px;left:32px;right:32px;display:flex;justify-content:space-between;letter-spacing:.18em}
.flight-presentation small{color:#8daeb8;font-size:10px;letter-spacing:.15em}.flight-presentation .readings{position:absolute;left:32px;bottom:92px;display:flex;gap:28px}
.flight-presentation strong{display:block;font-size:26px;font-weight:400}.flight-presentation .panel{position:absolute;right:32px;bottom:92px;width:255px;padding:18px;border:1px solid #72e6e033;background:#071419bc}
.flight-presentation .row{display:flex;justify-content:space-between;margin:6px 0}.flight-presentation meter{width:100%;height:5px;display:block;accent-color:var(--cyan)}
.flight-presentation .formula{position:absolute;left:32px;top:100px;max-width:330px;color:#b3d3da;background:rgba(4,14,18,.72);padding:3px 10px;border-radius:4px}.flight-presentation .formula b{color:var(--cyan);font-weight:400;font-size:18px}
.flight-presentation .warnings{position:absolute;left:25%;right:25%;top:23%;text-align:center;color:var(--amber);letter-spacing:.12em}.flight-presentation .warnings>div{background:rgba(4,14,18,.72);padding:3px 10px;border-radius:4px;display:inline-block;margin:1px 0}.flight-presentation .warnings{display:flex;flex-direction:column;align-items:center}.flight-presentation .formula:empty{display:none}.flight-presentation .red{color:#ff6978}.flight-presentation .manual-offer{color:#72e6e0;font-size:14px;letter-spacing:.16em}
.flight-presentation .reticle{position:absolute;left:50%;top:50%;width:28px;height:28px;transform:translate(-50%,-50%);border:1px solid #72e6e066;border-radius:50%}
.flight-presentation .marker{position:absolute;display:none;color:var(--cyan);transform:translate(-50%,-50%);font-size:24px}.flight-presentation .retro{color:var(--amber)}.flight-presentation .collision{color:#ff6978}
.flight-presentation .vignette{position:absolute;inset:0;background:radial-gradient(ellipse,transparent 25%,#000 100%);opacity:0}
.flight-presentation .help{position:absolute;bottom:26px;left:32px;right:32px;border-top:1px solid #72e6e033;padding-top:14px;color:#8daeb8}
.flight-presentation .objective:empty,.flight-presentation .warp:empty{display:none}.flight-presentation .objective{padding:5px 14px;background:#071419d9;border:1px solid #72e6e033;position:absolute;top:26px;left:50%;transform:translateX(-50%);max-width:56%;text-align:center;color:#d8eff1;letter-spacing:.08em;font-size:12px;white-space:normal}.flight-presentation .objective b{color:var(--cyan);font-weight:400;letter-spacing:.18em}
.flight-presentation .warp{padding:3px 10px;background:#071419d9;position:absolute;left:32px;top:58px;color:var(--cyan);letter-spacing:.14em;font-size:13px}.flight-presentation .warp.auto{color:var(--amber)}
.flight-presentation .checklist{position:absolute;right:32px;top:76px;width:218px;padding:10px 12px;border:1px solid #72e6e033;background:#071419bc;font-size:11px}.flight-presentation .checklist small{display:block;margin-bottom:4px}
.flight-presentation .checklist div{padding:1px 0;color:#8daeb8}.flight-presentation .checklist .done{color:#7dffa8}.flight-presentation .checklist .current{color:#fff;background:#72e6e022;box-shadow:inset 2px 0 var(--cyan);padding-left:6px}
.flight-presentation .card{position:absolute;left:50%;top:80px;transform:translateX(-50%);max-width:70%;padding:10px 18px;border:1px solid #ffbe7566;background:#071419e6;color:#ffe3b3;letter-spacing:.06em;font-size:14px;text-align:center;display:none}
.flight-presentation .gauge{position:absolute;left:32px;top:214px;width:210px;display:none;font-size:11px}.flight-presentation .gauge .bar{position:relative;height:150px;width:16px;float:left;margin-right:10px;border:1px solid #72e6e055;background:linear-gradient(#ff697866 0 25%,#7dffa866 25% 75%,#ff697866 75%)}
.flight-presentation .gauge .mark{position:absolute;left:-9px;width:0;height:0;border:6px solid transparent;border-left:9px solid #fff;transform:translateY(-6px)}
.flight-presentation .gauge .lab{height:150px;display:flex;flex-direction:column;justify-content:space-between;padding:4px 0;color:#8daeb8;letter-spacing:.1em}.flight-presentation .gauge .lab .mid{color:#7dffa8}
.flight-presentation .gauge .hint{clear:both;padding-top:8px;color:var(--amber)}.flight-presentation .gauge.bad .hint{color:#ff6978}
/* manual control: the other panels must not cover the centre display */
.flight-presentation.manual .warnings,.flight-presentation.manual .formula{display:none}.flight-presentation.manual .top,.flight-presentation.manual .readings,.flight-presentation.manual .panel,.flight-presentation.manual .objective,.flight-presentation.manual .warp,.flight-presentation.manual .checklist,.flight-presentation.manual .gauge,.flight-presentation.manual .help,.flight-presentation.manual .engine-state,.flight-presentation.manual .reticle{opacity:.25}
@media(max-width:700px){.flight-presentation .objective{top:56px;max-width:90%;font-size:10px}.flight-presentation .warp{top:30px;left:16px;font-size:10px}.flight-presentation .checklist{right:16px;width:150px;font-size:9px;top:90px}.flight-presentation .gauge{left:16px;top:170px;width:150px}.flight-presentation .card{top:130px;font-size:11px}.flight-presentation .panel{right:16px;width:185px}.flight-presentation .readings{left:16px;gap:12px}.flight-presentation strong{font-size:18px}.flight-presentation .formula{max-width:250px}.flight-presentation .help{font-size:9px}}
</style><div class="vignette"></div><div class="top"><span>FLIGHT / <span data-id="phase"></span></span><span data-id="clock"></span></div>
<div class="objective" data-role="objective"></div><div class="warp" data-role="warp"></div><div class="checklist" data-role="checklist" style="display:none"></div><div class="card" data-role="card" role="status"></div>
<div class="gauge" data-role="gauge"><div class="bar"><span class="mark"></span></div><div class="lab"><span>TOO SHALLOW</span><span class="mid">CORRIDOR</span><span>TOO STEEP</span></div><div class="hint"></div></div><div class="formula"></div><div class="reticle"></div><span class="marker pro">⊙</span><span class="marker retro">⊗</span><span class="marker collision">◇</span><div class="warnings" role="status"></div>
<div class="readings"><div><small>ALTITUDE / km</small><strong data-id="alt"></strong></div><div><small>VELOCITY / m/s</small><strong data-id="speed"></strong></div><div><small>VERTICAL / m/s</small><strong data-id="vertical"></strong></div></div>
<div class="panel"><small>PROPULSION & FLIGHT ENVELOPE</small><div class="row"><span>THROTTLE</span><span data-id="throttle"></span></div><meter min="0" max="1" data-id="throttleMeter"></meter><div class="row"><span>FUEL</span><span data-id="fuel"></span></div><meter min="0" max="1" data-id="fuelMeter"></meter><div class="row"><span>Δv REMAINING</span><span data-id="dv"></span></div><div class="row"><span>MAX-Q</span><span data-id="q"></span></div><meter min="0" max="1" data-id="qMeter"></meter><div class="row"><span>G LOAD</span><span data-id="g"></span></div><div class="row"><span>APO / PERI km</span><span data-id="orbit"></span></div><div class="row"><span>HEAT / LIMIT</span><span data-id="heat"></span></div></div>
<div class="engine-state" style="position:absolute;right:32px;bottom:64px" data-id="engineState"></div>
<div class="help">F take / give back the stick · SPACE / CLICK lock · C outside view · mouse orbit · wheel zoom · , . time warp</div>`;
  parent.append(root);
  const fields = Object.fromEntries([...root.querySelectorAll("[data-id]")].map((el) => [el.dataset.id, el]));
  const formula = root.querySelector(".formula"), warnings = root.querySelector(".warnings");
  const role = (name) => root.querySelector(`[data-role=${name}]`);
  const objectiveEl = role("objective"), warpEl = role("warp"), checklistEl = role("checklist"), cardEl = role("card"), gaugeEl = role("gauge");
  const gaugeMark = gaugeEl.querySelector(".mark"), gaugeHint = gaugeEl.querySelector(".hint");
  return {
    root,
    // extra (all optional): { objective, checklist:{title,steps}, warp:{value,label,auto}, card:{text}, gauge:{position,status,hint} }
    update(t, a, assistOn, extra = {}) {
      const values = {
        phase: t.phase?.toUpperCase() ?? "PRELAUNCH",
        clock: `T+ ${number(t.t, 1)} s`,
        alt: number(t.altitude / 1000, 2),
        speed: number(t.speed),
        vertical: number(t.verticalSpeed),
        throttle: `${number(t.throttle * 100)} %`,
        fuel: `${number(t.fuelFrac * 100)} %`,
        dv: `${number(t.deltaVLeft)} m/s`,
        q: `${number(t.dynamicPressure / 1000, 1)} / ${number(t.maxQ / 1000)} kPa`,
        g: `${number(t.gLoad, 1)} g`,
        orbit: `${number(t.apoapsis / 1000)} / ${number(t.periapsis / 1000)}`,
        heat: `${number(t.heatFlux / 1000)} / ${number(t.heatLimit / 1000)} kW/m²`,
        engineState: `ARMOR ${t.armorLeft ?? '—'}${Number.isFinite(t.ignitionsLeft) ? ` · IGNITIONS ${t.ignitionsLeft}` : ''}`,
      };
      for (const [key, value] of Object.entries(values)) fields[key].textContent = value;
      for (const [key, value] of Object.entries({ throttleMeter: t.throttle, fuelMeter: t.fuelFrac, qMeter: t.dynamicPressure / t.maxQ })) fields[key].value = value;
      warnings.replaceChildren(...a.warnings.map((w) => {
        const el = document.createElement("div");
        el.className = w.level;
        if (w.level === "manual-offer") el.style.opacity = (0.7 + 0.3 * Math.cos(performance.now() / 1000 * 2 * Math.PI)).toFixed(2);
        el.textContent = w.text;
        return el;
      }));
      if (t.collisionWarning) {
        const alert = document.createElement('div');
        alert.className = 'red';
        alert.textContent = `COLLISION ${number(Math.max(0, t.collisionWarning.timeToClosest), 1)} s`;
        warnings.append(alert);
      }
      if (t.failed || t.landed) {
        const el = document.createElement("div");
        el.textContent = t.failed ? "FLIGHT ENDED — choose a debug start to retry" : "TOUCHDOWN — E to leave seat";
        warnings.append(el);
      }
      const card = ["orbit", "coast"].includes(t.phase)
        ? a.cards.orbit
        : ["entry", "landing", "landed"].includes(t.phase)
          ? a.cards.stopping
          : a.cards.liftoff;
      formula.replaceChildren();
      if (assistOn) {
        const title = document.createElement("b");
        title.textContent = card.formula;
        formula.append(title, document.createElement("br"), card.numbers, document.createElement("br"), card.result);
      }
      const showGuides = assistOn !== false;
      objectiveEl.replaceChildren();
      if (showGuides && extra.objective) {
        const tag = document.createElement("b");
        tag.textContent = "OBJECTIVE";
        objectiveEl.append(tag, ` · ${extra.objective}`);
      }
      const w = extra.warp;
      warpEl.className = `warp${w?.auto ? " auto" : ""}`;
      warpEl.textContent = w && w.value > 1 ? `WARP ${Math.round(w.value)}×${w.label ? ` · ${w.label}` : ""}` : "";
      checklistEl.style.display = showGuides && extra.checklist ? "block" : "none";
      if (showGuides && extra.checklist) {
        const title = document.createElement("small");
        title.textContent = `${extra.checklist.title} · STEPS`;
        checklistEl.replaceChildren(title, ...extra.checklist.steps.map((st) => {
          const el = document.createElement("div");
          el.className = st.status;
          el.textContent = `${st.status === "done" ? "✓" : st.status === "current" ? "▶" : "○"} ${st.label}`;
          return el;
        }));
      }
      cardEl.style.display = extra.card ? "block" : "none";
      if (extra.card) cardEl.textContent = extra.card.text;
      gaugeEl.style.display = showGuides && extra.gauge ? "block" : "none";
      if (showGuides && extra.gauge) {
        gaugeMark.style.top = `${extra.gauge.position * 100}%`;
        gaugeHint.textContent = extra.gauge.hint;
        gaugeEl.classList.toggle("bad", extra.gauge.status === "shallow" || extra.gauge.status === "steep");
      }
      root.querySelector(".vignette").style.opacity = Math.min(0.85, Math.max(0, (t.gLoad - 3.5) / 4));
    },
    // manual control: dim every panel except the warning line (25 % opacity via the `manual` class)
    setManual(on) { root.classList.toggle('manual', !!on); },
    setSteeringVisible(visible) {
      root.querySelector('.reticle').style.display = visible ? 'block' : 'none';
      if (!visible) for (const kind of ['pro', 'retro', 'guide']) {
        const el = root.querySelector(`.${kind}`);
        if (el) el.style.display = 'none';
      }
    },
    marker(kind, point) {
      const el = root.querySelector(`.${kind}`);
      el.style.display = point ? "block" : "none";
      if (point) {
        el.style.left = `${point.x}%`;
        el.style.top = `${point.y}%`;
      }
    },
    dispose() {
      root.remove();
    }
  };
}
export {
  createFlightHUD
};
