// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organisation dashboard › Wellbeing, on the phone (deep audit 21 Oct 2026, finding 4).
 *
 * The organisation's owner, admins and safeguarding leads get a bell, a push and an email
 * when one of its volunteers says they are low or struggling and asks for someone to get
 * in touch. The push links to `/volunteering/org/{id}/dashboard?tab=wellbeing`, and the
 * app's dashboard had no such tab — it opened the overview with nothing about the alert.
 * This mirrors the website's `OrgWellbeingTab.tsx`: who, how they feel, when, whether the
 * organisation was told, and a way to message them. Name and mood only; the note stays
 * with the community's safeguarding staff.
 *
 * The tab is shown to everyone who can open the dashboard, and the server decides: a
 * plain team member gets 403 `NOT_ORGANISATION_CONTACT`, which reads as "you cannot see
 * this", never as an empty list.
 */

import { Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Card as HeroCard, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import EmptyState from '@/components/ui/EmptyState';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { Ionicons } from '@/components/ui/Icon';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { getOrganisationWellbeing, type OrganisationWellbeingItem } from '@/lib/api/volunteering';
import { isRefusalStatus } from '@/lib/api/refusal';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { formatWellbeingDateTime } from '@/lib/utils/wellbeingTime';

const STATUSES = ['active', 'acknowledged', 'resolved', 'dismissed'] as const;

function isOpen(item: OrganisationWellbeingItem): boolean {
  return item.status === 'active' || item.status === 'acknowledged';
}

function statusKey(status: string): (typeof STATUSES)[number] {
  return (STATUSES as readonly string[]).includes(status) ? status as (typeof STATUSES)[number] : 'active';
}

function WellbeingItemCard({ item }: { item: OrganisationWellbeingItem }) {
  const { t } = useTranslation(['volunteering']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const open = isOpen(item);
  const moodTone = item.mood === 1 ? theme.error : theme.warning;
  const checkedIn = formatWellbeingDateTime(item.checkin_at);
  const toldAt = formatWellbeingDateTime(item.told_at);
  return (
    <HeroCard
      className="rounded-panel p-0"
      style={open ? { borderWidth: 1, borderColor: withAlpha(theme.error, 0.3) } : undefined}
      testID={`org-wellbeing-item-${item.alert_id}`}
    >
      <HeroCard.Body className="gap-2 p-4">
        <Text className="text-base font-semibold" style={{ color: theme.text }}>{item.volunteer.name}</Text>
        <View className="flex-row flex-wrap gap-2">
          <Chip size="sm" variant="secondary" color="default">
            <Ionicons name="heart-circle-outline" size={12} color={moodTone} />
            <Chip.Label>{t(item.mood === 1 ? 'org.wellbeing.moodStruggling' : 'org.wellbeing.moodLow')}</Chip.Label>
          </Chip>
          <Chip size="sm" variant="secondary" color="default">
            <Chip.Label>{t(`org.wellbeing.status.${statusKey(item.status)}`)}</Chip.Label>
          </Chip>
        </View>
        {checkedIn ? (
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t('org.wellbeing.checkedIn', { date: checkedIn })}</Text>
        ) : null}
        <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
          {toldAt ? t('org.wellbeing.toldOn', { date: toldAt }) : t('org.wellbeing.notTold')}
        </Text>
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {open ? t('org.wellbeing.whatToDo') : t('org.wellbeing.closedHelp')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <HeroButton
            size="sm"
            variant="secondary"
            accessibilityLabel={t('org.wellbeing.message', { name: item.volunteer.name })}
            onPress={() => router.push({ pathname: '/(modals)/thread', params: { recipientId: String(item.volunteer.id) } } as unknown as Href)}
          >
            <Ionicons name="chatbubble-outline" size={16} color={primary} />
            <HeroButton.Label>{t('org.wellbeing.message', { name: item.volunteer.name })}</HeroButton.Label>
          </HeroButton>
          <HeroButton
            size="sm"
            variant="ghost"
            accessibilityLabel={t('org.wellbeing.viewProfile')}
            onPress={() => router.push({ pathname: '/(modals)/member-profile', params: { id: String(item.volunteer.id) } } as unknown as Href)}
          >
            <Ionicons name="person-outline" size={16} color={theme.textSecondary} />
            <HeroButton.Label>{t('org.wellbeing.viewProfile')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

export default function OrgWellbeingPanel({ orgId }: { orgId: number }) {
  const { t } = useTranslation(['volunteering', 'common']);
  const theme = useTheme();
  const api = useApi(() => getOrganisationWellbeing(orgId), [orgId], { clearOnRefusal: true });
  const items = api.data?.data?.items ?? [];

  let body: React.ReactNode;
  if (api.isLoading && !api.data) {
    body = <ListSkeleton rows={2} testID="org-wellbeing-skeleton" />;
  } else if (api.error && api.errorCode === 'FEATURE_DISABLED') {
    body = <EmptyState icon="heart-circle-outline" title={t('org.wellbeing.switchedOff')} testID="org-wellbeing-switched-off" />;
  } else if (api.error && isRefusalStatus(api.errorStatus)) {
    body = <EmptyState icon="lock-closed-outline" title={t('org.wellbeing.forbidden')} testID="org-wellbeing-forbidden" />;
  } else if (api.error && (api.errorStatus === 429 || api.errorCode === 'RATE_LIMIT_EXCEEDED')) {
    body = (
      <Surface variant="secondary" className="flex-row items-start gap-3 rounded-panel-inner p-3" testID="org-wellbeing-rate-limited" accessibilityRole="alert">
        <Ionicons name="time-outline" size={16} color={theme.warning} />
        <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.text }}>{t('org.wellbeing.rateLimited')}</Text>
        <HeroButton size="sm" variant="secondary" isDisabled={api.isLoading} onPress={api.refresh}>
          <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
        </HeroButton>
      </Surface>
    );
  } else if (api.error && !api.data) {
    body = (
      <View className="gap-3" testID="org-wellbeing-error">
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('org.wellbeing.loadError')}</Text>
        <HeroButton size="sm" variant="secondary" isDisabled={api.isLoading} onPress={api.refresh}>
          <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
        </HeroButton>
      </View>
    );
  } else if (items.length === 0) {
    body = <EmptyState icon="heart-circle-outline" title={t('org.wellbeing.empty')} subtitle={t('org.wellbeing.emptyDesc')} testID="org-wellbeing-empty" />;
  } else {
    const waiting = items.filter(isOpen).length;
    body = (
      <View className="gap-3">
        <RefreshFailedNotice error={api.error} onRetry={api.refresh} isRetrying={api.isLoading} testID="org-wellbeing-refresh-failed" />
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('org.wellbeing.summary', { count: waiting })}</Text>
        {items.map((item) => <WellbeingItemCard key={item.alert_id} item={item} />)}
        <View className="flex-row items-start gap-2">
          <Ionicons name="lock-closed-outline" size={14} color={theme.textMuted} />
          <Text className="min-w-0 flex-1 text-xs leading-4" style={{ color: theme.textMuted }}>{t('org.wellbeing.confidentiality')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-4" testID="org-wellbeing-panel">
      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('org.wellbeing.intro')}</Text>
      {body}
    </View>
  );
}
