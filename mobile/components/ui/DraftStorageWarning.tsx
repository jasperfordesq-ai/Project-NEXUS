// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Alert } from 'heroui-native';
import { useTranslation } from 'react-i18next';

export default function DraftStorageWarning({ visible, testID = 'draft-storage-warning' }: { visible: boolean; testID?: string }) {
  const { t } = useTranslation('common');
  if (!visible) return null;

  return (
    <Alert status="warning" accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{t('draftStorage.title')}</Alert.Title>
        <Alert.Description>{t('draftStorage.message')}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
