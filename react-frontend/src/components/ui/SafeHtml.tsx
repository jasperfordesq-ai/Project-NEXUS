// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { sanitizeMemberRichText } from '@/lib/sanitize';

interface SafeHtmlProps {
  content: string;
  className?: string;
  as?: 'p' | 'div' | 'span';
}

const HTML_TAG_REGEX = /<[a-z][\s\S]*>/i;

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
        className={className}
        dangerouslySetInnerHTML={{ __html: sanitizeMemberRichText(content) }}
      />
    );
  }

  return <Tag className={className}>{content}</Tag>;
}
