// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Screenshot capture and comparison for the Expo client.
 *
 * This is the layer nothing in the mobile suite could provide: proof that the app
 * still LOOKS right. The Jest suite renders a component tree and asserts on it,
 * which is blind to layout — text running off the edge, a control overlapping
 * another, a tap target too small, a panel that collapses on a narrow screen. All
 * of those ship green today.
 *
 * It needs a running emulator, which is why it is a separate script rather than a
 * Jest test: the mobile CI job runs on a bare Node runner with no Android SDK.
 * Setup is in docs/TESTING.md.
 *
 * Determinism is the whole game for a pixel diff. Three things are pinned:
 *  - the AVD renders with `swiftshader_indirect` (CPU), so a host graphics driver
 *    update cannot shift pixels underneath the baseline;
 *  - animations are disabled on the device before capture, so a frame mid-fade
 *    cannot be photographed;
 *  - the clock and status bar are the remaining known movers, so the status bar is
 *    excluded from comparison by a top crop rather than being fought.
 *
 * Usage (from mobile/):
 *   node scripts/screenshots.mjs capture              # write screenshots/current/
 *   node scripts/screenshots.mjs compare              # diff current against baseline
 *   node scripts/screenshots.mjs approve              # promote current to baseline
 *   node scripts/screenshots.mjs capture --scheme dark
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const SHOT_ROOT = path.join(MOBILE_ROOT, 'screenshots');
const APP_ID = 'ie.project.nexus';

/**
 * The status bar carries a live clock and battery indicator, so its pixels change
 * between any two runs. Cropping the top band is more honest than tolerating a
 * high global difference threshold, which would also hide real regressions
 * elsewhere on the screen. 96px at 420dpi covers the Pixel 7 status bar.
 */
const STATUS_BAR_PX = 96;

/** A difference this small is anti-aliasing noise, not a regression. */
const MAX_DIFF_RATIO = 0.001; // 0.1% of compared pixels

const args = process.argv.slice(2);
const mode = args[0];
const scheme = argValue('--scheme', 'light');
const adbPath = resolveAdb();

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

function resolveAdb() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (home) {
    for (const name of ['adb.exe', 'adb']) {
      const p = path.join(home, 'platform-tools', name);
      if (fs.existsSync(p)) return p;
    }
  }
  return 'adb'; // fall back to PATH
}

