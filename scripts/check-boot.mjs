// Boot check: opens the game in real Chrome and walks the whole loop. Run with: npm run check:boot
// Prints one line per step. Skips (exit 0) if Chrome cannot start. Fails on any console or page error
// except the errors this test provokes on purpose.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVE_KEY = 'hackathon_save_v1';
const balance = JSON.parse(readFileSync(path.join(ROOT, 'src/core/balance.json'), 'utf8'));
const reliable = JSON.parse(readFileSync(path.join(ROOT, 'src/core/mocks/ship.reliable.json'), 'utf8'));

let server = null;
let browser = null;
const started = Date.now();

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

async function cleanup() {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}

async function finish(code, message) {
  if (message) console.log(message);
  await cleanup();
  process.exit(code);
}

const watchdog = setTimeout(() => finish(1, 'FAIL  check:boot took longer than 120 seconds.'), 120_000);
watchdog.unref();

async function main() {
  const port = await freePort();
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port, strictPort: true, host: '127.0.0.1' } });
  await server.listen();

  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
  if (process.platform === 'darwin') args.push('--use-angle=metal');
  // Browser order: CHROME_PATH (explicit, so a wrong path fails instead of silently using another browser),
  // then Google Chrome, then Playwright's own Chromium (npx playwright-core install chromium).
  const fixes = 'Fix: set CHROME_PATH to a Chrome/Chromium binary, or install Google Chrome, or run `npx playwright-core install chromium`.';
  const chromePath = process.env.CHROME_PATH;
  const attempts = chromePath ? [{ executablePath: chromePath }] : [{ channel: 'chrome' }, {}];
  let lastError;
  for (const how of attempts) {
    try {
      browser = await chromium.launch({ ...how, headless: true, args });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!browser) {
    // Passing without walking the loop would prove nothing, so a missing browser is a failure.
    return finish(1, `FAILED  check:boot: no browser could start (${String(lastError.message).split('\n')[0]}).\n  ${fixes}`);
  }

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const errors = [];
  let expected = []; // regexes for errors this test provokes on purpose
  const record = (text) => {
    if (!expected.some((re) => re.test(text))) errors.push(text);
  };
  page.on('console', (message) => message.type() === 'error' && record(message.text()));
  page.on('pageerror', (error) => record(`page error: ${error.message}`));

  const fail = (message) => finish(1, `FAIL  ${message}`);
  const frames = () => page.evaluate(() => window.__game.frames);
  const state = () => page.evaluate(() => window.__game.getState());
  const money = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').money, SAVE_KEY).then((m) => m ?? balance.startMoney); // nothing saved yet = start money

  async function framesAdvance(label) {
    const before = await frames();
    try {
      await page.waitForFunction((n) => window.__game.frames >= n + 3, before, { timeout: 8000 });
    } catch {
      return fail(`${label}: frames stopped advancing (stuck at ${before}).`);
    }
  }

  async function checkErrors(label) {
    if (errors.length) return fail(`${label}: ${errors.length} console or page error(s):\n  ${errors.join('\n  ')}`);
  }

  async function step(label, to) {
    const ok = await page.evaluate((target) => window.__game.requestState(target), to);
    const now = await state();
    if (!ok || now !== to) return fail(`${label}: expected state ${to}, got ${now}.`);
    const panels = await page.locator('[data-stub], [data-screen]').count(); // stub panel or a real screen
    if (panels < 1) return fail(`${label}: no screen is mounted in ${to} (a real screen sets data-screen="${to}" on its root).`);
    await framesAdvance(label);
    await checkErrors(label);
    console.log(`ok    ${String(to).padEnd(10)} frames=${await frames()}`);
  }

  await page.goto(`http://127.0.0.1:${port}/?debug=1`);
  try {
    await page.waitForFunction(() => window.__game && window.__game.frames > 5, null, { timeout: 30_000 });
  } catch {
    await checkErrors('boot');
    return fail('boot: the game never started drawing frames.');
  }
  await checkErrors('boot');
  if ((await state()) !== 'MENU') return fail('boot: the game did not start in MENU.');
  console.log(`ok    MENU       frames=${await frames()}`);

  // Success loop.
  for (const to of ['HANGAR', 'GONOGO', 'PRELAUNCH', 'LAUNCH', 'ORBIT', 'CRUISE', 'ENTRY', 'LANDING', 'INTERIOR', 'SURFACE', 'INTERIOR', 'RETURN', 'ENDING', 'REPORT', 'HANGAR']) {
    await step('success loop', to);
  }

  // Invalid transition must be refused (and logs an error on purpose).
  expected = [/\[state\] refused/];
  const refused = await page.evaluate(() => window.__game.requestState('REPORT'));
  expected = [];
  if (refused !== false || (await state()) !== 'HANGAR') return fail('invalid transition HANGAR -> REPORT was not refused.');
  console.log('ok    invalid transition HANGAR -> REPORT refused');

  // Failure path from LAUNCH.
  for (const to of ['GONOGO', 'PRELAUNCH', 'LAUNCH']) await step('failure path', to);
  const before = await money();
  await page.evaluate(() => window.__game.events.emit('flight:failed', { endingId: 'burnup', cause: 'check:boot failure test' }));
  if ((await state()) !== 'ENDING') return fail(`failure path: flight:failed did not lead to ENDING (state ${await state()}).`);
  const after = await money();
  const penalty = Math.round(reliable.stats.cost * balance.penaltyRate + balance.penaltyBase);
  if (before - after !== penalty) return fail(`failure path: money dropped by ${before - after}, expected ${penalty}.`);
  await framesAdvance('failure path ENDING');
  await checkErrors('failure path ENDING');
  console.log(`ok    ENDING     penalty charged: ${penalty}`);
  await step('failure path', 'REPORT');
  await step('failure path', 'HANGAR');

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  return finish(0, `check:boot passed in ${seconds}s.`);
}

main().catch((error) => finish(1, `FAIL  check:boot crashed: ${error.stack ?? error}`));
