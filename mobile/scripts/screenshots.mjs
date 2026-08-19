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

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

/**
 * The right edge carries the scroll indicator, which fades in and out and is
 * therefore present in some captures and not others. On the dark login screen that
 * alone produced a 1.0% difference between two otherwise identical runs — the diff
 * was a single vertical stripe down the right edge and nothing else.
 *
 * Cropping it is the same judgement as cropping the status bar: a transient overlay
 * is excluded, rather than raising the global threshold and blunting the gate
 * everywhere. 24px at 420dpi clears the indicator with a margin.
 */
const SCROLLBAR_PX = 24;

/**
 * Screens captured for eyeballing but NOT compared, because they are not
 * reproducible and a gate that fires at random is worse than no gate.
 *
 * Measured across repeated tours on 2026-08-18: `01-login`, `05-profile` and
 * `06-wallet` reproduce at **0 pixels** difference, run after run. These three do
 * not, and the reasons are in the app rather than the tooling:
 *
 *   02-home-feed   the "For You" feed is algorithmically ordered, so the same
 *                  request can return a different sequence. Differed by 18% between
 *                  two runs that were otherwise identical.
 *   03-listings    cards animate in on a stagger AFTER the header is present, so a
 *                  settle wait returns while the list is still moving. Two settle
 *                  passes did not fix it (8.3% then 8.9%).
 *   04-messages    same staggered-content pattern.
 *
 * All three also render relative timestamps ("6d ago"), which drift daily
 * regardless of animation.
 *
 * Making them comparable needs fixed-date seed data and a deterministic sort — real
 * work, worth doing, and not pretended to be done here. Until then they are
 * captured (looking at them by hand still catches a broken layout) and skipped by
 * the comparison, which is stated in the output rather than hidden.
 */
const VOLATILE_SCREENS = new Set(['02-home-feed.png', '03-listings.png', '04-messages.png']);

/** A difference this small is anti-aliasing noise, not a regression. */
const MAX_DIFF_RATIO = 0.001; // 0.1% of compared pixels

/**
 * 🔴 These settings were `{ threshold: 0.02, includeAA: true }` and the gate was
 * effectively blind. Measured on 2026-08-19 against a real, intended change — panel
 * corner radii going from 24dp to 16dp on the wallet screen:
 *
 *   threshold 0.1  includeAA false ->     40 px (0.002%)  <- PASSED, reported "ok"
 *   threshold 0.1  includeAA true  ->     48 px (0.002%)  <- still passes
 *   threshold 0.05 includeAA true  ->  3,587 px (0.147%)
 *   threshold 0.02 includeAA true  ->  9,886 px (0.406%)  <- matches a hand count
 *
 * The cause is not anti-aliasing, it is the threshold. pixelmatch's `threshold` is a
 * YIQ colour-distance tolerance, and much of this app is a light grey surface on a
 * white card — a delta of roughly 14/255 per channel. At 0.1 that entire class of
 * change is inside the tolerance, so the gate could not see a tile move, a radius
 * change, or a surface swap between similar light tones. It reported "0 px" and the
 * readiness doc took that to mean "pixel-gated at 0px repeatability", which
 * overstated the protection considerably.
 *
 * 0.02 is the floor, not a preference: at 0.01 an untouched login screen reports
 * 42,240 differing pixels (1.7%) from ordinary render noise, which would make the
 * gate cry wolf. At 0.02 login still reports exactly 0 while both genuinely changed
 * screens report hundredths of a percent. `includeAA: true` is set because curve and
 * edge changes are largely made of anti-aliased pixels, and discarding them is
 * discarding the evidence.
 *
 * Guarded by scripts/screenshots.contrastSensitivity.test.mjs, which fails if these
 * settings drift back to a tolerance that cannot see a grey-on-white change.
 */
const PIXELMATCH_OPTIONS = Object.freeze({ threshold: 0.02, includeAA: true });

const args = process.argv.slice(2);
const mode = args[0];
const scheme = argValue('--scheme', 'light');
const adbPath = resolveAdb();

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

