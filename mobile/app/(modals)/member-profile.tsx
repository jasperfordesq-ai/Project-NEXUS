// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatDecimal } from '@/lib/utils/decimal';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';
import * as Haptics from '@/lib/haptics';
import { Accordion, Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';

import {
  acceptFederationConnection,
  getFederationConnectionStatus,
  getFederationMember,
  getFederationMemberReviews,
  rejectFederationConnection,
  removeFederationConnection,
  sendFederationTransaction,
  sendFederationConnectionRequest,
  type FederatedConnectionStatus,
} from '@/lib/api/federation';
import {
  acceptConnection,
  getConnectionStatus,
  removeConnection,
  sendConnectionRequest,
  type ConnectionStatusType,
} from '@/lib/api/connections';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import Avatar from '@/components/ui/Avatar';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { buildWebUrl } from '@/lib/utils/webUrl';
import VerificationBadgeRow from '@/components/verification/VerificationBadgeRow';
import {
  getMember,
  getMemberListings,
  getMemberReviews,
  type MemberReview,
} from '@/lib/api/members';
import type { Exchange } from '@/lib/api/exchanges';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';
import { blockUser } from '@/lib/api/settings';
import AccentIcon from '@/components/ui/AccentIcon';
import {
  getBadges,
  getGamificationProfile,
  type Badge,
  type GamificationProfile,
} from '@/lib/api/gamification';

import { parseDecimalInput } from '@/lib/utils/decimal';
interface MemberProfile {
  id: number | string;
  name?: string;
  first_name?: string;
  last_name?: string;
  bio?: string | null;
  avatar?: string | null;
  avatar_url?: string | null;
  location: string | null;
  time_balance?: number;
  skills?: string[];
  joined_at?: string;
  last_active_at?: string | null;
  total_hours_given?: number;
  total_hours_received?: number;
  groups_count?: number;
  events_attended?: number;
  stats?: {
    listings_count?: number;
  };
  rating?: number | null;
  is_verified?: boolean;
  tenant_id?: number | string;
  tenant_name?: string;
  timebank?: {
    id: number | string;
    name: string;
  };
  service_reach?: string | null;
  messaging_enabled?: boolean;
  transactions_enabled?: boolean;
  reputation_score?: number;
  reputation_count?: number;
  connection_status?: FederatedConnectionStatus;
  listings?: {
    id: number | string;
    title: string;
    type?: string | null;
    category_name?: string | null;
    description?: string | null;
    image_url?: string | null;
    hours_estimate?: number | null;
    estimated_hours?: number | null;
  }[];
  reviews?: MemberReview[];
  achievements?: MemberAchievements;
}

type TFunction = (key: string, options?: Record<string, unknown>) => string;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MemberBadge = Badge & {
  badge_key?: string;
  earned?: boolean;
};

interface MemberAchievements {
  profile: GamificationProfile | null;
  badges: MemberBadge[];
}

export default function MemberProfileScreen() {
  return (
    <ModalErrorBoundary>
      <MemberProfileScreenInner />
    </ModalErrorBoundary>
  );
}

function MemberProfileScreenInner() {
  const { t } = useTranslation(['members', 'federation', 'common']);
  const { id, tenant_id: tenantIdParam, name: nameParam } = useLocalSearchParams<{ id?: string; tenant_id?: string; name?: string }>();
  const primary = usePrimaryColor();
  const { hasFeature, hasModule, tenant } = useTenant();
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const rawMemberId = typeof id === 'string' ? id.trim() : '';
  const isExternalFederatedProfile = rawMemberId.startsWith('ext-');
  const routeMemberId = isExternalFederatedProfile ? Number.NaN : Number(rawMemberId || id);
  const authMemberId = Number(user?.id);
  const memberId = isExternalFederatedProfile ? 0 : (Number.isFinite(routeMemberId) && routeMemberId > 0 ? routeMemberId : authMemberId);
  const safeMemberId = Number.isFinite(memberId) && memberId > 0 ? memberId : 0;
  const routeTenantId = Number(tenantIdParam);
  const authTenantId = Number(user?.tenant_id);
  const safeTenantId = Number.isFinite(routeTenantId) && routeTenantId > 0 ? routeTenantId : null;
  const isFederatedProfile = isExternalFederatedProfile || (safeTenantId !== null && (!Number.isFinite(authTenantId) || safeTenantId !== authTenantId));
  const isOwnProfile = !isFederatedProfile && user?.id === safeMemberId;
  const sameTenantCanSendCredits = !isOwnProfile && !isFederatedProfile && (hasModule('wallet') || hasFeature('wallet'));

  const { data, isLoading, error, refresh } = useApi(
    () => loadMemberProfileData(safeMemberId, safeTenantId, isFederatedProfile),
    [safeMemberId, safeTenantId, isFederatedProfile],
    { enabled: safeMemberId > 0 && !isExternalFederatedProfile },
  );

  const member = useMemo(() => normalizeMember(data?.data as MemberProfile | undefined), [data]);
  const [connStatus, setConnStatus] = useState<ConnectionStatusType>('none');
  const [connId, setConnId] = useState<number | null>(null);
  const [connLoading, setConnLoading] = useState(false);
  // True when the status request failed: "Connect" is then hidden in favour of a retry,
  // because offering it would send a duplicate request to someone already connected.
  const [connStatusFailed, setConnStatusFailed] = useState(false);
  const [connActionLoading, setConnActionLoading] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [showFederationTransfer, setShowFederationTransfer] = useState(false);

  const loadConnectionStatus = useCallback(async () => {
    if (!safeMemberId || isOwnProfile) return;
    setConnLoading(true);
    try {
      if (isFederatedProfile && safeTenantId) {
        const res = await getFederationConnectionStatus(safeMemberId, safeTenantId);
        setConnStatus(mapFederatedConnectionStatus(res.data));
        setConnId(res.data.connection_id);
      } else {
        const res = await getConnectionStatus(safeMemberId);
        setConnStatus(res.data.status);
        setConnId(res.data.connection_id);
      }
      setConnStatusFailed(false);
    } catch {
      // Non-critical for the profile itself, but the connect button must not guess.
      setConnStatusFailed(true);
    } finally {
      setConnLoading(false);
    }
  }, [safeMemberId, safeTenantId, isOwnProfile, isFederatedProfile]);

  useEffect(() => {
    if (member) {
      if (isFederatedProfile && member.connection_status) {
        setConnStatus(mapFederatedConnectionStatus(member.connection_status));
        setConnId(member.connection_status.connection_id);
        return;
      }
      void loadConnectionStatus();
    }
  }, [member, isFederatedProfile, loadConnectionStatus]);

  async function handleConnect() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConnActionLoading(true);
    try {
      if (isFederatedProfile && safeTenantId) {
        const res = await sendFederationConnectionRequest(safeMemberId, safeTenantId);
        setConnId(res.data.connection_id ?? null);
      } else {
        const res = await sendConnectionRequest(safeMemberId);
        setConnId(res.data.connection_id);
      }
      setConnStatus('pending_sent');
    } catch {
      showToast({ title: t('profile.connectionError'), variant: 'danger' });
    } finally {
      setConnActionLoading(false);
    }
  }

  async function handleAccept() {
    if (!connId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConnActionLoading(true);
    try {
      if (isFederatedProfile) {
        await acceptFederationConnection(connId);
      } else {
        await acceptConnection(connId);
      }
      setConnStatus('connected');
    } catch {
      showToast({ title: t('profile.connectionError'), variant: 'danger' });
    } finally {
      setConnActionLoading(false);
    }
  }

  async function handleDecline() {
    if (!connId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setConnActionLoading(true);
    try {
      if (isFederatedProfile) {
        await rejectFederationConnection(connId);
      } else {
        await removeConnection(connId);
      }
      setConnStatus('none');
      setConnId(null);
    } catch {
      showToast({ title: t('profile.connectionError'), variant: 'danger' });
    } finally {
      setConnActionLoading(false);
    }
  }

  function handleDisconnect() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    confirm({
      title: t('profile.disconnectConfirm'),
      message: t('profile.disconnectMessage'),
      confirmLabel: t('profile.disconnect'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        if (!connId) return;
        setConnActionLoading(true);
        try {
          if (isFederatedProfile) {
            await removeFederationConnection(connId);
          } else {
            await removeConnection(connId);
          }
          setConnStatus('none');
          setConnId(null);
        } catch {
          showToast({ title: t('profile.connectionError'), variant: 'danger' });
        } finally {
          setConnActionLoading(false);
        }
      },
    });
  }

  async function handleShare() {
    if (!member) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        // Slug-prefixed so the link resolves to this community on the shared host.
        message: t('profile.shareMessage', {
          name: getMemberDisplayName(member),
          url: buildWebUrl(tenant?.slug, `/members/${member.id}`),
        }),
      });
    } catch {
      // Native share cancellation is not an error state.
    }
  }

  function handleBlock() {
    if (!safeMemberId || isOwnProfile || isFederatedProfile || isBlocking) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    confirm({
      title: t('profile.blockConfirmTitle', { name: member ? getMemberDisplayName(member) : '' }),
      message: t('profile.blockConfirmMessage'),
      confirmLabel: t('profile.block'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setIsBlocking(true);
        try {
          await blockUser(safeMemberId);
          showToast({
            title: t('profile.blockSuccessTitle'),
            description: t('profile.blockSuccessMessage'),
            variant: 'success',
          });
          router.replace('/(modals)/members' as Href);
        } catch (err) {
          showToast({
            title: t('profile.blockFailed'),
            description: describeApiError(err, t('profile.blockFailed')),
            variant: 'danger',
          });
        } finally {
          setIsBlocking(false);
        }
      },
    });
  }

  if (isExternalFederatedProfile && rawMemberId) {
    return (
      <ExternalFederatedMemberState
        memberId={rawMemberId}
        tenantId={externalTenantIdFromMemberId(rawMemberId) ?? tenantIdParam ?? ''}
        displayName={typeof nameParam === 'string' && nameParam.trim() ? nameParam.trim() : t('profile.externalFederatedMember')}
        primary={primary}
        theme={theme}
        t={t}
      />
    );
  }

  if (safeMemberId <= 0) {
    return (
      <ScreenShell t={t} title={t('profileTitle')}>
        <CenteredState icon="alert-circle-outline" color={theme.error} text={t('profile.signInRequired')} />
      </ScreenShell>
    );
  }

  if (isLoading && !data) {
    return (
      <ScreenShell t={t} title={t('profileTitle')}>
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      </ScreenShell>
    );
  }

  if (error || !member) {
    return (
      <ScreenShell t={t} title={t('profileTitle')}>
        <CenteredState icon="warning-outline" color={theme.error} text={t('profile.loadError')}>
          <HeroButton variant="primary" onPress={() => void refresh()}>
            <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
          </HeroButton>
        </CenteredState>
      </ScreenShell>
    );
  }

  const bio = stripHtml(member.bio);
  const displayName = getMemberDisplayName(member) || t('federation:directory.members.memberFallback');
  const communityName = member.timebank?.name ?? member.tenant_name;
  const totalGiven = member.total_hours_given ?? member.time_balance ?? 0;
  const totalReceived = member.total_hours_received ?? 0;
  const totalExchanged = totalGiven + totalReceived;
  const activeListings = member.stats?.listings_count ?? member.listings?.length ?? 0;
  const groupsCount = member.groups_count ?? 0;
  const eventsAttended = member.events_attended ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={isOwnProfile ? t('profile.myProfile') : isFederatedProfile ? t('federation:directory.members.title') : t('profileTitle')}
        backLabel={t('common:buttons.back')}
        fallbackHref={(isFederatedProfile ? '/(modals)/federation-members' : '/(modals)/members') as Href}
        rightAction={
          isOwnProfile
            ? { accessibilityLabel: t('profile.editProfile'), icon: 'create-outline', onPress: openEditProfile }
            : { accessibilityLabel: t('share'), icon: 'share-outline', onPress: handleShare }
        }
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 96 + bottomInset }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void refresh()} tintColor={primary} colors={[primary]} />}
      >
        <View className="px-4">
          <HeroCard variant="default" className="overflow-hidden">
            <View className="h-1 w-full" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="items-center gap-4 px-5 py-6">
              <Avatar uri={member.avatar_url ?? member.avatar ?? null} name={displayName} size={96} />
              {isFederatedProfile ? (
                <Chip size="sm" variant="soft" color="accent">
                  <Ionicons name="globe-outline" size={12} color={primary} />
                  <Chip.Label>{t('profile.federatedMember')}</Chip.Label>
                </Chip>
              ) : null}
              <View className="items-center gap-2">
                <View className="flex-row flex-wrap items-center justify-center gap-2">
                  <Text className="text-center text-2xl font-bold leading-8" style={{ color: theme.text }}>
                    {displayName}
                  </Text>
                </View>
                <VerificationBadgeRow userId={member.id} showUnverified disabled={isFederatedProfile} />

                <View className="flex-row flex-wrap justify-center gap-2">
                  {member.rating != null ? (
                    <Chip size="sm" variant="soft" color="warning">
                      <Ionicons name="star" size={12} color={theme.warning} />
                      <Chip.Label>{formatDecimal(member.rating, 1, 1)}</Chip.Label>
                    </Chip>
                  ) : null}
                  {member.location ? (
                    <Chip size="sm" variant="soft" color="default">
                      <Ionicons name="location-outline" size={12} color={theme.textMuted} />
                      <Chip.Label>{member.location}</Chip.Label>
                    </Chip>
                  ) : null}
                  {communityName ? (
                    <Chip size="sm" variant="soft" color="accent">
                      <Ionicons name="business-outline" size={12} color={primary} />
                      <Chip.Label>{communityName}</Chip.Label>
                    </Chip>
                  ) : null}
                </View>
              </View>

              {bio ? (
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {bio}
                </Text>
              ) : (
                <Text className="text-center text-sm italic leading-5" style={{ color: theme.textSecondary }}>
                  {isOwnProfile ? t('profile.noBioOwn') : t('profile.noBio')}
                </Text>
              )}
            </HeroCard.Body>
          </HeroCard>

          {isOwnProfile ? (
            <HeroCard variant="secondary" className="mt-3">
              <HeroCard.Body className="gap-3 px-4 py-4">
                <SectionTitle icon="person-circle-outline" title={t('profile.myProfile')} primary={primary} theme={theme} />
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('profile.ownProfileHint')}
                </Text>
                <View className="flex-row gap-2">
                  <HeroButton className="flex-1" variant="primary" onPress={openEditProfile}>
                    <AccentIcon name="create-outline" size={18} />
                    <HeroButton.Label>{t('profile.editProfile')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton className="flex-1" variant="secondary" onPress={handleShare}>
                    <Ionicons name="share-outline" size={18} color={primary} />
                    <HeroButton.Label>{t('share')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          {isFederatedProfile ? (
            <HeroCard variant="secondary" className="mt-3">
              <HeroCard.Body className="gap-3 px-4 py-4">
                <SectionTitle icon="globe-outline" title={t('profile.federatedProfile')} primary={primary} theme={theme} />
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('profile.federatedProfileHint', { community: communityName ?? t('federation:directory.unknownCommunity') })}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {member.service_reach ? (
                    <Chip size="sm" variant="soft" color="accent">
                      <Ionicons name={reachIcon(member.service_reach)} size={12} color={primary} />
                      <Chip.Label>{t(`federation:directory.members.reach.${member.service_reach}`)}</Chip.Label>
                    </Chip>
                  ) : null}
                  {member.messaging_enabled ? (
                    <Chip size="sm" variant="soft" color="success">
                      <Ionicons name="chatbubble-outline" size={12} color={theme.success} />
                      <Chip.Label>{t('profile.federatedMessaging')}</Chip.Label>
                    </Chip>
                  ) : null}
                  {member.transactions_enabled ? (
                    <Chip size="sm" variant="soft" color="warning">
                      <Ionicons name="swap-horizontal-outline" size={12} color={theme.warning} />
                      <Chip.Label>{t('profile.federatedExchanges')}</Chip.Label>
                    </Chip>
                  ) : null}
                </View>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          {showFederationTransfer && isFederatedProfile && member.transactions_enabled ? (
            <FederatedTransferCard
              member={member}
              displayName={displayName}
              primary={primary}
              theme={theme}
              t={t}
              onCancel={() => setShowFederationTransfer(false)}
              onComplete={() => {
                setShowFederationTransfer(false);
                refresh();
              }}
            />
          ) : null}

          <View className="mt-3 gap-3">
            <View className="flex-row gap-3">
              <StatCard value={Math.round(totalGiven)} label={t('profile.hoursGiven')} icon="arrow-up-outline" primary={primary} theme={theme} />
              <StatCard value={Math.round(totalReceived)} label={t('profile.hoursReceived')} icon="arrow-down-outline" primary={primary} theme={theme} />
              <StatCard value={Math.round(totalExchanged)} label={t('profile.totalHours')} icon="swap-horizontal-outline" primary={primary} theme={theme} />
            </View>
            <View className="flex-row gap-3">
              <StatCard value={activeListings} label={t('profile.activeListings')} icon="list-outline" primary={primary} theme={theme} />
              <StatCard value={groupsCount} label={t('profile.groups')} icon="people-outline" primary={primary} theme={theme} />
              <StatCard value={eventsAttended} label={t('profile.events')} icon="calendar-outline" primary={primary} theme={theme} />
            </View>
          </View>

          {!isOwnProfile && !connLoading && connStatus !== 'none' ? (
            <ConnectionActions
              t={t}
              primary={primary}
              theme={theme}
              status={connStatus}
              isLoading={connActionLoading}
              onConnect={handleConnect}
              onAccept={handleAccept}
              onDecline={handleDecline}
              onDisconnect={handleDisconnect}
            />
          ) : null}

          <HeroCard variant="secondary" className="mt-3">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="sparkles-outline" title={t('profile.skills')} primary={primary} theme={theme} />
              {(member.skills?.length ?? 0) > 0 ? (
                <View className="flex-row flex-wrap gap-2">
                  {(member.skills ?? []).map((skill) => (
                    <Chip key={skill} size="sm" variant="soft" color="accent">
                      <Chip.Label>{skill}</Chip.Label>
                    </Chip>
                  ))}
                </View>
              ) : (
                <Text className="text-sm italic" style={{ color: theme.textSecondary }}>{t('profile.noSkills')}</Text>
              )}
            </HeroCard.Body>
          </HeroCard>

          <TrustSummaryCard memberId={member.id} isFederatedProfile={isFederatedProfile} primary={primary} theme={theme} t={t} />

          <AchievementsAccordion
            achievements={member.achievements}
            isOwnProfile={isOwnProfile}
            isFederatedProfile={isFederatedProfile}
            primary={primary}
            theme={theme}
            t={t}
          />

          <ListingsSection
            listings={member.listings ?? []}
            isFederatedProfile={isFederatedProfile}
            primary={primary}
            theme={theme}
            t={t}
          />

          <ReviewsSection reviews={member.reviews ?? []} rating={member.rating} primary={primary} theme={theme} t={t} />

          {!isFederatedProfile ? (
            <ProfileExtrasCard member={member} displayName={displayName} isOwnProfile={isOwnProfile} primary={primary} theme={theme} t={t} />
          ) : null}

          {!isOwnProfile && !isFederatedProfile ? (
            <HeroCard variant="secondary" className="mt-3">
              <HeroCard.Body className="gap-3 px-4 py-4">
                <SectionTitle icon="shield-checkmark-outline" title={t('profile.safety')} primary={primary} theme={theme} />
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('profile.safetyHint')}
                </Text>
                <HeroButton variant="danger" isDisabled={isBlocking} onPress={handleBlock}>
                  {isBlocking ? <Spinner size="sm" /> : <Ionicons name="ban-outline" size={18} color="#ffffff" />}
                  <HeroButton.Label>{t('profile.block')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          <HeroCard variant="secondary" className="mt-3">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="information-circle-outline" title={t('profile.about')} primary={primary} theme={theme} />
              {member.joined_at ? (
                <InfoRow icon="calendar-outline" label={t('profile.memberSince', { date: formatDate(member.joined_at) })} theme={theme} />
              ) : null}
              {member.last_active_at ? (
                <InfoRow icon="pulse-outline" label={t('profile.lastActive', { date: formatDate(member.last_active_at) })} theme={theme} />
              ) : null}
              {member.location ? <InfoRow icon="location-outline" label={member.location} theme={theme} /> : null}
            </HeroCard.Body>
          </HeroCard>
        </View>
      </ScrollView>

      {/*
        🔴 Absolutely positioned, so the SafeAreaView's bottom padding does not reach it —
        and on Android modal screens that padding is 0 anyway. Owner's screenshot,
        2026-09-05: Connect / Send credits / Send Message sat under the 3-button nav bar.
      */}
      <Surface
        testID="member-profile-footer"
        variant="default"
        className="absolute bottom-0 left-0 right-0 border-t border-border px-3 pt-3"
        style={{ paddingBottom: Math.max(12, bottomInset + 12) }}
      >
        <View className="flex-row items-center gap-2">
          {isOwnProfile ? (
            <HeroButton
              className="min-w-0 flex-1"
              variant="primary"
              style={{ minHeight: 48, paddingHorizontal: 8 }}
              accessibilityLabel={t('profile.editProfile')}
              onPress={openEditProfile}
            >
              <AccentIcon name="create-outline" size={16} />
              <HeroButton.Label numberOfLines={1} style={{ fontSize: 13, lineHeight: 16 }}>{t('profile.editProfile')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {!isOwnProfile && connStatusFailed ? (
            <HeroButton className="min-w-0 flex-1" variant="secondary" style={{ minHeight: 48, paddingHorizontal: 8 }} isDisabled={connLoading} accessibilityLabel={t('profile.connectionStatusUnavailable')} onPress={() => void loadConnectionStatus()}>
              <Ionicons name="refresh-outline" size={16} color={primary} />
              <HeroButton.Label numberOfLines={2} style={{ fontSize: 13, lineHeight: 16 }}>{t('profile.connectionStatusUnavailable')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {!isOwnProfile && !connStatusFailed && connStatus === 'none' ? (
            <HeroButton className="min-w-0 flex-1" variant="secondary" style={{ minHeight: 48, paddingHorizontal: 8 }} isDisabled={connActionLoading} accessibilityLabel={t('profile.connect')} onPress={() => void handleConnect()}>
              {connActionLoading ? <Spinner size="sm" /> : <Ionicons name="person-add-outline" size={16} color={primary} />}
              <HeroButton.Label numberOfLines={1} style={{ fontSize: 13, lineHeight: 16 }}>{t('profile.connect')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {isFederatedProfile && member.transactions_enabled ? (
            <HeroButton
              className="min-w-0 flex-1"
              variant="secondary"
              style={{ minHeight: 48, paddingHorizontal: 8 }}
              accessibilityLabel={t('profile.sendCredits')}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowFederationTransfer((current) => !current);
              }}
            >
              <Ionicons name="wallet-outline" size={16} color={primary} />
              <HeroButton.Label numberOfLines={1} style={{ fontSize: 13, lineHeight: 16 }}>{t('profile.sendCredits')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {sameTenantCanSendCredits ? (
            <HeroButton
              className="min-w-0 flex-1"
              variant="secondary"
              style={{ minHeight: 48, paddingHorizontal: 8 }}
              accessibilityLabel={t('profile.sendCredits')}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({
                  pathname: '/(modals)/wallet',
                  params: { to: String(member.id), name: displayName },
                } as unknown as Href);
              }}
            >
              <Ionicons name="wallet-outline" size={16} color={primary} />
              <HeroButton.Label numberOfLines={1} style={{ fontSize: 13, lineHeight: 16 }}>{t('profile.sendCredits')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {!isOwnProfile ? (
            <HeroButton
              className="min-w-0 flex-1"
              variant="primary"
              style={{ minHeight: 48, paddingHorizontal: 8 }}
              accessibilityLabel={t('profile.sendMessage')}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isFederatedProfile) {
                  router.push({
                    pathname: '/(modals)/federation-messages',
                    params: { compose: 'true', to_user: String(member.id), to_tenant: String(member.timebank?.id ?? member.tenant_id ?? '') },
                  } as unknown as Href);
                  return;
                }
                router.push({ pathname: '/(modals)/thread', params: { recipientId: String(member.id), name: displayName } });
              }}
            >
              <AccentIcon name="chatbubble-outline" size={16} />
              <HeroButton.Label numberOfLines={1} style={{ fontSize: 13, lineHeight: 16 }}>{t('profile.sendMessage')}</HeroButton.Label>
            </HeroButton>
          ) : null}
        </View>
      </Surface>
      {confirmDialog}
    </SafeAreaView>
  );
}

function ExternalFederatedMemberState({
  memberId,
  tenantId,
  displayName,
  primary,
  theme,
  t,
}: {
  memberId: string;
  tenantId: string;
  displayName: string;
  primary: string;
  theme: Theme;
  t: TFunction;
}) {
  const canMessage = tenantId.trim().length > 0;
  const {
    data: reviewsResponse,
    isLoading: reviewsLoading,
    refresh: refreshReviews,
  } = useApi(
    () => getFederationMemberReviews(memberId, tenantId),
    [memberId, tenantId],
    { enabled: memberId.trim().length > 0 },
  );
  const reviews = useMemo(
    () => Array.isArray(reviewsResponse?.data) ? reviewsResponse.data : [],
    [reviewsResponse],
  );
  const averageRating = useMemo(() => {
    if (reviews.length === 0) return null;
    const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    return total > 0 ? total / reviews.length : null;
  }, [reviews]);

  function openMessage() {
    if (!canMessage) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(modals)/federation-messages',
      params: {
        compose: 'true',
        to_user: memberId,
        to_tenant: tenantId,
        name: displayName,
      },
    } as unknown as Href);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('profile.externalFederatedMember')} backLabel={t('common:buttons.back')} fallbackHref={'/(modals)/federation-members' as Href} />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        refreshControl={<RefreshControl refreshing={reviewsLoading} onRefresh={() => void refreshReviews()} tintColor={primary} colors={[primary]} />}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 40 }}
      >
        <HeroCard variant="default" className="overflow-hidden">
          <View className="h-1 w-full" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="items-center gap-4 px-5 py-6">
            <View className="size-16 items-center justify-center rounded-3xl" style={{ backgroundColor: `${primary}22` }}>
              <Ionicons name="globe-outline" size={30} color={primary} />
            </View>
            <View className="items-center gap-2">
              <Text className="text-center text-xl font-bold" style={{ color: theme.text }}>
                {displayName}
              </Text>
              <Chip size="sm" variant="soft" color="accent">
                <Ionicons name="git-network-outline" size={12} color={primary} />
                <Chip.Label>{t('profile.externalFederatedMember')}</Chip.Label>
              </Chip>
              <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('profile.externalFederatedMemberDescription')}
              </Text>
            </View>
            <View className="w-full gap-3">
              <HeroButton variant="primary" isDisabled={!canMessage} onPress={openMessage}>
                <AccentIcon name="chatbubble-ellipses-outline" size={18} />
                <HeroButton.Label>{t('profile.sendMessage')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={() => router.replace('/(modals)/federation-members' as Href)}>
                <Ionicons name="arrow-back-outline" size={18} color={primary} />
                <HeroButton.Label>{t('profile.backToFederatedMembers')}</HeroButton.Label>
              </HeroButton>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <Surface variant="secondary" className="mt-3 gap-3 rounded-panel px-4 py-4">
          <SectionTitle icon="shield-checkmark-outline" title={t('profile.trustStatus')} primary={primary} theme={theme} />
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('profile.externalFederatedTrustHint')}
          </Text>
          {reviewsLoading ? (
            <Surface variant="secondary" className="items-center rounded-panel-inner px-3 py-4">
              <Spinner size="sm" />
            </Surface>
          ) : (
            <ReviewsSection reviews={reviews} rating={averageRating} primary={primary} theme={theme} t={t} />
          )}
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

function FederatedTransferCard({
  member,
  displayName,
  primary,
  theme,
  t,
  onCancel,
  onComplete,
}: {
  member: MemberProfile;
  displayName: string;
  primary: string;
  theme: Theme;
  t: TFunction;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const { show: showToast } = useAppToast();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const tenantId = member.timebank?.id ?? member.tenant_id;

  async function submit() {
    const parsedAmount = parseDecimalInput(amount) ?? Number.NaN;
    if (!Number.isInteger(parsedAmount) || parsedAmount < 1 || parsedAmount > 100) {
      showToast({ title: t('profile.transferValidationTitle'), description: t('profile.transferAmountRequired'), variant: 'warning' });
      return;
    }
    if (!description.trim()) {
      showToast({ title: t('profile.transferValidationTitle'), description: t('profile.transferDescriptionRequired'), variant: 'warning' });
      return;
    }
    if (!tenantId) {
      showToast({ title: t('profile.transferFailedTitle'), description: t('profile.transferFailedMessage'), variant: 'danger' });
      return;
    }

    setIsSubmitting(true);
    try {
      await sendFederationTransaction({
        receiver_id: member.id,
        receiver_tenant_id: tenantId,
        amount: parsedAmount,
        description: description.trim(),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('profile.transferSuccessTitle'), description: t('profile.transferSuccessMessage', { amount: parsedAmount, name: displayName }), variant: 'success' });
      setAmount('');
      setDescription('');
      onComplete();
    } catch (err) {
      showToast({ title: t('profile.transferFailedTitle'), description: describeApiError(err, t('profile.transferFailedMessage')), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <HeroCard variant="secondary" className="mt-3 overflow-hidden">
      <View className="h-1" style={{ backgroundColor: theme.warning }} />
      <HeroCard.Body className="gap-4 px-4 py-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <SectionTitle icon="wallet-outline" title={t('profile.sendCreditsTo', { name: displayName })} primary={primary} theme={theme} />
            <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t('profile.transferSummary', { amount: amount || '0', name: displayName })}
            </Text>
          </View>
          <HeroButton size="sm" variant="secondary" isIconOnly onPress={onCancel} accessibilityLabel={t('profile.cancelTransfer')}>
            <Ionicons name="close-outline" size={18} color={primary} />
          </HeroButton>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('profile.amountHours')}</Text>
          <Input
            className="min-h-12 text-sm"
            style={{ color: theme.text }}
            placeholder={t('profile.amountPlaceholder')}
            placeholderTextColor={theme.textMuted}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            accessibilityLabel={t('profile.amountHours')}
          />
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('profile.transferDescription')}</Text>
          <Input
            className="min-h-20 text-sm"
            style={{ color: theme.text, textAlignVertical: 'top' }}
            placeholder={t('profile.transferDescriptionPlaceholder')}
            placeholderTextColor={theme.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            accessibilityLabel={t('profile.transferDescription')}
          />
        </View>

        <HeroButton variant="primary" isDisabled={isSubmitting} onPress={() => void submit()}>
          {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name="send-outline" size={16} />}
          <HeroButton.Label>{t('profile.sendCredits')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function externalTenantIdFromMemberId(memberId?: number | string | null): string | null {
  const raw = String(memberId ?? '');
  if (!raw.startsWith('ext-')) return null;
  const parts = raw.split('-', 3);
  return parts[1] ? `ext-${parts[1]}` : null;
}

async function loadMemberProfileData(
  memberId: number,
  tenantId: number | null,
  isFederatedProfile: boolean,
): Promise<{ data: MemberProfile }> {
  if (isFederatedProfile) {
    const [profileRes, reviewsRes] = await Promise.all([
      getFederationMember(memberId, tenantId ?? undefined) as Promise<{ data: MemberProfile }>,
      getFederationMemberReviews(memberId, tenantId ?? undefined).catch(() => ({ data: [] as MemberReview[] })),
    ]);

    return {
      data: {
        ...profileRes.data,
        rating: profileRes.data.rating ?? profileRes.data.reputation_score ?? null,
        reviews: reviewsRes.data ?? [],
      },
    };
  }

  const [profileRes, listingsRes, reviewsRes, achievementsRes, badgesRes] = await Promise.all([
    getMember(memberId) as Promise<{ data: MemberProfile }>,
    getMemberListings(memberId, 6).catch(() => ({ data: [] as Exchange[] })),
    getMemberReviews(memberId, 6).catch(() => ({ data: [] as MemberReview[] })),
    getGamificationProfile(memberId).catch(() => ({ data: null as GamificationProfile | null })),
    getBadges(memberId).catch(() => ({ data: [] as MemberBadge[] })),
  ]);

  return {
    data: {
      ...profileRes.data,
      listings: listingsRes.data ?? [],
      reviews: reviewsRes.data ?? [],
      achievements: {
        profile: achievementsRes.data,
        badges: badgesRes.data ?? [],
      },
    },
  };
}

function openEditProfile() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  router.push('/(modals)/edit-profile');
}

function normalizeMember(member: MemberProfile | undefined): MemberProfile | undefined {
  if (!member) return undefined;
  const name = getMemberDisplayName(member);
  return {
    ...member,
    name,
    avatar_url: member.avatar_url ?? member.avatar ?? null,
    skills: Array.isArray(member.skills) ? member.skills.filter(Boolean) : [],
  };
}

function getMemberDisplayName(member: MemberProfile): string {
  return (
    member.name?.trim() ||
    `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() ||
    ''
  );
}

function mapFederatedConnectionStatus(status: FederatedConnectionStatus): ConnectionStatusType {
  if (status.status === 'accepted') return 'connected';
  if (status.status === 'pending') {
    return status.direction === 'incoming' ? 'pending_received' : 'pending_sent';
  }
  return 'none';
}

function reachIcon(reach: string): IoniconName {
  if (reach === 'remote_ok') return 'wifi-outline';
  if (reach === 'travel_ok') return 'car-outline';
  return 'home-outline';
}

function ScreenShell({ t, title, children }: { t: TFunction; title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/members" />
      <View className="flex-1 px-4" style={{ flex: 1 }}>
      {children}
      </View>
    </SafeAreaView>
  );
}

function CenteredState({ icon, color, text, children }: { icon: IoniconName; color: string; text: string; children?: React.ReactNode }) {
  return (
    <HeroCard variant="secondary" className="my-8">
      <HeroCard.Body className="items-center gap-4">
        <Ionicons name={icon} size={34} color={color} />
        <Text className="text-center text-sm font-medium text-muted-foreground">{text}</Text>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}

function SectionTitle({ icon, title, primary, theme }: { icon: IoniconName; title: string; primary: string; theme: Theme }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={18} color={primary} />
      <Text className="text-base font-semibold" style={{ color: theme.text }}>{title}</Text>
    </View>
  );
}

function StatCard({ value, label, icon, primary, theme }: { value: number; label: string; icon: IoniconName; primary: string; theme: Theme }) {
  return (
    <HeroCard variant="secondary" className="flex-1">
      <HeroCard.Body className="items-center gap-1 px-2 py-3">
        <Ionicons name={icon} size={16} color={primary} />
        <Text className="text-xl font-bold" style={{ color: primary }}>{value}</Text>
        <Text className="text-center text-[11px] leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{label}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function ConnectionActions({
  t,
  primary,
  theme,
  status,
  isLoading,
  onConnect,
  onAccept,
  onDecline,
  onDisconnect,
}: {
  t: TFunction;
  primary: string;
  theme: Theme;
  status: ConnectionStatusType;
  isLoading: boolean;
  onConnect: () => Promise<void>;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onDisconnect: () => void;
}) {
  if (status === 'none') {
    return (
      <HeroCard variant="secondary" className="mt-3">
        <HeroCard.Body className="gap-3 px-4 py-4">
          <SectionTitle icon="person-add-outline" title={t('profile.connect')} primary={primary} theme={theme} />
          <HeroButton variant="secondary" isDisabled={isLoading} onPress={() => void onConnect()}>
            {isLoading ? <Spinner size="sm" /> : <Ionicons name="person-add-outline" size={18} color={primary} />}
            <HeroButton.Label>{t('profile.connect')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>
    );
  }

  if (status === 'pending_sent') {
    return (
      <Surface variant="secondary" className="mt-3 flex-row items-center gap-2 rounded-panel-inner px-4 py-3">
        <Ionicons name="time-outline" size={18} color={theme.textMuted} />
        <Text className="text-sm font-medium" style={{ color: theme.textSecondary }}>{t('profile.pendingSent')}</Text>
      </Surface>
    );
  }

  if (status === 'pending_received') {
    return (
      <HeroCard variant="secondary" className="mt-3">
        <HeroCard.Body className="gap-3 px-4 py-4">
          <SectionTitle icon="person-add-outline" title={t('profile.pendingReceived')} primary={primary} theme={theme} />
          <View className="flex-row gap-2">
            <HeroButton className="flex-1" variant="primary" isDisabled={isLoading} onPress={() => void onAccept()}>
              <HeroButton.Label>{t('profile.accept')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className="flex-1" variant="secondary" isDisabled={isLoading} onPress={() => void onDecline()}>
              <HeroButton.Label>{t('profile.decline')}</HeroButton.Label>
            </HeroButton>
          </View>
        </HeroCard.Body>
      </HeroCard>
    );
  }

  return (
    <Surface variant="secondary" className="mt-3 flex-row items-center justify-between gap-3 rounded-panel-inner px-4 py-3">
      <View className="flex-row items-center gap-2">
        <Ionicons name="checkmark-circle" size={18} color={theme.success} />
        <Text className="text-sm font-semibold" style={{ color: theme.success }}>{t('profile.connected')}</Text>
      </View>
      <HeroButton size="sm" variant="ghost" onPress={onDisconnect}>
        <HeroButton.Label>{t('profile.disconnect')}</HeroButton.Label>
      </HeroButton>
    </Surface>
  );
}

const BADGE_ICON_MAP: Record<string, IoniconName> = {
  achievement: 'trophy-outline',
  achievements: 'trophy-outline',
  badge: 'ribbon-outline',
  badges: 'ribbon-outline',
  calendar: 'calendar-outline',
  community: 'people-outline',
  event: 'calendar-outline',
  events: 'calendar-outline',
  exchange: 'swap-horizontal-outline',
  exchanges: 'swap-horizontal-outline',
  fire: 'flame-outline',
  first_exchange: 'swap-horizontal-outline',
  gift: 'gift-outline',
  heart: 'heart-outline',
  level: 'flash-outline',
  listing: 'list-outline',
  medal: 'medal-outline',
  message: 'chatbubble-ellipses-outline',
  offer: 'gift-outline',
  profile: 'person-circle-outline',
  request: 'hand-left-outline',
  review: 'star-outline',
  ribbon: 'ribbon-outline',
  shield: 'shield-checkmark-outline',
  star: 'star-outline',
  streak: 'flame-outline',
  time: 'time-outline',
  trophy: 'trophy-outline',
  volunteer: 'heart-outline',
  wallet: 'wallet-outline',
  xp: 'sparkles-outline',
};

function AchievementsAccordion({
  achievements,
  isOwnProfile,
  isFederatedProfile,
  primary,
  theme,
  t,
}: {
  achievements?: MemberAchievements;
  isOwnProfile: boolean;
  isFederatedProfile: boolean;
  primary: string;
  theme: Theme;
  t: TFunction;
}) {
  if (isFederatedProfile || (!achievements?.profile && (achievements?.badges.length ?? 0) === 0)) {
    return null;
  }

  const safeAchievements = achievements ?? { profile: null, badges: [] };
  const profile = safeAchievements.profile;
  const badges = safeAchievements.badges ?? [];
  const showcasedBadges = profile?.showcased_badges ?? [];
  const visibleBadges = (showcasedBadges.length > 0 ? showcasedBadges : badges).slice(0, 6) as MemberBadge[];
  const earnedCount = profile?.badges_count ?? badges.length;
  const level = profile?.level ?? 1;
  const xp = profile?.xp ?? 0;
  const nextLevelXp = profile?.next_level_xp ?? profile?.level_progress?.xp_for_next_level ?? xp;
  const remainingXp = Math.max(0, nextLevelXp - xp);

  return (
    <Accordion
      selectionMode="single"
      variant="surface"
      hideSeparator
      className="mt-3 overflow-hidden rounded-panel"
    >
      <Accordion.Item value="achievements">
        <Accordion.Trigger className="px-4 py-4">
          <View className="min-w-0 flex-1 flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withColorAlpha(primary, 0.14) }}>
              <Ionicons name="trophy-outline" size={20} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {t('profile.achievements')}
              </Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {t('profile.achievementsSummary', { level, count: earnedCount })}
              </Text>
            </View>
            <Chip size="sm" variant="soft" color="warning">
              <Ionicons name="flash-outline" size={12} color={theme.warning} />
              <Chip.Label>{t('profile.level', { level })}</Chip.Label>
            </Chip>
          </View>
          <Accordion.Indicator iconProps={{ color: theme.textSecondary }} />
        </Accordion.Trigger>
        <Accordion.Content className="px-4 pb-4">
          <View className="gap-3">
            <View className="flex-row gap-3">
              <MiniMetric icon="sparkles-outline" label={t('profile.xp')} value={String(xp)} primary={primary} theme={theme} />
              <MiniMetric icon="ribbon-outline" label={t('profile.badges')} value={String(earnedCount)} primary={primary} theme={theme} />
              <MiniMetric icon="trending-up-outline" label={t('profile.nextLevel')} value={String(remainingXp)} primary={primary} theme={theme} />
            </View>

            {visibleBadges.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {visibleBadges.map((badge) => (
                  <BadgePill key={getBadgeKey(badge)} badge={badge} primary={primary} theme={theme} />
                ))}
              </View>
            ) : (
              <Text className="text-sm italic" style={{ color: theme.textSecondary }}>
                {t('profile.noBadges')}
              </Text>
            )}

            {isOwnProfile ? (
              <HeroButton
                variant="secondary"
                onPress={() => router.push('/(modals)/gamification')}
                accessibilityLabel={t('profile.viewAllAchievements')}
              >
                <Ionicons name="trophy-outline" size={18} color={primary} />
                <HeroButton.Label>{t('profile.viewAllAchievements')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
}

function MiniMetric({
  icon,
  label,
  value,
  primary,
  theme,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  primary: string;
  theme: Theme;
}) {
  return (
    <Surface variant="secondary" className="flex-1 rounded-panel-inner px-2 py-3">
      <View className="items-center gap-1">
        <Ionicons name={icon} size={16} color={primary} />
        <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>
          {value}
        </Text>
        <Text className="text-center text-[11px]" style={{ color: theme.textSecondary }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Surface>
  );
}

function BadgePill({ badge, primary, theme }: { badge: MemberBadge; primary: string; theme: Theme }) {
  return (
    <Surface variant="secondary" className="min-w-[47%] flex-1 rounded-panel-inner px-3 py-3">
      <View className="flex-row items-center gap-2">
        <View className="size-9 items-center justify-center rounded-xl" style={{ backgroundColor: withColorAlpha(primary, 0.13) }}>
          <Ionicons name={normalizeBadgeIcon(badge.icon ?? badge.badge_key)} size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
            {badge.name}
          </Text>
          {badge.description ? (
            <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {badge.description}
            </Text>
          ) : null}
        </View>
      </View>
    </Surface>
  );
}

function getBadgeKey(badge: MemberBadge) {
  return String(badge.id ?? badge.badge_key ?? badge.name);
}

function normalizeBadgeIcon(icon: string | null | undefined): IoniconName {
  const raw = (icon ?? '').trim();
  const key = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const glyphMap = (Ionicons as unknown as { glyphMap?: Record<string, number> }).glyphMap;

  if (key && BADGE_ICON_MAP[key]) {
    return BADGE_ICON_MAP[key];
  }

  const candidates = [
    raw,
    raw ? `${raw}-outline` : '',
    key.replace(/_/g, '-'),
    key ? `${key.replace(/_/g, '-')}-outline` : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (glyphMap?.[candidate]) {
      return candidate as IoniconName;
    }
  }

  const firstToken = key.split('_')[0];
  return BADGE_ICON_MAP[firstToken] ?? 'ribbon-outline';
}

function withColorAlpha(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function TrustSummaryCard({
  memberId,
  isFederatedProfile,
  primary,
  theme,
  t,
}: {
  memberId: number | string;
  isFederatedProfile: boolean;
  primary: string;
  theme: Theme;
  t: TFunction;
}) {
  return (
    <HeroCard variant="secondary" className="mt-3">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <SectionTitle icon="shield-checkmark-outline" title={t('profile.trustStatus')} primary={primary} theme={theme} />
        <VerificationBadgeRow userId={memberId} showUnverified disabled={isFederatedProfile} />
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {isFederatedProfile ? t('profile.federatedTrustHint') : t('profile.trustStatusHint')}
        </Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function ListingsSection({
  listings,
  isFederatedProfile,
  primary,
  theme,
  t,
}: {
  listings: NonNullable<MemberProfile['listings']>;
  isFederatedProfile: boolean;
  primary: string;
  theme: Theme;
  t: TFunction;
}) {
  return (
    <HeroCard variant="secondary" className="mt-3">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <SectionTitle
          icon="list-outline"
          title={isFederatedProfile ? t('profile.sharedListings') : t('profile.memberListings')}
          primary={primary}
          theme={theme}
        />
        {listings.length > 0 ? (
          listings.map((listing) => {
            const isOffer = listing.type === 'offer';
            return (
              <NativePressable
                key={String(listing.id)}
                className="w-full"
                accessibilityLabel={t('profile.viewListing', { title: listing.title })}
                disabled={isFederatedProfile}
                onPress={
                  isFederatedProfile
                    ? undefined
                    : () => router.push({ pathname: '/(modals)/exchange-detail', params: { id: String(listing.id) } })
                }
              >
                {/* HeroButton collapsed raw children to content width — the rows
                    rendered as bare chip-coloured slivers with no text. */}
                <Surface variant="secondary" className="w-full rounded-panel-inner px-3 py-3">
                <View className="flex-row items-start justify-between gap-3">
                  <View className="min-w-0 flex-1 gap-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      {listing.type ? (
                        <Chip size="sm" variant="soft" color={isOffer ? 'success' : 'warning'}>
                          <Chip.Label>{isOffer ? t('profile.offer') : t('profile.request')}</Chip.Label>
                        </Chip>
                      ) : null}
                      {listing.category_name ? (
                        <Text className="min-w-0 flex-1 text-xs" numberOfLines={1} style={{ color: theme.textSecondary }}>
                          {listing.category_name}
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-sm font-semibold" numberOfLines={2} style={{ color: theme.text }}>
                      {listing.title}
                    </Text>
                    {listing.description ? (
                      <Text className="text-xs leading-4" numberOfLines={2} style={{ color: theme.textSecondary }}>
                        {stripHtml(listing.description)}
                      </Text>
                    ) : null}
                    {listing.hours_estimate != null || listing.estimated_hours != null ? (
                      <View className="mt-1 flex-row items-center gap-1">
                        <Ionicons name="time-outline" size={13} color={theme.textMuted} />
                        <Text className="text-xs" style={{ color: theme.textSecondary }}>
                          {t('profile.hoursEstimate', { hours: listing.hours_estimate ?? listing.estimated_hours })}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {!isFederatedProfile ? <Ionicons name="chevron-forward" size={18} color={primary} /> : null}
                </View>
                </Surface>
              </NativePressable>
            );
          })
        ) : (
          <Text className="text-sm italic" style={{ color: theme.textSecondary }}>
            {t('profile.noListings')}
          </Text>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function ReviewsSection({
  reviews,
  rating,
  primary,
  theme,
  t,
}: {
  reviews: MemberReview[];
  rating?: number | null;
  primary: string;
  theme: Theme;
  t: TFunction;
}) {
  return (
    <HeroCard variant="secondary" className="mt-3">
      <HeroCard.Body className="gap-3 px-4 py-4">
        <SectionTitle icon="star-outline" title={t('profile.reviews')} primary={primary} theme={theme} />
        {reviews.length > 0 ? (
          <>
            {typeof rating === 'number' && rating > 0 ? (
              <Surface variant="secondary" className="rounded-panel-inner px-3 py-3">
                <View className="flex-row items-center gap-3">
                  <Text className="text-3xl font-bold" style={{ color: theme.text }}>
                    {formatDecimal(rating, 1, 1)}
                  </Text>
                  <View>
                    <View className="flex-row gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons key={star} name={star <= Math.round(rating) ? 'star' : 'star-outline'} size={14} color={theme.warning} />
                      ))}
                    </View>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {t('profile.reviewCount', { count: reviews.length })}
                    </Text>
                  </View>
                </View>
              </Surface>
            ) : null}
            {reviews.map((review) => (
              <Surface key={review.id} variant="secondary" className="rounded-panel-inner px-3 py-3">
                <View className="flex-row items-start gap-3">
                  <Avatar
                    uri={review.reviewer?.avatar_url ?? review.reviewer?.avatar ?? null}
                    name={getReviewerName(review, t)}
                    size={36}
                  />
                  <View className="min-w-0 flex-1 gap-1">
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="min-w-0 flex-1 text-sm font-semibold" numberOfLines={1} style={{ color: theme.text }}>
                        {getReviewerName(review, t)}
                      </Text>
                      <View className="flex-row gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Ionicons key={star} name={star <= Math.round(review.rating) ? 'star' : 'star-outline'} size={12} color={theme.warning} />
                        ))}
                      </View>
                    </View>
                    {review.comment ? (
                      <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
                        {stripHtml(review.comment)}
                      </Text>
                    ) : null}
                    {review.listing_title ? (
                      <Text className="text-xs" numberOfLines={1} style={{ color: theme.textMuted }}>
                        {review.listing_title}
                      </Text>
                    ) : null}
                    {review.partner?.name || review.verified ? (
                      <View className="flex-row flex-wrap gap-2">
                        {review.partner?.name ? (
                          <Chip size="sm" variant="soft" color="accent">
                            <Ionicons name="globe-outline" size={12} color={primary} />
                            <Chip.Label>{t('federation:reviews.fromPartner', { partner: review.partner.name })}</Chip.Label>
                          </Chip>
                        ) : null}
                        {review.verified ? (
                          <Chip size="sm" variant="soft" color="success">
                            <Ionicons name="shield-checkmark-outline" size={12} color={theme.success} />
                            <Chip.Label>{t('federation:reviews.verified')}</Chip.Label>
                          </Chip>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                </View>
              </Surface>
            ))}
          </>
        ) : (
          <Text className="text-sm italic" style={{ color: theme.textSecondary }}>
            {t('profile.noReviews')}
          </Text>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

/**
 * Compact two-row card linking to the member's appreciation wall and saved
 * collections. Replaces two full-width CTA cards that read as disconnected
 * "weird graphics" under the achievements accordion.
 */
function ProfileExtrasCard({
  member,
  displayName,
  isOwnProfile,
  primary,
  theme,
  t,
}: {
  member: MemberProfile;
  displayName: string;
  isOwnProfile: boolean;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const rows: {
    key: string;
    icon: IoniconName;
    title: string;
    hint: string;
    accessibilityLabel: string;
    onPress: () => void;
  }[] = [
    {
      key: 'appreciations',
      icon: 'chatbubble-ellipses-outline',
      title: t('profile.appreciations'),
      hint: t('profile.appreciationsHint', { name: displayName }),
      accessibilityLabel: t('profile.viewAppreciationsFor', { name: displayName }),
      onPress: () => router.push({ pathname: '/(modals)/appreciations', params: { userId: String(member.id), name: displayName } } as unknown as Href),
    },
    {
      key: 'collections',
      icon: 'folder-open-outline',
      title: t('profile.collections'),
      hint: isOwnProfile ? t('profile.collectionsOwnHint') : t('profile.collectionsPublicHint', { name: displayName }),
      accessibilityLabel: isOwnProfile ? t('profile.viewMyCollections') : t('profile.viewCollectionsFor', { name: displayName }),
      onPress: () =>
        router.push({
          pathname: '/(modals)/profile-collections',
          params: isOwnProfile ? {} : { userId: String(member.id), name: displayName, scope: 'public' },
        } as unknown as Href),
    },
  ];

  return (
    <HeroCard variant="secondary" className="mt-3 overflow-hidden p-0">
      <HeroCard.Body className="p-0">
        {rows.map((row, index) => (
          <Fragment key={row.key}>
            {index > 0 ? <View className="h-px" style={{ backgroundColor: theme.borderSubtle }} /> : null}
            <NativePressable
              onPress={row.onPress}
              accessibilityLabel={row.accessibilityLabel}
              feedback="highlight"
              className="w-full"
            >
              <View className="flex-row items-center gap-3 px-4 py-3.5">
                <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withColorAlpha(primary, 0.12) }}>
                  <Ionicons name={row.icon} size={19} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                    {row.title}
                  </Text>
                  <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
                    {row.hint}
                  </Text>
                </View>
                <Ionicons name="chevron-forward-outline" size={17} color={theme.textMuted} />
              </View>
            </NativePressable>
          </Fragment>
        ))}
      </HeroCard.Body>
    </HeroCard>
  );
}

function getReviewerName(review: MemberReview, t: TFunction): string {
  return (
    review.reviewer?.name?.trim() ||
    `${review.reviewer?.first_name ?? ''} ${review.reviewer?.last_name ?? ''}`.trim() ||
    t('profile.anonymousReviewer')
  );
}

function InfoRow({ icon, label, theme }: { icon: IoniconName; label: string; theme: Theme }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={16} color={theme.textMuted} />
      <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }}>{label}</Text>
    </View>
  );
}

function stripHtml(value: string | null | undefined): string {
  if (!value) return '';
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(dateLocale(), {
      year: 'numeric',
      month: 'long',
    });
  } catch {
    return iso;
  }
}
