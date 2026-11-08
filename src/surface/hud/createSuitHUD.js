import { MAX_DUST_OPACITY } from '../visorDust.js';

const fmt = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : '—';

export function createSuitHUD({ parent = document.body, reducedMotion = false } = {}) {
  const root = document.createElement('div');
  root.className = 'suit-presentation';
  root.innerHTML = `<style>
.suit-presentation { position:absolute; inset:0; pointer-events:none; color:#d6eeee; font:12px/1.5 ui-monospace,monospace; --signal:#81e7df; }
.suit-presentation * { box-sizing:border-box; }
.suit-presentation[data-level=caution] { --signal:#ffc281; }
.suit-presentation[data-level=warning], .suit-presentation[data-level=critical] { --signal:#ff7f87; }
.suit-presentation .helmet { position:absolute; inset:0; border:18px solid #071318; border-radius:22%; box-shadow:inset 0 0 0 1px #90c7cb55,inset 0 0 65px #0008; }
.suit-presentation .helmet::after { content:''; position:absolute; inset:10% 4%; border-left:1px solid #a6e7ed22; border-right:1px solid #a6e7ed22; border-radius:35%; }
.suit-presentation .dust { position:absolute; inset:0; width:100%; height:100%; }
.suit-presentation .prebreathe { position:absolute; left:15%; right:15%; top:22%; text-align:center; color:#9fe8f0; letter-spacing:.1em; }
.suit-presentation .prebreathe .pbar { width:240px; height:4px; margin:8px auto 0; background:#9fe8f033; } .suit-presentation .prebreathe .pbar i { display:block; height:100%; width:0; background:#9fe8f0; }
.suit-presentation .shade { position:absolute; inset:0; background:radial-gradient(ellipse,transparent 20%,#150308 100%); opacity:0; }
.suit-presentation .header { position:absolute; top:38px; left:48px; right:48px; display:flex; justify-content:space-between; letter-spacing:.16em; }
.suit-presentation small { color:#a1babe; font-size:10px; letter-spacing:.13em; }
.suit-presentation .life { position:absolute; bottom:95px; left:48px; width:245px; padding:15px; background:#07171bce; border-left:2px solid var(--signal); }
.suit-presentation .oxygen { color:var(--signal); font-size:32px; display:block; }
.suit-presentation meter { display:block; width:100%; height:7px; accent-color:var(--signal); }
.suit-presentation .row { display:flex; justify-content:space-between; margin-top:9px; }
.suit-presentation .navigation { position:absolute; right:48px; bottom:115px; text-align:right; padding:15px; background:#07171baa; }
.suit-presentation .beacon { font-size:24px; color:#81e7df; display:inline-block; }
.suit-presentation .crosshair { position:absolute; left:50%; top:50%; width:5px; height:5px; border:1px solid #d6eeeeaa; border-radius:50%; transform:translate(-50%,-50%); }
.suit-presentation .prompt { position:absolute; left:25%; right:25%; top:60%; text-align:center; }
.suit-presentation progress { display:block; width:150px; height:5px; margin:10px auto; accent-color:#81e7df; }
.suit-presentation .warning { position:absolute; left:20%; right:20%; top:20%; text-align:center; color:var(--signal); letter-spacing:.1em; }
.suit-presentation .help { position:absolute; left:48px; right:48px; bottom:40px; border-top:1px solid #a2d4d933; padding-top:12px; color:#a1babe; }
.suit-presentation [hidden] { display:none!important; }
@media(max-width:650px) { .suit-presentation .life { left:25px; width:190px; bottom:100px; } .suit-presentation .navigation { right:25px; bottom:100px; font-size:10px; } .suit-presentation .header { left:25px; right:25px; font-size:10px; } .suit-presentation .help { left:25px; right:25px; font-size:9px; } }
</style>
<canvas class="dust" width="480" height="270" hidden></canvas><div class="helmet"></div><div class="shade"></div>
<div class="header"><span data-id="location"></span><span data-id="suit"></span></div>
<div class="prebreathe" hidden><span data-id="prebreathe"></span><div class="pbar"><i></i></div></div>
<div class="crosshair"></div><div class="warning" role="status"></div>
<div class="prompt"><span data-id="prompt"></span><progress max="1" value="0" hidden></progress></div>
<div class="life"><small>PERSONAL LIFE SUPPORT</small><strong class="oxygen" data-id="oxygen"></strong><meter min="0" max="100" value="100" aria-label="Suit oxygen"></meter>
<div class="row"><span>SUPPLY / SPARES</span><span data-id="supply"></span></div>
<div class="row"><span>HEART RATE</span><span data-id="heart"></span></div>
<div class="row"><span>LOCAL GRAVITY</span><span data-id="gravity"></span></div>
<div class="row body"><span>DOSE / PEAK G</span><span data-id="body"></span></div></div>
<div class="navigation"><small>SHIP RADIO BEACON</small><div><span class="beacon">↑</span> <span data-id="distance"></span></div><div data-id="motion"></div></div>
<div class="help">CLICK mouse look · WASD walk · SHIFT run · SPACE jump · E interact / hold to scan</div>`;
  parent.append(root);
  const fields = Object.fromEntries([...root.querySelectorAll('[data-id]')].map(el => [el.dataset.id, el]));
  const helmet = root.querySelector('.helmet');
  const shade = root.querySelector('.shade');
  const warning = root.querySelector('.warning');
  const navigation = root.querySelector('.navigation');
  const arrow = root.querySelector('.beacon');
  const progress = root.querySelector('progress');
  const meter = root.querySelector('meter');
  const dustCanvas = root.querySelector('.dust');
  const prebreatheBox = root.querySelector('.prebreathe');
  const prebreatheBar = prebreatheBox.querySelector('.pbar i');
  let drawnDust = 0;
  let elapsed = 0;
  let previousMessage = '';

  // Visor dust: butterscotch smudge + specks, strongest at the edges and bottom, centre kept clear.
  // `level` 0..1 (alpha never above MAX_DUST_OPACITY). Specks come from a seeded generator, so more dust only adds specks.
  function drawDust(level) {
    drawnDust = level;
    const ctx = dustCanvas.getContext?.('2d');
    if (!ctx) return;
    const W = dustCanvas.width, H = dustCanvas.height;
    ctx.clearRect(0, 0, W, H);
    dustCanvas.hidden = level <= 0.002;
    if (level <= 0.002) return;
    const a = level * MAX_DUST_OPACITY;
    const smudge = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, H * 0.95);
    smudge.addColorStop(0, 'rgba(206,150,80,0)');
    smudge.addColorStop(0.6, `rgba(206,150,80,${(a * 0.45).toFixed(3)})`);
    smudge.addColorStop(1, `rgba(190,128,62,${(a * 1.0).toFixed(3)})`);
    ctx.fillStyle = smudge;
    ctx.fillRect(0, 0, W, H);
    const floor = ctx.createLinearGradient(0, H * 0.6, 0, H); // dust settles at the bottom of the glass
    floor.addColorStop(0, 'rgba(200,140,70,0)');
    floor.addColorStop(1, `rgba(200,140,70,${(a * 0.7).toFixed(3)})`);
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const count = Math.round(900 * level);
    for (let i = 0; i < count; i++) {
      const ang = rnd() * Math.PI * 2, rr = 0.55 + 0.55 * Math.sqrt(rnd()); // 0.55 (clear centre) .. 1.1 (corners)
      const x = W / 2 + Math.cos(ang) * rr * W * 0.5 * 1.05, y = H * 0.55 + Math.sin(ang) * rr * H * 0.5 * (Math.sin(ang) > 0 ? 1.1 : 0.95);
      const size = 0.6 + rnd() * rnd() * 2.8;
      ctx.fillStyle = `rgba(${215 + (rnd() * 20) | 0},${150 + (rnd() * 30) | 0},${70 + (rnd() * 25) | 0},${(a * (0.55 + rnd() * 0.45)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return {
    root,
    update(dt, { telemetry: t, oxygen, suited, inside, focused, yaw, shipPosition, bodyStats, airlockProgress = 0, prebreathe = null, dust = 0 }) {
      elapsed += dt;
      const level = inside ? 'ok' : oxygen.level;
      root.dataset.level = level;
      helmet.hidden = !suited;
      fields.location.textContent = inside ? 'CABIN / PRESSURISED' : 'MARS / SURFACE EVA';
      fields.suit.textContent = suited ? 'SUIT CONNECTED' : 'SUIT STOWED';
      fields.oxygen.textContent = `${fmt(oxygen.percent)}% O₂`;
      fields.supply.textContent = `${fmt(oxygen.secondsLeft)} s / ${oxygen.spareTanks}`;
      fields.heart.textContent = `${t.heartRate} bpm`;
      fields.gravity.textContent = `${fmt(t.gravity, 2)} m/s²`;
      root.querySelector('.body').hidden = !bodyStats;
      if (bodyStats) fields.body.textContent = `${fmt(bodyStats.doseMSv, 3)} mSv / ${fmt(bodyStats.peakG, 1)} g`;
      meter.value = oxygen.percent;
      fields.prompt.textContent = focused?.prompt ?? '';
      progress.hidden = focused?.holdProgress == null;
      progress.value = focused?.holdProgress ?? 0;
      navigation.hidden = inside;
      if (!inside) {
        const dx = shipPosition.x - t.pos.x;
        const dz = shipPosition.z - t.pos.z;
        const distance = Math.hypot(dx, dz);
        // CSS zero points up; positive rotation points to the player's right.
        const relativeBearing = Math.atan2(dx, -dz) + yaw;
        arrow.style.transform = `rotate(${relativeBearing}rad)`;
        arrow.hidden = distance < 1;
        fields.distance.textContent = distance < 1 ? 'AT HATCH' : `${fmt(distance)} m`;
        fields.motion.textContent = `${fmt(t.speed, 1)} m/s · ${t.running ? 'RUN / O₂ USE ↑' : t.onGround ? 'GROUNDED' : 'AIRBORNE'}`;
      }
      const dustLevel = inside || !suited ? 0 : dust;
      if (Math.abs(dustLevel - drawnDust) > 0.02 || (dustLevel === 0 && drawnDust !== 0)) drawDust(dustLevel);
      prebreatheBox.hidden = !prebreathe;
      if (prebreathe) {
        fields.prebreathe.textContent = `PREBREATHE · pure O₂ · purging nitrogen to prevent decompression sickness · ${Math.ceil(prebreathe.remaining)} s`;
        prebreatheBar.style.width = `${(prebreathe.progress * 100).toFixed(1)}%`;
      }
      let message = '';
      if (oxygen.depleted) message = 'OXYGEN DEPLETED — MISSION ENDED';
      else if (prebreathe) message = '';
      else if (inside && airlockProgress > 0) message = `AIRLOCK CYCLING ${fmt(airlockProgress * 100)}%`;
      else if (inside) message = 'CABIN SUPPLY ACTIVE · SUIT O₂ CONSERVED';
      else if (level === 'critical') message = 'OXYGEN CRITICAL · RETURN TO SHIP';
      else if (level === 'warning') message = 'OXYGEN LOW · RETURN TO SHIP';
      else if (level === 'caution') message = 'OXYGEN BELOW 30% · CHECK RETURN DISTANCE';
      if (message !== previousMessage) {
        warning.textContent = message;
        previousMessage = message;
      }
      const pulse = reducedMotion ? 1 : 0.85 + Math.sin(elapsed * 2) * 0.15;
      shade.style.opacity = oxygen.depleted ? '0.9' : level === 'critical' ? String(0.65 * pulse) : level === 'warning' ? '0.25' : '0';
    },
    dispose() { root.remove(); },
  };
}
