// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG38 — TranslateButton.
 *
 * On-demand translator for any UGC string (post body, listing description,
 * profile bio, event description). Calls POST /api/v2/ugc-translate which
 * caches results for 30 days. Automatic display reads the cache only.
 *
 * Renders nothing if `sourceLocale` is already the user's current i18n locale.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Languages from 'lucide-react/icons/languages';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useTenant, useToast } from '@/contexts';
import { Button } from '@/components/ui';
import { useUgcTranslationPreferences } from '@/contexts/UgcTranslationPreferencesContext';

interface TranslateButtonProps {
  contentType: string;
  contentId: string | number;
  sourceText: string;
  sourceLocale?: string | null;
  /** Receives the translated text whenever the button toggles ON; original text on toggle OFF. */
  onTextChange?: (displayedText: string, isTranslated: boolean) => void;
  /** Hide the button entirely (used when caller is rendering an inline status pill instead). */
  hidden?: boolean;
  className?: string;
  /**
   * Other parts of the same item translated with the same press — a listing's
   * title, a group's name (31 Oct 2026: only the body could be translated).
   * Keyed by field name; each is sent as content type `<contentType>_<field>`.
   */
  extraFields?: Record<string, string | null | undefined>;
  /** Receives the translated extra fields while the translation is shown, and null for the original. */
  onFieldsChange?: (fields: Record<string, string> | null) => void;
}

interface UgcTranslateResponse {
  translated_text: string;
  source_locale: string;
  target_locale: string;
  cached: boolean;
}

export function TranslateButton({
  contentType,
  contentId,
  sourceText,
  sourceLocale,
  onTextChange,
  hidden = false,
  className,
  extraFields,
  onFieldsChange,
}: TranslateButtonProps) {
  const { t, i18n } = useTranslation('common');
  const toast = useToast();
  const tenant = useTenant().tenant;
  const preferences = useUgcTranslationPreferences();
  const translationSwitchedOff = tenant?.translation?.enabled === false;
  const interfaceLocale = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
  const userLocale = preferences.automatic && preferences.target ? preferences.target : interfaceLocale;
  const normalisedSource = (sourceLocale || '').slice(0, 2).toLowerCase();
  const fieldEntries = Object.entries(extraFields ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const fieldsKey = JSON.stringify(fieldEntries);
  const subject = JSON.stringify([tenant?.id, preferences.identity, preferences.automatic, translationSwitchedOff, hidden,
    interfaceLocale, userLocale, contentType, contentId, sourceText, fieldsKey, normalisedSource]);
  type Result = { subject: string; text: string; fields: Record<string, string>; bodyTranslated: boolean; partial: boolean };
  const [result, setResult] = useState<Result | null>(null);
  const [originalFor, setOriginalFor] = useState<string | null>(null);
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const generation = useRef(0);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const current = result?.subject === subject ? result : null;
  const showing = current && originalFor !== subject ? 'translated' : 'original';
  const loading = loadingFor === subject;
  const enabled = !hidden && !translationSwitchedOff && normalisedSource !== userLocale
    && (Boolean(sourceText.trim()) || fieldEntries.length > 0);

  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    onTextChange?.(showing === 'translated' ? current!.text : sourceText,
      showing === 'translated' && current!.bodyTranslated);
    onFieldsChange?.(showing === 'translated' ? current!.fields : null);
  }, [showing, current, sourceText, onTextChange, onFieldsChange]);

  const requestTranslation = useCallback(async (cacheOnly: boolean) => {
    const request = ++generation.current;
    const requestedFor = subject;
    if (!cacheOnly) setLoadingFor(subject);
    const entries: Array<[string, string]> = [
      ...(sourceText.trim() ? [['', sourceText] as [string, string]] : []),
      ...fieldEntries,
    ];
    try {
      const responses = await Promise.allSettled(entries.map(([key, text]) =>
        api.post<UgcTranslateResponse | null>('/v2/ugc-translate', {
          content_type: key ? `${contentType}_${key}` : contentType,
          content_id: contentId,
          source_text: text,
          source_locale: normalisedSource || undefined,
          target_locale: userLocale,
          ...(cacheOnly ? { cache_only: true } : {}),
        }),
      ));
      if (subjectRef.current !== requestedFor || generation.current !== request) return;
      let text = sourceText;
      let bodyTranslated = false;
      let successes = 0;
      const fields = Object.fromEntries(fieldEntries);
      responses.forEach((response, index) => {
        if (response.status !== 'fulfilled' || !response.value?.success || !response.value.data) return;
        const translated = response.value.data.translated_text;
        if (!translated) return;
        successes++;
        const key = entries[index]![0];
        if (key) fields[key] = translated;
        else { text = translated; bodyTranslated = true; }
      });
      if (successes > 0) {
        setResult({ subject: requestedFor, text, fields, bodyTranslated, partial: successes < entries.length });
        setOriginalFor(null);
      }
      if (!cacheOnly && successes < entries.length) {
        const failure = responses.find((response) => response.status === 'fulfilled' && response.value?.error);
        if (failure?.status === 'fulfilled' && failure.value.error) toast.error(failure.value.error);
        else toast.showToast(t('translate.failed'), 'error');
      }
    } finally {
      if (generation.current === request) setLoadingFor(null);
    }
  // Stable field serialisation avoids repeating requests for inline extraFields objects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  useEffect(() => {
    if (enabled && preferences.automatic) void requestTranslation(true);
    const requestGeneration = generation;
    return () => { requestGeneration.current++; };
  }, [enabled, preferences.automatic, requestTranslation]);

  const handleClick = () => {
    generation.current++; // A late automatic cache read must not undo a manual choice.
    if (showing === 'translated') setOriginalFor(subject);
    else if (current && !current.partial) setOriginalFor(null);
    else void requestTranslation(false);
  };

  if (!enabled) return null;

  return (
    <Button
      size="sm"
      variant="light"
      color="primary"
      isLoading={loading}
      onPress={handleClick}
      className={className}
      startContent={
        loading ? (
          <RefreshCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Languages aria-hidden="true" className="w-3.5 h-3.5" />
        )
      }
      aria-label={
        showing === 'translated'
          ? t('translate.show_original')
          : t('translate.translate')
      }
    >
      {showing === 'translated'
        ? t('translate.show_original')
        : loading
          ? t('translate.translating')
          : t('translate.translate')}
    </Button>
  );
}

export default TranslateButton;
