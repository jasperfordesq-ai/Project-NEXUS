// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUgcTranslationPreferences } from '@/lib/context/UgcTranslationPreferencesContext';

type Props = { contentType: string; contentId: string | number; fields: Record<string, string | null | undefined>; disabled?: boolean };
type Result = { key: string; fields: Record<string, string>; partial: boolean };

/** Translated plain text appears beneath the original; no provider calls on automatic cache misses. */
export default function ContentTranslation({ contentType, contentId, fields, disabled = false }: Props) {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const { tenant } = useTenant();
  const preferences = useUgcTranslationPreferences();
  const locale = preferences.automatic && preferences.target ? preferences.target : (i18n?.language || 'en').slice(0, 2);
  const entries = Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()));
  const enabled = !disabled && tenant?.translation?.enabled !== false && entries.length > 0;
  const key = JSON.stringify([tenant?.id, preferences.identity, preferences.automatic, i18n?.language, locale, contentType, contentId, entries, enabled]);
  const currentKey = useRef(key); currentKey.current = key;
  const generation = useRef(0);
  const [result, setResult] = useState<Result | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = result?.key === key ? result : null;
  const visible = current && hidden !== key;
  const translate = useCallback(async (cacheOnly: boolean) => {
    const request = ++generation.current;
    if (!cacheOnly) { setPending(key); setError(null); }
    const responses = await Promise.allSettled(entries.map(([field, text]) => api.post<{ data?: { translated_text?: string } | null }>(`${API_V2}/ugc-translate`, {
      content_type: field === 'body' ? contentType : `${contentType}_${field}`, content_id: contentId,
      source_text: text, target_locale: locale, ...(cacheOnly ? { cache_only: true } : {}),
    })));
    if (generation.current !== request || currentKey.current !== key) return;
    const translated: Record<string, string> = {};
    responses.forEach((response, index) => {
      const text = response.status === 'fulfilled' ? response.value?.data?.translated_text : null;
      if (typeof text === 'string' && text) translated[entries[index]![0]] = text;
    });
    const count = Object.keys(translated).length;
    if (count) { setResult({ key, fields: translated, partial: count !== entries.length }); setHidden(null); }
    if (!cacheOnly && count < entries.length) setError(key);
    setPending(null);
  // The key includes all source fields and request scope; inline objects do not repeat requests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (enabled && preferences.automatic) void translate(true);
    return () => { generation.current++; };
  }, [enabled, preferences.automatic, translate]);
  if (!enabled) return null;
  return <View className="gap-2">
    {visible ? <View accessibilityLiveRegion="polite" className="gap-2">
      <Text style={{ color: theme.textMuted }}>{t('ugcTranslation.originalAbove')}</Text>
      {Object.entries(current.fields).map(([field, text]) => <Text key={field} style={{ color: theme.text, writingDirection: locale === 'ar' ? 'rtl' : 'auto' }} accessibilityLanguage={locale}>{text}</Text>)}
    </View> : null}
    {error === key ? <Text accessibilityRole="alert" style={{ color: theme.textSecondary }}>{t('ugcTranslation.failed')}</Text> : null}
    <Button size="sm" variant="ghost" isDisabled={pending === key} accessibilityLabel={t(visible ? 'ugcTranslation.showOriginal' : 'ugcTranslation.translate')}
      onPress={() => {
        generation.current++;
        if (visible) setHidden(key);
        else if (current && !current.partial) setHidden(null);
        else void translate(false);
      }}>
      <Button.Label>{t(pending === key ? 'ugcTranslation.translating' : visible ? 'ugcTranslation.showOriginal' : 'ugcTranslation.translate')}</Button.Label>
    </Button>
  </View>;
}
