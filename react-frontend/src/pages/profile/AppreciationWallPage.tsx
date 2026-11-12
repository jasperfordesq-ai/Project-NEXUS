// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SOC14 — AppreciationWallPage at /users/:userId/appreciations
 *
 * Someone else's page: the thank-you notes that member has chosen to show,
 * with reaction buttons. A note you sent yourself can be deleted from here.
 *
 * Your own page (warmth phase 5, owner decision 12 Nov 2026 — "the receiver
 * decides"): every note you have received, private ones included. Each one
 * says whether it shows on your profile, and you can show it, hide it again,
 * remove it, or report the sender. A second tab lists the notes you sent, so
 * you can delete one. A note is private until its receiver shows it; nobody
 * can react to a private note.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';

import Heart from 'lucide-react/icons/heart';
import Sparkles from 'lucide-react/icons/sparkles';
import Star from 'lucide-react/icons/star';
import MessageCircleHeart from 'lucide-react/icons/message-circle-heart';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Trash2 from 'lucide-react/icons/trash-2';
import Flag from 'lucide-react/icons/flag';
import Lock from 'lucide-react/icons/lock';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Pagination } from '@/components/ui/Pagination';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { ReportConcernModal } from '@/components/safety/ReportConcernModal';
import { useAuth, useTenant, useToast } from '@/contexts';

interface Person {
  id: number;
  name: string | null;
  avatar_url: string | null;
}

interface Appreciation {
  id: number;
  sender_id: number;
  receiver_id: number;
  message: string;
  is_public: boolean;
  reactions_count: number;
  created_at: string;
  sender?: Person | null;
  receiver?: Person | null;
  my_reaction?: string | null;
}

