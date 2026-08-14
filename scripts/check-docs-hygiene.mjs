#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const root = process.cwd();
const docsDir = path.join(root, 'docs');
const docsPublicDir = path.join(root, 'docs-public');
const docsIndex = path.join(docsDir, 'README.md');
const docsPublicIndex = path.join(docsPublicDir, 'README.md');
const mkdocsConfig = path.join(root, 'mkdocs.yml');
const maxDocBytes = 80 * 1024;
const maxReviewAgeDays = 180;

const allowedExtensions = new Set(['.md']);
const blockedDirectories = new Set([
  'archive',
  'audits',
  'council-pilot',
  'handoffs',
  'legal',
  'parity-briefs',
  'plans',
  'pricing',
  'prompts',
  'reports',
  'superpowers',
]);

const blockedNamePattern = /(^|[-_.])(allnighter|audit|draft|handoff|morning|overnight|plan|prompt|report|scratch|tmp|tracker)([-_.]|$)/i;
const blockedContentPatterns = [
  { pattern: /C:\\ssh/i, reason: 'machine-local SSH key path' },
  { pattern: /C:\\Users\\/i, reason: 'machine-local Windows user path' },
  { pattern: /\b20\.224\.\d{1,3}\.\d{1,3}\b/, reason: 'production IP address' },
  { pattern: /funding@hour-timebank\.ie/i, reason: 'private contact email' },
  { pattern: /jasper@hour-timebank\.ie/i, reason: 'private contact email' },
  { pattern: /\bDB_PASS=\$\(/i, reason: 'production credential extraction snippet' },
  { pattern: /docs\/?\s+is\s+gitignored/i, reason: 'stale docs gitignore statement' },
  { pattern: /private,\s*dev machine/i, reason: 'private-dev-machine label in public docs' },
  { pattern: /PRODUCTION-READINESS/i, reason: 'reference to archived production-readiness notes' },
  { pattern: /docs\/(ROADMAP|LOCAL_DEV_SETUP|PHP_CONVENTIONS|API_REFERENCE|REGRESSION_PREVENTION|QA_AUDIT_AND_TEST_PLAN)\.md/i, reason: 'reference to retired docs' },
  { pattern: /\bNexus\\/i, reason: 'retired Nexus PHP namespace' },
  { pattern: /\bsrc\/(Services|Core|Controllers)\//i, reason: 'retired top-level PHP src path' },
  { pattern: /\bReact 18\b/i, reason: 'stale React version' },
  { pattern: /\bFramer Motion\b/i, reason: 'removed animation dependency' },
  { pattern: /\bHeroUI v2\b/i, reason: 'stale HeroUI version' },
  { pattern: /\bnginx\b/i, reason: 'stale web-server claim; Project NEXUS production uses Apache' },
  { pattern: /confidential and intended for/i, reason: 'confidentiality notice in public documentation' },
  { pattern: /^\s*<\/?content>\s*$/im, reason: 'stray content wrapper artifact' },
];

const secretPatterns = [
  { pattern: /\b[A-Z0-9_]*(?:PASSWORD|API_KEY|SECRET|TOKEN)[A-Z0-9_]*\s*=\s*(?!<|\$\{|your-|example|secret\b)[^\s'"]{8,}/i, reason: 'secret-like assignment' },
  { pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----/, reason: 'private key material' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: 'AWS access key shape' },
  { pattern: /\bghp_[A-Za-z0-9_]{20,}\b/, reason: 'GitHub token shape' },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/, reason: 'API key shape' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, reason: 'Slack token shape' },
];

const publicMarkdownFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'CONTRIBUTOR_TERMS.md',
  'CONTRIBUTORS.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'AGENTS.md',
  'LARAVEL_MIGRATION_PLAN.md',
  // `accessible-frontend/README.md` and `COMPONENTS.md` were listed here and were
  // removed on 2026-08-14 with the Blade accessible frontend. Harmless in this
  // list (it is existsSync-filtered), but see scopedDocumentationIndexes below —
  // the same directory in THAT list was not optional and failed the check.
  'mobile/README.md',
  'mobile/.maestro/README.md',
  'mobile/docs/ALERT_MIGRATION_PLAYBOOK.md',
  'mobile/docs/DISTRIBUTION.md',
  'mobile/docs/HEROUI_NATIVE_PARITY_AUDIT.md',
  'mobile/docs/NATIVE_UI_CONTRACT.md',
  'mobile/docs/SECURITY.md',
  'mobile/docs/WRAPPER_POLICY.md',
  'tests/README.md',
  'tests/Core/README.md',
  'e2e/README.md',
  'e2e/docs/REACT_ROUTES_REFERENCE.md',
];

const scopedDocumentationIndexes = [
  // 🔴 An `accessible-frontend/` entry was HERE and was removed on 2026-08-14 with
  // the Blade accessible frontend. Unlike publicMarkdownPaths above, this list is
  // NOT existsSync-filtered — checkScopedDocumentationIndexes() reports
  // "scoped documentation index is missing" for an absent index and the script
  // then exits 1. So leaving it behind made `npm run check:docs` (and the
  // docs-lint workflow) impossible to pass.
  {
    index: 'mobile/README.md',
    prefix: 'mobile/',
  },
  {
    index: 'e2e/README.md',
    prefix: 'e2e/',
  },
  {
    index: 'tests/README.md',
    prefix: 'tests/',
  },
];

const issues = [];

function trackedFiles() {
  try {
    return new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => toPosix(file)));
  } catch {
    return new Set();
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function addIssue(filePath, message) {
  issues.push(`${toPosix(path.relative(root, filePath))}: ${message}`);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkLastReviewedMarker(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const nearTop = text.split(/\r?\n/).slice(0, 10).join('\n');
  const reviewMatch = nearTop.match(/^Last reviewed: (\d{4}-\d{2}-\d{2})$/m);
  if (!reviewMatch) {
    addIssue(filePath, 'missing a near-top "Last reviewed: YYYY-MM-DD" marker (must appear within the first 10 lines)');
    return;
  }

  const reviewDate = new Date(`${reviewMatch[1]}T00:00:00Z`);
  if (Number.isNaN(reviewDate.valueOf()) || reviewDate.toISOString().slice(0, 10) !== reviewMatch[1]) {
    addIssue(filePath, `has an invalid Last reviewed date: ${reviewMatch[1]}`);
    return;
  }

  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDays = Math.floor((todayUtc - reviewDate.valueOf()) / (24 * 60 * 60 * 1000));
  if (ageDays < -1) {
    addIssue(filePath, `has a future Last reviewed date: ${reviewMatch[1]}`);
  } else if (ageDays > maxReviewAgeDays) {
    addIssue(filePath, `Last reviewed date is ${ageDays} days old; re-check the page against source at least every ${maxReviewAgeDays} days`);
  }
}

function checkDocsTree(files) {
  const indexText = fs.readFileSync(docsIndex, 'utf8');

  for (const filePath of files) {
    const relativeToDocs = toPosix(path.relative(docsDir, filePath));
    const extension = path.extname(filePath).toLowerCase();
    const parts = relativeToDocs.split('/');
    const stats = fs.statSync(filePath);

    if (!allowedExtensions.has(extension)) {
      addIssue(filePath, `only Markdown docs are allowed in docs/; found ${extension || 'no extension'}`);
    }

    for (const part of parts.slice(0, -1)) {
      if (blockedDirectories.has(part.toLowerCase())) {
        addIssue(filePath, `directory "${part}" is reserved for local/archive material, not public docs`);
      }
    }

    if (blockedNamePattern.test(path.basename(filePath))) {
      addIssue(filePath, 'filename looks like task output; put prompts, plans, handoffs, audits, reports, and trackers in .local-docs-archive/');
    }

    if (stats.size > maxDocBytes) {
      addIssue(filePath, `file is ${stats.size} bytes; public docs should stay under ${maxDocBytes} bytes or be split/curated`);
    }

    if (relativeToDocs !== 'README.md' && !indexText.includes(relativeToDocs)) {
      addIssue(filePath, 'not linked from docs/README.md; every public doc must be indexed');
    }

    const text = fs.readFileSync(filePath, 'utf8');
    if (extension === '.md') {
      checkLastReviewedMarker(filePath);
    }

    for (const { pattern, reason } of [...blockedContentPatterns, ...secretPatterns]) {
      if (pattern.test(text)) {
        addIssue(filePath, `contains ${reason}`);
      }
    }
  }
}

function checkDocsPublicIndex(files) {
  if (!fs.existsSync(docsPublicIndex)) {
    addIssue(docsPublicIndex, 'docs-public/README.md is missing');
    return;
  }

  const indexText = fs.readFileSync(docsPublicIndex, 'utf8');
  for (const filePath of files) {
    const relativeToDocsPublic = toPosix(path.relative(docsPublicDir, filePath));
    const extension = path.extname(filePath).toLowerCase();

    if (relativeToDocsPublic === 'README.md') continue;
    if (!['.md', '.html', '.json', '.yml', '.yaml'].includes(extension)) continue;

    if (!indexText.includes(relativeToDocsPublic)) {
      addIssue(filePath, 'not linked from docs-public/README.md; public collateral must be indexed');
    }
  }
}

function extractMarkdownLinks(text) {
  const links = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    links.push(match[1].trim());
  }

  return links;
}

function scopedDocuments(scope, repositoryFiles) {
  const excluded = new Set(scope.excluded ?? []);
  return [...repositoryFiles]
    .filter((relativePath) => relativePath.startsWith(scope.prefix))
    .filter((relativePath) => relativePath.endsWith('.md'))
    .filter((relativePath) => relativePath !== scope.index)
    .filter((relativePath) => !excluded.has(relativePath))
    .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
    .sort();
}

function checkScopedDocumentationIndexes(scopedDocumentsByIndex) {
  for (const scope of scopedDocumentationIndexes) {
    const indexPath = path.join(root, scope.index);
    if (!fs.existsSync(indexPath)) {
      addIssue(indexPath, 'scoped documentation index is missing');
      continue;
    }

    const linkedTargets = new Set();
    for (let target of extractMarkdownLinks(fs.readFileSync(indexPath, 'utf8'))) {
      if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1);
      }
      if (isExternalOrAnchor(target)) continue;
      const targetWithoutAnchor = target.split('#')[0];
      if (!targetWithoutAnchor) continue;
      linkedTargets.add(path.resolve(path.dirname(indexPath), targetWithoutAnchor));
    }

    for (const document of scopedDocumentsByIndex.get(scope.index) ?? []) {
      const documentPath = path.join(root, document);
      if (!linkedTargets.has(path.resolve(documentPath))) {
        addIssue(documentPath, `not linked from its scoped index ${scope.index}`);
      }
    }
  }
}

function isExternalOrAnchor(target) {
  return /^(https?:|mailto:|tel:|#)/i.test(target);
}

function checkLocalLinks(files) {
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;

    const text = fs.readFileSync(filePath, 'utf8');
    for (let target of extractMarkdownLinks(text)) {
      if (target.startsWith('<') && target.endsWith('>')) {
        target = target.slice(1, -1);
      }

      if (isExternalOrAnchor(target)) continue;

      const targetWithoutAnchor = target.split('#')[0];
      if (!targetWithoutAnchor || path.isAbsolute(targetWithoutAnchor)) continue;

      const resolved = path.resolve(path.dirname(filePath), targetWithoutAnchor);
      if (!resolved.startsWith(root + path.sep)) {
        addIssue(filePath, `link points outside repository: ${target}`);
        continue;
      }

      if (!fs.existsSync(resolved)) {
        addIssue(filePath, `broken local link: ${target}`);
      }
    }
  }
}

function checkTextPatterns(files) {
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const { pattern, reason } of [...blockedContentPatterns, ...secretPatterns]) {
      if (pattern.test(text)) {
        addIssue(filePath, `contains ${reason}`);
      }
    }
  }
}

