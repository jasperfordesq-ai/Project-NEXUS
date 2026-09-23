// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ListingTab — listing creation for the Compose Hub.
 *
 * Thin wrapper around the shared ListingForm (the same polished form as
 * /listings/create), adding composer-specific behaviour: draft
 * persistence, template prefill, and the mobile overlay header submit
 * button registration.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { useDraftPersistence } from '@/hooks';
import { userScopedStorageKey } from '@/lib/userScopedStorage';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ListingForm } from '@/components/listings/ListingForm';
import type { ListingFormSubmitState, ListingFormValues } from '@/components/listings/ListingForm';
import { useComposeSubmit } from '../ComposeSubmitContext';
import type { TabSubmitProps } from '../types';

interface ListingDraft {
  title: string;
  description: string;
  type: 'offer' | 'request';
}

export function ListingTab({ onSuccess, onClose, templateData, onContentChange }: TabSubmitProps) {
  const { t } = useTranslation('feed');
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { register, unregister } = useComposeSubmit();
  const isMobile = useMediaQuery('(max-width: 639px)');

  const [draft, setDraft, clearDraft] = useDraftPersistence<ListingDraft>(
    // F-109: drafts belong to one member of one community.
    userScopedStorageKey('compose-draft-listing', tenant?.id, user?.id),
    { title: '', description: '', type: 'offer' },
  );
  // The restored draft seeds the form once on mount; afterwards the form owns
  // the state and mirrors changes back via onValuesChange for persistence.
  const [initialDraft] = useState<ListingDraft>(draft);

  const [submitState, setSubmitState] = useState<ListingFormSubmitState | null>(null);

  const handleValuesChange = useCallback(
    (values: ListingFormValues) => setDraft(values),
    [setDraft],
  );

  const handleSuccess = useCallback(
    (id?: number) => {
      clearDraft();
      onClose();
      onSuccess('listing', id);
    },
    [clearDraft, onClose, onSuccess],
  );

  const gradientClass = (submitState?.type ?? initialDraft.type) === 'offer'
    ? 'from-emerald-500 to-teal-600'
    : 'from-amber-500 to-orange-600';

  // Register submit capabilities for the mobile overlay header button
  const submitStateRef = useRef(submitState);
  submitStateRef.current = submitState;
  useEffect(() => {
    register({
      canSubmit: submitState?.canSubmit ?? false,
      isSubmitting: submitState?.isSubmitting ?? false,
      onSubmit: () => submitStateRef.current?.submit(),
      buttonLabel: t('compose.create_listing'),
      gradientClass,
    });
    return unregister;
  }, [submitState?.canSubmit, submitState?.isSubmitting, gradientClass, register, unregister, t]);

  return (
    <ListingForm
      variant="sheet"
      initialValues={initialDraft}
      templateData={templateData}
      hideFooter={isMobile}
      onCancel={onClose}
      onContentChange={onContentChange}
      onValuesChange={handleValuesChange}
      onSubmitStateChange={setSubmitState}
      onSuccess={handleSuccess}
    />
  );
}
