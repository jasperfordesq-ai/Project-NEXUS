// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * translate-i18n-gaps.mjs
 *
 * Translates missing / English-fallback strings in all non-EN locale files.
 * Supports DeepL (recommended) or OpenAI as translation backend.
 *
 * Usage — DeepL (recommended, free tier 500k chars/month):
 *   DEEPL_API_KEY=your_key node scripts/translate-i18n-gaps.mjs
 *   Get a free key at: https://www.deepl.com/pro-api
 *
 * Usage — OpenAI (uses OPENAI_API_KEY from .env, GPT-4o-mini):
 *   OPENAI_API_KEY=your_key node scripts/translate-i18n-gaps.mjs
 *   (or set USE_OPENAI=1 if both keys are present to prefer OpenAI)
 *
 * Usage — Dry run / audit:
 *   node scripts/translate-i18n-gaps.mjs --summary
 *   DEEPL_API_KEY=x node scripts/translate-i18n-gaps.mjs --dry-run
 *
 * Flags:
 *   --dry-run          Print what would be translated without making changes
 *   --namespace <ns>   Only process files matching <ns> (e.g. --namespace emails)
 *   --lang <code>      Only process one language (e.g. --lang de)
 *   --missing-only     Only translate absent keys, not existing English fallback values
 *   --force            Re-translate strings even if they already differ from EN
 *   --include-simple   Translate short/simple strings too (useful for missing UI labels)
 *   --include-title-case  Translate title-cased labels normally treated as product names
 *   --include-core-namespaces  Include namespaces normally handled by dedicated checks
 *   --translate-skipped-missing  Translate otherwise protected values only when the key is absent
 *   --copy-skipped-missing  Copy missing invariant values (paths, tokens, URLs) from English
 *   --google           Use Google's public translate endpoint when no API key is available
 *   --concurrency <n>  Maximum parallel Google requests (default: 1, maximum: 10)
 *   --summary          Print a summary of gaps before translating
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../react-frontend/public/locales');
const ENV_PATH = path.resolve(__dirname, '../.env');

