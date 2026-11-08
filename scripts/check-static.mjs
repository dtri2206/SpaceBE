// Static contract check. Node only, no dependencies. Run with: npm run check:static
// Prints every failure as "file:line  what is wrong. How to fix it." and exits 1 if there is any.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = await import(pathToFileURL(path.join(ROOT, 'src/core/contract.js')).href);
const { EVENTS, STATES, PUBLIC_EXPORTS, ROLE_FOLDERS } = contract;

const failures = [];
const notes = [];
const fail = (file, line, message) => failures.push({ file, line, message });

// ---------- helpers ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// Blank out comments but keep strings and line numbers, so patterns never match prose.
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') { out += text[i++]; }
        if (c !== '`' && text[i] === '\n') break;
        out += text[i++];
      }
      out += text[i] ?? ''; i++;
    } else {
      out += c; i++;
    }
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scan(code, file, regex, handler) {
  for (const match of code.matchAll(regex)) handler(match, lineOf(code, match.index));
}

const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const sources = srcFiles.map((file) => ({ file: rel(file), code: stripComments(readFileSync(file, 'utf8')) }));

// ---------- 1. required files and exports ----------
for (const [file, names] of Object.entries(PUBLIC_EXPORTS)) {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) {
    fail(file, 1, 'Required file is missing. Create it and export the names listed in contract.js (PUBLIC_EXPORTS).');
    continue;
  }
  const code = stripComments(readFileSync(full, 'utf8'));
  const named = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) named.add(m[1]);
  for (const m of code.matchAll(/export\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g)) named.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of m[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/).pop();
      if (name) named.add(name);
    }
  }
  for (const name of names) {
    const found = name === 'default' ? /\bexport\s+default\b/.test(code) || named.has('default') : named.has(name);
    if (!found) fail(file, 1, `Missing export "${name}". Add it: contract.js (PUBLIC_EXPORTS) requires ${file} to export it.`);
  }
}

// ---------- per-file rules ----------
const FOLDER_ROLE = {};
for (const [role, folders] of Object.entries(ROLE_FOLDERS)) for (const f of folders) FOLDER_ROLE[f] = role;
const folderOf = (file) => file.split('/').slice(0, 2).join('/');
const SANCTIONED = [/^src\/core\/stubScreen\.js$/, /^src\/core\/mocks\/[\w.]+\.json$/, /^src\/ui\/theme\.css$/];

const only = (allowed) => (file) => !allowed.includes(file);
const notRaf = only(['src/core/main.js', 'src/graphics/cinematic.js']);
const notKeys = only(['src/core/input.js', 'src/audio/index.js', 'src/core/debug.js']);

