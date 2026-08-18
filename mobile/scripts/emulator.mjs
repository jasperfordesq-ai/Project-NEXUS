// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Start and stop the test emulator.
 *
 * Exists so the boot wait is done properly. `emulator -avd …` returns as soon as
 * the process starts, long before Android is usable, and `adb wait-for-device`
 * only waits for the *device* to appear — not for the system to finish booting.
 * Capturing a screenshot in that window photographs a black screen or the boot
 * animation, which then becomes a baseline and quietly breaks every later
 * comparison. So this polls `sys.boot_completed` and refuses to return until it
 * is `1`.
 *
 * Usage (from mobile/):
 *   npm run emulator:start
 *   npm run emulator:stop
 *   node scripts/emulator.mjs start --avd nexus_test --window
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args[0];
const AVD = argValue('--avd', 'nexus_test');
const HEADLESS = !args.includes('--window');
const BOOT_TIMEOUT_MS = 300_000;

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

function sdkTool(dir, names) {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (home) {
    for (const n of names) {
      const p = path.join(home, dir, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return names[0].replace(/\.exe$/, '');
}

const ADB = sdkTool('platform-tools', ['adb.exe', 'adb']);
const EMULATOR = sdkTool('emulator', ['emulator.exe', 'emulator']);

function adb(a) {
  return execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function bootCompleted() {
  try {
    return adb(['shell', 'getprop', 'sys.boot_completed']).trim() === '1';
  } catch {
    return false;
  }
}

function listAvds() {
  try {
    return execFileSync(EMULATOR, ['-list-avds'], { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    console.error('emulator: could not list AVDs — is the Android SDK installed?');
    console.error(`emulator: ${err.message.split('\n')[0]}`);
    process.exit(2);
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function start() {
  const avds = listAvds();
  if (!avds.includes(AVD)) {
    console.error(`emulator: no AVD named "${AVD}". Available: ${avds.join(', ') || '(none)'}`);
    console.error('emulator: create one — see docs/TESTING.md.');
    process.exit(2);
  }

  if (bootCompleted()) {
    console.log('emulator: already booted.');
    return;
  }

  const emuArgs = [
    '-avd',
    AVD,
    '-no-audio',
    '-no-boot-anim',
    // CPU rendering: slower than the host GPU but deterministic, which is what a
    // pixel comparison needs. Pinned here AND in the AVD config.
    '-gpu',
    'swiftshader_indirect',
    // Never resume from a snapshot: a restored snapshot can carry stale app state
    // and produce a screenshot that does not match a clean launch.
    '-no-snapshot',
  ];
  if (HEADLESS) emuArgs.push('-no-window');

  console.log(`emulator: starting ${AVD}${HEADLESS ? ' (headless)' : ''}`);
  const child = spawn(EMULATOR, emuArgs, { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let dots = 0;
  while (Date.now() < deadline) {
    if (bootCompleted()) {
      console.log(`\nemulator: booted in ${Math.round((BOOT_TIMEOUT_MS - (deadline - Date.now())) / 1000)}s`);
      console.log(adb(['devices']).trim());
      return;
    }
    await sleep(3000);
    dots += 1;
    if (dots % 5 === 0) process.stdout.write('.');
  }

  console.error('');
  console.error(`emulator: ${AVD} did not report sys.boot_completed within ${BOOT_TIMEOUT_MS / 1000}s.`);
  console.error('emulator: this is NOT a pass — do not capture screenshots against it.');
  process.exit(1);
}

function stop() {
  try {
    adb(['emu', 'kill']);
    console.log('emulator: stopped.');
  } catch {
    console.log('emulator: nothing running.');
  }
}

if (mode === 'start') {
  await start();
} else if (mode === 'stop') {
  stop();
} else {
  console.error('usage: node scripts/emulator.mjs <start|stop> [--avd NAME] [--window]');
  process.exit(2);
}
