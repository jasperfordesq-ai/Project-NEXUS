// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Tabs, router, type Href, usePathname } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useRealtimeContext } from '@/lib/context/RealtimeContext';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** Animated badge that scales in with a spring when it appears. */
function TabBadge({ count }: { count: number }) {
  const scale = useRef(new Animated.Value(0)).current;
  const primary = usePrimaryColor();

  useEffect(() => {
    if (count > 0) {
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
  }, [count, scale]);

  if (count <= 0) return null;

  return (
    <Animated.View
      className="absolute -top-1 -right-2.5 min-w-[18px] h-[18px] rounded-full items-center justify-center px-1"
      style={{ backgroundColor: primary, transform: [{ scale }] }}
    >
      <Animated.Text className="text-white text-[10px] font-bold text-center">
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
          height: 60 + (insets.bottom || 0),
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
            tabBarIcon: ({ focused, color, size }) => (
              <View style={{ position: 'relative' }}>
                <Ionicons
                  name={focused ? iconFocused : icon}
                  size={size}
                  color={color}
                />
                {name === 'messages' && (
                  <TabBadge count={messagesBadgeCount} />
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
