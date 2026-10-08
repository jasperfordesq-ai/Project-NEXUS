// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Edit an opportunity — the create/edit form from `new-volunteering` with, below it, the
 * one organiser action that form does not carry: deleting the opportunity.
 *
 * This file used to be a bare re-export of `new-volunteering`, so nothing on a phone
 * could remove an opportunity at all (volunteering gap M2). The form itself is unchanged
 * and still owns its hydration, validation and unsaved-changes guard; only the delete
 * strip is added here, asking first because the server soft-deletes with no undo from
 * the app (`DELETE /v2/volunteering/opportunities/{id}` → is_active = 0).
 */

import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spinner, Surface } from 'heroui-native';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { withRouteGate } from '@/components/withRouteGate';
import { deleteOpportunity } from '@/lib/api/volunteeringOrganiser';
import { describeApiError } from '@/lib/api/describeApiError';
import * as Haptics from '@/lib/haptics';
import { useTheme } from '@/lib/hooks/useTheme';
import { useBottomInset } from '@/lib/ui/rootInsets';

import NewVolunteering from './new-volunteering';

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function EditVolunteeringScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const opportunityId = parseId(params.id);
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false);

  async function runDelete(id: number) {
    if (deletePending.current) return;
    deletePending.current = true;
    setDeleting(true);
    try {
      await deleteOpportunity(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('deleteOpportunity.doneTitle'), description: t('deleteOpportunity.doneMessage'), variant: 'success' });
      // The detail screen below this one shows a record that no longer exists; land on the list instead.
      router.replace({ pathname: '/(modals)/volunteering', params: { tab: 'organisations' } } as Href);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('deleteOpportunity.failed')), variant: 'danger' });
    } finally {
      deletePending.current = false;
      setDeleting(false);
    }
  }

  function askDelete() {
    if (!opportunityId) return;
    confirm({
      title: t('deleteOpportunity.confirmTitle'),
      message: t('deleteOpportunity.confirmMessage'),
      confirmLabel: t('deleteOpportunity.confirm'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      confirmTestID: 'edit-volunteering-delete-confirm',
      onConfirm: () => runDelete(opportunityId),
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1 }}>
        <NewVolunteering />
      </View>
      {opportunityId ? (
        <Surface variant="secondary" className="gap-2 px-4 pt-3" style={{ paddingBottom: Math.max(bottomInset, 12) }} testID="edit-volunteering-delete-zone">
          <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('deleteOpportunity.heading')}</Text>
          <Text className="text-xs leading-4" style={{ color: theme.textMuted }}>{t('deleteOpportunity.hint')}</Text>
          <HeroButton
            size="sm"
            variant="danger-soft"
            isDisabled={deleting}
            accessibilityLabel={t('deleteOpportunity.button')}
            onPress={askDelete}
            testID="edit-volunteering-delete"
          >
            {deleting ? <Spinner size="sm" /> : null}
            <HeroButton.Label>{t('deleteOpportunity.button')}</HeroButton.Label>
          </HeroButton>
        </Surface>
      ) : null}
      {confirmDialog}
    </View>
  );
}

export default withRouteGate(EditVolunteeringScreen, 'edit-volunteering');
