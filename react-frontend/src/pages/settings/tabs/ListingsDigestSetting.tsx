// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How often the member gets the offers & requests round-up email.
 *
 * Saves on its own as soon as the member picks an option (it is not part of
 * the notifications form's Save button), because it lives in its own store:
 * GET/PUT /v2/users/me/listings-digest. "Community default" follows whatever
 * the community's admin chose, and says what that currently is.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectItem } from '@/components/ui/Select';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';

type Choice = 'default' | 'weekly' | 'monthly' | 'off';
type CommunityDefault = 'weekly' | 'monthly' | 'off';

interface ListingsDigestSettings {
  frequency: Choice;
  community_default: CommunityDefault;
  effective: CommunityDefault;
}

const CHOICES: Choice[] = ['default', 'weekly', 'monthly', 'off'];

export function ListingsDigestSetting() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const [settings, setSettings] = useState<ListingsDigestSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<ListingsDigestSettings>('/v2/users/me/listings-digest');
        if (!cancelled && res?.success && res.data) setSettings(res.data);
      } catch {
        // Leave the control hidden; the rest of the page still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) return null;

  const handleChange = async (choice: Choice) => {
    if (choice === settings.frequency) return;
    const previous = settings;
    setSettings({ ...settings, frequency: choice });
    setIsSaving(true);
    try {
      const res = await api.put<ListingsDigestSettings>('/v2/users/me/listings-digest', { frequency: choice });
      if (res.success && res.data) {
        setSettings(res.data);
        toast.success(t('listings_digest.saved'));
      } else {
        setSettings(previous);
        toast.error(t('listings_digest.save_failed'));
      }
    } catch {
      setSettings(previous);
      toast.error(t('listings_digest.save_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const communityLabel = t(`listings_digest.frequency_${settings.community_default}`);

  return (
    <div className="p-4 rounded-lg bg-theme-elevated">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="font-medium text-theme-primary">{t('listings_digest.label')}</p>
          <p className="text-sm text-theme-subtle">{t('listings_digest.description')}</p>
        </div>
        <Select
          label={t('listings_digest.label')}
          selectedKeys={[settings.frequency]}
          isDisabled={isSaving}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as Choice | undefined;
            if (value) void handleChange(value);
          }}
          className="sm:max-w-[220px]"
          classNames={{
            trigger: 'bg-theme-elevated border-theme-default',
            value: 'text-theme-primary',
          }}
        >
          {CHOICES.map((choice) => (
            <SelectItem key={choice} id={choice}>
              {choice === 'default'
                ? t('listings_digest.option_default', { frequency: communityLabel })
                : t(`listings_digest.option_${choice}`)}
            </SelectItem>
          ))}
        </Select>
      </div>
    </div>
  );
}

export default ListingsDigestSetting;
