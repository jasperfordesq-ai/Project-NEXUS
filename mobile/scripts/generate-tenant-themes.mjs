// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Generates one uniwind theme per community per scheme, so HeroUI Native's components
 * render in that community's own brand colour.
 *
 * ── Why this is generated and not hand-written ────────────────────────────────
 *
 * HeroUI Native has thirteen components that resolve `--accent` internally (button,
 * tabs, switch, checkbox, chip, radio, slider, toast, OTP and more), and its provider
 * accepts no colour configuration. The only way to retint them is to change the CSS
 * variable they read. uniwind compiles those variables at BUILD time and exposes no
 * runtime setter for an arbitrary value — `Uniwind.setTheme()` can only switch between
 * themes that were registered when the bundle was built.
 *
 * 🔴 And uniwind requires every registered theme to declare the SAME variable set
 * (`node_modules/uniwind/src/bundler/artifacts/css/themes.ts` errors with "All themes
 * must have the same variables"). HeroUI declares 35 variables per scheme, so each
 * community theme has to repeat all 35. That is 35 x 2 x N lines — which is why this
 * is generated. Hand-maintaining it would guarantee drift the first time HeroUI adds
 * a variable.
 *
 * The variable set is READ from HeroUI's own shipped stylesheet rather than copied
 * here, so a library upgrade that adds or renames a variable flows through on the next
 * generate instead of silently producing a theme uniwind will reject.
 *
 * Usage:
 *   node scripts/generate-tenant-themes.mjs           # write generated/tenant-themes.css
 *   node scripts/generate-tenant-themes.mjs --check   # fail if the committed file is stale
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');

const ARGS = process.argv.slice(2);
const CHECK_ONLY = ARGS.includes('--check');

/**
 * `--palette <path>` and `--out <path>` exist so tests can run this generator against
 * fixture colours. The alternative was exporting the colour arithmetic and importing it
 * from a test, which jest cannot do here (the jest-expo preset does not transform .mjs),
 * and re-implementing the arithmetic in the test would only prove the copy works.
 */
function argValue(flag) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : null;
}

const HEROUI_VARIABLES = path.join(
  MOBILE_ROOT, 'node_modules', 'heroui-native', 'lib', 'module', 'styles', 'variables.css'
);
const PALETTE = argValue('--palette') ?? path.join(MOBILE_ROOT, 'config', 'tenant-palettes.json');
const OUT_DIR = path.join(MOBILE_ROOT, 'generated');
const OUT_FILE = argValue('--out') ?? path.join(OUT_DIR, 'tenant-themes.css');


function fail(...lines) {
  for (const line of lines) console.error(`generate-tenant-themes: ${line}`);
  process.exit(1);
}

// ── colour helpers ───────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const clean = hex.trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) fail(`"${hex}" is not a 6-digit hex colour.`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** sRGB channel to linear light, per the WCAG definition. */
function toLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The text/icon colour to sit ON the accent.
 *
 * 🔴 Computed, not assumed. A tenant picks their own brand colour, so white is not
 * always readable on it — a pale brand colour needs dark ink. The web side hardcodes
 * white and its own token file admits the pairing is only checked for the default
 * accent (react-frontend/src/styles/tokens.css). Doing the arithmetic here means a
 * community with a yellow or pale-green brand still gets a legible label.
 */
function foregroundFor(rgb) {
  const white = [255, 255, 255];
  const ink = [15, 23, 42]; // slate-900, the app's darkest text tone
  const onWhite = contrastRatio(rgb, white);
  const onInk = contrastRatio(rgb, ink);

  // Pick the better of the two, not "white unless it fails". At the crossover a colour can
  // miss 4.5:1 on BOTH, and taking the larger ratio is then the only sensible answer.
  const choice = onWhite >= onInk
    ? { css: 'oklch(1 0 0)', label: 'white', ratio: onWhite }
    : { css: 'oklch(0.21 0.03 256)', label: 'ink', ratio: onInk };

  // 🔴 Some accents cannot reach 4.5:1 with either label. A mid-lightness colour sits at
  // the crossover: #8b5cf6 measures 4.23 on white and 4.22 on ink, so even the better
  // pairing falls short of the AA requirement for normal-size text. It does clear the 3:1
  // floor that applies to large text and UI components, so it is not unusable — but it is a
  // compromise, and a compromise nobody is told about is exactly how the WCAG failures
  // found earlier this week got into the app. So it is reported at generate time rather
  // than shipped quietly. Fixing it properly needs a third option (an outline or
  // tinted-surface button variant), which is a design decision, not arithmetic.
  choice.belowAA = choice.ratio < 4.5;
  return choice;
}

