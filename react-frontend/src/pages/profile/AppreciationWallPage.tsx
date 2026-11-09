// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
/**
 * SOC14 — AppreciationWallPage at /users/:userId/appreciations
 * Public feed of thank-you notes received by a user, with reaction buttons.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';

import Heart from 'lucide-react/icons/heart';
import Sparkles from 'lucide-react/icons/sparkles';
import Star from 'lucide-react/icons/star';
import MessageCircleHeart from 'lucide-react/icons/message-circle-heart';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth, useTenant } from '@/contexts';

interface Appreciation {
  id: number;
  sender_id: number;
  receiver_id: number;
  message: string;
  is_public: boolean;
  reactions_count: number;
  created_at: string;
  sender?: { id: number; name: string | null; avatar_url: string | null } | null;
  my_reaction?: string | null;
}

const REACTIONS: Array<{ key: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'heart', icon: Heart },
  { key: 'clap', icon: Sparkles },
  { key: 'star', icon: Star },
];

export default function AppreciationWallPage() {
  const { t } = useTranslation('common');
  const { userId } = useParams<{ userId: string }>();
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const [items, setItems] = useState<Appreciation[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  usePageTitle(t('appreciations.wall_title'));

  const load = useCallback(async (p: number) => {
    if (!userId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<Appreciation[]>(`/v2/users/${userId}/appreciations?page=${p}`);
      // api.get resolves { success:false } on a 4xx WITHOUT throwing — without
      // this branch a failed load rendered the "No appreciations yet" empty
      // state as if the wall were genuinely empty.
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data);
        const meta = (res as unknown as { meta?: { total_pages?: number } }).meta;
        if (meta?.total_pages) setTotalPages(meta.total_pages);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load(page);
  }, [page, load]);

  const react = useCallback(async (apprId: number, reactionType: string) => {
    if (!user) return;
    try {
      const res = await api.post(`/v2/appreciations/${apprId}/react`, { reaction_type: reactionType });
      // api.post resolves { success:false } on a 4xx (rate-limited, removed appreciation,
      // invalid reaction) WITHOUT throwing, so the catch never fires — only apply the
      // count/my_reaction change once the server confirms it, else the reaction count
      // drifts (off by one, until a reload) on a rejected reaction.
      if (!res.success) return;
      setItems((prev) =>
        prev.map((a) =>
          a.id === apprId
            ? {
                ...a,
                my_reaction: a.my_reaction === reactionType ? null : reactionType,
                reactions_count: a.my_reaction === reactionType
                  ? Math.max(0, a.reactions_count - 1)
                  : a.my_reaction
                    ? a.reactions_count
                    : a.reactions_count + 1,
              }
            : a,
        ),
      );
    } catch {
      // ignore
    }
  }, [user]);

  if (loading && items.length === 0) return <LoadingScreen />;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <PageMeta title={t('appreciations.wall_title')} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={t('appreciations.wall_title')}
          icon={<MessageCircleHeart className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />
      </div>

      {loadError ? (
        <Card role="alert">
          <CardBody className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{t('appreciations.load_error_title')}</h2>
            <p className="text-[var(--text-muted)] mb-4">{t('appreciations.load_error_desc')}</p>
            <Button
              color="primary"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => load(page)}
            >
              {t('appreciations.retry')}
            </Button>
          </CardBody>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          title={t('appreciations.empty_title')}
          description={t('appreciations.empty_desc')}
        />
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <Card key={a.id}>
              <CardBody className="space-y-2">
                <div className="flex items-center gap-2">
                  <Avatar src={a.sender?.avatar_url ?? undefined} name={a.sender?.name ?? ''} size="sm" />
                  <Link to={tenantPath(`/profile/${a.sender_id}`)} className="font-medium hover:underline">
                    {a.sender?.name ?? t('common.someone')}
                  </Link>
                  <span className="text-xs text-[var(--text-muted)] ml-auto">
                    {new Date(a.created_at).toLocaleDateString(getFormattingLocale())}
                  </span>
                </div>
                <p className="text-[var(--text-primary)]">{a.message}</p>
                <div className="flex items-center gap-2 pt-1">
                  {REACTIONS.map(({ key, icon: Icon }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={a.my_reaction === key ? 'flat' : 'light'}
                      color={a.my_reaction === key ? 'primary' : 'default'}
                      onPress={() => react(a.id, key)}
                      isDisabled={!user}
                      startContent={<Icon className="w-4 h-4" />}
                      aria-label={t(`appreciations.reaction_${key}`)}
                    >
                      {key === 'heart' ? t('appreciations.react_heart') :
                       key === 'clap' ? t('appreciations.react_clap') :
                       t('appreciations.react_star')}
                    </Button>
                  ))}
                  {a.reactions_count > 0 && (
                    <span className="text-sm text-[var(--text-muted)] ml-2">
                      {a.reactions_count}
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {!loadError && totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <Pagination total={totalPages} page={page} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
