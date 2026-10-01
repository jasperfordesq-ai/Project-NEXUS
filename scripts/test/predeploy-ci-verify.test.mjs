// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Regression cover for how scripts/predeploy-ci-verify.mjs reads ONE commit's
 * CI runs into a per-check verdict.
 *
 * On 2026-09-30 run 36777243634 on 3a1cd1164 had "PHP Tests (shard 5)" and
 * "(shard 9)" cancelled by a later push, and the other eight shards green. The
 * verifier then reported "PHP Tests — passed on 3a1cd1164" for a later deploy
 * commit: cancelled shards were skipped before the matrix rule ran, so any
 * green sibling made the whole check green. Two tenths of the PHP suite had
 * never run, and the deploy gate inherited a pass nobody produced.
 *
 * commitVerdicts() is pure — it takes runs already fetched from GitHub — so
 * every branch here runs without `gh`, a network or a particular git history.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const { commitVerdicts, WORKFLOWS } = await import('../predeploy-ci-verify.mjs');

const CI = WORKFLOWS.find((w) => w.file === 'ci.yml');

const phpShards = (overrides = {}) =>
  Array.from({ length: 10 }, (_, i) => ({
    name: `PHP Tests (shard ${i + 1})`,
    conclusion: overrides[i + 1] === undefined ? 'success' : overrides[i + 1],
  }));

test('a run whose shards all passed is success evidence', () => {
  const { verdicts } = commitVerdicts([{ runId: 1, wf: CI, jobs: phpShards() }]);
  assert.deepEqual(verdicts.get('PHP Tests'), { conclusion: 'success', runId: 1 });
});

test('cancelled shards beside green ones are NOT success evidence (run 36777243634)', () => {
  const { verdicts } = commitVerdicts([
    { runId: 36777243634, wf: CI, jobs: phpShards({ 5: 'cancelled', 9: 'cancelled' }) },
  ]);
  assert.equal(verdicts.has('PHP Tests'), false,
    'a partly-cancelled matrix run must leave the check unresolved so the walk continues');
});

test('a shard with no conclusion beside green ones is NOT success evidence', () => {
  const { verdicts } = commitVerdicts([{ runId: 2, wf: CI, jobs: phpShards({ 3: null }) }]);
  assert.equal(verdicts.has('PHP Tests'), false);
});

test('a partly-cancelled newer run yields to a complete older run of the same commit', () => {
  const { verdicts } = commitVerdicts([
    { runId: 20, wf: CI, jobs: phpShards({ 5: 'cancelled' }) }, // newest first
    { runId: 10, wf: CI, jobs: phpShards() },
  ]);
  assert.deepEqual(verdicts.get('PHP Tests'), { conclusion: 'success', runId: 10 });
});

test('a failed shard still refuses even when fail-fast cancelled its siblings', () => {
  const { verdicts } = commitVerdicts([
    { runId: 3, wf: CI, jobs: phpShards({ 2: 'failure', 5: 'cancelled', 9: 'cancelled' }) },
  ]);
  assert.deepEqual(verdicts.get('PHP Tests'), { conclusion: 'failure', runId: 3 });
});

test('the newest run that decides still stands over an older one', () => {
  const { verdicts } = commitVerdicts([
    { runId: 20, wf: CI, jobs: phpShards() },
    { runId: 10, wf: CI, jobs: phpShards({ 4: 'failure' }) },
  ]);
  assert.deepEqual(verdicts.get('PHP Tests'), { conclusion: 'success', runId: 20 });
});

test('a wholly cancelled or skipped job is not evidence either way', () => {
  const { verdicts } = commitVerdicts([
    { runId: 4, wf: CI, jobs: [
      { name: 'Migration Safety Gate', conclusion: 'cancelled' },
      { name: 'PHP Tests (shard ${{ matrix.shard }})', conclusion: 'skipped' },
    ] },
  ]);
  assert.equal(verdicts.has('Migration Safety Gate'), false);
  assert.equal(verdicts.has('PHP Tests'), false);
});

test('one partly-cancelled matrix does not taint a different check in the same run', () => {
  const { verdicts } = commitVerdicts([
    { runId: 5, wf: CI, jobs: [
      ...phpShards({ 5: 'cancelled' }),
      { name: 'Migration Safety Gate', conclusion: 'success' },
    ] },
  ]);
  assert.equal(verdicts.has('PHP Tests'), false);
  assert.deepEqual(verdicts.get('Migration Safety Gate'), { conclusion: 'success', runId: 5 });
});

test('a job the verifier does not know is reported, not treated as evidence', () => {
  const { verdicts, unknown } = commitVerdicts([
    { runId: 6, wf: CI, jobs: [{ name: 'Brand New Gate', conclusion: 'success' }] },
  ]);
  assert.equal(verdicts.size, 0);
  assert.deepEqual(unknown, ['Brand New Gate  (ci.yml)']);
});
