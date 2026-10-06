// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { sanitizeMemberRichText } from '@/lib/sanitize';
import { cn } from '@/lib/helpers';

interface SafeHtmlProps {
  content: string;
  className?: string;
  as?: 'p' | 'div' | 'span';
}

const HTML_TAG_REGEX = /<[a-z][\s\S]*>/i;

/**
 * Since F-562 (E-092) the only links left in member rich text are addresses
 * written out in full, so they must read as links and must wrap inside a
 * narrow comment box instead of overflowing it.
 */
const MEMBER_LINK_CLASSES =
  '[&_a]:text-[var(--color-primary)] [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-all';

/** Check if a string contains HTML tags */
export function containsHtml(text: string): boolean {
  return HTML_TAG_REGEX.test(text);
}

/**
 * Renders content that may contain HTML safely.
 * Detects HTML tags and uses DOMPurify + dangerouslySetInnerHTML when present,
 * otherwise renders as plain text.
 */
export function SafeHtml({ content, className, as: Tag = 'div' }: SafeHtmlProps) {
  if (!content) return null;

  if (HTML_TAG_REGEX.test(content)) {
    return (
      <Tag
        className={cn(MEMBER_LINK_CLASSES, className)}
        // nosemgrep: react-dangerouslysetinnerhtml — the value is DOMPurify output (sanitizeMemberRichText); code-scanning alerts 1386, 1773
        dangerouslySetInnerHTML={{ __html: sanitizeMemberRichText(content) }}
      />
    );
  }

  return <Tag className={className}>{content}</Tag>;
}
