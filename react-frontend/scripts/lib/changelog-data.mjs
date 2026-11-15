// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * changelog-data.mjs
 *
 * Turns CHANGELOG.md into the small data files the in-app /changelog page
 * reads: one index of releases, and one file per release holding that
 * release's entries. Pure functions only — no file access — so the page's
 * tests can run the same code against the real CHANGELOG.md.
 *
 * Why this exists: the page used to download the whole file (3.78 MB, 5,186
 * entries on 15 Nov 2026) and print it as one page. Splitting by release at
 * build time lets the page open with a short list and fetch a release only
 * when someone opens it.
 *
 * What counts as what:
 *
 *   ## [3.2.0] - 2026-11-12   a release (also `## [Unreleased]`)
 *   ## Project history        any other `## ` heading ENDS the releases. The
 *                             accessible site's splitter only looks for
 *                             `## [`, which is why its oldest release page
 *                             carries "Project history" and "Support".
 *   ### Added                 a section; the same heading twice in one
 *                             release is merged into one section
 *   #### Laravel 12 Migration a group label carried on the entries under it
 *   - **Title**: detail       an entry, with its indented continuation lines
 *   loose paragraph           before the first entry of a release: the
 *                             release's intro. After an entry: part of that
 *                             entry's detail. Nothing is dropped.
 */

const REPO_BLOB = 'https://github.com/jasperfordesq-ai/Project-NEXUS/blob/main/';

const RELEASE_HEADING = /^##\s+\[([^\]]+)\](?:\s*[-–]\s*(.+?))?\s*$/;
const OTHER_H2 = /^##(?!#)/;
const SECTION_HEADING = /^###(?!#)\s*(.+?)\s*$/;
const GROUP_HEADING = /^####+\s*(.+?)\s*$/;
const LINK_DEFINITION = /^\[([^\]]+)\]:\s*(\S+)\s*$/;
const RULE = /^-{3,}\s*$/;
const RELATIVE_FILE = /^[\w./-]+\.(?:md|mdx|txt|json|ya?ml|php|tsx?|jsx?|mjs|sh)(?:#[\w-]+)?$/i;

/** Markdown reduced to the words a reader sees, on one line. */
export function plainText(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Links to files in the repository only work on GitHub, so point them there. */
export function absoluteLinks(markdown) {
  return markdown.replace(/\]\(([^)\s]+)\)/g, (match, target) =>
    RELATIVE_FILE.test(target) ? `](${REPO_BLOB}${target.replace(/^\.\//, '')})` : match,
  );
}

export function slugFor(version) {
  return version
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sectionType(label) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'other'
  );
}

const ABBREVIATION = /(?:\be\.g|\bi\.e|\bvs|\bno|\bapprox)$/i;

/**
 * Where the first sentence of `text` ends (the index just past it), or
 * `text.length` when the text is one sentence. A full stop inside backticks
 * (`file.ts`) or without a space after it (v3.2.0) does not end a sentence;
 * a blank line or the start of a nested list always does.
 */
export function firstSentenceEnd(text) {
  let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '`') {
      inCode = !inCode;
      continue;
    }
    if (ch === '\n') {
      const after = text.slice(i + 1);
      if (after.startsWith('\n') || /^\s*[-*] /.test(after)) return i;
      continue;
    }
    if (inCode || i < 15) continue;
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = text[i + 1];
      const endsHere = next === undefined || /\s/.test(next);
      if (endsHere && !(ch === '.' && ABBREVIATION.test(text.slice(0, i)))) return i + 1;
    }
  }
  return text.length;
}

/**
 * Split one entry into the short title shown in the list and the detail shown
 * when it is opened. Most entries (71% on 15 Nov 2026) open with a bold run
 * that is already a title; the rest get their first sentence.
 */
export function splitEntry(text) {
  let rest = text.trim();
  let breaking = false;

  const marker = /^\*\*BREAKING:?\*\*:?\s*/i.exec(rest);
  if (marker) {
    breaking = true;
    rest = rest.slice(marker[0].length);
  }

  const bold = /^\*\*([\s\S]+?)\*\*/.exec(rest);
  const boldTitle = bold ? plainText(bold[1]).replace(/[.:]+$/, '').trim() : '';
  if (bold && boldTitle) {
    // "**Title**: the detail…" reads on from its title in the file. On the
    // page the detail stands on its own under the title, so it starts with a
    // capital. Only an ordinary lower-case word is touched: `code`, "iOS" and
    // the like are left as written.
    const body = rest
      .slice(bold[0].length)
      .replace(/^[ \t]*(?::|—|–)?\s*/, '')
      .replace(/^[a-z](?=[a-z]*[\s,])/, (first) => first.toUpperCase());
    return { title: boldTitle, body: absoluteLinks(body.trim()), breaking };
  }

  const end = firstSentenceEnd(rest);
  const title = plainText(rest.slice(0, end)).replace(/:+$/, '').trim();
  const body = rest.slice(end).trim();
  if (!title) return { title: plainText(rest), body: '', breaking };
  return { title, body: absoluteLinks(body), breaking };
}

