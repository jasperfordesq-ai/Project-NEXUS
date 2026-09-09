// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef } from 'react';
import { Animated, PixelRatio, Text, View } from 'react-native';
import { Tabs, router, type Href, usePathname } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useRealtimeContext } from '@/lib/context/RealtimeContext';
import { useOptionalTenantCapabilities } from '@/lib/context/TenantContext';
import { isRouteAllowed } from '@/lib/navigation/routeRequirements';

import { useReducedMotion } from '@/lib/hooks/useReducedMotion';
import { TAB_LABEL_MAX_FONT_SCALE } from '@/lib/ui/textScale';
import { contrastText } from '@/lib/utils/color';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Animated badge that scales in with a spring when it appears. */
function TabBadge({ count, accessibilityLabel }: { count: number; accessibilityLabel: string }) {
  const scale = useRef(new Animated.Value(0)).current;
  const primary = usePrimaryColor();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (count > 0) {
      // 🔴 Hand-written Animated code is outside HeroUI's reduced-motion handling, so
      // this bounce ran for members who had asked the OS for no motion (audit
      // 2026-09-05, F09). With the setting on, the badge simply appears.
      if (reducedMotion) {
        scale.setValue(1);
        return;
      }
      scale.setValue(0);
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      scale.setValue(0);
    }
  }, [count, scale, reducedMotion]);

  if (count <= 0) return null;

  return (
    <Animated.View
      className="absolute -top-1 -right-2.5 min-w-[18px] h-[18px] rounded-full items-center justify-center px-1"
      style={{ backgroundColor: primary, transform: [{ scale }] }}
      accessibilityLabel={accessibilityLabel}
      testID="messages-tab-badge"
    >
      {/* Foreground from the shared contrast rule, not hard-coded white: a bright tenant
          accent (e.g. yellow) made white 10px digits unreadable. */}
      <Animated.Text className="text-[10px] font-bold text-center" style={{ color: contrastText(primary) }}>
        {count > 99 ? '99+' : count}
      </Animated.Text>
    </Animated.View>
  );
}

interface TabConfig {
  name: string;
  i18nKey: string;
  icon: IoniconName;
  iconFocused: IoniconName;
  quickCreate?: boolean;
}

const TABS_CONFIG: TabConfig[] = [
  { name: 'home',      i18nKey: 'common:tabs.home',      icon: 'home-outline',    iconFocused: 'home' },
  { name: 'exchanges', i18nKey: 'common:tabs.listings',   icon: 'list-outline',    iconFocused: 'list' },
  { name: 'create',    i18nKey: 'common:tabs.create',     icon: 'add-circle-outline', iconFocused: 'add-circle', quickCreate: true },
  { name: 'messages',  i18nKey: 'common:tabs.messages',   icon: 'chatbubble-outline', iconFocused: 'chatbubble' },
  { name: 'profile',   i18nKey: 'common:tabs.more',       icon: 'menu-outline',    iconFocused: 'menu' },
];

export default function TabsLayout() {
  const { t } = useTranslation();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { unreadMessages, refreshCounts } = useRealtimeContext();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // 🔴 A tab for a module the community has switched off must not be in the bar at all.
  // React hides Messages when the `messages` module is off and Listings when `listings`
  // is off; the native bar showed both regardless (audit 2026-09-07). The requirement per
  // tab lives in `lib/navigation/routeRequirements.ts`, and an unknown configuration
  // (cold start, offline with no cache) keeps every tab — see `isRouteAllowed`.
  const capabilities = useOptionalTenantCapabilities();

  /*
    🔴 The tab bar is the one row in the app whose height the navigator fixes, so it is the
    one place the OS text-size setting could not simply be obeyed. At a 2.0 font scale the
    11pt labels grew to 22pt inside a 60dp bar and were clipped mid-word, on every screen.

    Two halves, and both are needed. The label is capped at 1.3 (the most a five-tab bar can
    show on a 360dp phone before "Messages" truncates to nothing useful), and the bar grows
    by the same capped amount so the larger label still fits instead of clipping against a
    height that never moved. `PixelRatio.getFontScale()` is read at render, which is when the
    navigator measures; Android restarts the activity on a font-scale change, so it is
    re-read. Audit 2026-09-09, item 3.
  */
  const labelFontScale = Math.min(PixelRatio.getFontScale(), TAB_LABEL_MAX_FONT_SCALE);
  const tabBarContentHeight = Math.round(60 + (labelFontScale - 1) * 16);

  // Single source of truth from RealtimeContext — no duplicate API call
  const messagesBadgeCount = unreadMessages;

  // Re-read the real unread count when the user arrives at the Messages tab.
  //
  // This used to zero the badge locally instead. That was cosmetic — it told the
  // server nothing, so the count was still waiting at the next login, which is
  // what made the red dot look like it kept coming back. Merely *looking* at the
  // conversation list also does not read anything; the badge must keep agreeing
  // with the "N unread" chip on the list itself.
  useEffect(() => {
    if (pathname === '/messages') {
      refreshCounts(true);
    }
  }, [pathname, refreshCounts]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          borderTopWidth: 1,
          paddingBottom: (insets.bottom || 0) + 4,
          paddingTop: 4,
          height: tabBarContentHeight + (insets.bottom || 0),
          shadowColor: '#000',
          shadowOpacity: 0.14,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 16,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      {TABS_CONFIG.map(({ name, i18nKey, icon, iconFocused, quickCreate }) => (
        <Tabs.Screen
          key={name}
          name={name}
          listeners={quickCreate ? {
            tabPress: (event) => {
              event.preventDefault();
              router.push('/(modals)/quick-create' as Href);
            },
          } : undefined}
          options={{
            title: t(i18nKey),
            /*
              Rendered rather than styled, because `tabBarLabelStyle` has no way to express a
              cap — `maxFontSizeMultiplier` is a Text prop, not a style. `title` above stays
              as it is: it is what a screen reader announces, and it must not be capped or
              truncated.
            */
            tabBarLabel: ({ color }: { color: string }) => (
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE}
                style={{ color, fontSize: 11, fontWeight: '600', textAlign: 'center' }}
              >
                {t(i18nKey)}
              </Text>
            ),
            // `href: null` removes the tab from the bar; `undefined` leaves the default.
            ...(isRouteAllowed(capabilities, name) ? {} : { href: null }),
            tabBarIcon: ({ focused, color, size }) => (
              <View style={{ position: 'relative' }}>
                <Ionicons
                  name={focused ? iconFocused : icon}
                  size={size}
                  color={color}
                />
                {name === 'messages' && (
                  <TabBadge count={messagesBadgeCount} accessibilityLabel={t('unreadBadge', { count: messagesBadgeCount })} />
                )}
              </View>
            ),
          }}
        />
      ))}
      {/* Hide auxiliary tabs from the tab bar — navigated to programmatically */}
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="groups" options={{ href: null }} />
      <Tabs.Screen name="members" options={{ href: null }} />
      <Tabs.Screen name="events" options={{ href: null }} />
    </Tabs>
  );
}