function checkTrackedRootArtifacts(tracked) {
  const allowedRootMarkdown = new Set([
    'AGENTS.md',
    'CHANGELOG.md',
    'CLAUDE.md',
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'CONTRIBUTORS.md',
    'CONTRIBUTOR_TERMS.md',
    'GOVERNANCE.md',
    'LARAVEL_MIGRATION_PLAN.md',
    'README.md',
    'RELEASES.md',
    'SECURITY.md',
    'SUPPORT.md',
    'THIRD_PARTY_LICENSES.md',
    'THIRD_PARTY_NOTICES.md',
  ]);

  for (const relativePath of tracked) {
    if (!fs.existsSync(path.join(root, relativePath))) continue;
    if (relativePath.includes('/')) continue;
    const extension = path.extname(relativePath).toLowerCase();
    const basename = path.basename(relativePath);

    if (extension === '.md' && !allowedRootMarkdown.has(basename)) {
      addIssue(path.join(root, relativePath), 'root Markdown is not a maintained public entrypoint; move task output to docs/ or .local-docs-archive/');
    }

    if (extension === '.txt' && !['VERSION'].includes(basename)) {
      addIssue(path.join(root, relativePath), 'root text artifact is not maintained documentation; remove generated output from the public repo');
    }

    // Maintained root config files whose names collide with the task-artifact
    // pattern (e.g. "audit" in the npm-audit exception list — the .trivyignore
    // counterpart consumed by scripts/npm-audit-gate.mjs in CI).
    const allowedRootConfig = new Set(['.npm-audit-exceptions.json']);

    if (/(^|[-_.])(audit|handoff|plan|prompt|report|scratch|tmp|tracker)([-_.]|$)/i.test(basename)
      && !allowedRootMarkdown.has(basename)
      && !allowedRootConfig.has(basename)) {
      addIssue(path.join(root, relativePath), 'tracked root task artifact should not be public documentation');
    }
  }
}

