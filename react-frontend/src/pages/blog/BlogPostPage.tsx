// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Blog Post Detail Page - Single blog article view with shared social comments
 *
 * Uses V2 API: GET /api/v2/blog/{slug}
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import MessageCircle from 'lucide-react/icons/message-circle';
import { sanitizeRichText } from '@/lib/sanitize';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Breadcrumbs } from '@/components/navigation';
import { Helmet } from 'react-helmet-async';
import { PageMeta, PrerenderStatusCode } from '@/components/seo';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { usePrerenderReady } from '@/hooks/usePrerenderReady';
import { api } from '@/lib/api';
import { isNotFoundResponse } from '@/lib/not-found';
import { toIsoDateTime } from '@/lib/serverTime';
import { logError } from '@/lib/logger';
import { resolveAssetUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import { toJsonLd } from '@/lib/json-ld';

/* ───────────────────────── Types ───────────────────────── */

interface BlogPostDetail {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  featured_image: string | null;
  published_at: string;
  created_at: string;
  updated_at: string | null;
  views: number;
  reading_time: number;
  meta_title: string | null;
  meta_description: string | null;
  meta_keywords?: string | null;
  canonical_url?: string | null;
  og_image_url?: string | null;
  noindex?: boolean;
  category: {
    id: number;
    name: string;
    color: string;
  } | null;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
}

interface ArticleStructuredDataOptions {
  origin: string;
  pathname: string;
  canonicalUrl?: string;
  publisherName: string;
  publisherLogo?: string | null;
}

function buildArticleStructuredData(post: BlogPostDetail, options: ArticleStructuredDataOptions) {
  const canonicalUrl = options.canonicalUrl || `${options.origin}${options.pathname}`;
  const imageUrl = post.featured_image ? resolveAssetUrl(post.featured_image) : undefined;
  const publisherLogo = options.publisherLogo ? resolveAssetUrl(options.publisherLogo) : undefined;
  const organization = {
    '@type': 'Organization',
    name: options.publisherName,
    ...(publisherLogo ? { logo: { '@type': 'ImageObject', url: publisherLogo } } : {}),
  };

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${canonicalUrl}#article`,
    mainEntityOfPage: canonicalUrl,
    headline: post.meta_title || post.title,
    name: post.title,
    description: post.meta_description || post.excerpt || undefined,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    // ISO 8601: the API has sent the database form "2026-10-23 14:00:00",
    // which the Article rich result rejects (2026-10-23 SEO audit).
    datePublished: toIsoDateTime(post.published_at || post.created_at),
    dateModified: toIsoDateTime(post.updated_at || post.published_at || post.created_at),
    ...(post.category?.name ? { articleSection: post.category.name } : {}),
    ...(post.reading_time ? { timeRequired: `PT${post.reading_time}M` } : {}),
    author: organization,
    publisher: organization,
  };
}

/* ───────────────────────── Main Component ───────────────────────── */

/** Size of the hero thumbnail requested from the image service. */
const BLOG_HERO_WIDTH = 1200;
const BLOG_HERO_HEIGHT = 675;

const categoryColorMap: Record<string, string> = {
  blue: 'bg-blue-500/10 text-[var(--color-info)]',
  gray: 'bg-gray-500/10 text-gray-500',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-500',
  purple: 'bg-accent/10 text-accent',
  green: 'bg-emerald-500/10 text-emerald-500',
  red: 'bg-rose-500/10 text-rose-500',
  yellow: 'bg-amber-500/10 text-[var(--color-warning)]',
};

