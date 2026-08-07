// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import Toggle from '@/components/ui/Toggle';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import {
  approveSubAccount,
  getManagedSubAccounts,
  getManagerSubAccounts,
  getSubAccountActivity,
  requestSubAccount,
  resolveSupportTiers,
  revokeSubAccount,
  updateSubAccountTiers,
  type SubAccountActivitySummary,
  type SubAccountPermission,
  type SubAccountRelationship,
  type SupportTier,
  type SupportTierCapability,
} from '@/lib/api/settings';

/**
 * The permissions actually OFFERED — i.e. the ones the backend enforces.
 *
 * 🔴 `can_view_messages` is deliberately absent, matching the React and
 * accessible frontends (removed there 2026-08-05). It was a switch that saved
 * successfully and did nothing: no code anywhere consults it, so a family
 * could be told a carer can read a dependent's conversations when no such
 * thing happens. Do not re-add it without the counterparty notice existing —
 * the other person in a conversation never agreed to it being shared.
 */
const PERMISSIONS: SubAccountPermission[] = [
  'can_view_activity',
  'can_manage_listings',
  'can_transact',
];

function displayName(item: SubAccountRelationship, fallback: string) {
  return [item.first_name, item.last_name].filter(Boolean).join(' ').trim() || item.email || fallback;
}

async function loadLinkedAccounts() {
  const [managed, managers] = await Promise.all([
    getManagedSubAccounts(),
    getManagerSubAccounts(),
  ]);
  return { managed, managers };
}

export default function SettingsLinkedAccountsRoute() {
  return (
    <ModalErrorBoundary>
      <SettingsLinkedAccountsScreen />
    </ModalErrorBoundary>
  );
}

function SettingsLinkedAccountsScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const query = useApi(loadLinkedAccounts, []);

  async function sendRequest() {
    const trimmed = email.trim();
    if (!trimmed) {
      showToast({ title: t('common:errors.alertTitle'), description: t('linkedAccounts.emailRequired'), variant: 'warning' });
      return;
    }
    try {
      setIsSending(true);
      await requestSubAccount(trimmed);
      setEmail('');
      query.refresh();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('linkedAccounts.requestFailed'), variant: 'danger' });
    } finally {
      setIsSending(false);
    }
  }

  async function approve(item: SubAccountRelationship) {
    try {
      setBusyId(item.relationship_id);
      await approveSubAccount(item.relationship_id);
      query.refresh();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('linkedAccounts.approveFailed'), variant: 'danger' });
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(item: SubAccountRelationship) {
    try {
      setBusyId(item.relationship_id);
      await revokeSubAccount(item.relationship_id);
      query.refresh();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('linkedAccounts.revokeFailed'), variant: 'danger' });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * 🔴 Tier-aware toggles — reads AND writes go through the tier vocabulary.
   *
   * The old handler flipped the legacy boolean. That was a live escalation
   * hazard: `co_decide` ("prepare only") projects to boolean `false`, so this
   * screen rendered a real prepare-only grant as an OFF toggle, and "turning
   * it on" posted a boolean the backend mapped to full act-alone power.
   *
   * Now: the toggle's on/off state comes from the resolved tier (any level ≠
   * none shows as on), and changes post explicit tiers — `co_decide` when
   * enabling listings/credits (the recommended family level; act-alone can be
   * chosen on the web's three-level control), `assist` for activity, `none`
   * when disabling. This screen can therefore never escalate anything.
   */
  async function togglePermission(item: SubAccountRelationship, permission: SubAccountPermission) {
    const capability: SupportTierCapability | null =
      permission === 'can_view_activity' ? 'activity'
      : permission === 'can_manage_listings' ? 'listings'
      : permission === 'can_transact' ? 'credits'
      : null;
    if (!capability) return;

    const currentTier = resolveSupportTiers(item.permissions)[capability];
    const nextTier: SupportTier = currentTier !== 'none'
      ? 'none'
      : (capability === 'activity' ? 'assist' : 'co_decide');

    try {
      setBusyId(item.relationship_id);
      await updateSubAccountTiers(item.relationship_id, { [capability]: nextTier });
      query.refresh();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('linkedAccounts.permissionFailed'), variant: 'danger' });
    } finally {
      setBusyId(null);
    }
  }

  const managed = query.data?.managed ?? [];
  const managers = query.data?.managers ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background">
      <AppTopBar title={t('linkedAccounts.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <HeroCard className="overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="people-circle-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('linkedAccounts.eyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('linkedAccounts.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('linkedAccounts.subtitle')}</Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-base font-bold" style={{ color: theme.text }}>{t('linkedAccounts.addTitle')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('linkedAccounts.addDescription')}</Text>
            <Input
              value={email}
              onChangeText={setEmail}
              label={t('linkedAccounts.emailLabel')}
              placeholder={t('linkedAccounts.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <HeroButton variant="primary" style={{ backgroundColor: primary }} onPress={sendRequest} isDisabled={isSending}>
              <HeroButton.Label>{isSending ? t('linkedAccounts.sending') : t('linkedAccounts.sendRequest')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>

        {query.isLoading ? (
          <View className="items-center py-8"><Spinner size="lg" /></View>
        ) : query.error ? (
          <Surface variant="secondary" className="rounded-panel p-4">
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('linkedAccounts.loadFailed')}</Text>
          </Surface>
        ) : (
          <>
            <RelationshipSection
              title={t('linkedAccounts.managedTitle')}
              subtitle={t('linkedAccounts.managedDescription')}
              empty={t('linkedAccounts.managedEmpty')}
              items={managed}
              canManagePermissions
              busyId={busyId}
              onApprove={approve}
              onRevoke={revoke}
              onTogglePermission={togglePermission}
            />
            <RelationshipSection
              title={t('linkedAccounts.managersTitle')}
              subtitle={t('linkedAccounts.managersDescription')}
              empty={t('linkedAccounts.managersEmpty')}
              items={managers}
              canApprove
              busyId={busyId}
              onApprove={approve}
              onRevoke={revoke}
              onTogglePermission={togglePermission}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RelationshipSection({
  title,
  subtitle,
  empty,
  items,
  canManagePermissions,
  canApprove,
  busyId,
  onApprove,
  onRevoke,
  onTogglePermission,
}: {
  title: string;
  subtitle: string;
  empty: string;
  items: SubAccountRelationship[];
  canManagePermissions?: boolean;
  canApprove?: boolean;
  busyId: number | null;
  onApprove: (item: SubAccountRelationship) => void;
  onRevoke: (item: SubAccountRelationship) => void;
  onTogglePermission: (item: SubAccountRelationship, permission: SubAccountPermission) => void;
}) {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const primary = usePrimaryColor();

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View>
          <Text className="text-base font-bold" style={{ color: theme.text }}>{title}</Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{subtitle}</Text>
        </View>
        {items.length === 0 ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>{empty}</Text>
        ) : (
          <View className="gap-3">
            {items.map((item) => {
              const name = displayName(item, t('linkedAccounts.unknownMember'));
              const isBusy = busyId === item.relationship_id;
              return (
                <Surface key={item.relationship_id} variant="secondary" className="gap-3 rounded-panel-inner p-3">
                  <View className="flex-row items-start gap-3">
                    <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                      <Ionicons name="person-outline" size={18} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-semibold" style={{ color: theme.text }} numberOfLines={1}>{name}</Text>
                      <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{item.email}</Text>
                    </View>
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{t(`linkedAccounts.status.${item.status}`, { defaultValue: item.status })}</Chip.Label>
                    </Chip>
                  </View>

                  {canManagePermissions && item.status === 'active' ? (
                    <View className="gap-2">
                      <Text className="text-xs font-semibold" style={{ color: theme.text }}>{t('linkedAccounts.permissionsTitle')}</Text>
                      {PERMISSIONS.map((permission) => {
                        // 🔴 On/off must come from the resolved TIER, not the
                        // legacy boolean: a co_decide ("prepare only") grant
                        // projects to boolean false, and rendering it as off
                        // is what made this screen an escalation hazard.
                        const tiers = resolveSupportTiers(item.permissions);
                        const capability =
                          permission === 'can_view_activity' ? 'activity'
                          : permission === 'can_manage_listings' ? 'listings'
                          : 'credits';
                        return (
                          <Toggle
                            key={permission}
                            label={t(`linkedAccounts.permissions.${permission}`)}
                            accessibilityLabel={t('linkedAccounts.permissionToggle', {
                              permission: t(`linkedAccounts.permissions.${permission}`),
                              name,
                            })}
                            value={tiers[capability] !== 'none'}
                            onValueChange={() => onTogglePermission(item, permission)}
                            disabled={isBusy}
                          />
                        );
                      })}
                    </View>
                  ) : null}

                  {/* Read-only activity view (React SupportActivityModal parity).
                      Offered only when the grant is on AND the link is active —
                      never show what does not work. Seeing is all it does. */}
                  {canManagePermissions && item.status === 'active' && resolveSupportTiers(item.permissions).activity !== 'none' ? (
                    <ActivitySection childUserId={item.user_id} name={name} />
                  ) : null}

                  <View className="flex-row gap-2">
                    {canApprove && item.status === 'pending' ? (
                      <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => onApprove(item)} isDisabled={isBusy}>
                        <HeroButton.Label>{t('linkedAccounts.approve')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                    <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => onRevoke(item)} isDisabled={isBusy}>
                      <HeroButton.Label>{item.status === 'pending' && canApprove ? t('linkedAccounts.decline') : t('linkedAccounts.remove')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                </Surface>
              );
            })}
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

const ACTIVITY_TIMELINE_LIMIT = 10;

/** Timeline vocabulary the client knows; anything else renders the generic
 *  label rather than leaking the server code into member-facing text. */
const KNOWN_ACTIVITY_TYPES = new Set(['post', 'comment', 'connection', 'gave_hours', 'received_hours']);

/**
 * Read-only activity summary for one supported member, fetched when the
 * member expands it. Deliberately offers NO actions: seeing is the `assist`
 * tier; preparing and acting are different tiers with their own screens.
 */
function ActivitySection({ childUserId, name }: { childUserId: number; name: string }) {
  const { t } = useTranslation('settings');
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<SubAccountActivitySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!expanded || summary !== null) return;
    let cancelled = false;
    setIsLoading(true);
    setFailed(false);
    getSubAccountActivity(childUserId)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, summary, childUserId]);

  const hours = summary?.hours_summary;
  const connections = summary?.connection_stats;
  const engagement = summary?.engagement;
  const timeline = (summary?.timeline ?? []).slice(0, ACTIVITY_TIMELINE_LIMIT);

  const statRow = (label: string, value: number | string | undefined) => (
    <View className="flex-row items-center justify-between">
      <Text className="text-xs" style={{ color: theme.textSecondary }}>{label}</Text>
      <Text className="text-sm font-semibold" style={{ color: theme.text }}>{value ?? 0}</Text>
    </View>
  );

  return (
    <View className="gap-2">
      <HeroButton
        size="sm"
        variant="secondary"
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityLabel={t('linkedAccounts.activity.toggleAria', { name })}
      >
        <HeroButton.Label>
          {expanded ? t('linkedAccounts.activity.hide') : t('linkedAccounts.activity.show')}
        </HeroButton.Label>
      </HeroButton>

      {expanded ? (
        <View className="gap-3">
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
            {t('linkedAccounts.activity.explainer', { name })}
          </Text>

          {isLoading ? (
            <View className="items-center py-3"><Spinner size="sm" /></View>
          ) : failed ? (
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {t('linkedAccounts.activity.loadFailed')}
            </Text>
          ) : summary ? (
            <>
              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('linkedAccounts.activity.hoursHeading')}
                </Text>
                {statRow(t('linkedAccounts.activity.hoursGiven'), hours?.hours_given)}
                {statRow(t('linkedAccounts.activity.hoursReceived'), hours?.hours_received)}
                {statRow(t('linkedAccounts.activity.netBalance'), hours?.net_balance)}
              </View>

              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('linkedAccounts.activity.communityHeading')}
                </Text>
                {statRow(t('linkedAccounts.activity.connections'), connections?.total_connections)}
                {statRow(t('linkedAccounts.activity.groups'), connections?.groups_joined)}
                {statRow(t('linkedAccounts.activity.posts'), engagement?.posts_count)}
              </View>

              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('linkedAccounts.activity.timelineHeading')}
                </Text>
                {timeline.length === 0 ? (
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                    {t('linkedAccounts.activity.timelineEmpty')}
                  </Text>
                ) : (
                  timeline.map((item) => (
                    <View key={`${item.activity_type}-${item.id}-${item.created_at}`} className="gap-0.5">
                      <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>
                        {KNOWN_ACTIVITY_TYPES.has(item.activity_type)
                          ? t(`linkedAccounts.activity.types.${item.activity_type}`)
                          : t('linkedAccounts.activity.types.other')}
                      </Text>
                      {item.description ? (
                        <Text className="text-sm" style={{ color: theme.text }} numberOfLines={3}>
                          {item.description}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
