// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// check-sentry-nightly.mjs — turn the triage queue into an alarm a human actually
// receives, without publishing anything about the errors themselves.
//
// WHY: Sentry has been receiving everything and telling nobody. A Redis fault ran
// from 2026-09-06 to 2026-09-16 (1237 events) and ended only because a Docker
// upgrade happened to restart the daemon; a daily safeguarding pager fired 17 times
// from 2026-08-30 naming three real members who could not be contacted. Both sat in
// Sentry unread, because the ONLY error monitoring on this platform ran for 30
// minutes after a deploy. scripts/sentry-triage.mjs was written as the collection
// half of a nightly loop and was never scheduled. This is the half that raises the
// alarm.
//
// TWO CHANNELS, DELIBERATELY DIFFERENT
//
//   stdout → the GitHub Actions log, which is PUBLIC because this repository is.
//            COUNTS ONLY: never a title, culprit, short id, permalink or tenant id.
//            "Safeguarding contact gate unusable for tenants with live
//            vetted-interaction selections" is a real finding about real members
//            and must not be published by our own monitoring.
//
//   --message-file → the Telegram body, which is PRIVATE (the channel the owner
//            already receives; see uptime-check.yml). It NAMES the issues, because
//            a bare "3 need attention" would make the owner go and look anyway.
//            It is written to a file the curl step reads directly, so it never
//            passes through stdout or a step output — either can reach the log.
//
// STATE KEY (to $GITHUB_OUTPUT) drives alert-on-change, matching uptime-check.yml:
// "A monitor that messages every 15 minutes for the length of an outage teaches its
// owner to ignore it." The key is a hash of the issue ids that need attention, so
// re-ordering is not a change, a new issue is, and clearing is. It is a hash rather
// than the ids themselves so that nothing identifying rides in a step output.
//
// USAGE
//   node scripts/check-sentry-nightly.mjs [queue.json] [--message-file <path>]
//
// EXIT CODES
//   0  nothing needs attention
//   1  something does (the workflow alerts; it does NOT fail the run for this)
//   2  the queue file is absent or unreadable: the sweep did not run, which is
//      NOT a pass — an unavailable check never counts as a passing one here

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flagAt = argv.indexOf('--message-file');
const MESSAGE_FILE = flagAt >= 0 ? argv[flagAt + 1] : null;
// 🔴 `flagAt + 1` is only the flag's VALUE when the flag is present. With no
// --message-file, flagAt is -1 and flagAt + 1 is 0, which silently swallowed the
// queue path — the first version of this line did exactly that.
const valueIndex = flagAt >= 0 ? flagAt + 1 : -1;
const positional = argv.filter((a, i) => !a.startsWith('--') && i !== valueIndex);
const QUEUE = positional[0]
  ? path.resolve(positional[0])
  : path.join(ROOT, '.local-docs-archive', 'sentry', 'queue.json');

// The only fields that may ever reach stdout. Anything else stays unread.
const COUNT_KEYS = ['unresolved', 'queued', 'parkedByLedger', 'newSinceLastRun', 'sensitive', 'recurred'];

const emitOutput = (key, value) => {
  const target = process.env.GITHUB_OUTPUT;
  if (target) writeFileSync(target, `${key}=${value}\n`, { flag: 'a' });
};

const fail = (msg, code) => { console.error(`[sentry-nightly] ✗ ${msg}`); process.exitCode = code; };

if (!existsSync(QUEUE)) {
  fail('no triage queue was produced — the sweep did not run. Not a pass.', 2);
} else {
  let data = null;
  try {
    data = JSON.parse(readFileSync(QUEUE, 'utf8'));
  } catch (e) {
    fail(`triage queue unreadable (${e.message}). Not a pass.`, 2);
  }

  const counts = data && typeof data.counts === 'object' ? data.counts : null;
  if (process.exitCode !== 2 && !counts) fail('triage queue has no counts block. Not a pass.', 2);

  if (process.exitCode !== 2) {
    const n = (k) => (Number.isFinite(Number(counts[k])) ? Number(counts[k]) : 0);
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const window = typeof data.window === 'string' ? data.window : 'unknown';

    // --- public: counts only -------------------------------------------------
    console.log(`[sentry-nightly] window: ${window}`);
    for (const k of COUNT_KEYS) console.log(`[sentry-nightly] ${k}: ${n(k)}`);

    // --- change signal -------------------------------------------------------
    const ids = queue.map((i) => String(i?.id ?? '')).filter(Boolean).sort();
    const stateKey = n('queued') === 0 || ids.length === 0
      ? 'clear'
      : createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16);
    emitOutput('state_key', stateKey);
    emitOutput('queued', String(n('queued')));
    emitOutput('sensitive', String(n('sensitive')));

    // --- private: the Telegram body ------------------------------------------
    if (MESSAGE_FILE) {
      const lines = [
        `Sentry nightly — ${n('queued')} issue(s) need attention`,
        `window ${window} · ${n('sensitive')} sensitive · ${n('recurred')} recurred · ${n('parkedByLedger')} parked`,
        '',
      ];
      for (const i of queue.slice(0, 10)) {
        const flag = i?.risk === 'sensitive' ? '[SENSITIVE] ' : '';
        lines.push(`${flag}${i?.shortId ?? '?'} — ${String(i?.title ?? '').slice(0, 140)}`);
        lines.push(`  ${i?.events ?? 0} event(s), last seen ${i?.lastSeen ?? 'unknown'}`);
      }
      if (queue.length > 10) lines.push(`…and ${queue.length - 10} more.`);
      lines.push('');
      lines.push('Detail:  node scripts/sentry-triage.mjs --days 1');
      lines.push('Park it: node scripts/sentry-triage.mjs ledger <id> --decision <d> --note "..."');
      writeFileSync(MESSAGE_FILE, `${lines.join('\n')}\n`, 'utf8');
    }

    if (n('queued') > 0) {
      console.error('');
      console.error(`[sentry-nightly] ✗ ${n('queued')} issue(s) need attention (${n('sensitive')} sensitive, ${n('recurred')} recurred).`);
      console.error('[sentry-nightly]   Detail is deliberately NOT printed here — this log is public.');
      console.error('[sentry-nightly]   Read it locally:  node scripts/sentry-triage.mjs --days 1');
      process.exitCode = 1;
    } else {
      console.log('[sentry-nightly] ✓ nothing needs attention.');
      process.exitCode = 0;
    }
  }
}