function adb(adbArgs, { binary = false } = {}) {
  return execFileSync(adbPath, adbArgs, {
    encoding: binary ? 'buffer' : 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function requireDevice() {
  let out;
  try {
    out = adb(['devices']);
  } catch (err) {
    fail(
      'adb could not be run.',
      'Install the Android SDK and put platform-tools on PATH — see docs/TESTING.md.',
      err.message.split('\n')[0]
    );
  }
  const devices = out
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('*'))
    .filter((l) => l.endsWith('device'));

  if (devices.length === 0) {
    fail(
      'No emulator or device is attached.',
      'Start one:  emulator -avd nexus_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect',
      'Then wait for boot:  adb wait-for-device shell getprop sys.boot_completed'
    );
  }
  return devices[0].split(/\s+/)[0];
}

function fail(...lines) {
  console.error('');
  for (const l of lines) console.error(`screenshots: ${l}`);
  console.error('');
  process.exit(2);
}

const ANIMATION_SCALE_KEYS = [
  'window_animation_scale',
  'transition_animation_scale',
  'animator_duration_scale',
];

/**
 * Restore normal animation timing.
 *
 * 🔴 This exists because leaving the scales at 0 has a consequence beyond this
 * script: Android then reports "reduced motion", Reanimated logs a development
 * warning about it, and React Native's LogBox draws a banner across the BOTTOM of
 * the screen — directly over the tab bar. Maestro's taps on the "More" tab then
 * hit the banner instead, and three flows failed on a missing "View wallet" that
 * was simply never navigated to. The device is shared state; a script that
 * changes it must put it back.
 */
export function restoreAnimations() {
  for (const key of ANIMATION_SCALE_KEYS) {
    try {
      adb(['shell', 'settings', 'put', 'global', key, '1']);
    } catch {
      // Best effort — a disconnected device is not worth failing a capture over.
    }
  }
}

/**
 * Disable the three animation scales. A capture taken mid-transition differs from
 * one taken after it settles, which shows up as an intermittent diff that looks
 * like a real regression and wastes an afternoon.
 */
function stabiliseDevice() {
  for (const key of ANIMATION_SCALE_KEYS) {
    adb(['shell', 'settings', 'put', 'global', key, '0']);
  }
  // A fixed demo status bar removes the clock and signal icons from the frame.
  // Ignored on images without the flag, so failure here is not fatal.
  try {
    adb(['shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1']);
    adb(['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'enter']);
    adb(['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'clock', '-e', 'hhmm', '1200']);
    adb(['shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'battery', '-e', 'level', '100', '-e', 'plugged', 'false']);
  } catch {
    // Demo mode is a convenience, not a requirement — the status-bar crop below
    // is what actually guarantees determinism.
  }
}

function setScheme(target) {
  // `cmd uiautomation` does not exist on all images; `settings put ui_night_mode`
  // is the portable route. 1 = light, 2 = dark.
  adb(['shell', 'settings', 'put', 'secure', 'ui_night_mode', target === 'dark' ? '2' : '1']);
  adb(['shell', 'cmd', 'uimode', 'night', target === 'dark' ? 'yes' : 'no']);
}

function appInstalled() {
  const out = adb(['shell', 'pm', 'list', 'packages', APP_ID]);
  return out.includes(APP_ID);
}

function launchApp() {
  adb(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1']);
}

function capture(name, dir) {
  const buf = adb(['exec-out', 'screencap', '-p'], { binary: true });
  if (buf.length === 0 || buf.slice(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') {
    fail(`screencap returned no valid PNG for "${name}".`);
  }
  const out = path.join(dir, `${name}.png`);
  fs.writeFileSync(out, buf);
  const png = PNG.sync.read(buf);
  return { file: out, width: png.width, height: png.height };
}

/** Crop the status bar off the top so its live clock cannot cause a diff. */
function cropStatusBar(png) {
  const height = png.height - STATUS_BAR_PX;
  if (height <= 0) return png;
  const out = new PNG({ width: png.width, height });
  PNG.bitblt(png, out, 0, STATUS_BAR_PX, png.width, height, 0, 0);
  return out;
}

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

// ── modes ────────────────────────────────────────────────────────────────────

function doCapture() {
  const device = requireDevice();
  const dir = path.join(SHOT_ROOT, 'current', scheme);
  ensureDir(dir);

  console.log(`screenshots: device ${device}, scheme ${scheme}`);

  if (!appInstalled()) {
    fail(
      `${APP_ID} is not installed on ${device}.`,
      'Build and install it first:  npx expo run:android',
      '🔴 Build with JDK 17 — Android Studio bundles JDK 25 and Gradle rejects it.'
    );
  }

  stabiliseDevice();
  setScheme(scheme);
  launchApp();

  // The app needs a moment to draw after launch. This is a fixed wait rather than
  // a poll because there is no reliable "first frame drawn" signal from adb; the
  // animation scales are already zero, so the frame is settled once it appears.
  const settleMs = 6000;
  console.log(`screenshots: waiting ${settleMs}ms for the app to settle`);
  execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${settleMs})`]);

  const shot = capture('01-launch', dir);
  console.log(`screenshots: wrote ${path.relative(MOBILE_ROOT, shot.file)} (${shot.width}x${shot.height})`);

  // Put the device back. See restoreAnimations() for why this is not optional.
  restoreAnimations();
  console.log('screenshots: animation scales restored');

  console.log('');
  console.log('screenshots: ONE screen captured. This is the launch screen only —');
  console.log('screenshots: reaching signed-in screens needs a Maestro flow to navigate');
  console.log('screenshots: and a seeded local API. See docs/TESTING.md.');
}

function doCompare() {
  const currentDir = path.join(SHOT_ROOT, 'current', scheme);
  const baselineDir = path.join(SHOT_ROOT, 'baseline', scheme);
  const diffDir = path.join(SHOT_ROOT, 'diff', scheme);

  if (!fs.existsSync(currentDir)) fail(`no captures at ${path.relative(MOBILE_ROOT, currentDir)} — run capture first.`);
  if (!fs.existsSync(baselineDir)) {
    fail(
      `no baseline at ${path.relative(MOBILE_ROOT, baselineDir)}.`,
      'Review the current captures by eye, then:  node scripts/screenshots.mjs approve',
      'A baseline adopted without looking at it just blesses whatever is on screen.'
    );
  }

  ensureDir(diffDir);
  const names = fs.readdirSync(baselineDir).filter((f) => f.endsWith('.png'));
  if (names.length === 0) fail('the baseline directory contains no PNGs.');

  let failures = 0;
  for (const name of names) {
    const cur = path.join(currentDir, name);
    if (!fs.existsSync(cur)) {
      console.error(`screenshots: MISSING capture for baseline "${name}"`);
      failures += 1;
      continue;
    }

    const a = cropStatusBar(readPng(path.join(baselineDir, name)));
    const b = cropStatusBar(readPng(cur));

    if (a.width !== b.width || a.height !== b.height) {
      console.error(
        `screenshots: SIZE CHANGED ${name} — baseline ${a.width}x${a.height}, current ${b.width}x${b.height}`
      );
      console.error('screenshots: a different AVD or density will do this. Compare like with like.');
      failures += 1;
      continue;
    }

    const diff = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
      threshold: 0.1,
      includeAA: false,
    });
    const ratio = changed / (a.width * a.height);

    if (ratio > MAX_DIFF_RATIO) {
      const diffFile = path.join(diffDir, name);
      fs.writeFileSync(diffFile, PNG.sync.write(diff));
      console.error(
        `screenshots: CHANGED ${name} — ${changed} px (${(ratio * 100).toFixed(3)}%) differ; ` +
          `diff at ${path.relative(MOBILE_ROOT, diffFile)}`
      );
      failures += 1;
    } else {
      console.log(`screenshots: ok ${name} — ${changed} px (${(ratio * 100).toFixed(4)}%)`);
    }
  }

  if (failures > 0) {
    console.error('');
    console.error(`screenshots: ${failures} screen(s) differ from the baseline.`);
    console.error('screenshots: look at the diff images. If the change is intended, run `approve`.');
    console.error('screenshots: do NOT approve without looking — that is how a visual bug becomes the baseline.');
    process.exit(1);
  }
  console.log(`screenshots: OK — ${names.length} screen(s) match the baseline.`);
}

function doApprove() {
  const currentDir = path.join(SHOT_ROOT, 'current', scheme);
  const baselineDir = path.join(SHOT_ROOT, 'baseline', scheme);
  if (!fs.existsSync(currentDir)) fail('nothing to approve — run capture first.');
  ensureDir(baselineDir);
  let n = 0;
  for (const f of fs.readdirSync(currentDir).filter((x) => x.endsWith('.png'))) {
    fs.copyFileSync(path.join(currentDir, f), path.join(baselineDir, f));
    n += 1;
  }
  console.log(`screenshots: promoted ${n} capture(s) to baseline/${scheme}.`);
  console.log('screenshots: commit them — the baseline is the assertion.');
}

switch (mode) {
  case 'capture':
    doCapture();
    break;
  case 'compare':
    doCompare();
    break;
  case 'approve':
    doApprove();
    break;
  case 'restore-animations':
    // Exposed so a Maestro run can guarantee normal timing without capturing.
    requireDevice();
    restoreAnimations();
    console.log('screenshots: animation scales restored to 1');
    break;
  default:
    console.error(
      'usage: node scripts/screenshots.mjs <capture|compare|approve|restore-animations> [--scheme light|dark]'
    );
    process.exit(2);
}
