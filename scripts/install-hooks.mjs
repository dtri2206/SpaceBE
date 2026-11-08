// Runs on `npm install` and adds the team's pre-push hook. It must never make the install itself fail.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MARK = '# SpaceB&E pre-push check';

// GitHub can't protect branches on this plan, so this is what keeps main safe and dev healthy.
// It is plain shell, not a script in the repo, so it still works on a branch that has no scripts/ folder.
const HOOK = `#!/bin/sh
${MARK}: added by npm install (scripts/install-hooks.mjs).
check_dev=0
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/main)
      if [ "$ALLOW_MAIN_PUSH" != "1" ]; then
        echo "Refused: nobody pushes to main directly. Put your work on dev. dtri moves dev to main once the whole team has checked it." >&2
        exit 1
      fi
      ;;
    refs/heads/dev) check_dev=1 ;;
  esac
done
if [ "$check_dev" = "1" ]; then
  echo "Pushing to dev, so running npm run check first..."
  if ! npm run check; then
    echo "Refused: npm run check failed. Fix what it reports, then push again." >&2
    exit 1
  fi
fi
exit 0
`;

try {
  const dir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const file = path.join(dir, 'pre-push');
  mkdirSync(dir, { recursive: true });
  if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARK)) {
    console.warn(`[hooks] ${file} already exists, so the team's pre-push check was not added. Run npm run check by hand before pushing to dev.`);
  } else {
    writeFileSync(file, HOOK, { mode: 0o755 });
  }
} catch {
  // Not a git checkout: nothing to install.
}
