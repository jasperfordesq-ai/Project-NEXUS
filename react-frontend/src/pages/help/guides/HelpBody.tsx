// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Renders a Help Centre article body.
 *
 * Article bodies are translated strings, so they use a deliberately tiny
 * format that translators can keep intact — and that is rendered as React
 * elements, never as HTML:
 *
 *   blank line      new paragraph
 *   ## Heading      subheading
 *   - item          bulleted list
 *   1. step         numbered steps
 *   > note          highlighted tip
 *   **text**        bold (on-screen labels)
 *   [text](/path)   link to a page in this app (internal paths only)
 */

import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Lightbulb from 'lucide-react/icons/lightbulb';
import { useTenant } from '@/contexts';

type LineKind = 'heading' | 'bullet' | 'step' | 'tip' | 'text' | 'blank';

interface Block {
  kind: Exclude<LineKind, 'blank'>;
  lines: string[];
}

function classify(line: string): LineKind {
  if (line.trim() === '') return 'blank';
  if (/^##\s+/.test(line)) return 'heading';
  if (/^\s*[-•]\s+/.test(line)) return 'bullet';
  if (/^\s*\d+[.)]\s+/.test(line)) return 'step';
  if (/^\s*>\s?/.test(line)) return 'tip';
  return 'text';
}

function stripMarker(kind: Block['kind'], line: string): string {
  switch (kind) {
    case 'heading': return line.replace(/^##\s+/, '');
    case 'bullet': return line.replace(/^\s*[-•]\s+/, '');
    case 'step': return line.replace(/^\s*\d+[.)]\s+/, '');
    case 'tip': return line.replace(/^\s*>\s?/, '');
    default: return line.trim();
  }
}

/** Groups body lines into blocks; consecutive lines of one kind form one block. */
export function parseHelpBody(body: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const kind = classify(raw);
    if (kind === 'blank') {
      current = null;
      continue;
    }
    // Every heading line is its own block.
    if (current && current.kind === kind && kind !== 'heading') {
      current.lines.push(stripMarker(kind, raw));
      continue;
    }
    current = { kind, lines: [stripMarker(kind, raw)] };
    blocks.push(current);
  }

  return blocks;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function isInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

function renderInline(text: string, tenantPath: (path: string) => string): ReactNode[] {
  return text.split(INLINE_PATTERN).filter(Boolean).map((part, index) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      return <strong key={index} className="font-semibold text-theme-primary">{bold[1]}</strong>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label = '', path = ''] = link;
      if (!isInternalPath(path)) return <Fragment key={index}>{label}</Fragment>;
      return (
        <Link key={index} to={tenantPath(path)} className="font-medium text-accent underline underline-offset-2 hover:no-underline">
          {label}
        </Link>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Plain text of a body, for search and page descriptions. */
export function helpBodyToPlainText(body: string): string {
  return parseHelpBody(body)
    .map((block) => block.lines.join(' '))
    .join(' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function HelpBody({ body }: { body: string }) {
  const { tenantPath } = useTenant();
  const blocks = parseHelpBody(body);

  return (
    <div className="space-y-4 text-base leading-7 text-theme-secondary">
      {blocks.map((block, index) => {
        const inline = (line: string) => renderInline(line, tenantPath);
        switch (block.kind) {
          case 'heading':
            return (
              <h2 key={index} className="pt-2 text-lg font-semibold text-theme-primary">
                {inline(block.lines[0] ?? '')}
              </h2>
            );
          case 'bullet':
            return (
              <ul key={index} className="list-disc space-y-1.5 pl-6 marker:text-accent">
                {block.lines.map((line, i) => <li key={i}>{inline(line)}</li>)}
              </ul>
            );
          case 'step':
            return (
              <ol key={index} className="space-y-2">
                {block.lines.map((line, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">{inline(line)}</span>
                  </li>
                ))}
              </ol>
            );
          case 'tip':
            return (
              <div
                key={index}
                role="note"
                className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-theme-primary"
              >
                <Lightbulb className="mt-1 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <p className="min-w-0">{inline(block.lines.join(' '))}</p>
              </div>
            );
          default:
            return <p key={index}>{inline(block.lines.join(' '))}</p>;
        }
      })}
    </div>
  );
}
