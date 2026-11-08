// Serialises heavy jobs between the hangar v5 part agents: one Blender and one browser at a time (14 GB machine).
// Usage (from the repo root):
//   node src/builder/tools/blender/hangar/v5lock.mjs blender -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b ...
//   node src/builder/tools/blender/hangar/v5lock.mjs browser -- node my-inspect-script.mjs
// Waits (polling every 5 s, up to 40 min) until the lock is free, runs the command, then releases the lock.
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const [kind, sep, cmd, ...args] = process.argv.slice(2);
if (!['blender', 'browser'].includes(kind) || sep !== '--' || !cmd) {
  console.error('usage: node v5lock.mjs <blender|browser> -- <command> [args...]');
  process.exit(2);
}
const dir = path.join(os.tmpdir(), 'spaceb-hangar-v5-locks', kind);
const ownerFile = path.join(dir, 'owner.json');
mkdirSync(path.dirname(dir), { recursive: true });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const started = Date.now();
let announced = false;
for (;;) {
  try {
    mkdirSync(dir);
    writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, cmd, args, since: new Date().toISOString() }));
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = null;
    try { owner = JSON.parse(readFileSync(ownerFile, 'utf8')); } catch {}
    let stale = owner ? !alive(owner.pid) : false;
    if (!owner) { try { stale = Date.now() - statSync(dir).mtimeMs > 60000; } catch { stale = false; } }
    if (stale) { rmSync(dir, { recursive: true, force: true }); continue; }
    if (Date.now() - started > 40 * 60 * 1000) { console.error(`[v5lock] gave up after 40 min waiting for the ${kind} lock`, owner); process.exit(3); }
    if (!announced) { console.log(`[v5lock] waiting for the ${kind} lock held by`, owner?.cmd, owner?.args?.slice(0, 6).join(' ')); announced = true; }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
const release = () => { try { const o = JSON.parse(readFileSync(ownerFile, 'utf8')); if (o.pid === process.pid) rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on('exit', release);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { release(); process.exit(130); });
console.log(`[v5lock] ${kind} lock acquired after ${((Date.now() - started) / 1000).toFixed(0)} s`);
const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
child.on('error', (error) => { console.error('[v5lock] could not start', cmd, error.message); release(); process.exit(1); });
child.on('exit', (code) => { release(); process.exit(code ?? 1); });