for (const { file, code } of sources) {
  // 2. unknown event names
  scan(code, file, /\b(emit|on|once)\(\s*(['"`])([^'"`\n]+)\2/g, (m, line) => {
    if (!(m[3] in EVENTS)) fail(file, line, `${m[1]}('${m[3]}') uses an event that is not in contract.js. Use an existing name from EVENTS, or stop and ask your human because all four people must agree on a new one.`);
  });

  // 3. unknown states
  scan(code, file, /\b(?:requestState|debugJump)\(\s*(['"`])(\w+)\1|\bto:\s*(['"`])(\w+)\3/g, (m, line) => {
    const name = m[2] ?? m[4];
    if (!(name in STATES)) fail(file, line, `State '${name}' is not in contract.js (STATES). Use one of: ${Object.keys(STATES).join(', ')}.`);
  });

  // 4. imports across folders
  scan(code, file, /\b(?:import|export)\s+(?:[^'"();]*?\sfrom\s+)?(['"])([^'"]+)\1|\bimport\(\s*(['"])([^'"]+)\3\s*\)/g, (m, line) => {
    const spec = m[2] ?? m[4];
    let target = null;
    let relative = false;
    if (spec.startsWith('/src/')) target = spec.slice(1);
    else if (spec.startsWith('.')) {
      target = rel(path.resolve(ROOT, path.dirname(file), spec));
      relative = true;
    }
    if (!target || !target.startsWith('src/')) return;
    const from = folderOf(file);
    const to = folderOf(target);
    if (from === to) return;
    if (relative) {
      fail(file, line, `Relative import '${spec}' crosses into ${to}. Import it as '/src/${to.slice(4)}/index.js' (its public file) instead.`);
    } else if (FOLDER_ROLE[from] !== FOLDER_ROLE[to] && target !== `${to}/index.js` && !SANCTIONED.some((re) => re.test(target))) {
      fail(file, line, `Import '${spec}' reaches into another role's folder. Import only '/${to}/index.js' and use what it exports.`);
    }
  });

  // 5. requestAnimationFrame
  if (notRaf(file)) scan(code, file, /\brequestAnimationFrame\b/g, (m, line) => fail(file, line, 'requestAnimationFrame is only allowed in src/core/main.js (the single game loop). Put your per-frame work in your module\'s update(dt, state).'));

  // 6. graphics.render
  if (file !== 'src/core/main.js') scan(code, file, /\bgraphics\.render\(/g, (m, line) => fail(file, line, 'graphics.render() is only called by src/core/main.js. Remove the call; main.js renders after your update().'));

  // 7. WebGLRenderer
  if (!file.startsWith('src/graphics/')) scan(code, file, /new\s+(?:THREE\.)?WebGLRenderer/g, (m, line) => fail(file, line, 'Creating a WebGLRenderer is only allowed in src/graphics/. Use graphics.init() and graphics.setView(scene, camera).'));

  // 8. keyboard and mouse listeners
  if (notKeys(file)) scan(code, file, /addEventListener\(\s*(['"`])(key|mouse|pointer)\w*\1/g, (m, line) => fail(file, line, 'Keyboard, mouse and pointer listeners are only allowed in src/core/input.js. Use input.onPress, input.isDown or input.mouseDelta from /src/core/index.js.'));

  // 9. localStorage
  if (file !== 'src/core/save.js') scan(code, file, /\blocalStorage\b/g, (m, line) => fail(file, line, 'localStorage is only touched by src/core/save.js. Use save.load() and save.update() from /src/core/index.js.'));

  // 10. gravity numbers
  if (file !== 'src/core/planets.js') scan(code, file, /(?<![\w.])(9\.81|3\.71|9\.80665)(?![\w.])/g, (m, line) => fail(file, line, `Number ${m[1]} must not be written here. Read gravity from PLANETS (or G0) in /src/core/index.js.`));
}

// ---------- 11. JSON under src ----------
for (const file of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(rel(file), 1, `JSON does not parse (${error.message}). Fix the syntax.`);
  }
}

// ---------- 12. git checks ----------
function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
function gitOk(...args) {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
}

if (!gitOk('rev-parse', '--is-inside-work-tree')) {
  notes.push('git checks skipped: not inside a git repository.');
} else if (!gitOk('rev-parse', '--verify', '--quiet', 'origin/dev')) {
  fail('(git)', 0, 'origin/dev is missing. Run: git fetch origin. If GitHub has no dev branch, someone renamed or deleted it: stop and tell dtri. Do not create it yourself.');
} else {
  if (!gitOk('merge-base', '--is-ancestor', 'origin/dev', 'HEAD')) {
    fail('(git)', 0, 'This branch does not contain origin/dev. Run: git merge origin/dev  (then fix conflicts and run npm run check again).');
  }
  const changed = new Set();
  const add = (text) => text.split('\n').filter(Boolean).forEach((f) => changed.add(f));
  try { add(git('diff', '--name-only', 'origin/dev...HEAD')); } catch { /* no common base */ }
  try { add(git('diff', '--name-only', 'HEAD')); } catch { /* ignore */ }
  try { add(git('ls-files', '--others', '--exclude-standard')); } catch { /* ignore */ }

  if (changed.has('src/core/contract.js') && process.env.ALLOW_CONTRACT_CHANGE !== '1') {
    fail('src/core/contract.js', 1, 'contract.js changed. All four people must agree on any contract change; once they do, run with ALLOW_CONTRACT_CHANGE=1.');
  }

  const branch = git('branch', '--show-current');
  const role = /^role(\d)-/.exec(branch)?.[1];
  if (process.env.ALLOW_OWNERSHIP_CHANGE === '1') {
    notes.push('role folder check skipped: ALLOW_OWNERSHIP_CHANGE=1.');
  } else if (role && ROLE_FOLDERS[role]) {
    const folders = ROLE_FOLDERS[role];
    const shared = ['README.md', 'CREDITS.md', 'docs/DECISIONS.md', 'docs/SHARE_PROBLEMS.md', 'src/core/balance.json']; // balancing numbers are everyone's job
    const sandbox = new RegExp(`^sandbox/role${role}\\.`);
    // Role 3 keeps src/core, so it also keeps the project files around it.
    const keeper = role === '3' && /^(scripts\/|docs\/|index\.html$|package(-lock)?\.json$|AGENTS\.md$|CLAUDE\.md$|\.gitignore$)/;
    for (const file of changed) {
      const ok = folders.some((f) => file.startsWith(`${f}/`)) || shared.includes(file) || file.startsWith('public/assets/') || sandbox.test(file) || (keeper && keeper.test(file))
        || (file === 'src/core/contract.js'); // reported above with its own message
      if (!ok && file.startsWith('src/core/')) fail(file, 0, `src/core/ belongs to Role 3 (dtri). Revert it (git checkout origin/dev -- ${file}) and ask dtri to make the change; only src/core/balance.json is open to everyone.`);
      else if (!ok) fail(file, 0, `Role ${role} may not change this file. Revert it (git checkout origin/dev -- ${file}) or ask the owner of that folder; your folders are ${folders.join(', ')}.`);
    }
  } else if (changed.size > 0) {
    fail('(branch)', 0, `Work on your role branch (role1-builder, role2-flight, role3-graphics or role4-story), not "${branch}", so your changes can be checked against your folders.`);
  }
}

// ---------- 13. vite build ----------
{
  const out = mkdtempSync(path.join(tmpdir(), 'spaceb-check-build-'));
  const vite = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const result = spawnSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { cwd: ROOT, encoding: 'utf8' });
  rmSync(out, { recursive: true, force: true });
  if (result.status !== 0) {
    const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-12).join('\n');
    fail('(vite build)', 0, `vite build failed. Fix the error below (a missing file or a broken import is the usual cause):\n${tail}`);
  }
}

// ---------- report ----------
for (const note of notes) console.log(`NOTE  ${note}`);
for (const { file, line, message } of failures) console.log(`FAIL  ${file}${line ? `:${line}` : ''}  ${message}`);
if (failures.length) {
  console.log(`\ncheck:static FAILED with ${failures.length} problem(s).`);
  process.exit(1);
}
console.log('check:static passed.');
