// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@/components/ui/Icon';

import { useTheme } from '@/lib/hooks/useTheme';
import NativePressable from '@/components/ui/NativePressable';

/**
 * Canonical Project NEXUS source repository.
 *
 * AGPL-3.0-or-later Section 7(b) and the NOTICE file require every interactive
 * user interface to carry a visible attribution notice AND a source-code link.
 * Keep this constant as the single definition — screens must not inline the URL.
 */
export const PROJECT_NEXUS_REPO_URL = 'https://github.com/jasperfordesq-ai/Project-NEXUS';

interface SourceRepositoryLinkProps {
  /** Container spacing override. Screens use `mt-6` at the end of a long scroll. */
  className?: string;
}

/**
 * Licence notice plus the tappable source-repository link.
 *
 * This is the mobile equivalent of the web footer attribution
 * (`react-frontend/src/components/layout/SourceRepositoryLink.tsx`,
 * `accessible-frontend/views/layout.blade.php`, `web-uk/src/views/partials/footer.njk`).
 * It is rendered at the foot of the Profile hub and the settings-family modals so
 * the notice path stays reachable from ordinary navigation.
 *
 * Do not remove: dropping either the notice or the link is a licence violation.
 */
export default function SourceRepositoryLink({ className = 'mt-2' }: SourceRepositoryLinkProps) {
  const { t } = useTranslation('common');
  const theme = useTheme();

  return (
    <View className={`items-center gap-2 px-3 ${className}`} testID="source-repository-attribution">
      <Text className="text-center text-[11px] leading-4" style={{ color: theme.textMuted }}>
        {t('attribution')}
      </Text>
      <Text className="text-center text-[11px] leading-4" style={{ color: theme.textMuted }}>
        {t('sourceRepo.copyright', { year: new Date().getFullYear() })}
      </Text>

      <NativePressable
        accessibilityLabel={t('sourceRepo.accessibilityLabel')}
        accessibilityRole="link"
        testID="source-repository-link"
        feedback="highlight"
        className="rounded-panel-inner px-3 py-2"
        onPress={() => void Linking.openURL(PROJECT_NEXUS_REPO_URL)}
      >
        <View className="min-h-[44px] flex-row items-center justify-center gap-2">
          <Ionicons name="logo-github" size={14} color={theme.textSecondary} />
          <Text
            className="text-center text-[11px] font-semibold leading-4 underline"
            style={{ color: theme.textSecondary }}
          >
            {t('sourceRepo.builtOn')}
          </Text>
          <Ionicons name="open-outline" size={12} color={theme.textMuted} />
        </View>
      </NativePressable>
    </View>
  );
}
