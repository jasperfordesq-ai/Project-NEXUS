// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CommunityThankYousPage at /thank-yous — warmth phase 6, D3b (owner, 13 Nov
 * 2026): "notes whose receivers chose to show them, newest first, first
 * names. No ranking, no 'most thanked'."
 *
 * Behind its own community switch, `community_thank_you_page`, default OFF
 * (the route's FeatureGate; the server refuses the list as well). Reads
 * GET /v2/community/thank-yous, which applies every privacy rule — only notes
 * the receiver chose to show, never one involving a member you blocked or
 * who blocked you, first names only. This page shows what it is given, newest
 * first, and has nothing to sort, count or search by person.
 *
 * Each note uses the same card as the thank-you list on a profile
 * (AppreciationWallPage): avatar, name, date, the note.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MessageCircleHeart from 'lucide-react/icons/message-circle-heart';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { LoadError } from '@/components/feedback/LoadError';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant } from '@/contexts';

interface Person {
  id: number;
  name: string | null;
  avatar_url: string | null;
}

interface CommunityNote {
  id: number;
  message: string;
  created_at: string;
  sender: Person | null;
  receiver: Person | null;
}

const ENDPOINT = '/v2/community/thank-yous';

export default function CommunityThankYousPage() {
  const { t } = useTranslation('common');
  const { tenant, branding, tenantPath } = useTenant();
  const community = branding?.name || tenant?.name || '';
  const title = t('appreciations.community_title', { community });
  usePageTitle(title);

  const [items, setItems] = useState<CommunityNote[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  /** `after` is the cursor of the last page shown; null loads the newest notes. */
  const load = useCallback(async (after: string | null) => {
    if (after === null) {
      setLoading(true);
      setLoadError(false);
    } else {
      setLoadingMore(true);
    }
    try {
      const url = after === null ? ENDPOINT : `${ENDPOINT}?cursor=${encodeURIComponent(after)}`;
      const res = await api.get<CommunityNote[]>(url);
      // api.get resolves { success:false } on a 4xx without throwing.
      if (res.success && Array.isArray(res.data)) {
        const page = res.data;
        const meta = (res as unknown as { meta?: { has_more?: boolean; cursor?: string } }).meta;
        setItems((prev) => (after === null ? page : [...prev, ...page]));
        setHasMore(Boolean(meta?.has_more) && typeof meta?.cursor === 'string');
        setCursor(meta?.cursor ?? null);
      } else if (after === null) {
        setLoadError(true);
      }
    } catch {
      if (after === null) setLoadError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getFormattingLocale());

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <PageMeta title={title} noIndex />
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={title}
          description={t('appreciations.community_intro')}
          icon={<MessageCircleHeart className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />
      </div>

      {loading ? (
        <LoadingScreen />
      ) : loadError ? (
        <LoadError title={t('appreciations.load_error_title')} onRetry={() => void load(null)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MessageCircleHeart className="h-10 w-10" aria-hidden="true" />}
          title={t('appreciations.community_empty_title')}
          description={t('appreciations.community_empty_desc')}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((note) => {
              const senderName = note.sender?.name ?? t('common.someone');
              const receiverName = note.receiver?.name ?? t('common.someone');
              return (
                <li key={note.id}>
                  <Card data-testid={`community-thank-you-${note.id}`}>
                    <CardBody className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Avatar src={note.sender?.avatar_url ?? undefined} name={note.sender?.name ?? ''} size="sm" />
                        {note.sender ? (
                          <Link to={tenantPath(`/profile/${note.sender.id}`)} className="font-medium hover:underline">
                            {senderName}
                          </Link>
                        ) : (
                          <span className="font-medium">{senderName}</span>
                        )}
                        <span className="text-xs text-[var(--text-muted)] ms-auto">
                          {formatDate(note.created_at)}
                        </span>
                      </div>
                      <p className="text-[var(--text-primary)] whitespace-pre-wrap break-words">{note.message}</p>
                      <p className="text-sm text-[var(--text-muted)]">
                        {note.receiver ? (
                          <Link to={tenantPath(`/profile/${note.receiver.id}`)} className="hover:underline">
                            {t('appreciations.thanks_to', { name: receiverName })}
                          </Link>
                        ) : (
                          t('appreciations.thanks_to', { name: receiverName })
                        )}
                      </p>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
          {hasMore && cursor !== null && (
            <div className="flex justify-center mt-6">
              <Button
                variant="flat"
                className="bg-theme-elevated text-theme-primary"
                isLoading={loadingMore}
                onPress={() => void load(cursor)}
              >
                {t('appreciations.community_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
