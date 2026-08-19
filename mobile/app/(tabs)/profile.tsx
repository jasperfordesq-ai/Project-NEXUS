// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';
import { Accordion, Button as HeroButton, Card as HeroCard, Chip, Text } from 'heroui-native';

import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant, usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { ProfileSkeleton } from '@/components/ui/Skeleton';
import ErrorState from '@/components/ui/ErrorState';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import NativePressable from '@/components/ui/NativePressable';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import AccentIcon from '@/components/ui/AccentIcon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface MenuItem {
  labelKey: string;
  descriptionKey: string;
  icon: IoniconName;
  route: Href;
  tone: string;
  featureGate?: string;
  featureGates?: string[];
  moduleGate?: string;
}

const MY_SPACE: MenuItem[] = [
  { labelKey: 'myProfile', descriptionKey: 'navDescriptions.myProfile', icon: 'person-outline', route: '/(modals)/member-profile', tone: '#3b82f6', moduleGate: 'profile' },
  { labelKey: 'wallet', descriptionKey: 'navDescriptions.wallet', icon: 'wallet-outline', route: '/(modals)/wallet', tone: '#f59e0b', moduleGate: 'wallet' },
  { labelKey: 'messages', descriptionKey: 'navDescriptions.messages', icon: 'chatbubble-outline', route: '/(tabs)/messages', tone: '#0ea5e9', moduleGate: 'messages' },
  { labelKey: 'notifications', descriptionKey: 'navDescriptions.notifications', icon: 'notifications-outline', route: '/(modals)/notifications', tone: '#ef4444', moduleGate: 'notifications' },
  { labelKey: 'menuLabels.activity', descriptionKey: 'navDescriptions.activity', icon: 'pulse-outline', route: '/(modals)/activity' as Href, tone: '#22c55e' },
  { labelKey: 'menuLabels.matches', descriptionKey: 'navDescriptions.matches', icon: 'sparkles-outline', route: '/(modals)/matches' as Href, tone: '#a855f7' },
  { labelKey: 'menuLabels.reviews', descriptionKey: 'navDescriptions.reviews', icon: 'star-outline', route: '/(modals)/reviews' as Href, tone: '#f59e0b', featureGate: 'reviews' },
  { labelKey: 'achievements', descriptionKey: 'navDescriptions.achievements', icon: 'trophy-outline', route: '/(modals)/gamification', tone: '#f59e0b', featureGate: 'gamification' },
  { labelKey: 'myGoals', descriptionKey: 'navDescriptions.myGoals', icon: 'flag-outline', route: '/(modals)/goals', tone: '#8b5cf6', featureGate: 'goals' },
];

