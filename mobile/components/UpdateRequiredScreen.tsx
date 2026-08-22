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

import { useCallback, useMemo } from 'react';
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

/**
 * Numeric-segment version comparison. Returns >0 when `a` is ahead of `b`.
 *
 * Deliberately not a semver library: these strings come from a server response and may be
 * empty, partial ("1.3"), or carry a suffix. Anything unparseable compares as equal, which
 * makes the caller fall through to showing nothing rather than to a wrong claim.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((part) => Number.parseInt(part, 10));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) return 0;
    if (l !== r) return l - r;
  }
  return 0;
}

export default function UpdateRequiredScreen({ requirement }: Props) {
  const { t } = useTranslation(['common']);
  const theme = useTheme();

  /**
   * The "latest / you have" line, or nothing.
   *
   * Shown only when the version being offered is genuinely ahead of the installed one.
   * `currentVersion` is the newest build the server knows about; if the floor has been
   * raised above it, that number is not an upgrade and saying so on a blocking screen tells
   * the member the block is a mistake. The required minimum is the honest fallback, since
   * that IS the version they need. If neither is ahead, the line is omitted entirely — a
   * quiet detail is worth less than a contradiction costs.
   */
  const versionLine = useMemo(() => {
    const installed = requirement.clientVersion?.trim();
    if (!installed) return null;

    const ahead = [requirement.currentVersion, requirement.minimumVersion]
      .map((v) => v?.trim())
      .find((v) => v && compareVersions(v, installed) > 0);

    if (!ahead) return null;

    return t('common:updateRequired.versions', { current: ahead, installed });
  }, [requirement.clientVersion, requirement.currentVersion, requirement.minimumVersion, t]);

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
            anyone asks for when a member reports this, so it is present but not shouted.

            🔴 Never show a "latest" that is not actually newer than what they have.
            Measured on a device 2026-08-22 by firing the lever for the first time: with the
            server floor raised to 1.3.0 while the newest build was still 1.2.0, this line
            read "Latest version 1.2.0 · you have 1.2.0" on a screen that was refusing to let
            the member continue. That sentence tells them the block is a bug, and leaves them
            with nothing to do about it.

            The server is not wrong to report it — `current_version` is "the newest build that
            exists", and config/mobile.php warns that the update a raised floor demands must be
            downloadable first. But a screen this final must not present a contradiction
            whatever the server was configured to say, so it falls back to the version actually
            required and, failing that, says nothing. */}
        {versionLine ? (
          <Text
            className="mt-8"
            style={{ color: theme.textMuted, fontSize: 12, textAlign: 'center' }}
            testID="update-required-versions"
          >
            {versionLine}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
