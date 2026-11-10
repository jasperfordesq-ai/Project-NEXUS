// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUgcTranslationPreferences } from '@/lib/context/UgcTranslationPreferencesContext';
import { toPlainText } from '@/lib/utils/plainText';
import { alreadyInReaderLanguage, readerVocabulary, useReaderVocabulary } from '@/lib/textLanguage/readerVocabulary';
import { useTextLanguages, writtenInReaderLanguage } from '@/lib/textLanguage/detectLanguage';

/**
 * 🔴 Private conversations are never sent to the server's language check
 * (POST /v2/ugc-language) — they keep the word check alone, as on the website.
 * `message` is a member-to-member message (thread.tsx). Federated messages do not
 * use this component at all (FederationDirectoryScreen keeps its own word check).
 */
const PRIVATE_CONTENT_TYPES: ReadonlySet<string> = new Set(['message']);

type Props = {
  contentType: string;
  contentId: string | number;
  fields: Record<string, string | null | undefined>;
  /**
   * Translated with `fields` on the same press and shown with them, but left out
   * of the "already in the reader's language?" check and never enough on their
   * own to show the control: a profile's skills, a list of single words no check
   * can be sure about (AWID report, Oct 2026). Same rule as both websites.
   */
  companionFields?: Record<string, string | null | undefined>;
  disabled?: boolean;
};
type Result = { key: string; fields: Record<string, string>; partial: boolean };

/** Translated plain text appears beneath the original; no provider calls on automatic cache misses. */
export default function ContentTranslation({ contentType, contentId, fields, companionFields, disabled = false }: Props) {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const { tenant } = useTenant();
  const preferences = useUgcTranslationPreferences();
  const locale = preferences.automatic && preferences.target ? preferences.target : (i18n?.language || 'en').slice(0, 2);
  // Translate the plain text a reader sees: stored descriptions are HTML, and
  // the web clients send plain text, so this also shares their cached results.
  const entries = Object.entries(fields)
    .map(([field, value]): [string, unknown] => [field, typeof value === 'string' ? toPlainText(value) : value])
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()));
  const companionEntries = Object.entries(companionFields ?? {})
    .map(([field, value]): [string, unknown] => [field, typeof value === 'string' ? toPlainText(value) : value])
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()));
  // No control when everything shown is, beyond doubt, the reader's language
  // already (the website's own rule; doubt keeps it).
  const vocabularyReady = useReaderVocabulary(locale);
  const inReaderLanguage = useMemo(() => alreadyInReaderLanguage(entries.map(([, text]) => text), locale),
    // The serialised entries stand for their contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(entries), locale, vocabularyReady]);
  const couldShow = !disabled && tenant?.translation?.enabled !== false && entries.length > 0 && !inReaderLanguage;
  // Owner, 9 Nov 2026: Translate only when the text is in another language. Where the
  // words alone cannot tell (short texts such as a group's name), the server's language
  // service is asked — every text on a screen in one request, each remembered. The button
  // waits while it answers, and stays whenever the answer is not known (no engine, a
  // failure, no signed-in member, a private message). Same rule as the website.
  const judgedParts = useMemo(() => entries.map(([, text]) => text),
    // The serialised entries stand for their contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(entries)]);
  const mayAsk = preferences.identity !== '' && !PRIVATE_CONTENT_TYPES.has(contentType);
  const languages = useTextLanguages(judgedParts, couldShow && mayAsk);
  const languageIsReaders = languages.settled
    && writtenInReaderLanguage(judgedParts, languages.answers, locale, readerVocabulary(locale));
  const enabled = couldShow && languages.settled && !languageIsReaders;
  const key = JSON.stringify([tenant?.id, preferences.identity, preferences.automatic, i18n?.language, locale, contentType, contentId, entries, companionEntries, enabled]);
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
    const all = [...entries, ...companionEntries];
    const responses = await Promise.allSettled(all.map(([field, text]) => api.post<{ data?: { translated_text?: string } | null }>(`${API_V2}/ugc-translate`, {
      content_type: field === 'body' ? contentType : `${contentType}_${field}`, content_id: contentId,
      source_text: text, target_locale: locale, ...(cacheOnly ? { cache_only: true } : {}),
    })));
    if (generation.current !== request || currentKey.current !== key) return;
    const translated: Record<string, string> = {};
    let count = 0;
    responses.forEach((response, index) => {
      const text = response.status === 'fulfilled' ? response.value?.data?.translated_text : null;
      if (typeof text !== 'string' || !text) return;
      translated[all[index]![0]] = text;
      // Only the fields decide whether there is a result and whether it is partial.
      if (index < entries.length) count++;
    });
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
