// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { htmlToPlainText } from '@/lib/sanitize';
import { cn } from '@/lib/helpers';

/**
 * Text a member typed into a PLAIN text box: comments, listing / event / group
 * descriptions, Q&A, announcements, ideas, bios. None of those boxes has a
 * formatting toolbar, so nothing typed into them is ever HTML by intent — and
 * nothing typed into them is ever interpreted as HTML on the way out.
 *
 * F-568 (E-093, Cyphere stored-HTML-injection retest of F-562, 6 Oct 2026).
 * Until now these boxes rendered through `SafeHtml`, which turns any text that
 * looks like a tag into real markup. `<a href="https://google.com">Click here to
 * re-authenticate</a>` became a link, `<h1>` a heading, `<img>` an image from
 * any host. The tester's bar for the finding is the ordinary one: typed markup
 * must come out as words. This component meets it the way the accessible site
 * and the phone app already do.
 *
 * Older rows may hold HTML from before the server stored these fields as text;
 * that is converted to readable words (paragraph and line breaks kept) rather
 * than shown as raw tags. `SafeHtml` remains for the surfaces that have a real
 * rich-text editor (feed posts, group discussions) and for administrator content.
 */

const LOOKS_LIKE_MARKUP = /<[a-z!/?][\s\S]*>/i;

/** The words a member typed, with any markup turned into readable text. */
export function memberPlainText(content: string | null | undefined): string {
  if (!content) return '';
  return LOOKS_LIKE_MARKUP.test(content) ? htmlToPlainText(content) : content;
}

interface MemberPlainTextProps {
  content: string | null | undefined;
  className?: string;
  as?: 'p' | 'div' | 'span';
}

export function MemberPlainText({ content, className, as: Tag = 'div' }: MemberPlainTextProps) {
  const text = memberPlainText(content);
  if (!text) return null;
  return <Tag className={cn('whitespace-pre-wrap', className)}>{text}</Tag>;
}