/** Maestro's launcher, which is a .bat on Windows — see the spawnSync note below. */
function resolveMaestro() {
  return process.platform === 'win32'
    ? path.join(os.homedir(), '.maestro', 'bin', 'maestro.bat')
    : path.join(os.homedir(), '.maestro', 'bin', 'maestro');
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

/**
 * Crop the two transient regions: the status bar along the top (live clock) and
 * the scroll indicator down the right edge. Everything between them is compared
 * strictly.
 */
function cropTransientRegions(png) {
  const height = png.height - STATUS_BAR_PX;
  const width = png.width - SCROLLBAR_PX;
  if (height <= 0 || width <= 0) return png;
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, STATUS_BAR_PX, width, height, 0, 0);
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

/**
 * Drive the app through the signed-in screens with Maestro and collect the
 * resulting images into `screenshots/current/<scheme>/`.
 *
 * Maestro is used for navigation rather than a hand-rolled sequence of `adb
 * shell input tap` coordinates, because coordinates break the moment a layout
 * changes — which is exactly the thing being tested. Maestro finds elements by
 * label and testID, so the tour keeps working when the pixels move.
 *
 * Maestro writes `takeScreenshot` output into its own run directory, so this
 * copies the newest run's images across. It refuses to proceed if the tour
 * produced nothing, rather than silently comparing an empty set and reporting OK.
 */
function doTour() {
  requireDevice();

  const flow = path.join(MOBILE_ROOT, '.maestro', 'screens', 'capture-screens.yaml');
  if (!fs.existsSync(flow)) fail(`tour flow not found: ${path.relative(MOBILE_ROOT, flow)}`);

  const maestro = resolveMaestro();
  if (!fs.existsSync(maestro)) fail(`Maestro not found at ${maestro} — see docs/TESTING.md.`);

  // Animations must be ON for navigation: with scales at 0 the LogBox banner
  // covers the tab bar and taps land on it instead. stabiliseDevice() below then
  // turns them off only for the capture itself.
  restoreAnimations();
  setScheme(scheme);

  const email = process.env.E2E_TEST_EMAIL || 'e2e.user.a@project-nexus.local';
  const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';

  console.log(`screenshots: touring the app (scheme ${scheme}) via Maestro`);
  const run = spawnSync(
    maestro,
    ['test', '--env', `TEST_EMAIL=${email}`, '--env', `TEST_PASSWORD=${password}`, flow],
    {
      cwd: MOBILE_ROOT,
      stdio: 'inherit',
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    // 🔴 `shell: true` is REQUIRED on Windows. Maestro ships `maestro.bat`, and
    // Node refuses to spawn a .bat directly since the CVE-2024-27980 fix — it
    // fails with EINVAL and `status: null`, which reads as "the tool ran and
    // returned nothing" rather than "the tool never started".
    shell: process.platform === 'win32',
    }
  );

  const collected = collectMaestroScreenshots();
  if (collected === 0) {
    fail(
      'the tour produced no screenshots.',
      run.status === 0
        ? 'Maestro reported success but wrote nothing — check the flow takeScreenshot steps.'
        : `Maestro exited ${run.status}. Its output above says which step failed.`
    );
  }
  console.log(`screenshots: collected ${collected} screen(s) into current/${scheme}`);
  if (run.status !== 0) {
    console.error('');
    console.error(`screenshots: Maestro exited ${run.status} — the tour did not finish, so some`);
    console.error('screenshots: screens are missing. Do NOT approve a partial tour as a baseline.');
    process.exit(1);
  }
}

/**
 * Copy the newest Maestro run's takeScreenshot output into `<destRoot>/<scheme>/`.
 *
 * `flowName` is the flow's filename without extension, because that is the
 * directory Maestro writes under — passing the wrong one silently finds nothing and
 * reads as "the flow produced no screenshots".
 */
function collectMaestroScreenshots(flowName = 'capture-screens', destRoot = 'current') {
  const testsRoot = path.join(os.homedir(), '.maestro', 'tests');
  if (!fs.existsSync(testsRoot)) return 0;

  const runs = fs
    .readdirSync(testsRoot)
    .map((name) => ({ name, mtime: fs.statSync(path.join(testsRoot, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (runs.length === 0) return 0;

  const shotDir = path.join(testsRoot, runs[0].name, flowName, 'takeScreenshot');
  if (!fs.existsSync(shotDir)) return 0;

  const dest = path.join(SHOT_ROOT, destRoot, scheme);
  ensureDir(dest);
  let n = 0;
  for (const f of fs.readdirSync(shotDir).filter((x) => x.endsWith('.png'))) {
    fs.copyFileSync(path.join(shotDir, f), path.join(dest, f));
    n += 1;
  }
  return n;
}

/**
 * Walk as many screens as the app will allow and collect the images into
 * `screenshots/sweep/<scheme>/` for a person to look through.
 *
 * 🔴 This deliberately writes to `sweep/`, NOT to `current/`. `current/` is the
 * input to the pixel comparison, so dropping 26 unreproducible live-data screens
 * into it would either flood the gate with false regressions or tempt someone to
 * approve them as baselines — and a baseline that never reproduces is worse than no
 * baseline, because it gets ignored and then the real regressions are ignored with
 * it.
 *
 * There is no pass/fail here and no exit code beyond "did it run". A screen the
 * sweep could not reach shows up as a missing image, which is itself the finding.
 */
function doSweep() {
  requireDevice();

  const flow = path.join(MOBILE_ROOT, '.maestro', 'screens', 'sweep-screens.yaml');
  if (!fs.existsSync(flow)) fail(`sweep flow not found: ${path.relative(MOBILE_ROOT, flow)}`);

  const maestro = resolveMaestro();
  if (!fs.existsSync(maestro)) fail(`Maestro not found at ${maestro} — see docs/TESTING.md.`);

  // Animations ON: with scales at 0 the LogBox banner covers the tab bar and taps
  // land on it instead of the tab. The sweep is not pixel-compared, so the slight
  // motion blur this allows costs nothing here.
  restoreAnimations();
  setScheme(scheme);

  const email = process.env.E2E_TEST_EMAIL || 'e2e.user.a@project-nexus.local';
  const password = process.env.E2E_TEST_PASSWORD || 'TestPassword123!';

  console.log(`screenshots: sweeping the app (scheme ${scheme}) via Maestro`);
  const run = spawnSync(
    maestro,
    ['test', '--env', `TEST_EMAIL=${email}`, '--env', `TEST_PASSWORD=${password}`, flow],
    {
      cwd: MOBILE_ROOT,
      stdio: 'inherit',
      env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
      shell: process.platform === 'win32',
    }
  );

  const collected = collectMaestroScreenshots('sweep-screens', 'sweep');
  console.log('');
  if (collected === 0) {
    fail(
      'the sweep produced no screenshots.',
      run.status === 0
        ? 'Maestro reported success but wrote nothing — check the flow takeScreenshot steps.'
        : `Maestro exited ${run.status}. Its output above says which step failed.`
    );
  }
  console.log(`screenshots: collected ${collected} screen(s) into sweep/${scheme}`);
  console.log('screenshots: these are for LOOKING AT. They are not baselines and are');
  console.log('screenshots: not compared — see doSweep() for why.');
  if (run.status !== 0) {
    console.log(`screenshots: Maestro exited ${run.status} — some screens were unreachable.`);
    console.log('screenshots: that is a finding, not a crash. Check which images are missing.');
  }
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
  let skipped = 0;
  for (const name of names) {
    if (VOLATILE_SCREENS.has(name)) {
      console.log(`screenshots: skip ${name} — not reproducible, see VOLATILE_SCREENS`);
      skipped += 1;
      continue;
    }
    const cur = path.join(currentDir, name);
    if (!fs.existsSync(cur)) {
      console.error(`screenshots: MISSING capture for baseline "${name}"`);
      failures += 1;
      continue;
    }

    const a = cropTransientRegions(readPng(path.join(baselineDir, name)));
    const b = cropTransientRegions(readPng(cur));

    if (a.width !== b.width || a.height !== b.height) {
      console.error(
        `screenshots: SIZE CHANGED ${name} — baseline ${a.width}x${a.height}, current ${b.width}x${b.height}`
      );
      console.error('screenshots: a different AVD or density will do this. Compare like with like.');
      failures += 1;
      continue;
    }

    const diff = new PNG({ width: a.width, height: a.height });
    const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, PIXELMATCH_OPTIONS);
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
  console.log(
    `screenshots: OK — ${names.length - skipped} screen(s) match the baseline` +
      (skipped > 0 ? `, ${skipped} skipped as not reproducible.` : '.')
  );
}

function doApprove() {
  const currentDir = path.join(SHOT_ROOT, 'current', scheme);
  const baselineDir = path.join(SHOT_ROOT, 'baseline', scheme);
  if (!fs.existsSync(currentDir)) fail('nothing to approve — run capture first.');
  ensureDir(baselineDir);
  let n = 0;
  for (const f of fs.readdirSync(currentDir).filter((x) => x.endsWith('.png'))) {
    if (VOLATILE_SCREENS.has(f)) {
      console.log(`screenshots: not promoting ${f} — it does not reproduce, so it cannot be an assertion`);
      continue;
    }
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
  case 'tour':
    doTour();
    break;
  case 'sweep':
    doSweep();
    break;
  case 'restore-animations':
    // Exposed so a Maestro run can guarantee normal timing without capturing.
    requireDevice();
    restoreAnimations();
    console.log('screenshots: animation scales restored to 1');
    break;
  default:
    console.error(
      'usage: node scripts/screenshots.mjs <tour|sweep|capture|compare|approve|restore-animations> [--scheme light|dark]'
    );
    process.exit(2);
}
