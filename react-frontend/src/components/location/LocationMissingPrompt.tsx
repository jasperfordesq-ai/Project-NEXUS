// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Home-page reminder for a member who has no town on their profile.
 *
 * Owner decisions (9 October 2026):
 *  - It can NEVER be hidden. There is deliberately no dismiss control, no
 *    "remind me later", and nothing is remembered in the browser. It stays
 *    until the member saves a town.
 *  - It is shown whenever the SERVER says the member has no location
 *    (`location_missing === true`), whether or not onboarding is finished.
 *    A member whose community forces the wizard never reaches the home page
 *    before answering it; a member in a community where the wizard is off or
 *    optional (e.g. an admin-created or imported member) would otherwise never
 *    be asked. Such a member may see this card beside the onboarding banner.
 *  - Nothing is forced on the server: this is a firm, permanent prompt, not a gate.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import MapPin from 'lucide-react/icons/map-pin';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { MemberLocationField } from '@/components/location/MemberLocationField';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import {
  EMPTY_MEMBER_LOCATION,
  hasLocationText,
  isLocationMissing,
  locationErrorField,
  locationUpdatePayload,
  type MemberLocationValue,
} from '@/lib/memberLocation';
import type { User } from '@/types/api';

/** The one rule for when the reminder appears. */
export function shouldShowLocationReminder(user: User | null | undefined): boolean {
  return isLocationMissing(user);
}

export function LocationMissingPrompt() {
  const { t } = useTranslation('dashboard');
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState<MemberLocationValue>(EMPTY_MEMBER_LOCATION);
  const [isSaving, setIsSaving] = useState(false);

  if (!shouldShowLocationReminder(user)) return null;

  const handleSave = async () => {
    if (!hasLocationText(value)) return;

    setIsSaving(true);
    try {
      const response = await api.put('/v2/users/me', locationUpdatePayload(value));

      if (response.success) {
        // The refreshed member no longer has location_missing, so this card
        // disappears by itself.
        await refreshUser();
        toast.success(t('location_prompt.saved'));
        return;
      }

      // Our own wording, keyed off which field the server refused — never the server's English.
      const refused = locationErrorField(response.errors);
      toast.error(
        t('location_prompt.not_saved'),
        refused === 'location'
          ? t('location_prompt.error_location')
          : refused === 'coordinates'
            ? t('location_prompt.error_coordinates')
            : t('location_prompt.error_generic'),
      );
    } catch (error) {
      logError('Failed to save location from the home-page reminder', error);
      toast.error(t('location_prompt.not_saved'), t('location_prompt.error_generic'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <GlassCard className="border-l-4 border-l-accent p-4 sm:p-5" role="region" aria-label={t('location_prompt.title')}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/15 dark:bg-accent/20 flex items-center justify-center shrink-0">
          <MapPin className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-theme-primary">{t('location_prompt.title')}</p>
          <p className="mt-1 text-sm leading-5 text-theme-muted">{t('location_prompt.subtitle')}</p>

          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <MemberLocationField
              className="min-w-0 flex-1"
              value={value}
              onChange={setValue}
              label={t('location_prompt.label')}
              placeholder={t('location_prompt.placeholder')}
              isRequired
            />
            <Button
              type="submit"
              size="sm"
              className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white sm:mt-1 sm:w-auto"
              isLoading={isSaving}
              isDisabled={isSaving || !hasLocationText(value)}
            >
              {t('location_prompt.save')}
            </Button>
          </form>
        </div>
      </div>
    </GlassCard>
  );
}