type OwnTab = 'received' | 'sent';

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
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Appreciation[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<OwnTab>('received');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [reportTarget, setReportTarget] = useState<Person | null>(null);

  const isOwn = user != null && userId != null && String(user.id) === userId;
  const title = isOwn ? t('appreciations.thanks_own_title') : t('appreciations.wall_title');
  usePageTitle(title);

  const load = useCallback(async (p: number) => {
    if (!userId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const endpoint = isOwn
        ? `/v2/me/appreciations?tab=${tab}&page=${p}`
        : `/v2/users/${userId}/appreciations?page=${p}`;
      const res = await api.get<Appreciation[]>(endpoint);
      // api.get resolves { success:false } on a 4xx WITHOUT throwing — without
      // this branch a failed load rendered the "No appreciations yet" empty
      // state as if the wall were genuinely empty.
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data);
        // The server sends `last_page`; `total_pages` is kept for older shapes.
        const meta = (res as unknown as { meta?: { last_page?: number; total_pages?: number } }).meta;
        setTotalPages(meta?.last_page ?? meta?.total_pages ?? 1);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [userId, isOwn, tab]);

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

  /** The receiver shows a note on their profile, or hides it again. */
  const setShown = useCallback(async (note: Appreciation, show: boolean) => {
    setBusyId(note.id);
    try {
      const res = await api.put(`/v2/appreciations/${note.id}/visibility`, { is_public: show });
      if (!res.success) {
        toast.error(t('appreciations.thanks_action_failed'));
        return;
      }
      setItems((prev) => prev.map((a) => (
        // A hidden note loses its reactions' place on the wall, not the count.
        a.id === note.id ? { ...a, is_public: show } : a
      )));
      toast.success(show ? t('appreciations.thanks_shown_done') : t('appreciations.thanks_hidden_done'));
    } catch {
      toast.error(t('appreciations.thanks_action_failed'));
    } finally {
      setBusyId(null);
    }
  }, [toast, t]);

  /** The receiver removes a note they were sent; the sender deletes one they wrote. */
  const remove = useCallback(async (note: Appreciation, sentByMe: boolean) => {
    const approved = await confirm({
      title: t('appreciations.thanks_remove_title'),
      body: sentByMe ? t('appreciations.thanks_remove_body_sent') : t('appreciations.thanks_remove_body'),
      confirmLabel: t('appreciations.thanks_remove_confirm'),
      cancelLabel: t('appreciations.thanks_keep'),
    });
    if (!approved) return;
    setBusyId(note.id);
    try {
      const res = await api.delete(`/v2/appreciations/${note.id}`);
      if (!res.success) {
        toast.error(t('appreciations.thanks_action_failed'));
        return;
      }
      setItems((prev) => prev.filter((a) => a.id !== note.id));
      toast.success(t('appreciations.thanks_removed_done'));
    } catch {
      toast.error(t('appreciations.thanks_action_failed'));
    } finally {
      setBusyId(null);
    }
  }, [confirm, toast, t]);

  if (loading && items.length === 0 && !isOwn) return <LoadingScreen />;

  const showingSent = isOwn && tab === 'sent';

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <PageMeta title={title} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={title}
          description={isOwn ? t('appreciations.thanks_own_intro') : undefined}
          icon={<MessageCircleHeart className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />
      </div>

      {isOwn && (
        <Tabs
          aria-label={t('appreciations.thanks_tabs_label')}
          selectedKey={tab}
          onSelectionChange={(key) => {
            setItems([]);
            setPage(1);
            setTab(key as OwnTab);
          }}
          className="mb-4"
        >
          <Tab key="received" title={t('appreciations.thanks_tab_received')} />
          <Tab key="sent" title={t('appreciations.thanks_tab_sent')} />
        </Tabs>
      )}

      {loading && items.length === 0 ? (
        <LoadingScreen />
      ) : loadError ? (
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
          title={isOwn ? t('appreciations.thanks_empty_own_title') : t('appreciations.empty_title')}
          description={
            showingSent
              ? t('appreciations.thanks_empty_sent_desc')
              : isOwn
                ? t('appreciations.thanks_empty_own_desc')
                : t('appreciations.empty_desc')
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            // On "Sent" the other person is the receiver; everywhere else, the sender.
            const person = showingSent ? a.receiver : a.sender;
            const personId = showingSent ? a.receiver_id : a.sender_id;
            const personName = person?.name ?? t('common.someone');
            const mineToManage = isOwn && !showingSent;
            const sentByMe = user != null && a.sender_id === user.id;
            const busy = busyId === a.id;
            return (
              <Card key={a.id} data-testid={`thanks-note-${a.id}`}>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Avatar src={person?.avatar_url ?? undefined} name={person?.name ?? ''} size="sm" />
                    <Link to={tenantPath(`/profile/${personId}`)} className="font-medium hover:underline">
                      {showingSent ? t('appreciations.thanks_to', { name: personName }) : personName}
                    </Link>
                    <span className="text-xs text-[var(--text-muted)] ml-auto">
                      {new Date(a.created_at).toLocaleDateString(getFormattingLocale())}
                    </span>
                  </div>
                  <p className="text-[var(--text-primary)] whitespace-pre-wrap break-words">{a.message}</p>

                  {mineToManage && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Chip
                        size="sm"
                        variant="flat"
                        data-testid={`thanks-status-${a.id}`}
                        className={a.is_public ? 'bg-accent-soft text-accent-soft-foreground' : 'bg-theme-elevated text-theme-secondary'}
                        startContent={a.is_public
                          ? <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
                      >
                        {a.is_public ? t('appreciations.thanks_shown') : t('appreciations.thanks_only_you')}
                      </Chip>
                      <Button
                        size="sm"
                        variant="flat"
                        className="bg-theme-elevated text-theme-primary"
                        isLoading={busy}
                        onPress={() => void setShown(a, !a.is_public)}
                        startContent={a.is_public
                          ? <EyeOff className="w-4 h-4" aria-hidden="true" />
                          : <Eye className="w-4 h-4" aria-hidden="true" />}
                      >
                        {a.is_public ? t('appreciations.thanks_hide') : t('appreciations.thanks_show')}
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        isDisabled={busy}
                        onPress={() => void remove(a, false)}
                        startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('appreciations.thanks_remove')}
                      </Button>
                      {a.sender ? (
                        <Button
                          size="sm"
                          variant="light"
                          isDisabled={busy}
                          onPress={() => setReportTarget(a.sender ?? null)}
                          startContent={<Flag className="w-4 h-4" aria-hidden="true" />}
                        >
                          {t('appreciations.thanks_report')}
                        </Button>
                      ) : null}
                    </div>
                  )}

                  {!mineToManage && sentByMe && (
                    <div className="pt-1">
                      <Button
                        size="sm"
                        variant="light"
                        isDisabled={busy}
                        onPress={() => void remove(a, true)}
                        startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('appreciations.thanks_remove')}
                      </Button>
                    </div>
                  )}

                  {/* Nobody can react to a private note, so the buttons only
                      show on a note that is on the profile. */}
                  {a.is_public && !showingSent && (
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
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {!loadError && totalPages > 1 && (
        <div className="flex justify-center mt-6">
          <Pagination total={totalPages} page={page} onChange={setPage} />
        </div>
      )}

      {/* Report the sender of a note to the community's coordinators. */}
      {reportTarget ? (
        <ReportConcernModal
          targetKind="member"
          targetId={reportTarget.id}
          targetName={reportTarget.name}
          isOpen
          onClose={() => setReportTarget(null)}
        />
      ) : null}
    </div>
  );
}
