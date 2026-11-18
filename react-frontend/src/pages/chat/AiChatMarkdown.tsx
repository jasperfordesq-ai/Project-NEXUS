// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AiChatMarkdown — shows an AI Assistant answer with its formatting.
 *
 * The assistant writes Markdown (numbered steps, **bold** button names, links
 * to pages). Until 18 Nov 2026 answers were printed as plain text, so members
 * saw the asterisks and `[text](/path)` themselves.
 *
 * Safety: react-markdown never renders raw HTML unless a plugin asks it to, and
 * none does here. Images are not shown (an answer has no reason to load a
 * picture from somewhere); their alt text is shown instead. Links:
 *   - a path on this site stays inside the app, with the community's address
 *     prefix added by `tenantPath()` (which never adds it twice);
 *   - a full address on this same site is treated the same way;
 *   - anything else opens in a new tab, through `safeHref`, which drops
 *     `javascript:` and other unsafe schemes.
 */

import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import ExternalLink from 'lucide-react/icons/external-link';
import { useTenant } from '@/contexts';
import { safeHref } from '@/lib/safeHref';

/** A link the app can open itself, as a path; null when it belongs elsewhere. */
export function internalPath(href: string | undefined | null): string | null {
  if (!href) return null;
  const value = href.trim();
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(value);
    if (url.origin === window.location.origin) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Not an absolute address; fall through.
  }
  return null;
}

const LINK_CLASS = 'font-medium text-accent underline underline-offset-4 decoration-accent/40 hover:decoration-accent break-words';

interface AiChatMarkdownProps {
  content: string;
}

function AiChatMarkdownImpl({ content }: AiChatMarkdownProps) {
  const { tenantPath } = useTenant();

  const components: Components = {
    a: ({ href, children }) => {
      const path = internalPath(href);
      if (path) {
        return (
          <Link to={tenantPath(path)} className={LINK_CLASS}>
            {children}
          </Link>
        );
      }
      // Only a full web or email address leaves the app. A bare word such as
      // "listings" would otherwise become a link relative to the chat page.
      const safe = safeHref(href);
      if (!safe || !/^(?:https?:|mailto:)/i.test(safe)) {
        return <span>{children}</span>;
      }
      return (
        <a href={safe} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS} inline-flex items-baseline gap-0.5`}>
          {children}
          <ExternalLink className="h-3 w-3 shrink-0 self-center" aria-hidden="true" />
        </a>
      );
    },
    img: ({ alt }) => (alt ? <span>{alt}</span> : null),
    h1: ({ children }) => <p className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</p>,
    h2: ({ children }) => <p className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</p>,
    h3: ({ children }) => <p className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</p>,
    h4: ({ children }) => <p className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</p>,
    h5: ({ children }) => <p className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</p>,
    h6: ({ children }) => <p className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</p>,
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 ps-5 first:mt-0 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 ps-5 first:mt-0 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="ps-1 marker:text-[var(--color-text-muted)] [&>p]:my-0">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-s-2 border-accent/50 ps-3 text-[var(--color-text-muted)]">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-[var(--border-default)]" />,
    code: ({ children, className }) => (
      <code className={`${className ?? ''} rounded-sm bg-[var(--color-surface-elevated)] px-1 py-0.5 text-[0.9em]`}>{children}</code>
    ),
    pre: ({ children }) => (
      <pre className="my-2 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--color-surface-elevated)] p-3 text-xs [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-[var(--border-default)] px-2 py-1.5 font-semibold">{children}</th>,
    td: ({ children }) => <td className="border-b border-[var(--border-default)] px-2 py-1.5 align-top">{children}</td>,
  };

  return (
    <div className="ai-chat-answer text-[0.9375rem] leading-relaxed text-[var(--color-text)] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const AiChatMarkdown = memo(AiChatMarkdownImpl);

/** Plain text of an answer, for the copy button: the Markdown without its symbols. */
export function answerPlainText(node: HTMLElement | null, fallback: string): string {
  const text = node?.innerText || node?.textContent || '';
  return text.trim() ? text.trim() : fallback;
}

export default AiChatMarkdown;