function checkTrackedLocalArchive(tracked) {
  for (const relativePath of tracked) {
    if (relativePath !== '.local-docs-archive'
      && !relativePath.startsWith('.local-docs-archive/')) continue;

    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) continue;
    addIssue(filePath, 'tracked local/archive material must be removed from Git; .local-docs-archive/ is intentionally gitignored');
  }
}

function checkMkDocsNavigation(files) {
  if (!fs.existsSync(mkdocsConfig)) {
    addIssue(mkdocsConfig, 'MkDocs configuration is missing');
    return;
  }

  const configText = fs.readFileSync(mkdocsConfig, 'utf8');
  const navStart = configText.search(/^nav:\s*$/m);
  if (navStart === -1) {
    addIssue(mkdocsConfig, 'nav section is missing; every maintained document must be discoverable in the built site');
    return;
  }

  const navText = configText.slice(navStart);
  const navEntries = new Map();
  const navPattern = /:\s*["']?([^\s"'#]+\.md)["']?\s*(?:#.*)?$/gm;
  let match;
  while ((match = navPattern.exec(navText)) !== null) {
    const relativePath = toPosix(match[1]);
    navEntries.set(relativePath, (navEntries.get(relativePath) ?? 0) + 1);
  }

  for (const filePath of files) {
    if (path.extname(filePath).toLowerCase() !== '.md') continue;
    const relativeToDocs = toPosix(path.relative(docsDir, filePath));
    if (!navEntries.has(relativeToDocs)) {
      addIssue(filePath, 'not listed in mkdocs.yml nav; every maintained document must be published and discoverable');
    }
  }

  for (const [relativePath, count] of navEntries) {
    const target = path.join(docsDir, relativePath);
    if (!fs.existsSync(target)) {
      addIssue(mkdocsConfig, `nav references missing document: ${relativePath}`);
    }
    if (count > 1) {
      addIssue(mkdocsConfig, `nav lists ${relativePath} ${count} times`);
    }
  }
}

if (!fs.existsSync(docsDir)) {
  console.error('docs/ directory is missing.');
  process.exit(1);
}

if (!fs.existsSync(docsIndex)) {
  console.error('docs/README.md is missing.');
  process.exit(1);
}

const docsFiles = walk(docsDir);
const publicCollateralTextFiles = fs.existsSync(docsPublicDir)
  ? walk(docsPublicDir).filter((file) => ['.md', '.html', '.json', '.yml', '.yaml'].includes(path.extname(file).toLowerCase()))
  : [];
const tracked = trackedFiles();
const scopedDocumentsByIndex = new Map(scopedDocumentationIndexes.map((scope) => [
  scope.index,
  scopedDocuments(scope, tracked),
]));
const scopedReviewedRelativePaths = [...new Set(scopedDocumentationIndexes.flatMap((scope) => [
  scope.index,
  ...(scopedDocumentsByIndex.get(scope.index) ?? []),
]))];
const publicMarkdownPaths = [...new Set([
  ...publicMarkdownFiles,
  ...scopedReviewedRelativePaths,
])]
  .map((file) => path.join(root, file))
  .filter((file) => fs.existsSync(file));
const scopedReviewedMarkdownPaths = scopedReviewedRelativePaths
  .map((file) => path.join(root, file))
  .filter((file) => fs.existsSync(file));
const linkCheckFiles = [
  ...publicMarkdownPaths,
  ...docsFiles.filter((file) => path.extname(file).toLowerCase() === '.md'),
  ...publicCollateralTextFiles.filter((file) => path.extname(file).toLowerCase() === '.md'),
];

checkDocsTree(docsFiles);
checkMkDocsNavigation(docsFiles);
checkDocsPublicIndex(publicCollateralTextFiles);
checkScopedDocumentationIndexes(scopedDocumentsByIndex);
for (const filePath of scopedReviewedMarkdownPaths) {
  checkLastReviewedMarker(filePath);
}
for (const filePath of publicCollateralTextFiles.filter((file) => path.extname(file).toLowerCase() === '.md')) {
  checkLastReviewedMarker(filePath);
}
checkTextPatterns(publicCollateralTextFiles);
checkTextPatterns([
  path.join(root, 'NOTICE'),
  path.join(root, 'CONTRIBUTING.md'),
  path.join(root, 'CONTRIBUTOR_TERMS.md'),
  ...publicMarkdownPaths.filter((file) => !file.endsWith(`${path.sep}AGENTS.md`) && !file.endsWith(`${path.sep}CLAUDE.md`)),
]);
checkLocalLinks(linkCheckFiles);
checkTrackedRootArtifacts(tracked);
checkTrackedLocalArchive(tracked);

if (issues.length > 0) {
  console.error('Documentation hygiene check failed:');
  for (const issue of issues.sort()) {
    console.error(`- ${issue}`);
  }
  console.error('');
  console.error('Routine prompts, scratch plans, handoffs, audits, generated reports, PDFs, and private notes belong in .local-docs-archive/, not docs/.');
  process.exit(1);
}

console.log(`Documentation hygiene OK (${docsFiles.length} docs files, ${scopedReviewedMarkdownPaths.length} scoped guides, ${publicCollateralTextFiles.length} public collateral files checked).`);
