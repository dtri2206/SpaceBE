const number = (v, digits = 0) => Number.isFinite(v) ? v.toFixed(digits) : "—";
function createFlightHUD({ parent = document.body } = {}) {
  const root = document.createElement("div");
  root.className = "flight-presentation";
  root.innerHTML = `<style>
.flight-presentation{position:absolute;inset:0;pointer-events:none;color:#d8eff1;font:12px/1.5 ui-monospace,monospace;--cyan:#72e6e0;--amber:#ffbe75}
.flight-presentation *{box-sizing:border-box}.flight-presentation .top{position:absolute;top:30px;left:32px;right:32px;display:flex;justify-content:space-between;letter-spacing:.18em}
.flight-presentation small{color:#8daeb8;font-size:10px;letter-spacing:.15em}.flight-presentation .readings{position:absolute;left:32px;bottom:92px;display:flex;gap:28px}
.flight-presentation strong{display:block;font-size:26px;font-weight:400}.flight-presentation .panel{position:absolute;right:32px;bottom:92px;width:255px;padding:18px;border:1px solid #72e6e033;background:#071419bc}
.flight-presentation .row{display:flex;justify-content:space-between;margin:6px 0}.flight-presentation meter{width:100%;height:5px;display:block;accent-color:var(--cyan)}
.flight-presentation .formula{position:absolute;left:32px;top:100px;max-width:330px;color:#b3d3da}.flight-presentation .formula b{color:var(--cyan);font-weight:400;font-size:18px}
.flight-presentation .warnings{position:absolute;left:25%;right:25%;top:23%;text-align:center;color:var(--amber);letter-spacing:.12em}.flight-presentation .red{color:#ff6978}
.flight-presentation .reticle{position:absolute;left:50%;top:50%;width:28px;height:28px;transform:translate(-50%,-50%);border:1px solid #72e6e066;border-radius:50%}
.flight-presentation .marker{position:absolute;display:none;color:var(--cyan);transform:translate(-50%,-50%);font-size:24px}.flight-presentation .retro{color:var(--amber)}.flight-presentation .collision{color:#ff6978}
.flight-presentation .vignette{position:absolute;inset:0;background:radial-gradient(ellipse,transparent 25%,#000 100%);opacity:0}
.flight-presentation .help{position:absolute;bottom:26px;left:32px;right:32px;border-top:1px solid #72e6e033;padding-top:14px;color:#8daeb8}
@media(max-width:700px){.flight-presentation .panel{right:16px;width:185px}.flight-presentation .readings{left:16px;gap:12px}.flight-presentation strong{font-size:18px}.flight-presentation .formula{max-width:250px}.flight-presentation .help{font-size:9px}}
</style><div class="vignette"></div><div class="top"><span>FLIGHT / <span data-id="phase"></span></span><span data-id="clock"></span></div>
<div class="formula"></div><div class="reticle"></div><span class="marker pro">⊙</span><span class="marker retro">⊗</span><span class="marker collision">◇</span><div class="warnings" role="status"></div>
<div class="readings"><div><small>ALTITUDE / km</small><strong data-id="alt"></strong></div><div><small>VELOCITY / m/s</small><strong data-id="speed"></strong></div><div><small>VERTICAL / m/s</small><strong data-id="vertical"></strong></div></div>
<div class="panel"><small>PROPULSION & FLIGHT ENVELOPE</small><div class="row"><span>THROTTLE</span><span data-id="throttle"></span></div><meter min="0" max="1" data-id="throttleMeter"></meter><div class="row"><span>FUEL</span><span data-id="fuel"></span></div><meter min="0" max="1" data-id="fuelMeter"></meter><div class="row"><span>Δv REMAINING</span><span data-id="dv"></span></div><div class="row"><span>MAX-Q</span><span data-id="q"></span></div><meter min="0" max="1" data-id="qMeter"></meter><div class="row"><span>G LOAD</span><span data-id="g"></span></div><div class="row"><span>APO / PERI km</span><span data-id="orbit"></span></div><div class="row"><span>HEAT / LIMIT</span><span data-id="heat"></span></div></div>
<div class="engine-state" style="position:absolute;right:32px;bottom:64px" data-id="engineState"></div>
<div class="help">CLICK mouse look · W/S pitch · A/D yaw · Q/E throttle · X cut-off · SPACE brake · F assist · C camera</div>`;
  parent.append(root);
  const fields = Object.fromEntries([...root.querySelectorAll("[data-id]")].map((el) => [el.dataset.id, el]));
  const formula = root.querySelector(".formula"), warnings = root.querySelector(".warnings");
  return {
    root,
    update(t, a, assistOn) {
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
      root.querySelector(".vignette").style.opacity = Math.min(0.85, Math.max(0, (t.gLoad - 3.5) / 4));
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
