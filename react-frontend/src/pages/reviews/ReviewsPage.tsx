// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReviewsPage — View reviews received, reviews given, and pending reviews to write.
 *
 * API endpoints:
 *   GET /api/v2/reviews/user/{userId}       — reviews received by current user
 *   GET /api/v2/reviews/given               — reviews written by current user
 *   GET /api/v2/reviews/pending             — exchanges awaiting a review
 *   DELETE /api/v2/reviews/{id}             — delete own review
 */

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import Star from 'lucide-react/icons/star';
import Trash2 from 'lucide-react/icons/trash-2';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { PageMeta } from '@/components/seo';
import { ReviewModal } from '@/components/reviews/ReviewModal';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { Button, Chip, Avatar, Tabs, Tab, Skeleton, useConfirm } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reviewer {
  id: number | null;
  name: string;
  avatar?: string | null;
  avatar_url?: string | null;
}

interface Review {
  id: number;
  rating: number;
  comment?: string | null;
  is_anonymous: boolean;
  reviewer: Reviewer;
  created_at: string;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
}

/** A review written by the current user — `receiver` is the member it's about. */
interface GivenReview {
  id: number;
  rating: number;
  comment?: string | null;
  receiver: Reviewer;
  created_at: string;
}

interface PendingReview {
  exchange_id: number;
  exchange_title?: string | null;
  receiver_id: number;
  receiver_name: string;
  receiver_avatar?: string | null;
  transaction_id?: number | null;
  completed_at?: string | null;
}

// ─── Star display component ───────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }): ReactNode {
  const { t } = useTranslation('reviews');
  return (
    <div className="flex items-center gap-0.5" aria-label={t('rating_aria', { n: rating })}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`w-4 h-4 ${i < rating ? 'fill-amber-400 text-amber-400' : 'text-theme-subtle'}`}
        />
      ))}
    </div>
  );
}

// ─── Review Card ──────────────────────────────────────────────────────────────