export function BlogPostPage() {
  const { t } = useTranslation('blog');
  const { slug } = useParams<{ slug: string }>();
  const { tenantPath, branding } = useTenant();
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  usePageTitle(post?.title || t('page_title'));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The server said the post does not exist (not merely that loading failed).
  const [missing, setMissing] = useState(false);
  usePrerenderReady(!isLoading && error === null && post !== null);

  // AbortController refs to cancel stale requests
  const abortPostRef = useRef<AbortController | null>(null);

  // Keep the latest translator available inside async callbacks.
  const tRef = useRef(t);
  tRef.current = t;

  const loadPost = useCallback(async () => {
    if (!slug) return;

    abortPostRef.current?.abort();
    const controller = new AbortController();
    abortPostRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      setMissing(false);

      const response = await api.get<BlogPostDetail>(`/v2/blog/${slug}`);

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        setPost(response.data);
      } else {
        setError(tRef.current('post.not_found'));
        setMissing(isNotFoundResponse(response));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load blog post', err);
      setError(tRef.current('post.error_load'));
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  // Loading state
  if (isLoading) {
    return (
      <div role="status" className="max-w-3xl mx-auto space-y-6" aria-busy="true" aria-label={t('loading_post')}>
        <PageMeta title={t('page_title')} noIndex />
        <div>
          <Skeleton className="mb-4 h-6 w-1/4 rounded" />
          <Skeleton className="mb-6 h-64 rounded-xl" />
          <Skeleton className="mb-3 h-8 w-3/4 rounded" />
          <Skeleton className="mb-8 h-4 w-1/3 rounded" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-5/6 rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-3/4 rounded" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !post) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageMeta title={error || t('post.not_found')} noIndex />
        {/* Only a confirmed missing post answers crawlers 404; a failed load does not. */}
        {missing && <PrerenderStatusCode code={404} />}
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">
            {error || t('post.not_found')}
          </h2>
          <p className="text-theme-muted mb-4">
            {t('post.not_found_desc')}
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              as={Link}
              to={tenantPath("/blog")}
              variant="flat"
              className="text-theme-muted"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('post.back_to_blog')}
            </Button>
            <Button
              className="bg-gradient-to-r from-blue-500 to-accent-gradient-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={loadPost}
            >
              {t('try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  const imageProps = post.featured_image
    ? responsiveThumbnailProps(post.featured_image, {
        width: BLOG_HERO_WIDTH,
        height: BLOG_HERO_HEIGHT,
        sizes: '(min-width: 768px) 768px, 100vw',
      })
    : null;
  const canonicalUrl = post.canonical_url
    ? new URL(post.canonical_url, window.location.origin).href
    : `${window.location.origin}${window.location.pathname}`;
  const articleStructuredData = buildArticleStructuredData(post, {
    origin: window.location.origin,
    pathname: window.location.pathname,
    canonicalUrl,
    publisherName: branding?.name || 'NEXUS',
    publisherLogo: branding?.logo,
  });

  return (
    <>
      <PageMeta
        title={post.meta_title || post.title}
        description={post.meta_description || post.excerpt}
        keywords={post.meta_keywords || undefined}
        image={post.og_image_url || (post.featured_image ? resolveAssetUrl(post.featured_image) : undefined)}
        url={post.canonical_url || undefined}
        type="article"
        noIndex={post.noindex === true}
        publishedTime={toIsoDateTime(post.published_at || post.created_at)}
        modifiedTime={toIsoDateTime(post.updated_at)}
      />

      {/* Article JSON-LD structured data */}
      <Helmet>
        <script type="application/ld+json">
          {toJsonLd(articleStructuredData)}
        </script>
      </Helmet>

      <article className="max-w-3xl mx-auto space-y-6">
        {/* Breadcrumbs */}
        <Breadcrumbs items={[
          { label: t('page_title'), href: '/blog' },
          { label: post.title },
        ]} />

        {/* Featured Image — the page's largest paint (LCP): loaded eagerly at
            high priority, its space reserved by the requested thumbnail size,
            and visible from the first frame rather than faded in. */}
        {imageProps && (
          <div className="rounded-2xl overflow-hidden">
            <img
              {...imageProps}
              alt={post.title}
              width={BLOG_HERO_WIDTH}
              height={BLOG_HERO_HEIGHT}
              className="w-full h-auto max-h-48 sm:max-h-96 object-cover"
              loading="eager"
              fetchPriority="high"
            />
          </div>
        )}

        {/* Post Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {post.category && (
            <Chip
              size="sm"
              variant="flat"
              className={`mb-3 ${categoryColorMap[post.category.color] ?? categoryColorMap.blue}`}
            >
              {post.category.name}
            </Chip>
          )}

          <h1 className="text-3xl font-bold text-theme-primary mb-4">
            {post.title}
          </h1>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-theme-muted pb-6 border-b border-theme-default">
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" aria-hidden="true" />
              {new Date(post.published_at).toLocaleDateString(getFormattingLocale(), {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>

            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" aria-hidden="true" />
              {t('post.min_read', { count: post.reading_time })}
            </span>

            {post.views > 0 && (
              <span className="flex items-center gap-1">
                <Eye className="w-4 h-4" aria-hidden="true" />
                {t('post.views_count', { count: post.views })}
              </span>
            )}

            <span className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              {t('post.comment_count', { count: post.comments_count ?? 0 })}
            </span>
          </div>
        </motion.div>

        {/* Post Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <GlassCard className="p-6 sm:p-8">
            <div
              className="prose prose-sm sm:prose dark:prose-invert max-w-none
                text-theme-primary
                [&_h2]:text-theme-primary [&_h2]:font-bold [&_h2]:mt-8 [&_h2]:mb-4
                [&_h3]:text-theme-primary [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-3
                [&_p]:text-theme-muted [&_p]:leading-relaxed [&_p]:mb-4
                [&_a]:text-[var(--color-info)] [&_a]:hover:text-blue-600
                [&_ul]:text-theme-muted [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4
                [&_ol]:text-theme-muted [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4
                [&_li]:mb-1
                [&_blockquote]:border-l-4 [&_blockquote]:border-blue-500 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-theme-subtle
                [&_img]:rounded-xl [&_img]:my-6
                [&_code]:bg-theme-elevated [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm
                [&_pre]:bg-theme-elevated [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto
              "
              dangerouslySetInnerHTML={{ __html: sanitizeRichText(post.content) }}
            />
          </GlassCard>
        </motion.div>

        {/* ─── Comments Section ─── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <GlassCard className="p-6 sm:p-8">
            <SocialInteractionPanel
              targetType="blog"
              targetId={post.id}
              initialLiked={post.is_liked ?? false}
              initialLikesCount={post.likes_count ?? 0}
              initialCommentsCount={post.comments_count ?? 0}
              title={post.title}
              description={post.excerpt}
              defaultShowComments={typeof window !== 'undefined' && /^#comment-\d+$/.test(window.location.hash)}
            />
          </GlassCard>
        </motion.div>

        {/* Footer */}
        <div className="pt-4 text-center">
          <Button
            as={Link}
            to={tenantPath("/blog")}
            variant="flat"
            className="bg-theme-elevated text-theme-muted"
            startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
          >
            {t('post.back_to_blog')}
          </Button>
        </div>
      </article>
    </>
  );
}

/* ───────────────────────── Comment Item ───────────────────────── */

/* ───────────────────────── Helpers ───────────────────────── */

export default BlogPostPage;
