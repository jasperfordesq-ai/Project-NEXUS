// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { buildWebUrl } from '@/lib/utils/webUrl';
import { useMemo } from 'react';
import {
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  getFederationPartner,
  getFederationPartners,
  type FederatedTenant,
} from '@/lib/api/federation';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import AccentIcon from '@/components/ui/AccentIcon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];


const permissionIcons: Record<string, IoniconName> = {
  profiles: 'person-outline',
  messaging: 'chatbubble-ellipses-outline',
  transactions: 'swap-horizontal-outline',
  listings: 'list-outline',
  events: 'calendar-outline',
  groups: 'people-outline',
};

const defaultPermissions = ['profiles', 'messaging', 'transactions', 'listings', 'events', 'groups'];

const partnerActionMeta: Record<string, { icon: IoniconName; labelKey: string; tone: string; href: string }> = {
  profiles: { icon: 'people-outline', labelKey: 'detail.browseMembers', tone: '#6366f1', href: '/(modals)/federation-members' },
  messaging: { icon: 'chatbubbles-outline', labelKey: 'detail.openMessages', tone: '#06b6d4', href: '/(modals)/federation-messages' },
  listings: { icon: 'list-outline', labelKey: 'detail.browseListings', tone: '#f59e0b', href: '/(modals)/federation-listings' },
  events: { icon: 'calendar-outline', labelKey: 'detail.browseEvents', tone: '#f43f5e', href: '/(modals)/federation-events' },
  groups: { icon: 'people-circle-outline', labelKey: 'detail.browseGroups', tone: '#8b5cf6', href: '/(modals)/federation-groups' },
};

function unwrapPartner(response: { data?: FederatedTenant } | FederatedTenant | null | undefined) {
  if (!response) return null;
  if (typeof response === 'object' && 'data' in response && response.data) {
    return response.data;
  }
  return response as FederatedTenant;
}

async function loadPartner(id: string) {
  try {
    return await getFederationPartner(id);
  } catch (error) {
    const partners = await getFederationPartners(null);
    const fallback = partners.data.find((partner) => (
      String(partner.id) === id ||
      (partner.external_partner_id !== undefined && `ext-${String(partner.external_partner_id)}` === id)
    ));
    if (fallback) return { data: fallback };
    throw error;
  }
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

function normalizeUrl(value?: string | null) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function getLevelLabel(
  partner: FederatedTenant,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (partner.federation_level_name) return partner.federation_level_name;
  const level = Number(partner.federation_level ?? 0);
  const keys: Record<number, string> = {
    1: 'detail.levelDiscovery',
    2: 'detail.levelSocial',
    3: 'detail.levelEconomic',
    4: 'detail.levelIntegrated',
  };
  return t(keys[level] ?? 'detail.levelUnknown');
}

function StatTile({
  icon,
  label,
  value,
  tone,
  theme,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-2 rounded-panel-inner p-4">
      <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={2}>
        {value}
      </Text>
      <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={2}>
        {label}
      </Text>
    </Surface>
  );
}

function PartnerActionGrid({
  partner,
  permissions,
  t,
  theme,
}: {
  partner: FederatedTenant;
  permissions: string[];
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
}) {
  const actions = Object.entries(partnerActionMeta)
    .filter(([permission]) => permissions.includes(permission))
    .map(([permission, meta]) => ({ permission, ...meta }));

  if (actions.length === 0) return null;

  return (
    <View className="mb-4 gap-3">
      <Text className="text-lg font-bold" style={{ color: theme.text }}>
        {t('detail.explorePartner')}
      </Text>
      <View className="flex-row flex-wrap gap-3">
        {actions.map((action) => (
          <HeroButton
            key={action.permission}
            variant="secondary"
            className="min-w-[46%] flex-1"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: action.href, params: { partner_id: String(partner.id) } } as unknown as Href);
            }}
            accessibilityLabel={t(action.labelKey)}
          >
            <Ionicons name={action.icon} size={16} color={action.tone} />
            <HeroButton.Label>{t(action.labelKey)}</HeroButton.Label>
          </HeroButton>
        ))}
      </View>
    </View>
  );
}

