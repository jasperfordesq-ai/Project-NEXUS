// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CustomPage - Dynamic CMS page renderer
 *
 * Fetches and displays published pages created via the admin Page Builder.
 * Uses V2 API: GET /api/v2/pages/{slug}
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import FileText from 'lucide-react/icons/file-text';
import { sanitizeCustomPageHtml, sanitizeRichText } from '@/lib/sanitize';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePrerenderReady } from '@/hooks/usePrerenderReady';

interface PageData {
  id: number;
  title: string;
  slug: string;
  content: string;
  content_format?: 'plaintext' | 'richtext' | 'html' | 'builder';
  meta_description: string;
  created_at: string;
  updated_at: string;
}

function plainTextExcerpt(html: string, maxLength = 160): string | undefined {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

export function CustomPage() {
  const { t } = useTranslation('utility');
  const { slug } = useParams<{ slug: string }>();
  const { tenantPath, tenant, isLoading: tenantLoading } = useTenant();

  const [page, setPage] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  usePrerenderReady(!tenantLoading && !loading && !notFound && page !== null);

  // tenantId captured as primitive to avoid object reference churn in deps
  const tenantId = tenant?.id ?? null;

  const reqIdRef = useRef(0);
  const loadPage = useCallback(async () => {
    // Wait for tenant bootstrap to complete before fetching — avoids stale closure
    // where tenantId is null and context_tenant is omitted from the request.
    if (!slug || tenantLoading) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setNotFound(false);

    try {
      // Include context_tenant so the PHP API can resolve the correct tenant for
      // unauthenticated requests (where X-Tenant-ID header is not available).
      const tenantParam = tenantId ? `?context_tenant=${tenantId}` : '';
      const res = await api.get<PageData>(`/v2/pages/${encodeURIComponent(slug)}${tenantParam}`);
      if (reqId !== reqIdRef.current) return; // a newer load started — drop this stale response
      if (res.success && res.data) {
        setPage(res.data);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      logError('Failed to load page', err);
      setNotFound(true);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [slug, tenantId, tenantLoading]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center items-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <PageMeta title={t('not_found.page_title')} noIndex />
        <GlassCard className="p-8">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('not_found.heading')}</h1>
          <p className="text-theme-secondary mb-6">
            {t('custom_page.not_found_description')}
          </p>
          <Button as={Link} to={tenantPath('/')} variant="primary" startContent={<ArrowLeft size={16} />}>
            {t('custom_page.back_to_home')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  const metaDescription = page.meta_description?.trim() || plainTextExcerpt(page.content);
  const rendersAsCustomHtml = page.content_format === 'builder' || page.content_format === 'html';

  return (
    <>
      <PageMeta
        title={page.title}
        description={metaDescription}
        type="article"
        publishedTime={page.created_at}
        modifiedTime={page.updated_at || page.created_at}
      />

      <div className={rendersAsCustomHtml ? 'py-8 space-y-6' : 'max-w-4xl mx-auto px-4 py-8 space-y-6'}>
        <div className={rendersAsCustomHtml ? 'mx-auto max-w-6xl px-4' : undefined}>
          <Breadcrumbs items={[
            { label: t('not_found.go_home'), href: tenantPath('/') },
            { label: page.title },
          ]} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {rendersAsCustomHtml ? (
            <>
              {/* Custom HTML and Design pages carry their own visual title (or none),
                  so the page still gets a heading screen readers can find. */}
              <h1 className="sr-only">{page.title}</h1>
              {page.content && (
                <div
                  dangerouslySetInnerHTML={{ __html: sanitizeCustomPageHtml(page.content) }}
                />
              )}
            </>
          ) : (
            <GlassCard className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <FileText className="w-6 h-6 text-accent" />
                <h1 className="text-2xl sm:text-3xl font-bold text-theme-primary">
                  {page.title}
                </h1>
              </div>

              {page.content_format === 'plaintext' && page.content && (
                <div className="whitespace-pre-wrap text-theme-primary">
                  {page.content}
                </div>
              )}

              {page.content_format !== 'plaintext' && page.content && (
                <div
                  className="
                    prose prose-neutral dark:prose-invert max-w-none
                    [&_a]:text-accent [&_a]:underline
                    [&_img]:rounded-xl [&_img]:max-w-full
                    [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-4
                    [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-3
                    [&_ul]:list-disc [&_ul]:pl-6
                    [&_ol]:list-decimal [&_ol]:pl-6
                    [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:pl-4 [&_blockquote]:italic
                    [&_code]:bg-theme-elevated [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm
                    [&_pre]:bg-theme-elevated [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto
                  "
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(page.content) }}
                />
              )}
            </GlassCard>
          )}
        </motion.div>
      </div>
    </>
  );
}

export default CustomPage;
