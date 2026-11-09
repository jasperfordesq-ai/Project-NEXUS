// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { CardBody, Card } from '@/components/ui/Card';
/**
 * SOC10 — UserCollectionsView at /users/:userId/collections
 * Public collections of another user.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';

import Bookmark from 'lucide-react/icons/bookmark';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant } from '@/contexts';

interface Collection {
  id: number;
  name: string;
  description: string | null;
  color: string;
  is_public: boolean;
  items_count: number;
}

export default function UserCollectionsView() {
  const { t } = useTranslation('common');
  const { userId } = useParams<{ userId: string }>();
  const { tenantPath } = useTenant();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  usePageTitle(t('collections.public_title'));

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await api.get<Collection[]>(`/v2/users/${userId}/public-collections`);
      if (res.success && Array.isArray(res.data)) {
        setCollections(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <PageMeta title={t('collections.public_title')} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={t('collections.public_title')}
          icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
          accent="amber"
        />
      </div>

      {collections.length === 0 ? (
        <EmptyState
          title={t('collections.no_public')}
          description={t('collections.no_public_desc')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c) => (
            <Link key={c.id} to={tenantPath(`/me/collections/${c.id}`)} className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardBody className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: c.color || 'var(--color-primary)' }}
                      aria-hidden="true"
                    />
                    <h3 className="font-semibold flex-1 truncate">{c.name}</h3>
                    <span className="text-sm text-[var(--text-muted)]">{c.items_count}</span>
                  </div>
                  {c.description && (
                    <p className="text-sm text-[var(--text-muted)] line-clamp-2">{c.description}</p>
                  )}
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
