// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Separator } from '@/components/ui/Separator';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserPlus from 'lucide-react/icons/user-plus';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
/**
 * MyVereinInvitationsPage — AG55
 *
 * Cross-Verein invitations the auth'd user has received (and sent).
 * Route: /me/verein-invitations
 */


interface InvitationDto {
  id: number;
  status: 'sent' | 'accepted' | 'declined' | 'expired' | string;
  message: string | null;
  sent_at: string | null;
  responded_at: string | null;
  expires_at: string | null;
  source_organization_id: number;
  target_organization_id: number;
  source_name: string | null;
  target_name: string | null;
  inviter_name: string | null;
  invitee_user_id?: number;
}

function statusColor(status: string): 'default' | 'success' | 'danger' | 'warning' | 'primary' {
  if (status === 'accepted') return 'success';
  if (status === 'declined') return 'danger';
  if (status === 'expired') return 'warning';
  if (status === 'sent') return 'primary';
  return 'default';
}

export default function MyVereinInvitationsPage() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const toast = useToast();
  usePageTitle(t('verein_federation.my_invitations_title'));

  const [received, setReceived] = useState<InvitationDto[]>([]);
  const [sent, setSent] = useState<InvitationDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<InvitationDto[]>('/v2/me/verein-invitations');
      if (res.success && Array.isArray(res.data)) {
        // Server returns invitations where invitee_user_id = me. Sent list comes
        // from inverse query — so we partition the same payload by inviter vs
        // invitee. Backend currently returns only received; "sent" stays empty
        // until backend extends listInvitationsForUser. Defensive split:
        const myId = user?.id;
        const recv = res.data.filter((i) => !myId || i.invitee_user_id === myId || true);
        setReceived(recv);
        setSent([]);
      } else {
        // api.get resolves { success:false } on a 4xx/5xx WITHOUT throwing, so the
        // catch never fired — without this branch a failed load just showed the empty
        // "Received" tab, indistinguishable from genuinely having no invitations.
        toast.error(t('verein_federation.load_failed'));
      }
    } catch (err) {
      logError('MyVereinInvitationsPage: load failed', err);
      toast.error(t('verein_federation.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [user, toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = useCallback(async (id: number, action: 'accept' | 'decline') => {
    try {
      const res = await api.post<InvitationDto>(`/v2/me/verein-invitations/${id}/respond`, { action });
      if (res.success) {
        await load();
      } else {
        toast.error(res.error || t('verein_federation.respond_failed'));
      }
    } catch (err) {
      logError('MyVereinInvitationsPage: respond failed', err);
      toast.error(t('verein_federation.respond_failed'));
    }
  }, [load, toast, t]);

  const renderList = (list: InvitationDto[], emptyKey: string, allowRespond: boolean) => {
    if (list.length === 0) {
      return <p className="text-sm text-muted py-8 text-center">{t(emptyKey)}</p>;
    }
    return (
      <ul className="space-y-3">
        {list.map((inv) => (
          <li key={inv.id}>
            <Card>
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold">
                      {t('verein_federation.target_label')}: {inv.target_name ?? '—'}
                    </p>
                    <p className="text-sm text-muted">
                      {t('verein_federation.from_label')}: {inv.inviter_name || inv.source_name || '—'}
                    </p>
                  </div>
                  <Chip color={statusColor(inv.status)} size="sm" variant="flat">
                    {t(`verein_federation.status_${inv.status}`)}
                  </Chip>
                </div>

                {inv.message ? (
                  <p className="text-sm bg-surface-secondary rounded p-2 italic">{inv.message}</p>
                ) : null}

                {inv.expires_at ? (
                  <p className="text-xs text-muted">
                    {t('verein_federation.expires_label')}: {new Date(inv.expires_at).toLocaleDateString(getFormattingLocale())}
                  </p>
                ) : null}

                {allowRespond && inv.status === 'sent' ? (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" variant="danger-soft" onPress={() => void respond(inv.id, 'decline')}>
                      {t('verein_federation.decline')}
                    </Button>
                    <Button size="sm" onPress={() => void respond(inv.id, 'accept')}>
                      {t('verein_federation.accept')}
                    </Button>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <PageMeta title={t('verein_federation.my_invitations_title')} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <PublicPageHero
        size="compact"
        title={t('verein_federation.my_invitations_title')}
        description={t('verein_federation.my_invitations_subtitle')}
        icon={<UserPlus className="h-6 w-6" aria-hidden="true" />}
        accent="indigo"
      />

      <Card>
        <CardHeader>
          <h2 className="sr-only">{t('verein_federation.my_invitations_title')}</h2>
        </CardHeader>
        <Separator />
        <CardBody>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('loading')} className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : (
            <Tabs aria-label={t('verein_federation.my_invitations_title')}>
              <Tab key="received" title={t('verein_federation.tab_received')}>
                {renderList(received, 'verein_federation.received_empty', true)}
              </Tab>
              <Tab key="sent" title={t('verein_federation.tab_sent')}>
                {renderList(sent, 'verein_federation.sent_empty', false)}
              </Tab>
            </Tabs>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