function EmptyPartnerState({
  isInvalid,
  refresh,
  t,
  theme,
  primary,
}: {
  isInvalid: boolean;
  refresh: () => void;
  t: (key: string) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
}) {
  return (
    <View className="flex-1 px-4">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="items-center gap-4 p-6">
          <View className="size-14 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(theme.error, 0.14) }}>
            <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
          </View>
          <Text className="text-center text-base font-semibold" style={{ color: theme.text }}>
            {t('detail.notFound')}
          </Text>
          <View className="w-full gap-2">
            {!isInvalid ? (
              <HeroButton variant="secondary" onPress={refresh} accessibilityLabel={t('detail.retry')}>
                <Ionicons name="refresh-outline" size={16} color={primary} />
                <HeroButton.Label>{t('detail.retry')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            <HeroButton variant="primary" onPress={() => router.replace('/(modals)/federation')} accessibilityLabel={t('detail.goBack')}>
              <AccentIcon name="git-network-outline" size={16} />
              <HeroButton.Label>{t('detail.browseNetwork')}</HeroButton.Label>
            </HeroButton>
          </View>
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

export default function FederationPartnerScreen() {
  const { t } = useTranslation(['federation', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const primary = usePrimaryColor();
  const { tenant } = useTenant();
  const theme = useTheme();

  const partnerId = useMemo(() => {
    const rawId = Array.isArray(id) ? id[0] : id;
    return typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : null;
  }, [id]);

  const {
    data,
    isLoading,
    refresh,
  } = useApi(
    () => loadPartner(partnerId ?? ''),
    [partnerId],
    { enabled: !!partnerId },
  );

  const partner = unwrapPartner(data);
  const websiteUrl = normalizeUrl(partner?.website);
  const levelLabel = partner ? getLevelLabel(partner, t) : '';
  const connectedDate = partner ? formatDate(partner.partnership_since ?? partner.connected_since) : '';
  const permissions = partner?.permissions?.length ? partner.permissions : defaultPermissions;

  async function handleShare() {
    if (!partner) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = buildWebUrl(tenant?.slug, `/federation/partners/${partner.id}`);
    try {
      await Share.share({ message: t('detail.shareMessage', { name: partner.name, url }) });
    } catch {
      // Native share can be cancelled by the user.
    }
  }

  async function openWebsite() {
    if (!websiteUrl) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (await Linking.canOpenURL(websiteUrl)) {
      await Linking.openURL(websiteUrl);
    }
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar
          title={t('detail.title')}
          backLabel={t('common:back')}
          fallbackHref="/(modals)/federation"
          rightAction={partner ? { accessibilityLabel: t('detail.share'), icon: 'share-outline', onPress: handleShare } : undefined}
        />

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <Spinner size="lg" />
          </View>
        ) : !partner ? (
          <EmptyPartnerState
            isInvalid={!partnerId}
            refresh={refresh}
            t={t}
            theme={theme}
            primary={primary}
          />
        ) : (
          <ScrollView
            refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          >
            <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-5 p-4 pt-0">
                <View className="flex-row items-start gap-4">
                  <Avatar uri={partner.logo} name={partner.name} size={72} />
                  <View className="min-w-0 flex-1 gap-2">
                    <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                      {t('detail.eyebrow')}
                    </Text>
                    <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={3}>
                      {partner.name}
                    </Text>
                    {partner.tagline ? (
                      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {partner.tagline}
                      </Text>
                    ) : null}
                    <View className="flex-row flex-wrap gap-2">
                      <Chip size="sm" variant="secondary" color={partner.is_external ? 'warning' : 'success'}>
                        <Ionicons name={partner.is_external ? 'globe-outline' : 'shield-checkmark-outline'} size={13} color={partner.is_external ? '#f59e0b' : '#22c55e'} />
                        <Chip.Label>{partner.is_external ? t('detail.externalPartner') : t('detail.integratedPartner')}</Chip.Label>
                      </Chip>
                      <Chip size="sm" variant="secondary" color="accent">
                        <Ionicons name="git-network-outline" size={13} color={primary} />
                        <Chip.Label>{levelLabel}</Chip.Label>
                      </Chip>
                    </View>
                  </View>
                </View>

                {partner.location || partner.country ? (
                  <Surface variant="secondary" className="flex-row items-center gap-2 rounded-panel-inner p-3">
                    <Ionicons name="location-outline" size={17} color={primary} />
                    <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.text }} numberOfLines={2}>
                      {[partner.location, partner.country].filter(Boolean).join(', ')}
                    </Text>
                  </Surface>
                ) : null}
              </HeroCard.Body>
            </HeroCard>

            <View className="mb-4 flex-row flex-wrap gap-3">
              <StatTile
                icon="people-outline"
                label={t('detail.memberTotal')}
                value={(partner.member_count ?? 0).toLocaleString(dateLocale())}
                tone={primary}
                theme={theme}
              />
              <StatTile
                icon="calendar-outline"
                label={t('detail.partnerSinceLabel')}
                value={connectedDate ? t('detail.connectedDate', { date: connectedDate }) : t('detail.levelUnknown')}
                tone="#06b6d4"
                theme={theme}
              />
              <StatTile
                icon="shield-outline"
                label={t('detail.level')}
                value={levelLabel}
                tone="#a855f7"
                theme={theme}
              />
              {websiteUrl ? (
                <StatTile
                  icon="globe-outline"
                  label={t('detail.website')}
                  value={websiteUrl.replace(/^https?:\/\//i, '')}
                  tone="#f59e0b"
                  theme={theme}
                />
              ) : null}
            </View>

            <View className="mb-4 gap-3">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>
                {t('detail.about')}
              </Text>
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="p-4">
                  <Text className="text-sm leading-6" style={{ color: theme.textSecondary }}>
                    {partner.description || partner.tagline || t('detail.noDescription')}
                  </Text>
                </HeroCard.Body>
              </HeroCard>
            </View>

            <View className="mb-4 gap-3">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>
                {t('detail.availableFeatures')}
              </Text>
              <HeroCard className="rounded-panel p-0">
                <HeroCard.Body className="flex-row flex-wrap gap-2 p-4">
                  {permissions.map((permission) => (
                    <Chip key={permission} size="sm" variant="secondary">
                      <Ionicons name={permissionIcons[permission] ?? 'checkmark-circle-outline'} size={13} color={primary} />
                      <Chip.Label>{t(`detail.permission${permission.charAt(0).toUpperCase()}${permission.slice(1)}`)}</Chip.Label>
                    </Chip>
                  ))}
                </HeroCard.Body>
              </HeroCard>
            </View>

            <PartnerActionGrid partner={partner} permissions={permissions} t={t} theme={theme} />

            <View className="gap-3">
              {websiteUrl ? (
                <HeroButton variant="primary" onPress={openWebsite} accessibilityLabel={t('visitWebsite')}>
                  <AccentIcon name="open-outline" size={16} />
                  <HeroButton.Label>{t('visitWebsite')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              <HeroButton variant="secondary" onPress={handleShare} accessibilityLabel={t('detail.share')}>
                <Ionicons name="share-outline" size={16} color={primary} />
                <HeroButton.Label>{t('detail.share')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={() => router.push('/(modals)/federation-settings' as Href)} accessibilityLabel={t('detail.federationSettings')}>
                <Ionicons name="settings-outline" size={16} color={primary} />
                <HeroButton.Label>{t('detail.federationSettings')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={() => router.replace('/(modals)/federation')} accessibilityLabel={t('detail.browseNetwork')}>
                <Ionicons name="git-network-outline" size={16} color={primary} />
                <HeroButton.Label>{t('detail.browseNetwork')}</HeroButton.Label>
              </HeroButton>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
