// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Measure every touch target on a running emulator and report the ones that are too small.
 *
 * 🔴 This exists because the first touch-target audit (journey 7.10, 2026-08-23) covered
 * five screens of roughly 137, by hand. Doing that once teaches you the density trap; doing
 * it for the whole app by hand is not something anyone will repeat, so it never gets
 * re-checked after a redesign. This walks a list of screens, reads the live accessibility
 * tree from each, and prints every clickable node below the thresholds.
 *
 * 🔴 The density is measured, never assumed. The first audit nearly used 2.25x, which would
 * have understated every figure — this asks the device (`wm density`) and converts with the
 * real value. On the standard test emulator that is 420dpi, so 1dp = 2.625px, the WCAG 2.2
 * AA minimum of 24dp = 63px, and Android's own 48dp guidance = 126px.
 *
 * Usage (the app must be running and signed in, Metro up):
 *   node scripts/audit-touch-targets.mjs
 *   node scripts/audit-touch-targets.mjs --serial emulator-5554 --json out.json
 *   node scripts/audit-touch-targets.mjs --screens home,members,wallet
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const SERIAL = argValue('--serial', 'emulator-5554');
const JSON_OUT = argValue('--json', null);
const ADB = process.env.ADB_PATH
  ?? 'C:/Users/jaspe/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const PACKAGE = 'ie.project.nexus';
const BASE_URL = 'https://app.project-nexus.ie';

/** WCAG 2.2 AA (2.5.8) minimum, and Android's own guidance. */
const AA_MIN_DP = 24;
const ANDROID_GUIDANCE_DP = 48;

/**
 * The screens to walk. Deep links, because they land on one screen with no navigation
 * guesswork; each is a screen a member reaches in normal use.
 */
const DEFAULT_SCREENS = [
  'home', 'listings', 'events', 'groups', 'members', 'messages', 'wallet',
  'volunteering', 'jobs', 'marketplace', 'notifications', 'profile',
  'resources', 'polls', 'goals', 'matches', 'organisations', 'blog',
  'group-exchanges', 'achievements', 'leaderboard', 'search', 'settings', 'support',
  'connections', 'activity', 'endorsements', 'reviews', 'skills',
];

/**
 * 🔴 Proof that the screen on the device is the screen being measured.
 *
 * Settling on "the tree stopped changing" was not enough: with deep links fired one after
 * another into a dev build, a slow screen let the run measure the PREVIOUS one, and the
 * report attributed groups chips to the members screen and marketplace chips to settings.
 * Each route now carries text only that screen shows. No match, no measurement — the row is
 * reported UNVERIFIED and left out of the totals, which is the honest failure mode.
 */
const SCREEN_FINGERPRINT = {
  home: /Community Feed|Create post/,
  listings: /Offers|Requests|Browse exchanges/,
  events: /Upcoming|Past events|step-free/i,
  groups: /GROUPS|Featured|My groups/i,
  members: /Member directory|Search members/i,
  messages: /Inbox|Archived|conversation/i,
  wallet: /TIME CREDIT WALLET|Your balance/,
  volunteering: /COMMUNITY ACTION|Find opportunities/,
  jobs: /COMMUNITY ROLES|Search jobs/,
  marketplace: /MARKETPLACE|Browse|Sell/i,
  notifications: /Notifications|All caught up/i,
  profile: /Your profile|Edit profile|My activity/i,
  resources: /Resources|Knowledge|Files/i,
  polls: /Polls|Which day/i,
  goals: /Goals|Progress/i,
  matches: /Matches|Recommended/i,
  organisations: /Organisations|Organizations/i,
  blog: /Blog|Latest posts/i,
  'group-exchanges': /SHARED TIME EXCHANGE|Group Exchanges/i,
  achievements: /Achievements|COMMUNITY PROGRESS|badges/i,
  leaderboard: /Leaderboard|Ranking|Top/i,
  search: /Search|Find/i,
  settings: /Settings|Preferences|Appearance/i,
  support: /Support|Help|Contact/i,
  connections: /Connections|Connection requests|Browse members/i,
  activity: /Activity|Recent activity|Hours given/i,
  endorsements: /Endorsements|My skills|Discover/i,
  reviews: /Reviews|Received|Pending/i,
  skills: /Skills|Endorsements|Add skill/i,
};

const screens = argValue('--screens', null)?.split(',').map((s) => s.trim()).filter(Boolean)
  ?? DEFAULT_SCREENS;