const DISCOVER: MenuItem[] = [
  { labelKey: 'discover', descriptionKey: 'navDescriptions.discover', icon: 'compass-outline', route: '/(tabs)/explore', tone: '#0ea5e9' },
  { labelKey: 'search', descriptionKey: 'navDescriptions.search', icon: 'search-outline', route: '/(modals)/search', tone: '#64748b', featureGate: 'search' },
  { labelKey: 'listings', descriptionKey: 'navDescriptions.listings', icon: 'storefront-outline', route: '/(tabs)/exchanges', tone: '#0f766e', moduleGate: 'listings' },
  { labelKey: 'jobs', descriptionKey: 'navDescriptions.jobs', icon: 'briefcase-outline', route: '/(modals)/jobs', tone: '#2563eb', featureGate: 'job_vacancies' },
  { labelKey: 'events', descriptionKey: 'navDescriptions.events', icon: 'calendar-outline', route: '/(tabs)/events', tone: '#f43f5e', featureGate: 'events' },
  { labelKey: 'groups', descriptionKey: 'navDescriptions.groups', icon: 'people-outline', route: '/(modals)/groups', tone: '#06b6d4', featureGate: 'groups' },
  { labelKey: 'groupExchanges', descriptionKey: 'navDescriptions.groupExchanges', icon: 'swap-horizontal-outline', route: '/(modals)/group-exchanges' as Href, tone: '#6366f1', featureGate: 'group_exchanges' },
  { labelKey: 'polls', descriptionKey: 'navDescriptions.polls', icon: 'stats-chart-outline', route: '/(modals)/polls' as Href, tone: '#7c3aed', featureGate: 'polls' },
  { labelKey: 'ideation', descriptionKey: 'navDescriptions.ideation', icon: 'bulb-outline', route: '/(modals)/ideation' as Href, tone: '#f59e0b', featureGate: 'ideation_challenges' },
  { labelKey: 'browseMembers', descriptionKey: 'navDescriptions.browseMembers', icon: 'people-outline', route: '/(modals)/members', tone: '#14b8a6', featureGate: 'connections' },
  { labelKey: 'connections', descriptionKey: 'navDescriptions.connections', icon: 'person-add-outline', route: '/(modals)/connections' as Href, tone: '#6366f1', featureGate: 'connections' },
  { labelKey: 'volunteering', descriptionKey: 'navDescriptions.volunteering', icon: 'heart-outline', route: '/(modals)/volunteering', tone: '#e11d48', featureGate: 'volunteering' },
  { labelKey: 'organisations', descriptionKey: 'navDescriptions.organisations', icon: 'business-outline', route: '/(modals)/organisations', tone: '#6366f1', featureGate: 'organisations' },
  { labelKey: 'support.title', descriptionKey: 'navDescriptions.support', icon: 'help-circle-outline', route: '/(modals)/support' as Href, tone: '#0ea5e9' },
  { labelKey: 'skills', descriptionKey: 'navDescriptions.skills', icon: 'ribbon-outline', route: '/(modals)/skills' as Href, tone: '#10b981' },
  { labelKey: 'aiChat', descriptionKey: 'navDescriptions.aiChat', icon: 'sparkles-outline', route: '/(modals)/chat', tone: '#a855f7', featureGate: 'ai_chat' },
  { labelKey: 'marketplaceBrowse', descriptionKey: 'navDescriptions.marketplaceBrowse', icon: 'bag-handle-outline', route: '/(modals)/marketplace' as Href, tone: '#0ea5e9', featureGate: 'marketplace' },
];

const FEDERATION: MenuItem[] = [
  { labelKey: 'federationHub', descriptionKey: 'navDescriptions.federationHub', icon: 'git-network-outline', route: '/(modals)/federation' as Href, tone: '#0ea5e9', featureGate: 'federation' },
  { labelKey: 'federationPartners', descriptionKey: 'navDescriptions.federationPartners', icon: 'globe-outline', route: '/(modals)/federation-partners' as Href, tone: '#6366f1', featureGate: 'federation' },
  { labelKey: 'federationMembers', descriptionKey: 'navDescriptions.federationMembers', icon: 'people-outline', route: '/(modals)/federation-members' as Href, tone: '#a855f7', featureGate: 'federation' },
  { labelKey: 'federationConnections', descriptionKey: 'navDescriptions.federationConnections', icon: 'person-add-outline', route: '/(modals)/federation-connections' as Href, tone: '#14b8a6', featureGate: 'federation' },
  { labelKey: 'federationMessages', descriptionKey: 'navDescriptions.federationMessages', icon: 'chatbubbles-outline', route: '/(modals)/federation-messages' as Href, tone: '#06b6d4', featureGate: 'federation' },
  { labelKey: 'federationListings', descriptionKey: 'navDescriptions.federationListings', icon: 'list-outline', route: '/(modals)/federation-listings' as Href, tone: '#f59e0b', featureGate: 'federation' },
  { labelKey: 'federationGroups', descriptionKey: 'navDescriptions.federationGroups', icon: 'people-circle-outline', route: '/(modals)/federation-groups' as Href, tone: '#8b5cf6', featureGate: 'federation' },
  { labelKey: 'federationEvents', descriptionKey: 'navDescriptions.federationEvents', icon: 'calendar-outline', route: '/(modals)/federation-events' as Href, tone: '#f43f5e', featureGate: 'federation' },
  { labelKey: 'federationSettings', descriptionKey: 'navDescriptions.federationSettings', icon: 'settings-outline', route: '/(modals)/federation-settings' as Href, tone: '#64748b', featureGate: 'federation' },
];

const ACCOUNT: MenuItem[] = [
  { labelKey: 'settings', descriptionKey: 'navDescriptions.settings', icon: 'settings-outline', route: '/(modals)/settings', tone: '#64748b', moduleGate: 'settings' },
];

