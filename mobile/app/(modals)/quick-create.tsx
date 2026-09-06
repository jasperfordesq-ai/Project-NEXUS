// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface QuickCreateOption {
  labelKey: string;
  descriptionKey: string;
  icon: IoniconName;
  /** An in-app route. Every option on this menu is built natively — see below. */
  route: string;
  tone: string;
  featureGate?: string;
  moduleGate?: string;
}

const QUICK_CREATE_OPTIONS: QuickCreateOption[] = [
  {
    /*
      🔴 Namespaced keys, deliberately. This screen loads the `common` namespace, and the
      composer's copy lives in `home` beside the rest of the feed's wording rather than
      being duplicated here. An explicit `ns:key` resolves against any bundled namespace.
    */
    labelKey: 'home:newPost.title',
    descriptionKey: 'home:composer.title',
    icon: 'create-outline',
    route: '/(modals)/new-post',
    tone: '#0284c7',
    moduleGate: 'feed',
  },
  {
    labelKey: 'quickCreate.newTimebankListing',
    descriptionKey: 'quickCreate.newTimebankListingDescription',
    icon: 'storefront-outline',
    route: '/(modals)/new-exchange',
    tone: '#0f766e',
    moduleGate: 'listings',
  },
  {
    labelKey: 'quickCreate.newMarketplaceListing',
    descriptionKey: 'quickCreate.newMarketplaceListingDescription',
    icon: 'bag-add-outline',
    route: '/(modals)/new-marketplace-listing',
    tone: '#16a34a',
    featureGate: 'marketplace',
  },
  {
    labelKey: 'quickCreate.newMessage',
    descriptionKey: 'quickCreate.newMessageDescription',
    icon: 'chatbubble-ellipses-outline',
    route: '/(modals)/new-message',
    tone: '#0ea5e9',
  },
  {
    labelKey: 'quickCreate.newEvent',
    descriptionKey: 'quickCreate.newEventDescription',
    icon: 'calendar-outline',
    route: '/(modals)/new-event',
    tone: '#f97316',
    featureGate: 'events',
  },
  {
    labelKey: 'quickCreate.newPoll',
    descriptionKey: 'quickCreate.newPollDescription',
    icon: 'stats-chart-outline',
    route: '/(modals)/polls?create=1',
    tone: '#7c3aed',
    featureGate: 'polls',
  },
  {
    labelKey: 'quickCreate.newChallenge',
    descriptionKey: 'quickCreate.newChallengeDescription',
    icon: 'bulb-outline',
    route: '/(modals)/new-challenge',
    tone: '#f59e0b',
    featureGate: 'ideation_challenges',
  },
  {
    labelKey: 'quickCreate.newGroup',
    descriptionKey: 'quickCreate.newGroupDescription',
    icon: 'people-outline',
    route: '/(modals)/new-group',
    tone: '#8b5cf6',
    featureGate: 'groups',
  },
  {
    labelKey: 'quickCreate.newGoal',
    descriptionKey: 'quickCreate.newGoalDescription',
    icon: 'flag-outline',
    route: '/(modals)/goals',
    tone: '#2563eb',
    featureGate: 'goals',
  },
  /*
    🔴 Owner's report, 2026-09-04: "I couldn't see anything for courses or podcasts"
    in this menu, on a community that had both switched on. Auditing every module
    against this list found three native builders that already existed but were
    never offered here (jobs, volunteering, organisations), and two modules the app
    can only VIEW — courses and podcasts have no native builder at all. A member
    reasonably concluded those features did not exist.

    🔴 The first fix was wrong, and the owner said so on 2026-09-06: courses and
    podcasts were added here as links that OPENED THE WEBSITE, because
    `parity-map.json` had both authoring surfaces recorded as "out-of-scope —
    authoring workspace". Handing a member off to a browser mid-way through a
    Create menu reads as a broken app, not as a considered boundary, and it
    quietly made the out-of-scope ruling permanent by removing the pressure to
    build the real thing. That ruling is reversed; both builders are now native
    (`new-course`, `podcast-studio`) and `parity-map.json` records them as such.

    Nothing on this menu leaves the app any more, which is why the whole
    `opensOnWebsite` handoff mechanism has gone with it rather than being left
    behind unused.

    Group exchanges are deliberately absent — that builder needs a group, so it
    belongs inside a group. Care in Community is deliberately absent — it is
    outside native scope by store-audience policy.
  */
  {
    labelKey: 'quickCreate.newJob',
    descriptionKey: 'quickCreate.newJobDescription',
    icon: 'briefcase-outline',
    route: '/(modals)/new-job',
    tone: '#0891b2',
    featureGate: 'job_vacancies',
  },
  {
    labelKey: 'quickCreate.newVolunteering',
    descriptionKey: 'quickCreate.newVolunteeringDescription',
    icon: 'hand-left-outline',
    route: '/(modals)/new-volunteering',
    tone: '#059669',
    featureGate: 'volunteering',
  },
  {
    labelKey: 'quickCreate.newOrganisation',
    descriptionKey: 'quickCreate.newOrganisationDescription',
    icon: 'business-outline',
    route: '/(modals)/new-organisation',
    tone: '#4f46e5',
    featureGate: 'organisations',
  },
  {
    labelKey: 'quickCreate.newCourse',
    descriptionKey: 'quickCreate.newCourseDescription',
    icon: 'school-outline',
    route: '/(modals)/new-course',
    tone: '#7c3aed',
    featureGate: 'courses',
  },
  {
    labelKey: 'quickCreate.newPodcast',
    descriptionKey: 'quickCreate.newPodcastDescription',
    icon: 'mic-outline',
    route: '/(modals)/podcast-studio',
    tone: '#db2777',
    featureGate: 'podcasts',
  },
];