function adb(cmdArgs, { encoding = 'utf8' } = {}) {
  return execFileSync(ADB, ['-s', SERIAL, ...cmdArgs], {
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

function deviceDensity() {
  // "Physical density: 420" — and an override line when one is set.
  const out = adb(['shell', 'wm', 'density']);
  const override = out.match(/Override density:\s*(\d+)/);
  const physical = out.match(/Physical density:\s*(\d+)/);
  const dpi = Number((override ?? physical)?.[1]);
  if (!Number.isFinite(dpi)) throw new Error(`Could not read density from: ${out}`);
  return dpi;
}

function openScreen(route) {
  adb(['shell', `am start -a android.intent.action.VIEW -d '${BASE_URL}/${route}' ${PACKAGE}`]);
}

function forceStopApp() {
  adb(['shell', 'am', 'force-stop', PACKAGE]);
}

function dumpTree() {
  return adb(['exec-out', 'uiautomator', 'dump', '/dev/tty']);
}

/** Every node the tree reports, with its bounds and whether it is a target. */
function parseNodes(xml) {
  const nodes = [];
  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = match[1];
    const attr = (name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    const bounds = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;
    const [, x1, y1, x2, y2] = bounds.map(Number);
    nodes.push({
      clickable: attr('clickable') === 'true',
      longClickable: attr('long-clickable') === 'true',
      className: attr('class'),
      desc: attr('content-desc'),
      text: attr('text'),
      widthPx: x2 - x1,
      heightPx: y2 - y1,
      x: x1,
      y: y1,
    });
  }
  return nodes;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cheap identity for a screen: the labels it exposes, in order. */
function signatureOf(xml) {
  return [...xml.matchAll(/content-desc="([^"]+)"/g)].map((m) => m[1]).join('|');
}

/**
 * 🔴 Wait until the screen has actually arrived AND stopped changing.
 *
 * The first version of this script slept 4.5s after each deep link and measured whatever
 * happened to be on screen. On slower screens that caught the PREVIOUS one, and the report
 * cheerfully attributed marketplace chips to the settings screen ("Free items", "Contact
 * seller") — figures that looked precise and were wrong. A measurement you cannot trust is
 * worse than none, so the tree is polled until it differs from the screen before it and two
 * consecutive reads agree. A screen that never settles is reported as UNSETTLED and left
 * out of the totals rather than counted as if it had been measured.
 */
async function settledTree(previousSignature) {
  const DEADLINE_MS = 20000;
  const POLL_MS = 1200;
  const started = Date.now();
  let lastXml = null;
  let lastSignature = null;
  while (Date.now() - started < DEADLINE_MS) {
    await sleep(POLL_MS);
    let xml;
    try {
      xml = dumpTree();
    } catch {
      continue;
    }
    const signature = signatureOf(xml);
    if (signature === previousSignature) continue;  // still the screen we came from
    if (signature === lastSignature) return { xml, signature, settled: true };
    lastXml = xml;
    lastSignature = signature;
  }
  return { xml: lastXml, signature: lastSignature, settled: false };
}

async function main() {
  const dpi = deviceDensity();
  const pxPerDp = dpi / 160;
  const aaMinPx = Math.round(AA_MIN_DP * pxPerDp);
  const guidancePx = Math.round(ANDROID_GUIDANCE_DP * pxPerDp);
  console.log(`Device ${SERIAL} at ${dpi}dpi — 1dp = ${pxPerDp.toFixed(3)}px`);
  console.log(`WCAG 2.2 AA floor ${AA_MIN_DP}dp = ${aaMinPx}px; Android guidance ${ANDROID_GUIDANCE_DP}dp = ${guidancePx}px\n`);

  const belowAA = [];
  const belowGuidance = [];
  const perScreen = [];

  let previousSignature = null;
  for (const route of screens) {
    forceStopApp();
    openScreen(route);
    const { xml, signature, settled } = await settledTree(previousSignature);
    if (!xml) {
      console.log(`${route.padEnd(18)} UNREADABLE — the screen never arrived`);
      continue;
    }
    if (!settled) {
      // Reported, never silently folded into the totals as if it had been measured.
      console.log(`${route.padEnd(18)} UNSETTLED — still changing after 20s, skipped`);
      previousSignature = signature;
      continue;
    }
    previousSignature = signature;

    const fingerprint = SCREEN_FINGERPRINT[route];
    if (fingerprint && !fingerprint.test(xml)) {
      console.log(`${route.padEnd(18)} UNVERIFIED — the screen on the device is not this one`);
      continue;
    }

    const nodes = parseNodes(xml);
    const targets = nodes.filter((node) => node.clickable || node.longClickable);
    const small = targets.filter((node) => node.heightPx < aaMinPx || node.widthPx < aaMinPx);
    const shortOfGuidance = targets.filter(
      (node) => (node.heightPx >= aaMinPx && node.heightPx < guidancePx)
        || (node.widthPx >= aaMinPx && node.widthPx < guidancePx),
    );
    perScreen.push({ route, targets: targets.length, belowAA: small.length, belowGuidance: shortOfGuidance.length });
    for (const node of small) belowAA.push({ route, ...node });
    for (const node of shortOfGuidance) belowGuidance.push({ route, ...node });
    console.log(
      `${route.padEnd(18)} ${String(targets.length).padStart(3)} targets  `
      + `${String(small.length).padStart(3)} below AA  ${String(shortOfGuidance.length).padStart(3)} below 48dp`,
    );
  }

  const toDp = (px) => (px / pxPerDp).toFixed(0);

  console.log(`\n${belowAA.length} target(s) below the WCAG 2.2 AA minimum:`);
  for (const node of belowAA) {
    const label = node.desc || node.text || node.className;
    console.log(`  ${node.route}: ${toDp(node.widthPx)}x${toDp(node.heightPx)}dp — ${label.slice(0, 60)}`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(
      path.resolve(JSON_OUT),
      `${JSON.stringify({ dpi, aaMinPx, guidancePx, perScreen, belowAA, belowGuidance }, null, 2)}\n`,
      'utf8',
    );
    console.log(`\nWritten to ${JSON_OUT}`);
  }

  // Below the AA floor is a failure; below Android's guidance is reported, not enforced —
  // the 40dp group is a known, recorded state and blocking on it would stop the audit being
  // run at all.
  process.exit(belowAA.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