export default function MoreScreen() {
  const { t } = useTranslation(['profile', 'common', 'auth']);
  const { user, displayName, logout, isLoading } = useAuth();
  const { hasFeature, hasModule } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { confirm, confirmDialog } = useConfirm();

  const rawBalance = user && 'balance' in user ? (user.balance as number | null) : null;
  const balance = typeof rawBalance === 'number' && Number.isFinite(rawBalance) ? rawBalance : null;
  const isMenuItemVisible = (item: MenuItem) => {
    if (item.moduleGate && !hasModule(item.moduleGate)) return false;
    if (item.featureGate && !hasFeature(item.featureGate)) return false;
    if (item.featureGates?.some((feature) => !hasFeature(feature))) return false;
    return true;
  };
  const visibleDiscover = DISCOVER.filter(isMenuItemVisible);
  const visibleMySpace = MY_SPACE.filter(isMenuItemVisible);
  const visibleFederation = FEDERATION.filter(isMenuItemVisible);
  const visibleAccount = ACCOUNT.filter(isMenuItemVisible);
  const collapsibleSections = [
    { title: t('federationSection'), value: 'federation', icon: 'git-network-outline' as IoniconName, items: visibleFederation },
    { title: t('mySpace'), value: 'my-space', icon: 'person-circle-outline' as IoniconName, items: visibleMySpace },
  ].filter((section) => section.items.length > 0);

  function navigate(route: Href) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route);
  }

  function confirmLogout() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    confirm({
      title: t('signOutConfirmTitle'),
      message: t('signOutConfirmMessage'),
      confirmLabel: t('signOut'),
      cancelLabel: t('common:buttons.cancel'),
      confirmAccessibilityLabel: `${t('signOutConfirmTitle')}: ${t('signOut')}`,
      confirmTestID: 'profile-confirm-sign-out',
      variant: 'danger',
      onConfirm: () => void logout(),
    });
  }

  // 🔴 `!user` used to mean BOTH of these, and both rendered a skeleton — so a member whose
  // session failed to restore sat in front of a permanent loading placeholder with no way out
  // but to kill the app. This screen had no failure branch at all (the readiness audit found
  // zero references to `error` in it).
  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  // Auth has finished and there is still no member. The honest recovery is to sign in again —
  // a "try again" button would have nothing to retry, since this screen reads the member from
  // context rather than fetching. The app's start-up redirect normally prevents this state, so
  // this is a safety net rather than a path anyone should reach; before, that safety net was an
  // endless skeleton.
  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ErrorState
          testID="profile-session-unavailable"
          title={t('sessionUnavailableTitle')}
          subtitle={t('sessionUnavailableSubtitle')}
          retryLabel={t('auth:login.submit')}
          onRetry={() => router.replace('/(auth)/login')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 112 }} showsVerticalScrollIndicator={false}>
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-5 p-4">
            <View className="flex-row items-start gap-4">
              <Avatar uri={user.avatar_url} name={displayName} size={72} showOnline />
              <View className="min-w-0 flex-1 gap-2">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('hubEyebrow')}
                </Text>
                <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }} numberOfLines={2}>
                  {displayName}
                </Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {user.email}
                </Text>
                {balance !== null ? (
                  <Chip size="sm" variant="secondary">
                    <Ionicons name="time-outline" size={12} color={primary} />
                    <Chip.Label>{t('balanceLabel', { balance: balance.toFixed(1) })}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </View>

            <View className="flex-row gap-3">
              <HeroButton className="flex-1" variant="primary" onPress={() => navigate('/(modals)/edit-profile')}>
                <AccentIcon name="create-outline" size={17} />
                <HeroButton.Label>{t('editProfile')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant="secondary" onPress={() => navigate('/(modals)/wallet')}>
                <Ionicons name="wallet-outline" size={17} color={primary} />
                <HeroButton.Label>{t('viewWallet')}</HeroButton.Label>
              </HeroButton>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <View className="mb-4 flex-row gap-3">
          <MetricCard icon="star-outline" label={t('quickStats.trust')} value={t('quickStats.active')} tone="#f59e0b" theme={theme} />
          <MetricCard icon="git-network-outline" label={t('quickStats.network')} value={visibleDiscover.length.toString()} tone="#0ea5e9" theme={theme} />
          <MetricCard icon="shield-checkmark-outline" label={t('quickStats.account')} value={t('quickStats.ready')} tone="#22c55e" theme={theme} />
        </View>

        <MenuSection title={t('discover')} items={visibleDiscover} onNavigate={navigate} theme={theme} />
        <CollapsibleMenuSections sections={collapsibleSections} onNavigate={navigate} theme={theme} />
        <MenuSection title={t('account')} items={visibleAccount} onNavigate={navigate} theme={theme} />

        <HeroButton
          testID="profile-sign-out"
          accessibilityLabel={t('signOut')}
          variant="danger"
          onPress={confirmLogout}
          className="mt-1"
        >
          <Ionicons name="log-out-outline" size={18} color="#fff" />
          <HeroButton.Label>{t('signOut')}</HeroButton.Label>
        </HeroButton>

        <SourceRepositoryLink className="mt-6" />
      </ScrollView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function MetricCard({ icon, label, value, tone, theme }: { icon: IoniconName; label: string; value: string; tone: string; theme: Theme }) {
  return (
    <HeroCard className="flex-1 rounded-panel p-0">
      <HeroCard.Body className="items-center gap-1 px-2 py-3">
        <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
          <Ionicons name={icon} size={17} color={tone} />
        </View>
        <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{value}</Text>
        <Text className="text-center text-[11px] leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{label}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function MenuSection({ title, items, onNavigate, theme }: { title: string; items: MenuItem[]; onNavigate: (route: Href) => void; theme: Theme }) {
  if (items.length === 0) return null;

  return (
    <View className="mb-4">
      <Text className="mb-2 text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
        {title}
      </Text>
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-2 p-2">
          {items.map((item) => (
            <MenuRow key={item.labelKey} item={item} onPress={() => onNavigate(item.route)} theme={theme} />
          ))}
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

function CollapsibleMenuSections({
  sections,
  onNavigate,
  theme,
}: {
  sections: { title: string; value: string; icon: IoniconName; items: MenuItem[] }[];
  onNavigate: (route: Href) => void;
  theme: Theme;
}) {
  if (sections.length === 0) return null;

  return (
    <Accordion selectionMode="single" variant="surface" hideSeparator className="mb-4 overflow-hidden rounded-panel">
      {sections.map((section) => (
        <CollapsibleMenuSection key={section.value} {...section} onNavigate={onNavigate} theme={theme} />
      ))}
    </Accordion>
  );
}

function CollapsibleMenuSection({
  title,
  value,
  icon,
  items,
  onNavigate,
  theme,
}: {
  title: string;
  value: string;
  icon: IoniconName;
  items: MenuItem[];
  onNavigate: (route: Href) => void;
  theme: Theme;
}) {
  if (items.length === 0) return null;

  return (
    <Accordion.Item value={value}>
      <Accordion.Trigger className="px-4 py-4" accessibilityLabel={title}>
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(theme.text, 0.08) }}>
            <Ionicons name={icon} size={18} color={theme.textSecondary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Chip size="sm" variant="secondary">
            <Chip.Label>{items.length}</Chip.Label>
          </Chip>
        </View>
        <Accordion.Indicator iconProps={{ color: theme.textSecondary }} />
      </Accordion.Trigger>
      <Accordion.Content className="px-2 pb-2">
        <View className="gap-2">
          {items.map((item) => (
            <MenuRow key={item.labelKey} item={item} onPress={() => onNavigate(item.route)} theme={theme} />
          ))}
        </View>
      </Accordion.Content>
    </Accordion.Item>
  );
}

function MenuRow({ item, onPress, theme }: { item: MenuItem; onPress: () => void; theme: Theme }) {
  const { t } = useTranslation('profile');

  return (
    <NativePressable
      accessibilityLabel={t(item.labelKey)}
      onPress={onPress}
      className="w-full rounded-panel-inner px-3 py-3"
      style={{
        minHeight: 76,
        backgroundColor: withAlpha(theme.text, 0.06),
        borderColor: 'transparent',
        borderWidth: 1,
      }}
      feedback="highlight"
    >
      <View className="min-h-[50px] flex-row items-center gap-3">
        <View className="size-12 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(item.tone, 0.14) }}>
          <Ionicons name={item.icon} size={20} color={item.tone} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-semibold leading-5" style={{ color: theme.text }} numberOfLines={2}>
            {t(item.labelKey)}
          </Text>
          <Text className="text-xs leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {t(item.descriptionKey)}
          </Text>
        </View>
        <View className="shrink-0">
          <Ionicons name="chevron-forward-outline" size={18} color={theme.textSecondary} />
        </View>
      </View>
    </NativePressable>
  );
}
