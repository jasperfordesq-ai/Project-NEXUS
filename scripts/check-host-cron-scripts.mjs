#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guard: a host script that cron runs DIRECTLY must be executable in git.
 *
 * Why this exists
 * ---------------
 * `scripts/watchdog-queue.sh` restarts a dead Horizon queue container. It is
 * installed on the production host as a five-minute cron entry that names
 * `/opt/nexus-php/scripts/watchdog-queue.sh` and nothing else
 * — invoked directly, with no interpreter in front of it. Every OTHER cron
 * entry on that host goes through `bash` or `/bin/bash`, so only this one
 * depends on the file's executable bit.
 *
 * Git tracked the script as mode 100644, and /opt/nexus-php is a git checkout
 * with core.filemode=true, so every deploy wrote it back non-executable. The
 * script's own install instructions said to `chmod +x` by hand; that step was
 * either never done or was undone by the next checkout. Result: cron ran it
 * every five minutes and got "Permission denied" every single time, from the
 * day it was installed (2026-05-22) until it was found on 2026-09-07 — a
 * 2.2 MB log containing nothing but that one error, roughly 31,000 failures,
 * and a queue watchdog that had never once run.
 *
 * The cost showed up on 2026-09-06: an apt upgrade of docker-ce/containerd.io
 * restarted the container engine at 06:27, the queue container did not come
 * back, and because the watchdog was dead nothing restarted it. Queue workers
 * processed no jobs between 06:25 and 11:18 — nearly five hours — and the
 * platform only noticed retroactively, when the scheduler came back and
 * `queue:verify-liveness` reported the gap it had missed (Sentry NEXUS-PHP-2F,
 * NEXUS-PHP-3J, NEXUS-PHP-2B).
 *
 * The rule this enforces
 * ----------------------
 * If a cron line anywhere in this repository names a repo script WITHOUT an
 * interpreter in front of it, that script must be mode 100755 in the git
 * index. Lines that call `bash`/`sh`/`php`/`node` explicitly are exempt: the
 * exec bit is irrelevant to them, which is why the rest of the crontab
 * survived a decade of 644.
 *
 * Zero dependencies and no npm ci, so it can live in an always-on CI job that
 * no path filter can put to sleep.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The deploy root on the production host. Cron lines reference absolute paths
// there; this maps them back to repo-relative paths.
const DEPLOY_ROOT = '/opt/nexus-php/';

// A token that runs the script for you, making the exec bit irrelevant.
const INTERPRETERS =
  /^(?:\/usr\/bin\/|\/usr\/local\/bin\/|\/bin\/)?(?:bash|sh|dash|zsh|php|node|python3?|docker|flock|env|nice|ionice|timeout)$/;

// Five cron fields, optionally preceded by a comment marker and/or an `echo "`
// (install instructions are written both ways), then the command.
const CRON_LINE =
  /^\s*(?:#\s*)?(?:echo\s+")?((?:[-*\/,0-9]+\s+){4}[-*\/,0-9]+)\s+(\S.*)$/;

function gitModes() {
  const res = spawnSync('git', ['ls-files', '-s'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error('FAILURE: could not read the git index.');
    console.error(res.stderr || '(no stderr)');
    process.exit(1);
  }
  const modes = new Map();
  for (const line of res.stdout.split(/\r?\n/)) {
    // "<mode> <sha> <stage>\t<path>"
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    modes.set(line.slice(tab + 1), line.slice(0, line.indexOf(' ')));
  }
  return modes;
}

const modes = gitModes();
const shellScripts = [...modes.keys()].filter((p) => p.endsWith('.sh'));

/** Every repo script path a cron line runs, and how. */
const invocations = [];

for (const file of shellScripts) {
  let lines;
  try {
    lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
  } catch {
    continue; // Tracked but absent locally; CI checks out everything.
  }

  lines.forEach((raw, i) => {
    const m = raw.match(CRON_LINE);
    if (!m) return;

    const command = m[2];

    // Find the repo script this line runs. Only absolute deploy-root paths can
    // be resolved with confidence — a line built from a shell variable (e.g.
    // `/bin/bash $PROCESSOR_SCRIPT`) is skipped rather than guessed at.
    const pathMatch = command.match(
      new RegExp(`${DEPLOY_ROOT.replace(/\//g, '\\/')}(\\S+\\.sh)`),
    );
    if (!pathMatch) return;

    const target = pathMatch[1];
    if (!modes.has(target)) return; // Not a repo script (e.g. /opt/nexus-crm).

    // Is there an interpreter token before the script path?
    const before = command.slice(0, pathMatch.index).trim().split(/\s+/);
    const viaInterpreter = before.some((tok) => INTERPRETERS.test(tok));

    invocations.push({
      declaredIn: `${file}:${i + 1}`,
      target,
      viaInterpreter,
      mode: modes.get(target),
    });
  });
}

console.log('Checking cron-invoked host scripts are executable in git...\n');

// A guard that finds nothing passes for the wrong reason. If the cron install
// instructions ever move out of the scripts, this must fail loudly rather than
// quietly stop protecting anything.
if (invocations.length === 0) {
  console.error(
    'FAILURE: found no cron lines naming a repo script under ' + DEPLOY_ROOT,
  );
  console.error(
    'This guard has stopped checking anything. Either the install instructions',
  );
  console.error(
    'moved, or CRON_LINE no longer matches them. Fix the guard, do not delete it.',
  );
  process.exit(1);
}

const failures = [];

for (const inv of invocations) {
  if (inv.viaInterpreter) {
    console.log(
      `  OK    ${inv.target} — run via an interpreter (${inv.declaredIn}), exec bit not needed`,
    );
    continue;
  }
  if (inv.mode === '100755') {
    console.log(
      `  OK    ${inv.target} — run directly (${inv.declaredIn}) and executable in git`,
    );
    continue;
  }
  failures.push(
    `${inv.declaredIn}: cron runs ${inv.target} directly, but git tracks it as mode ${inv.mode} — cron will fail with "Permission denied"`,
  );
}

if (failures.length > 0) {
  console.error('\nFAILURE: a cron-invoked script is not executable.\n');
  for (const f of failures) console.error(`::error::${f}`);
  console.error('\nFix it in git, not with a manual chmod on the server — the');
  console.error('deploy tree is a git checkout with core.filemode=true, so a');
  console.error('hand-made chmod is reverted by the next deploy:');
  console.error('\n    git update-index --chmod=+x <script>\n');
  console.error('Or give the cron line an explicit interpreter (`bash <script>`),');
  console.error('which is what every other entry in this crontab does.');
  process.exit(1);
}

console.log(
  `\nOK: ${invocations.length} cron invocation(s) checked across ${shellScripts.length} shell script(s).`,
);