/** How far a dark-mode accent moves towards white. */
const DARK_LIFT = 0.3;

function toCssColor([r, g, b]) {
  return `rgb(${r} ${g} ${b})`;
}

/** Mix towards white (amount > 0) or black (amount < 0) in sRGB. */
function shift(rgb, amount) {
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return rgb.map((c) => Math.round(c + (target - c) * k));
}

// ── reading HeroUI's variable set ────────────────────────────────────────────

function readSchemeBlocks() {
  if (!fs.existsSync(HEROUI_VARIABLES)) {
    fail(
      `HeroUI's variables.css was not found at ${path.relative(MOBILE_ROOT, HEROUI_VARIABLES)}.`,
      'A heroui-native upgrade may have moved it. Find the file and update HEROUI_VARIABLES.'
    );
  }
  const source = fs.readFileSync(HEROUI_VARIABLES, 'utf8');

  const blocks = {};
  for (const scheme of ['light', 'dark']) {
    const match = new RegExp(`@variant ${scheme}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source);
    if (!match) fail(`could not find HeroUI's "@variant ${scheme}" block.`);

    const declarations = [...match[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]);
    if (declarations.length === 0) fail(`HeroUI's "${scheme}" block parsed to zero variables.`);

    blocks[scheme] = declarations;
  }

  const lightNames = blocks.light.map(([n]) => n).sort().join(',');
  const darkNames = blocks.dark.map(([n]) => n).sort().join(',');
  if (lightNames !== darkNames) {
    // uniwind would reject this later with a less helpful message.
    fail('HeroUI\'s light and dark blocks declare different variables, so generated themes cannot match.');
  }

  return blocks;
}

// ── generation ───────────────────────────────────────────────────────────────

export function themeName(slug, scheme) {
  // Slugs are lowercase-hyphen already; the prefix keeps them clear of `light`/`dark`.
  return `t-${slug}-${scheme}`;
}

function buildThemeBlock(slug, scheme, accentHex, accentDarkHex, blocks) {
  const baseHex = scheme === 'dark' ? (accentDarkHex ?? accentHex) : accentHex;
  let accent = hexToRgb(baseHex);

  // Lighten the accent for dark mode so a deep brand colour stays legible on a near-black
  // ground — the direction HeroUI's own default moves between its schemes.
  if (scheme === 'dark' && !accentDarkHex) accent = shift(accent, DARK_LIFT);

  // 🔴 The dark-mode lift, and the three things that had to be true before it was safe.
  //
  // Lifting makes the fill a DIFFERENT colour from `usePrimaryColor()`, which everything the
  // app paints by hand uses. Every earlier attempt therefore broke something, and each of
  // those has now been fixed on its own merits:
  //
  //   79 buttons overriding their own background     -> swept; the primary variant already
  //                                                     paints the accent
  //   91 conditional overrides on toggle buttons     -> swept; same reason
  //   72 hardcoded-white ICONS beside those labels   -> now <AccentIcon>, which resolves the
  //                                                     same colour the label uses
  //
  // That last one was NOT caused by lifting. A community with a yellow or mint brand colour
  // already got an ink label with a white icon beside it at ~1.4:1 — invisible, on the
  // primary action of every screen. Lifting merely made it visible on the default palette
  // too. `components/accentIconColour.test.ts` and `components/accentOverride.test.ts` keep
  // all three fixed.
  //
  // Why lift at all: a deep brand colour is harder to read on a near-black ground. The
  // agoris teal measures 3.61:1 against the dark background un-lifted and 6.35:1 lifted.

  const foreground = foregroundFor(accent);
  const hover = shift(accent, scheme === 'dark' ? 0.12 : -0.12);

  const overrides = new Map([
    ['--accent', toCssColor(accent)],
    ['--accent-foreground', foreground.css],
    ['--focus', toCssColor(accent)],
    ['--link', toCssColor(accent)],
  ]);

  const lines = blocks[scheme].map(([name, value]) => {
    const replacement = overrides.get(name);
    return `      ${name}: ${replacement ?? value};`;
  });

  // `--accent-hover` is ours, not HeroUI's: global.css declares it for the default
  // themes, so every theme must declare it too or uniwind rejects the set.
  lines.push(`      --accent-hover: ${toCssColor(hover)};`);

  return {
    css: [`    @variant ${themeName(slug, scheme)} {`, ...lines, '    }'].join('\n'),
    foreground,
  };
}

function generate() {
  const blocks = readSchemeBlocks();

  const palette = JSON.parse(fs.readFileSync(PALETTE, 'utf8'));
  const tenants = palette.tenants ?? {};
  const slugs = Object.keys(tenants).sort();
  if (slugs.length === 0) fail('config/tenant-palettes.json declares no tenants.');

  const report = [];
  const warnings = [];
  const blocksCss = [];

  for (const slug of slugs) {
    const entry = tenants[slug];
    if (!entry?.accent) fail(`tenant "${slug}" has no "accent" colour.`);

    for (const scheme of ['light', 'dark']) {
      const built = buildThemeBlock(slug, scheme, entry.accent, entry.accentDark, blocks);
      blocksCss.push(built.css);
      report.push(
        `  ${themeName(slug, scheme).padEnd(28)} accent ${entry.accent}  ` +
          `label ${built.foreground.label} at ${built.foreground.ratio.toFixed(2)}:1` +
          (built.foreground.belowAA ? '  [!] below 4.5:1 — clears the 3:1 UI floor only' : '')
      );
      if (built.foreground.belowAA) warnings.push(`${slug} (${scheme})`);
    }
  }

  const header = [
    '/* GENERATED FILE — do not edit by hand.',
    ' *',
    ' * Regenerate with:  npm run themes:generate',
    ' * Source of truth:  config/tenant-palettes.json',
    ' * Variable set:     node_modules/heroui-native/lib/module/styles/variables.css',
    ' *',
    ' * One uniwind theme per community per scheme. Every theme repeats HeroUI\'s full',
    ' * variable set because uniwind requires all registered themes to declare the same',
    ' * variables; only the accent trio differs. See scripts/generate-tenant-themes.mjs',
    ' * for why this cannot be done at runtime.',
    ' */',
    '',
    '@layer theme {',
    '  :root {',
  ];
  const footer = ['  }', '}', ''];

  return {
    css: [...header, ...blocksCss, ...footer].join('\n'),
    report,
    warnings,
    themeNames: slugs.flatMap((s) => ['light', 'dark'].map((sc) => themeName(s, sc))),
  };
}

/** Used by metro.config.js so the registered names and the CSS cannot disagree. */
export function tenantThemeNames() {
  const palette = JSON.parse(fs.readFileSync(PALETTE, 'utf8'));
  return Object.keys(palette.tenants ?? {})
    .sort()
    .flatMap((slug) => ['light', 'dark'].map((scheme) => themeName(slug, scheme)));
}

function main() {
  const { css, report, warnings, themeNames } = generate();

  if (CHECK_ONLY) {
    if (!fs.existsSync(OUT_FILE)) {
      fail('generated/tenant-themes.css is missing. Run `npm run themes:generate`.');
    }
    const committed = fs.readFileSync(OUT_FILE, 'utf8').replace(/\r\n/g, '\n');
    if (committed !== css) {
      fail(
        'generated/tenant-themes.css is stale — it does not match what the palette and',
        'HeroUI\'s variables produce now. Run `npm run themes:generate` and commit the result.'
      );
    }
    console.log(`generate-tenant-themes: OK — committed CSS matches (${themeNames.length} themes).`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, css, 'utf8');

  console.log(`generate-tenant-themes: wrote ${themeNames.length} themes to ${path.relative(MOBILE_ROOT, OUT_FILE)}`);
  for (const line of report) console.log(line);
  console.log('generate-tenant-themes: register these names in metro.config.js (it reads them from here).');
  if (warnings.length > 0) {
    console.warn('');
    console.warn(
      `generate-tenant-themes: [!] ${warnings.length} theme(s) cannot reach 4.5:1 with either ` +
        `label colour — ${warnings.join(', ')}.`
    );
    console.warn(
      'generate-tenant-themes: the better option was used and it clears the 3:1 floor for UI ' +
        'text, but these accents need a design answer (an outline or tinted variant), not a ' +
        'different label colour.'
    );
  }
}

main();
