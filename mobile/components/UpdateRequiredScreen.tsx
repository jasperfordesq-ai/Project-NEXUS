// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What a member sees when the server has refused this build as too old.
 *
 * The visible half of the force-update lever. `lib/api/client.ts` turns a 426 into a
 * record in `lib/updates/updateRequiredStore.ts`; the root layout renders this over
 * everything when that record exists.
 *
 * 🔴 It is deliberately a dead end, which is the one place in this app where that is the
 * correct design. Every other blocking state has been given a way out this week — the
 * profile screen, the unmappable-link screen, the failed loads — because a member stuck
 * with no exit cannot tell a policy from a crash. Here the exit IS the policy: the API
 * will refuse every request from this build, so any "continue anyway" button would lead
 * straight to a wall of unexplained failures. So there is no dismiss, no back, and no
 * skip — only the update, and enough information to explain why.
 *
 * What it must not do:
 *
 *  * **Never invent the update URL.** It comes from the server, because the copies that
 *    need it are exactly the ones that cannot be updated any other way; a hardcoded URL
 *    would be unfixable in the builds that matter.
 *  * **Never require a provider.** It renders outside the tenant and auth providers on
 *    purpose: a build this old may fail to load its tenant or its session at all, and the
 *    message must survive that. Hence `useTheme()` (module-store backed, provider-free)
 *    rather than anything tenant-aware.
 */

import { useCallback } from 'react';
import { Linking, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/lib/hooks/useTheme';
import type { UpdateRequirement } from '@/lib/updates/updateRequiredStore';

interface Props {
  requirement: UpdateRequirement;
}

export default function UpdateRequiredScreen({ requirement }: Props) {
  const { t } = useTranslation(['common']);
  const theme = useTheme();

  const openUpdate = useCallback(() => {
    if (!requirement.updateUrl) return;
    // Guarded: Linking.openURL REJECTS when nothing can handle the URL, and an
    // unhandled rejection on the one screen offering a way forward would be the
    // worst possible place for it.
    void Linking.openURL(requirement.updateUrl).catch(() => undefined);
  }, [requirement.updateUrl]);

  // 🔴 Layout note, learned twice on app/+not-found.tsx: do NOT wrap this content in
  // `flex-1 items-center justify-center`. On a device that rendered the icon, title and
  // body at zero size, showing nothing between the top of the screen and the buttons.
  // Padding plus an inner items-center group, with font size and weight as inline
  // styles, renders correctly.
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: theme.bg }} testID="update-required-screen">
      <View className="px-8 pt-24">
        <View className="items-center gap-4">
          {/* theme.text, not the tenant accent: `usePrimaryColor()` needs TenantProvider,
              and a build this old may fail to resolve its tenant at all. The message has
              to survive that. */}
          <Ionicons name="arrow-up-circle-outline" size={56} color={theme.text} />

          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
            {t('common:updateRequired.title')}
          </Text>

          <Text
            style={{ color: theme.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' }}
          >
            {t('common:updateRequired.subtitle')}
          </Text>
        </View>

        {requirement.updateUrl ? (
          <View className="mt-10 w-full">
            <HeroButton onPress={openUpdate} accessibilityLabel={t('common:updateRequired.action')}>
              <HeroButton.Label>{t('common:updateRequired.action')}</HeroButton.Label>
            </HeroButton>
          </View>
        ) : (
          // The server did not tell us where to go. Say so rather than showing a button
          // that does nothing — an unexplained dead end is what this screen exists to
          // prevent, and it must not become one itself.
          <Text
            className="mt-10"
            style={{ color: theme.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}
          >
            {t('common:updateRequired.noLink')}
          </Text>
        )}

        {/* Version detail, quiet and last. Useless to most members and the first thing
            anyone asks for when a member reports this, so it is present but not shouted. */}
        {requirement.currentVersion || requirement.clientVersion ? (
          <Text
            className="mt-8"
            style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}
            testID="update-required-versions"
          >
            {t('common:updateRequired.versions', {
              current: requirement.currentVersion || '—',
              installed: requirement.clientVersion || '—',
            })}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