if (fs.existsSync(ENV_PATH)) {
  const envLines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    process.env[key] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

const DEEPL_KEY = process.env.DEEPL_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const USE_OPENAI = process.env.USE_OPENAI === '1' || (!DEEPL_KEY && !!OPENAI_KEY);

// DeepL: free tier uses api-free.deepl.com; paid uses api.deepl.com
const DEEPL_URL = DEEPL_KEY?.endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate';

// DeepL language codes for our supported languages.
// Irish (ga) falls back to OpenAI because DeepL does not support it.
const LANG_MAP = {
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  pt: 'PT',
  es: 'ES',
  nl: 'NL',
  pl: 'PL',
  ja: 'JA',
  ar: 'AR',
};

const SUPPORTED_LANGUAGES = ['de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar', 'ga'];

// Namespaces skipped by this script. NOTE: admin.json was removed from this
// list on 2026-07-02 — the old "admin is English-only" policy was voided on
// 2026-06-06 (admin.json is drift-gated and translated in all 11 locales);
// the entry here was a stale leftover that silently no-op'd admin fills.
const SKIP_NAMESPACES = new Set([
  'admin_dashboard.json',
  'admin_nav.json',
  'admin.php',
  'admin_dashboard.php',
  'admin_nav.php',
  'api.php',
  'api_controllers_1.json',
  'api_controllers_2.json',
  'api_controllers_3.json',
  'super_admin.json',
]);

// Strings matching these patterns are never translated (URLs, placeholders, codes,
// formatter fragments, sample values, and product/technology names).
const HARD_NO_TRANSLATE_PATTERNS = [
  /^https?:\/\//,           // URLs
  /^\/[A-Za-z0-9_./*-]+$/, // internal routes and route patterns
  /^\{\{.*\}\}$/,           // pure Handlebars templates
  /^\d+$/,                  // pure numbers
  /^[A-Z_]+$/,              // ALL_CAPS constants
  /^[\s\-–—./…#∞⌘()]+$/u,   // punctuation / symbolic UI placeholders
  /^[€$£]?\d[\d,.: ]*(?:[€$£])?(?:\s*[:–-]\s*[€$£]?\d[\d,.: ]*)?$/,
  /^\d+(?:\.\d+)?\s*(?:km|m|h|TC)$/i,
  /^\d+\s*minutes?$/i,
  /^\d+d$/i,
  /^\/\s?\d+$/,
  /^\.[a-z0-9]+$/i,
  /^(?:h|x|km|cr|min|vs|paypal)$/i,
  /^\[TEST\]$/,
  /^e\.g\.\s+.+$/i,
  /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/, // sample email addresses
  /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?:,\s*[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})+$/,
  /^[+\d ()-]{7,}$/,        // sample phone numbers
  /^[•*]+$/,                // password placeholders
  /^[A-Za-z0-9!@#$%^&*()_+=.,:;'"?/-]{8,}$/, // sample passwords / compact tokens
  /^[-+~#x()/:\s]*\{\{[^}]+\}\}[-+~#x()/:\s]*(?:\{\{[^}]+\}\}[-+~#x()/:\s]*)*(?:%|h|d|m|km|KB|MB|GB|XP|cr|min|minutes?)?$/i,
  /^\(?\{\{[^}]+\}\}\s*[/–-]\s*\{\{[^}]+\}\}\)?$/,
  /^(?:AGPL|MIT|Apache|GPL|LGPL|BSD)[A-Za-z0-9 .—–©{}-]+.*$/i,
  /^(?:PDF|DOCX?|XLSX?|TXT|CSV|JPG|JPEG|PNG|GIF|SVG)(?:,\s*(?:PDF|DOCX?|XLSX?|TXT|CSV|JPG|JPEG|PNG|GIF|SVG))*.*$/i,
  /^Budget\s*\([€$£]\)$/i,
  /^Name\s*\(optional\)$/i,
  /^Onboarding\s+-\s+Broker$/i,
  /^Capacitor\s+\(iOS\s+\+\s+Android\)$/i,
  /^(?:AI|API|URL|ID|XP|CV|OAuth|GDPR|DSA|FAQ|UTC|HTTP|HTTPS|JSON|CSV|PDF|PNG|JPG|JPEG|WebP|MP4|MOV|WebM|ICS)$/i,
  /^(?:Google|Facebook|Outlook|OpenAI|MariaDB|Meilisearch|Laravel|PHP|React|TypeScript|HeroUI|Tailwind CSS|Firebase Cloud Messaging|Pusher WebSockets|NexusScore|NEXUS|Verein|Vereine|Spitex)(?:\b.*)?$/i,
];
const TITLE_CASE_NO_TRANSLATE_PATTERN = /^[A-Z][A-Za-z0-9+.-]*(?:\s+[A-Z][A-Za-z0-9+.-]*)*(?:\s+v?\d+(?:\.\d+)*(?:\+)?)*$/;

// Strings matching these patterns are skipped by default, but --include-simple
// can still process them when intentionally translating short UI labels.
const SIMPLE_NO_TRANSLATE_PATTERNS = [
  /^[a-zA-Z0-9_]+$/,       // single words / identifiers (likely code values)
];

// Some user-visible values are intentionally identical in every locale: product
// names, protocol labels, currency codes, keyboard shortcuts, and other tokens.
// Keep these explicit so the summary reports actionable translation debt rather
// than repeatedly sending invariant values to a translation provider.
const IDENTICAL_VALUE_ALLOWLIST = new Set([
  '65+',
  '% MRR',
  'Ad hoc',
  'A/B',
  'AWS ECS / Fargate:',
  'EUR (€)',
  'EUR - Euro',
  'EU (EEA)',
  'GBP (£)',
  'Heroku / Render / Fly.io:',
  'Komunitin (JSON:API)',
  'Linux / VPS',
  'Microsoft Azure (hosting, EU)',
  'Ordnance Survey Places (UK, UPRN)',
  'OS Places (PSGA)',
  'Plesk / cPanel / IIS:',
  'Stiftung für das Alter',
  'Tandems <->',
  'Twitter / X',
  'USD ($)',
  'User-agent: *\nDisallow: /admin/',
  'Cloudflare (CDN / WAF)',
  'application.created, shift.completed, hours.logged',
  'bern-cooperative',
  '⌘K',
  'broker@example.com',
  'A-Z',
  '⌘',
  'Project NEXUS',
  'AGPL-3.0 — Copyright © 2024–{{year}} Jasper Ford',
  'you@example.com',
  'P@ssw0rd!',
  '••••••••',
  'XXXX-XXXX',
  'e.g. Acme Corp',
  'e.g. +1 555 123 4567',
  '25–34',
  '35–44',
  '45–54',
  '55–64',
  '∞',
  'Google Gemini',
  'Gmail API',
  'GOCSPX-xxxxx',
  'noreply@example.com',
  'test@example.com',
  'user@example.com',
  'User-agent: *\nDisallow: /admin/',
  'S Gxxxxx...',
  'Smtpexamplecom...',
  'Xxxxappsgoogleusercontentcom...',
  '#',
  '/blog/my-post',
  'hour-timebank',
  'Apache/Plesk',
  'Credit Commons',
  '*',
]);

// Cognates and borrowed technical terms that are valid translations only in the
// listed language. Do not broaden these to every locale.
const LANGUAGE_IDENTICAL_VALUE_ALLOWLIST = {
  de: new Set(['Status:']),
  // 'Café' is the native word in these three, not a copied English value — the
  // curation test finds no locale file where they render English 'Café' as
  // anything else.
  fr: new Set(['Article 9.', 'page.', '{{count}} article', 'Café']),
  pt: new Set(['Café']),
  nl: new Set([
    'Ortsteil (district)',
    'Payload (JSON)',
    'Score (%)',
    'Status:',
    'Tip:',
    '{{count}} routes',
    'Café',
  ]),
};

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const MISSING_ONLY = args.includes('--missing-only');
const FORCE = args.includes('--force');
const INCLUDE_SIMPLE = args.includes('--include-simple');
const INCLUDE_TITLE_CASE = args.includes('--include-title-case');
const INCLUDE_CORE_NAMESPACES = args.includes('--include-core-namespaces');
const TRANSLATE_SKIPPED_MISSING = args.includes('--translate-skipped-missing');
const COPY_SKIPPED_MISSING = args.includes('--copy-skipped-missing');
const USE_GOOGLE = args.includes('--google');
const nsFilter = args.includes('--namespace') ? args[args.indexOf('--namespace') + 1] : null;
const langFilter = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;
const SUMMARY_ONLY = args.includes('--summary');
const SHOW_DETAILS = args.includes('--details');
const concurrencyArg = args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) : 1;
const GOOGLE_CONCURRENCY = Number.isInteger(concurrencyArg)
  ? Math.min(10, Math.max(1, concurrencyArg))
  : 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

function flattenKeys(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      Object.assign(result, flattenKeys(v, key));
    } else {
      result[key] = v;
    }
  }
  return result;
}

function setNestedKey(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) {
      cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function shouldSkipValue(val) {
  if (typeof val !== 'string') return true;
  if (!val.trim()) return true;
  if (HARD_NO_TRANSLATE_PATTERNS.some(p => p.test(val.trim()))) return true;
  if (!INCLUDE_TITLE_CASE && TITLE_CASE_NO_TRANSLATE_PATTERN.test(val.trim())) return true;
  if (isTemplateFragment(val)) return true;
  if (INCLUDE_SIMPLE) {
    return false;
  }
  if (SIMPLE_NO_TRANSLATE_PATTERNS.some(p => p.test(val.trim()))) return true;
  return false;
}

function isAllowedIdenticalValue(lang, val) {
  return IDENTICAL_VALUE_ALLOWLIST.has(val)
    || LANGUAGE_IDENTICAL_VALUE_ALLOWLIST[lang]?.has(val) === true;
}

function isTemplateFragment(val) {
  const text = val.trim();
  if (!text.includes('{{')) return false;

  const withoutTemplates = text.replace(/\{\{[^}]+\}\}/g, ' ');
  const words = withoutTemplates.match(/[A-Za-zÀ-ÿ]+/g) ?? [];
  if (words.length <= 2) return true;

  return words.every(word => [
    'AI',
    'CV',
    'ID',
    'KB',
    'MB',
    'TC',
    'Lv',
    'Ref',
    'Image',
    'Option',
    'Version',
    'Position',
    'Deadline',
    'Interview',
    'Match',
    'Platform',
  ].includes(word));
}

const PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}/g;

// Interpolation variables like {{name}} must survive translation untouched.
// We replace {{var}} with an XML-ish self-closing tag, then restore.
function escapeVars(str) {
  const vars = [];
  const escaped = str.replace(PLACEHOLDER_PATTERN, match => {
    vars.push(match);
    // The tag NAME is a single meaningless letter on purpose. This used to be
    // `<nexus0/>` and Google translated the name itself — `<nexo0/>` in Spanish
    // and Portuguese, `<lien0/>` in French — so restore missed and the
    // placeholder was lost. The same bug cost 207 values in lang/govuk_alpha.php
    // before it was fixed in scripts/translate-php-lang-gaps.mjs (69cf79b77).
    return `<x${vars.length - 1}/>`;
  });
  return { escaped, vars };
}

/**
 * Restore by INDEX, tolerating a translated or re-cased tag name.
 *
 * Even a one-letter name is not safe from every engine and language, so the
 * digits are the identity of the token and the name is decoration. A value that
 * genuinely contains something shaped like `<p0/>` would be mis-restored — but
 * then placeholdersMatch() rejects the result and the English is kept, so the
 * failure mode stays safe either way.
 */
function restoreVars(str, vars) {
  return str.replace(
    /<\s*[A-Za-zÀ-ɏ]{1,10}\s*(\d+)\s*\/?\s*>/g,
    (whole, index) => vars[Number(index)] ?? whole,
  );
}

function placeholderMultiset(text) {
  const counts = new Map();
  for (const match of text.match(PLACEHOLDER_PATTERN) ?? []) {
    counts.set(match, (counts.get(match) ?? 0) + 1);
  }
  return counts;
}

// A dropped or duplicated {{token}} renders as literal text in a member's face.
// A missing translation is recoverable; a broken placeholder is a visible defect,
// so callers keep the English when this returns false.
function placeholdersMatch(english, translated) {
  const left = placeholderMultiset(english);
  const right = placeholderMultiset(translated);
  if (left.size !== right.size) return false;
  for (const [token, count] of left) {
    if (right.get(token) !== count) return false;
  }
  return true;
}

// ── DeepL API ────────────────────────────────────────────────────────────────

async function translateBatchDeepL(texts, targetLang) {
  const BATCH_SIZE = 50;
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const escapedBatch = batch.map(escapeVars);

    const body = new URLSearchParams();
    body.append('auth_key', DEEPL_KEY);
    body.append('source_lang', 'EN');
    body.append('target_lang', targetLang);
    body.append('tag_handling', 'xml');
    body.append('ignore_tags', 'x0,x1,x2,x3,x4,x5,x6,x7,x8,x9');
    escapedBatch.forEach(({ escaped }) => body.append('text', escaped));

    const res = await fetch(DEEPL_URL, { method: 'POST', body });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DeepL API error ${res.status}: ${err}`);
    }
    const data = await res.json();
    data.translations.forEach((t, idx) => {
      results.push(restoreVars(t.text, escapedBatch[idx].vars));
    });

    if (i + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ── OpenAI API ───────────────────────────────────────────────────────────────
// Uses GPT-4o-mini — very fast, cheap (~$0.003 per 1k tokens), high quality.
// Batches up to 30 strings per request as a JSON array to minimise API calls.

const LANG_NAMES = {
  de: 'German', fr: 'French', it: 'Italian', pt: 'Portuguese', es: 'Spanish',
  nl: 'Dutch', pl: 'Polish', ja: 'Japanese', ar: 'Arabic', ga: 'Irish',
};

async function translateBatchOpenAI(texts, targetLangCode, targetLangDeepL) {
  const langName = LANG_NAMES[targetLangCode] || targetLangCode;
  const BATCH_SIZE = 30;
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const escapedBatch = batch.map(escapeVars);
    const toTranslate = escapedBatch.map(b => b.escaped);

    const prompt = `You are a professional translator for a community timebanking platform called Project NEXUS.
Translate the following UI strings from English to ${langName}.
Rules:
- Keep {{variable}} placeholders EXACTLY as-is (do not translate them)
- Keep HTML tags exactly as-is
- Use natural, friendly tone appropriate for a community platform
- Return ONLY a JSON array of translated strings, same order and count as input
- Do not add any explanation or markdown

Input JSON array:
${JSON.stringify(toTranslate, null, 2)}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const content = data.choices[0].message.content;

    let parsed;
    try {
      // Model may return {"translations": [...]} or {"1": "a", "2": "b"} or just [...]
      const obj = JSON.parse(content);
      if (Array.isArray(obj)) {
        parsed = obj;
      } else if (Array.isArray(obj.translations)) {
        parsed = obj.translations;
      } else if (Array.isArray(obj.results)) {
        parsed = obj.results;
      } else {
        // Object.values can return [["a","b","c"]] if one key holds the whole array — flatten one level
        const vals = Object.values(obj);
        parsed = (vals.length === 1 && Array.isArray(vals[0])) ? vals[0] : vals;
      }
    } catch {
      throw new Error(`OpenAI returned non-JSON: ${content.substring(0, 200)}`);
    }

    if (parsed.length !== batch.length) {
      throw new Error(`OpenAI returned ${parsed.length} translations for ${batch.length} inputs`);
    }

    parsed.forEach((t, idx) => {
      results.push(restoreVars(String(t), escapedBatch[idx].vars));
    });

    if (i + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function translateBatchGoogle(texts, targetLangCode) {
  const results = new Array(texts.length);
  let nextIndex = 0;

  async function translateOne(text, attempt = 1) {
    const { escaped, vars } = escapeVars(text);
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'en');
    url.searchParams.set('tl', targetLangCode);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', escaped);

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
        return translateOne(text, attempt + 1);
      }
      throw new Error(`Google Translate error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const translated = Array.isArray(data?.[0])
      ? data[0].map((part) => part?.[0] ?? '').join('')
      : '';
    return restoreVars(translated, vars);
  }

  async function worker() {
    while (nextIndex < texts.length) {
      const index = nextIndex++;
      results[index] = await translateOne(texts[index]);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(GOOGLE_CONCURRENCY, texts.length) },
    () => worker(),
  ));

  return results;
}

async function translateBatch(texts, targetLangCode, targetLangDeepL) {
  if (targetLangCode === 'ga') {
    if (!OPENAI_KEY) {
      throw new Error('Irish translation requires OPENAI_API_KEY; the Google path is not approved for Irish.');
    }
    return translateBatchOpenAI(texts, targetLangCode, targetLangDeepL);
  }

  if (USE_GOOGLE) {
    return translateBatchGoogle(texts, targetLangCode);
  }

  if (USE_OPENAI) {
    return translateBatchOpenAI(texts, targetLangCode, targetLangDeepL);
  }

  if (!targetLangDeepL) {
    throw new Error(`No translation backend is configured for ${targetLangCode}.`);
  }

  return translateBatchDeepL(texts, targetLangDeepL);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!DEEPL_KEY && !OPENAI_KEY && !USE_GOOGLE && !DRY_RUN && !SUMMARY_ONLY) {
    console.error('❌  No translation API key found.');
    console.error('   Option A (recommended): get a FREE DeepL key at https://www.deepl.com/pro-api');
    console.error('   Then run: DEEPL_API_KEY=your_key node scripts/translate-i18n-gaps.mjs');
    console.error('   Option B: set OPENAI_API_KEY in your environment (uses GPT-4o-mini)');
    console.error('   Option C: pass --google to use Google Translate without storing an API key');
    process.exit(1);
  }

  const backend = USE_GOOGLE ? 'Google Translate public endpoint' : (USE_OPENAI ? 'OpenAI GPT-4o-mini' : 'DeepL');
  if (!DRY_RUN && !SUMMARY_ONLY) {
    console.log(`🔑 Using translation backend: ${backend}`);
  }

  const enDir = path.join(LOCALES_DIR, 'en');
  const enFiles = fs.readdirSync(enDir).filter(f => f.endsWith('.json'));
  const languages = SUPPORTED_LANGUAGES;

  let totalGaps = 0;
  let totalTranslated = 0;
  let totalSkipped = 0;
  let totalRejected = 0;

  const langs = langFilter ? [langFilter] : languages;

  for (const lang of langs) {
    if (langFilter && lang !== langFilter) continue;
    const deeplCode = LANG_MAP[lang];
    if (lang === 'ga' && !OPENAI_KEY && !SUMMARY_ONLY && !DRY_RUN) {
      console.log('⚠️  ga: OPENAI_API_KEY is not set — skipping (Google is not approved for Irish)');
      continue;
    }
    if (!deeplCode && !OPENAI_KEY && !USE_GOOGLE && !SUMMARY_ONLY && !DRY_RUN) {
      console.log(`⚠️  ${lang}: No translation backend available — skipping`);
      continue;
    }

    const langDir = path.join(LOCALES_DIR, lang);
    if (!fs.existsSync(langDir)) fs.mkdirSync(langDir, { recursive: true });

    for (const file of enFiles) {
      if (!INCLUDE_CORE_NAMESPACES && SKIP_NAMESPACES.has(file)) continue;
      if (nsFilter && !file.includes(nsFilter)) continue;

      const enPath = path.join(enDir, file);
      const langPath = path.join(langDir, file);

      const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
      const langData = fs.existsSync(langPath)
        ? JSON.parse(fs.readFileSync(langPath, 'utf8'))
        : {};

      const enFlat = flattenKeys(enData);
      const langFlat = flattenKeys(langData);

      // Find keys that need translation:
      // - Missing entirely (key absent from language file)
      // - Value is identical to English (gap-fill fallback — not yet translated)
      // - --force: re-translate even strings that already differ from English
      const keysToTranslate = [];
      const keysToCopy = [];
      for (const [key, enVal] of Object.entries(enFlat)) {
        if (typeof enVal !== 'string') continue;
        const langVal = langFlat[key];
        // New namespaces still need exact key parity. Some legitimate UI strings
        // (for example "Version {{version}}" or "Online") resemble protected
        // tokens and used to be silently omitted while --summary reported zero
        // gaps. This opt-in translates only those ABSENT values; it never
        // rewrites an existing protected token.
        if (shouldSkipValue(enVal)
          && !(TRANSLATE_SKIPPED_MISSING && langVal === undefined)) {
          if (COPY_SKIPPED_MISSING && langVal === undefined) keysToCopy.push({ key, enVal });
          continue;
        }
        const needsTranslation =
          langVal === undefined ||   // missing
          (!MISSING_ONLY && langVal === enVal && !isAllowedIdenticalValue(lang, enVal)) ||
          FORCE;                     // --force re-translates everything

        if (needsTranslation) {
          keysToTranslate.push({ key, enVal });
        }
      }

      if (keysToTranslate.length === 0 && keysToCopy.length === 0) continue;

      totalGaps += keysToTranslate.length;

      if (SUMMARY_ONLY) {
        console.log(`  ${lang}/${file}: ${keysToTranslate.length} gaps`);
        if (SHOW_DETAILS) {
          keysToTranslate.forEach(({ key, enVal }) => {
            console.log(`    ${key}: ${JSON.stringify(enVal)}`);
          });
        }
        continue;
      }

      console.log(`\n🌍 Translating ${lang}/${file} (${keysToTranslate.length} strings → ${deeplCode})...`);

      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would translate ${keysToTranslate.length} strings`);
        keysToTranslate.slice(0, 3).forEach(({ key, enVal }) => {
          console.log(`   "${key}": "${enVal.substring(0, 60)}${enVal.length > 60 ? '...' : ''}"`);
        });
        if (keysToTranslate.length > 3) console.log(`   ... and ${keysToTranslate.length - 3} more`);
        totalSkipped += keysToTranslate.length;
        continue;
      }

      try {
        const translated = keysToTranslate.length > 0 ? await translateBatch(
          keysToTranslate.map(k => k.enVal),
          lang,
          deeplCode
        ) : [];

        // Merge translations back into langData. Every value is checked here
        // rather than inside a backend, so Google, DeepL and OpenAI are all
        // covered by the same gate.
        const updated = JSON.parse(JSON.stringify(langData)); // deep clone
        const rejected = [];
        keysToTranslate.forEach(({ key, enVal }, idx) => {
          const candidate = translated[idx];
          if (typeof candidate === 'string' && placeholdersMatch(enVal, candidate)) {
            setNestedKey(updated, key, candidate);
            return;
          }
          // Keep the English: the key still exists so parity holds and the
          // untranslated-value gates can still see it, whereas a mangled
          // placeholder would ship as literal text.
          setNestedKey(updated, key, enVal);
          rejected.push({ key, english: enVal, got: candidate });
        });
        keysToCopy.forEach(({ key, enVal }) => {
          setNestedKey(updated, key, enVal);
        });

        // Preserve key order from EN file
        const ordered = {};
        function orderLike(enObj, targetObj, result) {
          for (const key of Object.keys(enObj)) {
            if (key in targetObj) {
              if (typeof enObj[key] === 'object' && enObj[key] !== null && !Array.isArray(enObj[key])) {
                result[key] = {};
                orderLike(enObj[key], targetObj[key] || {}, result[key]);
              } else {
                result[key] = targetObj[key];
              }
            }
          }
          // Keep any extra keys in target not in EN
          for (const key of Object.keys(targetObj)) {
            if (!(key in result)) result[key] = targetObj[key];
          }
        }
        orderLike(enData, updated, ordered);

        if (!DRY_RUN) {
          fs.writeFileSync(langPath, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
        }

        totalTranslated += keysToTranslate.length - rejected.length;
        totalRejected += rejected.length;
        console.log(`   ✅ ${keysToTranslate.length - rejected.length} strings translated`);
        if (rejected.length > 0) {
          console.log(`   ⚠️  ${rejected.length} kept as English — placeholder mismatch:`);
          rejected.slice(0, 5).forEach(({ key, english, got }) => {
            console.log(`      ${key}`);
            console.log(`        en:  ${JSON.stringify(english)}`);
            console.log(`        got: ${JSON.stringify(got)}`);
          });
          if (rejected.length > 5) console.log(`      ... and ${rejected.length - 5} more`);
        }
      } catch (err) {
        console.error(`   ❌ Failed: ${err.message}`);
        totalSkipped += keysToTranslate.length;
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  if (SUMMARY_ONLY) {
    console.log(`📊 Total gaps found: ${totalGaps}`);
    console.log(`   Affected languages: ${langs.filter(l => SUPPORTED_LANGUAGES.includes(l)).join(', ')}`);
    console.log(`   Irish (ga) uses OpenAI when OPENAI_API_KEY is available`);
  } else if (DRY_RUN) {
    console.log(`📊 Dry run complete: ${totalGaps} strings would be translated`);
  } else {
    console.log(`📊 Done: ${totalTranslated} strings translated, ${totalSkipped} skipped`);
    if (totalRejected > 0) {
      console.log(`⚠️  ${totalRejected} kept as English because the {{placeholder}} set did not survive translation`);
    }
    if (totalTranslated > 0) {
      console.log('\nNext steps:');
      console.log('  1. Review a sample of translations: git diff react-frontend/public/locales/');
      console.log('  2. Run the drift check: node scripts/check-i18n-drift.mjs --summary');
      console.log('  3. Commit: git add react-frontend/public/locales/ && git commit -m "i18n: machine-translate user-facing strings via DeepL"');
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
