// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import os from 'node:os';
import path from 'path';

const inheritedMaxOldSpace =
  process.env.NODE_OPTIONS?.match(/--max-old-space-size=\S+/)?.[0] ?? '--max-old-space-size=8192';

// ---------------------------------------------------------------------------
// Concurrency: derived from the machine, NOT a fixed number.
//
// Almost all of this suite's wall-clock is per-file jsdom construction, not
// assertions — a 66-file run of src/components/ui spends ~10s in `environment`
// and ~7s in `tests`. That overhead is embarrassingly parallel, so file-level
// concurrency is worth far more here than it looks.
//
// CI IS DELIBERATELY LEFT ON THE OLD NUMBERS. `ubuntu-latest` is a 4-vCPU
// runner and the 8-shard `React Full Suite` gate (blocking since 2026-07-28)
// was stabilised at maxForks 2 / fileParallelism false. Retuning the gate is a
// separate exercise with its own evidence; this change is scoped to developer
// machines, where the old settings left a 32-thread CPU ~97% idle.
//
// Measured on a Ryzen 9 9950X3D (16C/32T, 96GB), 2026-08-04, --retry=0:
//   src/hooks         (29 files)  28.5s -> 5.3s   (5.4x)
//   src/components/ui (66 files)  78.8s -> 12.1s  (6.5x)  identical results
//   src/pages/groups  (51 files)  72.3s -> 9.3s   (7.8x)  4/4 runs green
// 24 forks measured slower than 16, so half the logical cores is the target,
// not all of them — the remaining threads absorb the main process and jsdom GC.
const isCI = !!process.env.CI;
const logicalCores = os.availableParallelism?.() ?? os.cpus().length;
const localForks = Math.max(2, Math.floor(logicalCores / 2));
// Escape hatch: NEXUS_VITEST_MAX_FORKS=1 reproduces a suspected ordering or
// shared-state bug serially without editing this file.
const overrideForks = Number.parseInt(process.env.NEXUS_VITEST_MAX_FORKS ?? '', 10);
const maxForks = Number.isFinite(overrideForks) && overrideForks > 0
  ? overrideForks
  : isCI
    ? 2
    : localForks;
// One fork at a time is not parallel, whatever maxForks says.
const fileParallelism = !isCI && maxForks > 1;

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_COMMIT__: JSON.stringify('test'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./src/test/ci-force-exit.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks,
        minForks: 1,
        // isolate stays TRUE at every concurrency level. A fresh fork per file
        // is what prevents the heap/jsdom accumulation that hangs a long run in
        // singleFork mode; running files concurrently does not replace it.
        isolate: true,
        singleFork: false,
        // Inherit npm test's worker heap cap and expose GC for setup cleanup.
        // Note this is a per-fork CEILING, not a reservation — 16 forks do not
        // reserve 16x the cap.
        execArgv: ['--expose-gc', inheritedMaxOldSpace],
      },
    },
    fileParallelism,
    testTimeout: 30000,  // 30s per test
    hookTimeout: 30000,
    teardownTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      thresholds: {
        // Raised after adding ~99 new test files (2026-03-22)
        // Previous baseline: ~40%. New estimated coverage: ~60%+. Target: 80%+
        statements: 55,
        branches: 50,
        functions: 50,
        lines: 55,
      },
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      {
        find: /^lucide-react\/icons\/(.+)$/,
        replacement: path.resolve(__dirname, 'node_modules/lucide-react/dist/esm/icons/$1.js'),
      },
    ],
  },
});
