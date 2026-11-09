// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { CardBody, Card } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
/**
 * SOC10 — CollectionDetailPage at /me/collections/:id
 * Paginated saved items hydrated with previews.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';

import Trash2 from 'lucide-react/icons/trash-2';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useToast } from '@/contexts';

interface SavedItem {
  id: number;
  item_type: string;
  item_id: number;
  note: string | null;
  saved_at: string;
  preview?: { title?: string | null } | null;
}

interface Collection {
  id: number;
  name: string;
  description: string | null;
  color: string;
  is_public: boolean;
  items_count: number;
}

interface ApiPayload {
  items: SavedItem[];
  collection: Collection;
}

const ITEM_LINKS: Record<string, (id: number) => string> = {
  post: (id) => `/feed?post=${id}`,
  listing: (id) => `/listings/${id}`,
  event: (id) => `/events/${id}`,
  group: (id) => `/groups/${id}`,
  article: (id) => `/blog/${id}`,
  marketplace_listing: (id) => `/marketplace/${id}`,
  job: (id) => `/jobs/${id}`,
  resource: (id) => `/resources?item=${id}`,
};

export default function CollectionDetailPage() {
  const { t } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { tenantPath } = useTenant();
  const [data, setData] = useState<ApiPayload | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  usePageTitle(data?.collection.name ?? t('collections.detail_title'));

  const reqIdRef = useRef(0);
  const load = useCallback(async (p: number) => {
    if (!id) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const res = await api.get<ApiPayload>(`/v2/me/collections/${id}/items?page=${p}`);
      if (reqId !== reqIdRef.current) return; // a newer load started — drop this stale response
      if (res.success && res.data) {
        setData(res.data);
        const meta = (res as unknown as { meta?: { total_pages?: number } }).meta;
        if (meta?.total_pages) setTotalPages(meta.total_pages);
      } else {
        // A rejected response (session expired, deleted collection, server error)
        // must surface an error state. Without it, `data` stays null and the page
        // renders blank — `undefined === 0` is false, so the empty state never shows.
        setError(true);
      }
    } catch {
      if (reqId === reqIdRef.current) setError(true);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load(page);
  }, [page, load]);

  const handleRemove = useCallback(async (savedItemId: number) => {
    try {
      const res = await api.delete(`/v2/me/saved-items/${savedItemId}`);
      if (res.success) {
        setData((prev) => prev ? { ...prev, items: prev.items.filter((i) => i.id !== savedItemId) } : prev);
        toast.success(t('collections.item_removed'));
      }
    } catch {
      toast.error(t('common.error'));
    }
  }, [toast, t]);

  if (loading && !data) return <LoadingScreen />;

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <PageMeta title={data?.collection.name ?? t('collections.detail_title')} noIndex />
      <Link to={tenantPath('/me/collections')} className="inline-flex items-center gap-2 mb-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="w-4 h-4" />
        {t('collections.back_to_my')}
      </Link>

      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). The
          collection's own colour dot stays as its picture. */}
      {data?.collection && (
        <div className="mb-6">
          <PublicPageHero
            size="compact"
            title={data.collection.name}
            description={t('collections.items_count', { n: data.collection.items_count })}
            icon={
              <span
                className="block h-6 w-6 rounded-full"
                style={{ backgroundColor: data.collection.color || 'var(--color-primary)' }}
                aria-hidden="true"
              />
            }
            accent="indigo"
          />
        </div>
      )}

      {error && !data ? (
        <Card>
          <CardBody className="items-center text-center gap-4 py-12">
            <p className="text-[var(--text-muted)]">{t('common.error')}</p>
            <Button color="primary" variant="flat" onPress={() => load(page)}>
              {t('actions.retry')}
            </Button>
          </CardBody>
        </Card>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title={t('collections.no_items')}
          description={t('collections.no_items_desc')}
        />
      ) : (
        <div className="space-y-3">
          {data?.items.map((item) => {
            const linkBuilder = ITEM_LINKS[item.item_type];
            const href = linkBuilder ? tenantPath(linkBuilder(item.item_id)) : '#';
            const title = item.preview?.title || `${item.item_type} #${item.item_id}`;
            return (
              <Card key={item.id}>
                <CardBody className="flex flex-row items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <Link to={href} className="font-medium truncate hover:underline block">
                      {title}
                    </Link>
                    <div className="text-xs text-[var(--text-muted)]">
                      {item.item_type} · {new Date(item.saved_at).toLocaleDateString(getFormattingLocale())}
                    </div>
                    {item.note && <p className="text-sm text-[var(--text-muted)] mt-1">{item.note}</p>}
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    aria-label={t('collections.remove_item')}
                    onPress={() => handleRemove(item.id)}
                  >
                    <Trash2 className="w-4 h-4 text-[var(--color-danger)]" />
                  </Button>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <Pagination total={totalPages} page={page} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