function ReviewCard({
  review,
  onDelete,
  canDelete,
}: {
  review: Review;
  onDelete?: (id: number) => void;
  canDelete?: boolean;
}): ReactNode {
  const { t } = useTranslation(['reviews', 'common']);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  // Reader-requested translation of the review text (31 Oct 2026).
  const [translatedComment, setTranslatedComment] = useState<string | null>(null);
  const onTranslatedText = useCallback((text: string, isTranslated: boolean) => setTranslatedComment(isTranslated ? text : null), []);

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('reviews:review_card.delete_confirm'),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    setDeleting(true);
    // The api client never rejects — branch on response.success.
    const res = await api.delete(`/v2/reviews/${review.id}`);
    setDeleting(false);
    if (res.success) {
      toast.success(t('reviews:review_card.delete_success'));
      onDelete?.(review.id);
    } else {
      toast.error(res.error || t('reviews:review_card.delete_error'));
    }
  }, [review.id, t, toast, onDelete, confirm]);

  const avatarUrl = resolveAvatarUrl(review.reviewer.avatar_url ?? review.reviewer.avatar);
  const displayName = review.is_anonymous ? t('review_card.anonymous') : review.reviewer.name;

  return (
    <div className="flex gap-3 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <Avatar
        src={review.is_anonymous ? undefined : (avatarUrl ?? undefined)}
        name={displayName}
        size="sm"
        className="shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">{displayName}</p>
            <StarRating rating={review.rating} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[var(--color-text-muted)]">
              {new Date(review.created_at).toLocaleDateString(getFormattingLocale())}
            </span>
            {canDelete && (
              <Button
                isIconOnly
                size="sm"
                variant="light"
                color="danger"
                isLoading={deleting}
                onPress={handleDelete}
                aria-label={t('review_card.delete')}
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        {review.comment && (
          <>
            <p className="mt-1.5 text-sm text-[var(--color-text-muted)] leading-relaxed">{translatedComment ?? review.comment}</p>
            <TranslateButton
              contentType="review"
              contentId={review.id}
              sourceText={review.comment}
              sourceLocale={null}
              onTextChange={onTranslatedText}
              className="mt-1"
            />
          </>
        )}
        <SocialInteractionPanel
          targetType="review"
          targetId={review.id}
          initialLiked={review.is_liked ?? false}
          initialLikesCount={review.likes_count ?? 0}
          initialCommentsCount={review.comments_count ?? 0}
          title={displayName}
          description={review.comment}
          className="mt-3"
          compact
        />
      </div>
    </div>
  );
}

// ─── Given Review Card ────────────────────────────────────────────────────────

function GivenReviewCard({
  review,
  onDelete,
}: {
  review: GivenReview;
  onDelete: (id: number) => void;
}): ReactNode {
  const { t } = useTranslation(['reviews', 'common']);
  const { tenantPath } = useTenant();
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const handleDelete = useCallback(async () => {
    const ok = await confirm({
      title: t('reviews:review_card.delete_confirm'),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    setDeleting(true);
    // The api client never rejects — branch on response.success.
    const res = await api.delete(`/v2/reviews/${review.id}`);
    setDeleting(false);
    if (res.success) {
      toast.success(t('reviews:review_card.delete_success'));
      onDelete(review.id);
    } else {
      toast.error(res.error || t('reviews:review_card.delete_error'));
    }
  }, [review.id, t, toast, onDelete, confirm]);

  const avatarUrl = resolveAvatarUrl(review.receiver.avatar_url ?? review.receiver.avatar);

  return (
    <div className="flex gap-3 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <Avatar
        src={avatarUrl ?? undefined}
        name={review.receiver.name}
        size="sm"
        className="shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            {review.receiver.id ? (
              <Link
                to={tenantPath(`/profile/${review.receiver.id}`)}
                className="text-sm font-medium text-[var(--color-text)] hover:underline"
              >
                {review.receiver.name}
              </Link>
            ) : (
              <p className="text-sm font-medium text-[var(--color-text)]">{review.receiver.name}</p>
            )}
            <StarRating rating={review.rating} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[var(--color-text-muted)]">
              {new Date(review.created_at).toLocaleDateString(getFormattingLocale())}
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              isLoading={deleting}
              onPress={handleDelete}
              aria-label={t('reviews:review_card.delete')}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {review.comment && (
          <p className="mt-1.5 text-sm text-[var(--color-text-muted)] leading-relaxed">{review.comment}</p>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message, subtitle }: { message: string; subtitle: string }): ReactNode {
  return (
    <div className="text-center py-12 text-[var(--color-text-muted)]">
      <Star className="w-12 h-12 mx-auto mb-3 opacity-30" aria-hidden="true" />
      <p className="font-medium">{message}</p>
      <p className="text-sm mt-1 opacity-70">{subtitle}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReviewsPage(): ReactNode {
  const { t } = useTranslation('reviews');
  const { user } = useAuth();
  const toast = useToast();
  usePageTitle(t('page_title'));

  // Deep link from the review-request email: /reviews/create?transaction_id=…
  const [searchParams] = useSearchParams();
  const deepLinkTxnId = searchParams.get('transaction_id');

  const [activeTab, setActiveTab] = useState<string>(deepLinkTxnId ? 'pending' : 'received');

  // Reviews received state
  const [received, setReceived] = useState<Review[]>([]);
  const [receivedLoading, setReceivedLoading] = useState(true);
  const [receivedError, setReceivedError] = useState(false);
  const [receivedCursor, setReceivedCursor] = useState<string | null>(null);
  const [receivedHasMore, setReceivedHasMore] = useState(false);
  const [receivedLoadingMore, setReceivedLoadingMore] = useState(false);

  // Reviews given state
  const [given, setGiven] = useState<GivenReview[]>([]);
  const [givenLoading, setGivenLoading] = useState(true);
  const [givenError, setGivenError] = useState(false);
  const [givenCursor, setGivenCursor] = useState<string | null>(null);
  const [givenHasMore, setGivenHasMore] = useState(false);
  const [givenLoadingMore, setGivenLoadingMore] = useState(false);

  // Pending reviews state
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState(false);

  // Review modal
  const [reviewTarget, setReviewTarget] = useState<PendingReview | null>(null);

  const fetchReceived = useCallback(async (cursor?: string | null) => {
    if (!user?.id) return;
    const isLoadMore = !!cursor;
    if (isLoadMore) setReceivedLoadingMore(true); else setReceivedLoading(true);
    setReceivedError(false);
    const qs = new URLSearchParams({ per_page: '20' });
    if (cursor) qs.set('cursor', cursor);
    // respondWithCollection unwraps to data = items[]; cursor/has_more in meta.
    const res = await api.get<Review[]>(`/v2/reviews/user/${user.id}?${qs}`);
    if (res.success) {
      const items: Review[] = Array.isArray(res.data) ? res.data : [];
      setReceived(prev => isLoadMore ? [...prev, ...items] : items);
      setReceivedCursor(res.meta?.cursor ?? null);
      setReceivedHasMore(res.meta?.has_more ?? false);
    } else if (!isLoadMore) {
      setReceivedError(true);
    } else {
      toast.error(res.error || t('load_error'));
    }
    if (isLoadMore) setReceivedLoadingMore(false); else setReceivedLoading(false);
  }, [user?.id, t, toast]);

  const fetchGiven = useCallback(async (cursor?: string | null) => {
    const isLoadMore = !!cursor;
    if (isLoadMore) setGivenLoadingMore(true); else setGivenLoading(true);
    setGivenError(false);
    const qs = new URLSearchParams({ per_page: '20' });
    if (cursor) qs.set('cursor', cursor);
    const res = await api.get<GivenReview[]>(`/v2/reviews/given?${qs}`);
    if (res.success) {
      const items: GivenReview[] = Array.isArray(res.data) ? res.data : [];
      setGiven(prev => isLoadMore ? [...prev, ...items] : items);
      setGivenCursor(res.meta?.cursor ?? null);
      setGivenHasMore(res.meta?.has_more ?? false);
    } else if (!isLoadMore) {
      setGivenError(true);
    } else {
      toast.error(res.error || t('load_error'));
    }
    if (isLoadMore) setGivenLoadingMore(false); else setGivenLoading(false);
  }, [t, toast]);

  const fetchPending = useCallback(async () => {
    setPendingLoading(true);
    setPendingError(false);
    try {
      const res = await api.get<PendingReview[]>('/v2/reviews/pending');
      const pending = Array.isArray(res.data) ? res.data : [];
      setPending(pending);
    } catch {
      setPendingError(true);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReceived();
    fetchGiven();
    fetchPending();
  }, [fetchReceived, fetchGiven, fetchPending]);

  // Resolve the email deep link to a specific pending review and open the modal.
  // Uses the transaction_id filter so the target is found even when the user has
  // more pending reviews than fit on the first page (and avoids re-running).
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (!deepLinkTxnId || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<PendingReview[]>(
          `/v2/reviews/pending?transaction_id=${encodeURIComponent(deepLinkTxnId)}`,
        );
        const list = Array.isArray(res.data) ? res.data : [];
        const match = list.find(p => String(p.transaction_id) === String(deepLinkTxnId)) ?? list[0] ?? null;
        if (!cancelled && match) {
          setActiveTab('pending');
          setReviewTarget(match);
        }
      } catch {
        /* Leave the pending tab visible — nothing to auto-open. */
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkTxnId]);

  const handleReviewWritten = useCallback((pendingItem: PendingReview) => {
    setPending(prev => prev.filter(p => p.exchange_id !== pendingItem.exchange_id));
    setReviewTarget(null);
    // The new review now belongs in the Given tab.
    fetchGiven();
  }, [fetchGiven]);

  const handleGivenDeleted = useCallback((id: number) => {
    setGiven(prev => prev.filter(r => r.id !== id));
  }, []);

  // Load failures are handled per-tab (receivedError / givenError /
  // pendingError), each rendering its own inline error + retry block, so a
  // failed fetch never falls through to the tab's empty state.

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <PageMeta title={t('page_title')} noIndex />
      <h1 className="text-2xl font-bold text-[var(--color-text)] mb-6">{t('page_title')}</h1>

      <Tabs
        selectedKey={activeTab}
        onSelectionChange={key => setActiveTab(key as string)}
        aria-label={t('page_title')}
        className="mb-6"
      >
        {/* ── Received ─────────────────────────────────────────────── */}
        <Tab
          key="received"
          title={
            <span className="flex items-center gap-1.5">
              {t('tabs.received')}
              {received.length > 0 && (
                <Chip size="sm" variant="flat">{received.length}</Chip>
              )}
            </span>
          }
        >
          {receivedLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : receivedError ? (
            <div className="text-center py-8">
              <p className="text-[var(--color-text-muted)]">{t('load_error')}</p>
              <Button className="mt-3" size="sm" onPress={() => fetchReceived()}>{t('load_more')}</Button>
            </div>
          ) : received.length === 0 ? (
            <EmptyState message={t('received.empty')} subtitle={t('received.empty_subtitle')} />
          ) : (
            <div className="space-y-3">
              {received.map(review => (
                <ReviewCard key={review.id} review={review} />
              ))}
              {receivedHasMore && (
                <Button
                  variant="flat"
                  className="w-full"
                  isLoading={receivedLoadingMore}
                  onPress={() => fetchReceived(receivedCursor)}
                >
                  {t('load_more')}
                </Button>
              )}
            </div>
          )}
        </Tab>

        {/* ── Given ─────────────────────────────────────────────────── */}
        <Tab
          key="given"
          title={
            <span className="flex items-center gap-1.5">
              {t('tabs.given')}
              {given.length > 0 && (
                <Chip size="sm" variant="flat">{given.length}</Chip>
              )}
            </span>
          }
        >
          {givenLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : givenError ? (
            <div className="text-center py-8">
              <p className="text-[var(--color-text-muted)]">{t('load_error')}</p>
              <Button className="mt-3" size="sm" onPress={() => fetchGiven()}>{t('load_more')}</Button>
            </div>
          ) : given.length === 0 ? (
            <EmptyState message={t('given.empty')} subtitle={t('given.empty_subtitle')} />
          ) : (
            <div className="space-y-3">
              {given.map(review => (
                <GivenReviewCard key={review.id} review={review} onDelete={handleGivenDeleted} />
              ))}
              {givenHasMore && (
                <Button
                  variant="flat"
                  className="w-full"
                  isLoading={givenLoadingMore}
                  onPress={() => fetchGiven(givenCursor)}
                >
                  {t('load_more')}
                </Button>
              )}
            </div>
          )}
        </Tab>

        {/* ── Pending ───────────────────────────────────────────────── */}
        <Tab
          key="pending"
          title={
            <span className="flex items-center gap-1.5">
              {t('tabs.pending')}
              {pending.length > 0 && (
                <Chip size="sm" color="warning" variant="flat">{pending.length}</Chip>
              )}
            </span>
          }
        >
          {pendingLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : pendingError ? (
            <div className="text-center py-8">
              <p className="text-[var(--color-text-muted)]">{t('load_error')}</p>
              <Button className="mt-3" size="sm" onPress={fetchPending}>{t('load_more')}</Button>
            </div>
          ) : pending.length === 0 ? (
            <EmptyState message={t('pending.empty')} subtitle={t('pending.empty_subtitle')} />
          ) : (
            <div className="space-y-3">
              {pending.map(item => (
                <div
                  key={item.exchange_id}
                  className="flex items-center justify-between gap-3 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      src={resolveAvatarUrl(item.receiver_avatar) ?? undefined}
                      name={item.receiver_name}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{item.receiver_name}</p>
                      {item.exchange_title && (
                        <p className="text-xs text-[var(--color-text-muted)] truncate">{item.exchange_title}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    color="primary"
                    onPress={() => setReviewTarget(item)}
                  >
                    {t('pending.write_review')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Tab>
      </Tabs>

      {/* Review submission modal */}
      {reviewTarget && (
        <ReviewModal
          isOpen
          onClose={() => setReviewTarget(null)}
          onSuccess={() => handleReviewWritten(reviewTarget)}
          receiverId={reviewTarget.receiver_id}
          receiverName={reviewTarget.receiver_name}
          receiverAvatar={reviewTarget.receiver_avatar}
          transactionId={reviewTarget.transaction_id ?? undefined}
        />
      )}
    </div>
  );
}
