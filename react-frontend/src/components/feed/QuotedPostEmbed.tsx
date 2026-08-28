// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * QuotedPostEmbed — compact, read-only card showing a quoted (embedded) post.
 * Used in both QuotePostModal (preview) and FeedCard (display).
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { resolveAvatarUrl, resolveThumbnailUrl, formatRelativeTime } from '@/lib/helpers';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { htmlToPlainText } from '@/lib/sanitize';

export interface QuotedPostData {
  id: number;
  content: string;
  content_truncated?: boolean;
  image_url?: string | null;
  created_at: string;
  author: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  media?: Array<{
    id: number;
    media_type: 'image' | 'video';
    file_url: string;
    thumbnail_url?: string | null;
    alt_text?: string | null;
  }>;
}

interface QuotedPostEmbedProps {
  post: QuotedPostData;
  /** If true, the card is not clickable (used in modal preview). */
  isPreview?: boolean;
}

export function QuotedPostEmbed({ post, isPreview = false }: QuotedPostEmbedProps) {
  const { t } = useTranslation('feed');
  const { tenantPath } = useTenant();
  const [expanded, setExpanded] = useState(false);

  const MAX_CHARS = 280;

  /*
   * 🔴 This card rendered `post.content` as text until 2026-08-28, and a quoted post is a
   * FEED post — written in the web composer, so stored as HTML. Quoting anything written on
   * the website therefore showed the markup: `<p class="mb-1 leading-relaxed …"><span>`.
   * It is the same fault a member reported on the phone on 2026-08-24, in the one place on
   * the website that renders post content as plain text instead of through
   * `FeedContentRenderer`. A quote card is a compact preview, so plain text is right here —
   * it just has to be plain text a reader recognises.
   */
  const plainContent = useMemo(() => htmlToPlainText(post.content), [post.content]);

  // Measure what the reader sees. The raw string is longer than the words in it.
  const shouldTruncate = post.content_truncated || plainContent.length > MAX_CHARS;
  const displayContent = expanded ? plainContent : plainContent.slice(0, MAX_CHARS);

  const firstMedia = post.media && post.media.length > 0 ? post.media[0] : null;
  const thumbnailUrl = firstMedia
    ? resolveThumbnailUrl(firstMedia.thumbnail_url || firstMedia.file_url, { width: 320, height: 180 })
    : post.image_url
      ? resolveThumbnailUrl(post.image_url, { width: 320, height: 180 })
      : null;

  const cardContent = (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 hover:border-[var(--color-primary)]/50 transition-colors duration-200 cursor-pointer">
      {/* Author row */}
      <div className="flex items-center gap-2 mb-2">
        <Avatar
          name={post.author.name}
          src={resolveAvatarUrl(post.author.avatar_url)}
          size="sm"
          className="w-6 h-6 flex-shrink-0"
        />
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
          {post.author.name}
        </span>
        <span className="text-[10px] text-[var(--text-subtle)] flex items-center gap-0.5 ml-auto flex-shrink-0">
          <Clock className="w-2.5 h-2.5" aria-hidden="true" />
          {formatRelativeTime(post.created_at)}
        </span>
      </div>

      {/* Content + optional thumbnail */}
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed break-words">
            {displayContent}
            {shouldTruncate && !expanded && '...'}
          </p>
          {shouldTruncate && !expanded && (
            <Button
              variant="tertiary"
              size="sm"
              className="mt-1 min-h-7 min-w-0 px-1 text-xs text-[var(--color-primary)]"
              aria-expanded={expanded}
              onPress={() => setExpanded(true)}
            >
              {t('card.read_more')}
            </Button>
          )}
        </div>

        {thumbnailUrl && (
          <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden">
            <img
              src={thumbnailUrl}
              alt={t('quoted_post_image')}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  );

  if (isPreview) {
    return cardContent;
  }

  return (
    <Link
      to={tenantPath(`/feed?post=${post.id}`)}
      className="block no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      {cardContent}
    </Link>
  );
}

export default QuotedPostEmbed;
