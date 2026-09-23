// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FeedContentRenderer — Safe HTML renderer for feed post content.
 * Handles both plain text (legacy posts) and rich HTML (new posts from ComposeEditor).
 * Sanitizes HTML with DOMPurify before rendering.
 */

import { Fragment } from 'react';
import { sanitizeMemberRichText } from '@/lib/sanitize';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { MentionRenderer } from '@/components/social/MentionRenderer';

/* ───────────────────────── Types ───────────────────────── */

interface FeedContentRendererProps {
  /** The post content string (plain text or HTML) */
  content: string;
  /** Whether the content has been truncated by the API */
  truncated?: boolean;
  /** Path to the detail page (used for "read more" link) */
  detailPath?: string;
  /** Post title used to build an accessible aria-label for the "Read more" link (WCAG 2.4.4) */
  postTitle?: string;
}

/* ───────────────────────── Constants ───────────────────────── */

/** Regex to detect if a string contains HTML tags */
const HTML_TAG_REGEX = /<[a-z][\s\S]*>/i;

/* ───────────────────────── DOMPurify Configuration ───────────────────────── */

/**
 * Sanitize feed HTML using the unified rich-text profile. The shared
 * helper already forces target=_blank + rel=noopener noreferrer nofollow
 * on every anchor and blocks unsafe URI schemes.
 */
function sanitizeHtml(html: string): string {
  return sanitizeMemberRichText(html);
}

/* ───────────────────────── Hashtag & Mention Helper ───────────────────────── */

/**
 * Render plain text with clickable #hashtags and @mentions.
 */
function TextWithHashtagsAndMentions({ text, tenantPath }: { text: string; tenantPath: (p: string) => string }) {
  // Combined regex: match #hashtags and @mentions in a single pass
  const combinedRegex = /(#(\w{2,})|@([a-zA-Z0-9_.-]+))/g;
  const parts: Array<{ type: 'text' | 'hashtag' | 'mention'; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      // Hashtag match
      parts.push({ type: 'hashtag', value: match[2] });
    } else if (match[3]) {
      // Mention match
      parts.push({ type: 'mention', value: match[3] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  if (parts.length === 0) return <>{text}</>;

  return (
    <>
      {parts.map((part, idx) => (
        <Fragment key={`${part.type}-${idx}-${part.value.slice(0, 16)}`}>
          {part.type === 'hashtag' ? (
            <Link
              to={tenantPath(`/feed/hashtag/${part.value}`)}
              className="text-accent hover:text-accent dark:text-accent dark:hover:text-accent font-medium transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              #{part.value}
            </Link>
          ) : part.type === 'mention' ? (
            <MentionRenderer text={`@${part.value}`} showUserCard={false} />
          ) : (
            part.value
          )}
        </Fragment>
      ))}
    </>
  );
}

/* ───────────────────────── Component ───────────────────────── */

export function FeedContentRenderer({
  content,
  truncated = false,
  detailPath,
  postTitle,
}: FeedContentRendererProps) {
  const { t } = useTranslation('feed');
  const { tenantPath } = useTenant();

  if (!content) {
    return null;
  }

  const isHtml = HTML_TAG_REGEX.test(content);

  if (isHtml) {
    // Rich HTML content — sanitize and render
    const sanitized = sanitizeHtml(content);

    return (
      <div>
        <div
          className="feed-content text-sm text-[var(--text-secondary)] leading-relaxed"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
        {truncated && detailPath && (
          <Link
            to={detailPath}
            className="text-[var(--color-primary)] hover:underline text-sm font-medium"
            aria-label={postTitle ? t('card.read_more_about', { title: postTitle }) : undefined}
          >
            ...{t('card.read_more')}
          </Link>
        )}
      </div>
    );
  }

  // Plain text content (legacy) — render with whitespace preservation and clickable hashtags
  return (
    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
      <TextWithHashtagsAndMentions text={content} tenantPath={tenantPath} />
      {truncated && detailPath && (
        <Link
          to={detailPath}
          className="text-[var(--color-primary)] hover:underline ms-1 text-sm font-medium"
          aria-label={postTitle ? t('card.read_more_about', { title: postTitle }) : undefined}
        >
          {t('card.read_more')}
        </Link>
      )}
    </p>
  );
}

export default FeedContentRenderer;
