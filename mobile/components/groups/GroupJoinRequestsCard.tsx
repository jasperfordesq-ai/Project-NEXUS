// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The queue of people waiting to be let into a group.
 *
 * 🔴 Members could ask to join from the phone, and a group admin could SEE that they
 * had — the pending count is on the group overview — but could do nothing about it.
 * `GET /v2/groups/{id}/requests` and `POST /v2/groups/{id}/requests/{userId}` both
 * existed with no caller in the app, so requests sat in the queue until somebody
 * opened the website. Audit 2026-09-07, fixed 2026-09-08.
 *
 * 🔴 This component loads its OWN data rather than taking it from `group-detail`.
 * That is not tidiness: `group-detail.test.tsx` stubs `useApi` positionally — a fixed
 * array of results handed out in call order — so a seventh `useApi` in that screen
 * shifts every later result by one on each re-render and breaks twelve unrelated
 * cases. Loading here keeps the screen's hook sequence exactly as it was, and only
 * costs a request on the one tab, for the one person, who can act on it.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button as HeroButton, Card as HeroCard, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/ui/Avatar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { describeApiError } from '@/lib/api/describeApiError';
import { dateLocale } from '@/lib/utils/dateLocale';
import { isRefusalStatus } from '@/lib/api/refusal';
import {
  getGroupJoinRequests,
  handleGroupJoinRequest,
  type GroupJoinRequest,
} from '@/lib/api/groups';
import { useApi } from '@/lib/hooks/useApi';
import { useTheme } from '@/lib/hooks/useTheme';

/*
  🔴 `dateLocale()`, never a bare `toLocaleDateString()`. With no argument, Intl uses
  the DEVICE locale, so a member who switched the app to Irish would still be shown
  dates in whatever language their phone is set to — and a bare 'en' is formatted as
  US English (8/17/2026), not 17/08/2026. `scripts/check-date-locale.mjs` enforces
  this and caught exactly this line on 2026-09-08.
*/
function formatRequestedAt(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(dateLocale());
}

export default function GroupJoinRequestsCard({
  groupId,
  canManage,
  onAccepted,
}: {
  groupId: number;
  canManage: boolean;
  /** Someone was let in: the member list and the group's own counts are now stale. */
  onAccepted: () => void;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const requestsApi = useApi(
    () => getGroupJoinRequests(groupId),
    [groupId],
    { enabled: canManage && groupId > 0 },
  );
  const requests: GroupJoinRequest[] = requestsApi.data?.data ?? [];

  async function answer(request: GroupJoinRequest, action: 'accept' | 'reject') {
    if (busyUserId !== null) return;
    setBusyUserId(request.user_id);
    try {
      await handleGroupJoinRequest(groupId, request.user_id, action);
      showToast({
        title: action === 'accept' ? t('detail.manage.accepted') : t('detail.manage.declined'),
        variant: 'success',
      });
      requestsApi.refresh();
      if (action === 'accept') onAccepted();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        // The server's own words: a full group answers 409 and says so, and "please
        // try again" would be wrong for that.
        description: describeApiError(err, t('detail.manage.actionFailed')),
        variant: 'danger',
      });
    } finally {
      setBusyUserId(null);
    }
  }

  function confirmDecline(request: GroupJoinRequest) {
    // Turning somebody away is not quietly undoable: they are not told why, and they
    // would have to ask again. Worth one question first.
    confirm({
      title: t('detail.manage.declineTitle'),
      message: t('detail.manage.declineMessage', { name: request.user?.name || request.name }),
      confirmLabel: t('detail.manage.decline'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: 'group-decline-confirm',
      onConfirm: () => answer(request, 'reject'),
    });
  }

  if (!canManage) return null;

  // Not an admin after all — the server is the authority, not the group payload. Show
  // nothing rather than an error the member can do nothing about; the tab still works.
  if (isRefusalStatus(requestsApi.errorStatus)) return null;

  if (requestsApi.isLoading) {
    return (
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="min-h-[96px] items-center justify-center">
          <Spinner size="sm" />
        </HeroCard.Body>
      </HeroCard>
    );
  }

  if (requestsApi.error) {
    return (
      <HeroCard className="rounded-panel p-0" testID="group-join-requests-error">
        <HeroCard.Body className="gap-3 p-4">
          <Text className="text-sm" style={{ color: theme.text }}>{requestsApi.error}</Text>
          <HeroButton size="sm" variant="secondary" onPress={requestsApi.refresh}>
            <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>
    );
  }

  // An empty queue is the normal state. A card saying "no requests" on every visit is
  // noise, so it is simply absent.
  if (requests.length === 0) return null;

  return (
    <HeroCard className="rounded-panel p-0" testID="group-join-requests">
      <HeroCard.Body className="gap-3 p-4">
        <Text className="text-base font-semibold" style={{ color: theme.text }}>
          {t('detail.manage.requestsTitle', { count: requests.length })}
        </Text>
        {requests.map((request) => {
          const name = request.user?.name || request.name || t('common:unknown');
          const isBusy = busyUserId === request.user_id;
          return (
            <View key={request.user_id} className="flex-row items-center gap-3">
              <Avatar uri={request.user?.avatar ?? request.avatar_url ?? undefined} name={name} size={40} />
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                  {name}
                </Text>
                <Text className="mt-0.5 text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {formatRequestedAt(request.requested_at ?? request.created_at)}
                </Text>
              </View>
              <View className="gap-2">
                <HeroButton
                  size="sm"
                  isDisabled={busyUserId !== null}
                  testID={`group-accept-${request.user_id}`}
                  onPress={() => void answer(request, 'accept')}
                >
                  <HeroButton.Label>
                    {isBusy ? t('detail.manage.working') : t('detail.manage.accept')}
                  </HeroButton.Label>
                </HeroButton>
                <HeroButton
                  size="sm"
                  variant="secondary"
                  isDisabled={busyUserId !== null}
                  testID={`group-decline-${request.user_id}`}
                  onPress={() => confirmDecline(request)}
                >
                  <HeroButton.Label>{t('detail.manage.decline')}</HeroButton.Label>
                </HeroButton>
              </View>
            </View>
          );
        })}
      </HeroCard.Body>
      {confirmDialog}
    </HeroCard>
  );
}