/**
 * Parse the whole changelog.
 *
 * @param {string} markdown
 * @returns {{ releases: Array<object> }}
 */
export function parseChangelog(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  const compareUrls = new Map();
  for (const line of lines) {
    const definition = LINK_DEFINITION.exec(line);
    if (definition && /^https?:\/\//.test(definition[2])) {
      compareUrls.set(definition[1].toLowerCase(), definition[2]);
    }
  }

  const releases = [];
  const slugs = new Set();
  let release = null;
  let section = null;
  let group = null;
  let lastEntry = null;
  /** @type {{ kind: 'entry' | 'paragraph', lines: string[] } | null} */
  let block = null;

  const sectionFor = (label) => {
    const type = sectionType(label);
    let found = release.sections.find((candidate) => candidate.type === type);
    if (!found) {
      found = { type, label, entries: [] };
      release.sections.push(found);
    }
    return found;
  };

  const flush = () => {
    if (!block || !release) {
      block = null;
      return;
    }
    const text = block.lines.join('\n').trim();
    const kind = block.kind;
    block = null;
    if (!text) return;

    if (kind === 'entry') {
      const entry = splitEntry(text);
      if (group) entry.group = group;
      if (!entry.breaking) delete entry.breaking;
      (section ?? (section = sectionFor('Other'))).entries.push(entry);
      lastEntry = entry;
      return;
    }

    const paragraph = absoluteLinks(text);
    if (lastEntry) {
      lastEntry.body = lastEntry.body ? `${lastEntry.body}\n\n${paragraph}` : paragraph;
    } else {
      release.intro = release.intro ? `${release.intro}\n\n${paragraph}` : paragraph;
    }
  };

  for (const line of lines) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      flush();
      const version = heading[1].trim();
      const slug = slugFor(version);
      if (!slug || slugs.has(slug)) {
        throw new Error(`changelog-data: release "${version}" has an empty or repeated slug "${slug}"`);
      }
      slugs.add(slug);
      release = {
        version,
        slug,
        date: (heading[2] ?? '').trim(),
        isUnreleased: /^unreleased$/i.test(version),
        compareUrl: compareUrls.get(version.toLowerCase()) ?? null,
        intro: '',
        sections: [],
      };
      releases.push(release);
      section = null;
      group = null;
      lastEntry = null;
      continue;
    }

    if (OTHER_H2.test(line)) {
      flush();
      release = null;
      continue;
    }
    if (!release) continue;

    if (RULE.test(line)) {
      flush();
      continue;
    }

    const sectionHeading = SECTION_HEADING.exec(line);
    if (sectionHeading) {
      flush();
      section = sectionFor(plainText(sectionHeading[1]));
      group = null;
      continue;
    }

    const groupHeading = GROUP_HEADING.exec(line);
    if (groupHeading) {
      flush();
      group = plainText(groupHeading[1]);
      continue;
    }

    if (line.startsWith('- ')) {
      flush();
      block = { kind: 'entry', lines: [line.slice(2)] };
      continue;
    }

    if (line.trim() === '') {
      if (block) block.lines.push('');
      continue;
    }

    if (/^\s/.test(line)) {
      // Indented: a wrapped line or a nested bullet of the entry above.
      if (block) block.lines.push(line.replace(/^ {1,2}/, ''));
      else block = { kind: 'paragraph', lines: [line.trim()] };
      continue;
    }

    // Unindented text. Directly under a line of the block above it is a
    // continuation (markdown's "lazy" continuation); after a blank line it
    // starts a paragraph of its own.
    const previous = block ? block.lines[block.lines.length - 1] : '';
    if (block && previous !== '') {
      block.lines.push(line);
    } else {
      flush();
      block = { kind: 'paragraph', lines: [line] };
    }
  }
  flush();

  return { releases };
}

/** The list the page opens with: every release, its counts, and no entry text. */
export function buildIndex(parsed) {
  return {
    releases: parsed.releases.map((release) => {
      const counts = release.sections.map((section) => ({
        type: section.type,
        label: section.label,
        count: section.entries.length,
      }));
      return {
        version: release.version,
        slug: release.slug,
        date: release.date,
        isUnreleased: release.isUnreleased,
        compareUrl: release.compareUrl,
        total: counts.reduce((sum, item) => sum + item.count, 0),
        counts,
      };
    }),
  };
}