function QuickCreateRouteInner() {
  const { t } = useTranslation(['common']);
  const { hasFeature, hasModule } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const visibleOptions = QUICK_CREATE_OPTIONS.filter((option) => {
    if (option.featureGate && !hasFeature(option.featureGate)) return false;
    if (option.moduleGate && !hasModule(option.moduleGate)) return false;
    return true;
  });

  function openOption(option: QuickCreateOption) {
    router.push(option.route as Href);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('quickCreate.title')} backLabel={t('buttons.back')} fallbackHref="/(tabs)/home" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-2 p-4">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
              {t('quickCreate.eyebrow')}
            </Text>
            <Text className="text-2xl font-bold" style={{ color: theme.text }}>
              {t('quickCreate.title')}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t('quickCreate.subtitle')}
            </Text>
          </HeroCard.Body>
        </HeroCard>

        {visibleOptions.length > 0 ? (
          <View className="gap-3">
            {visibleOptions.map((option) => (
              <HeroButton
                key={option.labelKey}
                accessibilityLabel={t(option.labelKey)}
                testID={`quick-create-${option.labelKey.split('.').pop()}`}
                className="h-auto justify-start rounded-panel p-0"
                variant="secondary"
                onPress={() => openOption(option)}
              >
                <View className="w-full flex-row items-center gap-3 px-3 py-3">
                  <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(option.tone, 0.14) }}>
                    <Ionicons name={option.icon} size={22} color={option.tone} />
                  </View>
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                      {t(option.labelKey)}
                    </Text>
                    <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
                      {t(option.descriptionKey)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward-outline" size={18} color={theme.textSecondary} />
                </View>
              </HeroButton>
            ))}
          </View>
        ) : (
          <EmptyState
            icon="add-circle-outline"
            title={t('quickCreate.emptyTitle')}
            subtitle={t('quickCreate.emptySubtitle')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function QuickCreateRoute() {
  return (
    <ModalErrorBoundary>
      <QuickCreateRouteInner />
    </ModalErrorBoundary>
  );
}
