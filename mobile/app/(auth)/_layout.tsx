// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';

export default function AuthLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-background">
      <View className="flex-1">
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="select-tenant" />
        </Stack>
      </View>
      <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        <SourceRepositoryLink />
      </View>
    </View>
  );
}
