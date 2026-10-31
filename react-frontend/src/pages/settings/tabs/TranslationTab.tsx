import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG35 + AG38 — Translation & Feed preferences tab.
 *
 * Lets the user opt out of personalised feed/listings ranking and turn on
 * UGC auto-translation (which surfaces cached translations when present).
 */

import { useEffect, useState } from 'react';

import Languages from 'lucide-react/icons/languages';
import Sparkles from 'lucide-react/icons/sparkles';
import Save from 'lucide-react/icons/save';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { UGC_PREFERENCES_CHANGED } from '@/contexts/UgcTranslationPreferencesContext';

const SUPPORTED_LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

interface PreferencesPayload {
  feed?: { prefers_chronological?: boolean };
  translation?: {
    auto_translate_ugc?: boolean;
    auto_translate_target_locale?: string | null;
  };
}

interface PreferencesResponse {
  feed?: { prefers_chronological?: boolean };
  translation?: {
    auto_translate_ugc?: boolean;
    auto_translate_target_locale?: string | null;
  };
}

export function TranslationTab() {
  const { t, i18n } = useTranslation('common');
  const toast = useToast();

  const detectedLocale = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
  const userLocale = SUPPORTED_LOCALES.includes(detectedLocale as SupportedLocale)
    ? detectedLocale as SupportedLocale
    : 'en';
  const [prefersChronological, setPrefersChronological] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [targetLocale, setTargetLocale] = useState<SupportedLocale>(userLocale);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.get<PreferencesResponse>('/v2/users/me/preferences');
        if (cancelled) return;
        if (resp.success && resp.data) {
          setPrefersChronological(Boolean(resp.data.feed?.prefers_chronological));
          setAutoTranslate(Boolean(resp.data.translation?.auto_translate_ugc));
          const tl = resp.data.translation?.auto_translate_target_locale;
          if (tl && SUPPORTED_LOCALES.includes(tl as SupportedLocale)) {
            setTargetLocale(tl as SupportedLocale);
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: PreferencesPayload = {
        feed: { prefers_chronological: prefersChronological },
        translation: {
          auto_translate_ugc: autoTranslate,
          auto_translate_target_locale: targetLocale,
        },
      };
      const resp = await api.put('/v2/users/me/preferences', payload);
      if (resp.success) {
        window.dispatchEvent(new Event(UGC_PREFERENCES_CHANGED));
        toast.success(t('settings_translation.saved'));
      } else {
        toast.error(t('settings_translation.save_failed'));
      }
    } catch {
      toast.error(t('settings_translation.save_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">
            {t('feed.personalisation.label')}
          </h2>
        </div>
        <div className="flex items-center justify-between p-4 rounded-lg bg-theme-elevated">
          <div>
            <p className="font-medium text-theme-primary">
              {t('feed.personalisation.latest')}
            </p>
            <p className="text-sm text-theme-subtle">
              {t('feed.personalisation.latest_hint')}
            </p>
          </div>
          <Switch
            isDisabled={isLoading}
            isSelected={prefersChronological}
            onValueChange={setPrefersChronological}
            aria-label={t('feed.personalisation.latest')}
          />
        </div>
      </GlassCard>

      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Languages className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">
            {t('settings_translation.section_title')}
          </h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-theme-elevated">
            <div className="pr-4">
              <p className="font-medium text-theme-primary">
                {t('settings_translation.auto_translate_label')}
              </p>
              <p className="text-sm text-theme-subtle">
                {t('settings_translation.auto_translate_help')}
              </p>
            </div>
            <Switch
              isDisabled={isLoading}
              isSelected={autoTranslate}
              onValueChange={setAutoTranslate}
              aria-label={t('settings_translation.auto_translate_label')}
            />
          </div>

          <Select
            isDisabled={isLoading || !autoTranslate}
            label={t('settings_translation.target_locale_label')}
            selectedKeys={[targetLocale]}
            onSelectionChange={(keys) => {
              const v = keys instanceof Set ? ([...keys][0] as SupportedLocale) : userLocale;
              if (SUPPORTED_LOCALES.includes(v)) setTargetLocale(v);
            }}
            classNames={{
              trigger: 'bg-theme-elevated border-theme-default',
              value: 'text-theme-primary',
              label: 'text-theme-muted',
            }}
          >
            {SUPPORTED_LOCALES.map((loc) => (
              <SelectItem key={loc} id={loc}>{loc.toUpperCase()}</SelectItem>
            ))}
          </Select>
        </div>
      </GlassCard>

      <div className="flex justify-end">
        <Button
          isLoading={isSaving}
          isDisabled={isLoading}
          onPress={handleSave}
          startContent={<Save className="w-4 h-4" aria-hidden="true" />}
        >
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

export default TranslationTab;
