// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { getOrganisation } from '@/lib/api/organisations';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { buildWebUrl } from '@/lib/utils/webUrl';
import AccentIcon from '@/components/ui/AccentIcon';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

const TRANSLATABLE_STATUSES = new Set(['approved', 'active', 'pending', 'declined']);

function getStatusLabel(status: string | null | undefined, t: (key: string) => string): string | null {
  if (!status) {
    return null;
  }

  const normalized = status.toLowerCase();
  if (!TRANSLATABLE_STATUSES.has(normalized)) {
    return status;
  }

  return t(`status.${normalized}`);
}

function ActionPill({
  label,
  icon,
  onPress,
  primary,
  tone = 'secondary',
  accessibilityLabel,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary: string;
  tone?: 'primary' | 'secondary';
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const isPrimary = tone === 'primary';

  return (
    // 🔴 No fill override on the primary pill: HeroUI derives the label colour from the same
    // accent pair it paints the fill with, so a hardcoded fill + white icon split them on
    // pale brands (S4-22). The secondary pill keeps its tinted outline.
    <HeroButton
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      size="sm"
      variant={isPrimary ? 'primary' : 'secondary'}
      style={isPrimary ? undefined : {
        backgroundColor: withAlpha(primary, 0.12),
        borderWidth: 1,
        borderColor: withAlpha(primary, 0.22),
      }}
    >
      {isPrimary ? <AccentIcon name={icon} size={16} /> : <Ionicons name={icon} size={16} color={primary} />}
      <HeroButton.Label className="text-sm font-semibold" style={isPrimary ? undefined : { color: theme.text }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}

export default function OrganisationDetailScreen() {
  const { t } = useTranslation(['organisations', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();

  const orgId = Number(id);
  const safeId = isNaN(orgId) || orgId <= 0 ? 0 : orgId;

  const { data, isLoading, error, refresh } = useApi(
    () => getOrganisation(safeId),
    [safeId],
    { enabled: safeId > 0 },
  );

  const organisation = data?.data ?? null;

  if (safeId === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/organisations" />
        <EmptyState
          icon="business-outline"
          title={t('detail.invalidId')}
          subtitle={t('detail.invalidIdHint')}
          actionLabel={t('detail.browseOrganisations')}
          onAction={() => router.replace('/(modals)/organisations')}
        />
      </SafeAreaView>
    );
  }

  // `&& !organisation`: a pull-to-refresh used to swap the whole screen for a spinner (S4-07).
  if (isLoading && !organisation) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/organisations" />
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  // 🔴 A network failure used to read as "not found" (S4-06). It gets a retry instead.
  if (!organisation && error) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/organisations" />
        <View className="flex-1 justify-center" style={{ flex: 1 }}>
          <ErrorState subtitle={error} onRetry={refresh} isRetrying={isLoading} testID="organisation-detail-error" />
        </View>
      </SafeAreaView>
    );
  }

  if (!organisation) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detailTitle')} backLabel={t('common:back')} fallbackHref="/(modals)/organisations" />
        <EmptyState
          icon="business-outline"
          title={t('detail.notFound')}
          subtitle={t('detail.notFoundHint')}
          actionLabel={t('detail.browseOrganisations')}
          onAction={() => router.replace('/(modals)/organisations')}
        />
      </SafeAreaView>
    );
  }

  async function handleShare() {
    if (!organisation) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `${organisation.name} - ${buildWebUrl(tenant?.slug, `/organisations/${organisation.id}`)}`,
      });
    } catch {
      // Share sheet dismissed.
    }
  }

  async function handleOpenWebsite() {
    if (!organisation?.website) return;
    const url = organisation.website.startsWith('http') ? organisation.website : `https://${organisation.website}`;
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      showToast({ title: t('common:errors.alertTitle'), description: url, variant: 'danger' });
    }
  }

  const membersCount = organisation.members_count ?? 0;
  const listingsCount = organisation.listings_count ?? 0;
  const opportunityCount = organisation.opportunity_count ?? 0;
  const totalHours = organisation.total_hours ?? 0;
  const statusLabel = getStatusLabel(organisation.status, t);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar
          title={t('detailTitle')}
          backLabel={t('common:back')}
          fallbackHref="/(modals)/organisations"
          rightAction={{
            accessibilityLabel: t('detail.share'),
            icon: 'share-outline',
            onPress: handleShare,
          }}
        />
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />
          }
        >
          <HeroCard className="mb-4 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}>
            <View className="h-1" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-5 p-5">
              <View className="flex-row items-start gap-4">
                <Avatar uri={organisation.logo ?? organisation.logo_url ?? null} name={organisation.name} size={72} />
                <View className="min-w-0 flex-1 gap-2">
                  <View className="flex-row flex-wrap gap-2">
                    {organisation.verified ? (
                      <Chip size="sm" variant="secondary">
                        <Ionicons name="checkmark-circle-outline" size={12} color={primary} />
                        <Chip.Label>{t('verified')}</Chip.Label>
                      </Chip>
                    ) : null}
                    {statusLabel ? (
                      <Chip size="sm" variant="secondary">
                        <Chip.Label>{statusLabel}</Chip.Label>
                      </Chip>
                    ) : null}
                  </View>
                  <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }} numberOfLines={3}>
                    {organisation.name}
                  </Text>
                  {organisation.description ? (
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                      {organisation.description}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View className="flex-row flex-wrap gap-2">
                {organisation.website ? (
                  <ActionPill
                    label={t('website')}
                    icon="globe-outline"
                    primary={primary}
                    accessibilityLabel={t('website')}
                    onPress={() => void handleOpenWebsite()}
                  />
                ) : null}
                <ActionPill
                  label={t('detail.share')}
                  icon="share-outline"
                  primary={primary}
                  accessibilityLabel={t('detail.share')}
                  onPress={() => void handleShare()}
                />
              </View>
            </HeroCard.Body>
          </HeroCard>

          <View className="mb-4 flex-row flex-wrap gap-3">
            <StatTile icon="people-outline" value={membersCount} label={t('members', { count: membersCount })} primary={primary} theme={theme} />
            <StatTile icon="list-outline" value={listingsCount} label={t('listings', { count: listingsCount })} primary={primary} theme={theme} />
            <StatTile icon="heart-outline" value={opportunityCount} label={t('opportunities', { count: opportunityCount })} primary={primary} theme={theme} />
            <StatTile icon="time-outline" value={totalHours} label={t('hoursLogged', { hours: totalHours })} primary={primary} theme={theme} />
          </View>

          {organisation.location || organisation.contact_email ? (
            <HeroCard className="mb-4 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.1) }}>
              <HeroCard.Body className="gap-3 p-4">
                <SectionTitle icon="call-outline" label={t('detail.contact')} primary={primary} theme={theme} />
                {organisation.location ? (
                  <InfoRow icon="location-outline" text={organisation.location} theme={theme} />
                ) : null}
                {organisation.contact_email ? (
                  <InfoRow icon="mail-outline" text={organisation.contact_email} theme={theme} />
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          <HeroCard className="mb-4 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.1) }}>
            <HeroCard.Body className="gap-3 p-4">
              <SectionTitle icon="document-text-outline" label={t('detail.about')} primary={primary} theme={theme} />
              <Text className="text-sm leading-6" style={{ color: theme.text }}>
                {organisation.description ?? t('noDescription')}
              </Text>
            </HeroCard.Body>
          </HeroCard>
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function StatTile({
  icon,
  value,
  label,
  primary,
  theme,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: number;
  label: string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface
      variant="secondary"
      className="min-w-[47%] flex-1 rounded-panel-inner p-3.5"
      style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
    >
      <View className="mb-3 size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
        <Ionicons name={icon} size={16} color={primary} />
      </View>
      <Text className="text-xl font-bold" style={{ color: theme.text }}>{value}</Text>
      <Text className="mt-1 text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{label}</Text>
    </Surface>
  );
}

function SectionTitle({
  icon,
  label,
  primary,
  theme,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
        <Ionicons name={icon} size={16} color={primary} />
      </View>
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function InfoRow({
  icon,
  text,
  theme,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="flex-row items-start gap-2.5 rounded-panel-inner p-3" style={{ backgroundColor: theme.surface }}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} style={{ marginTop: 1 }} />
      <Text className="flex-1 text-sm leading-5" style={{ color: theme.text }}>{text}</Text>
    </View>
  );
}
