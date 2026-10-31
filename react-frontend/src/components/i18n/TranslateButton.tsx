// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG38 — TranslateButton.
 *
 * On-demand translator for any UGC string (post body, listing description,
 * profile bio, event description). Calls POST /api/v2/ugc-translate which
 * caches the result for 30 days, so repeat clicks never re-charge OpenAI.
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
  const translationSwitchedOff = useTenant().tenant?.translation?.enabled === false;

  const userLocale = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
  const normalisedSource = (sourceLocale || '').slice(0, 2).toLowerCase();

  const [translated, setTranslated] = useState<string | null>(null);
  const [translatedFields, setTranslatedFields] = useState<Record<string, string> | null>(null);
  // Only non-empty extra fields, in a stable order.
  const fieldEntries = Object.entries(extraFields ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const fieldsKey = JSON.stringify(fieldEntries);
  const [showing, setShowing] = useState<'original' | 'translated'>('original');
  const [loading, setLoading] = useState(false);
  // What the current translation (or request) is of. A translation belongs to
  // one text, one item and one reader language; when any of them changes it is
  // dropped, and a reply to an earlier request is ignored (AWID audit A4).
  const subject = `${contentType}\u0000${contentId}\u0000${userLocale}\u0000${sourceText}\u0000${fieldsKey}`;
  const subjectRef = useRef(subject);
  useEffect(() => {
    if (subjectRef.current === subject) return;
    subjectRef.current = subject;
    setTranslated(null);
    setTranslatedFields(null);
    setShowing('original');
    setLoading(false);
  }, [subject]);

  // Notify parent whenever we toggle so it can swap the displayed body in place.
  useEffect(() => {
    if (!onTextChange) return;
    if (showing === 'translated' && translated) {
      onTextChange(translated, true);
    } else {
      onTextChange(sourceText, false);
    }
  }, [showing, translated, sourceText, onTextChange]);

  useEffect(() => {
    if (!onFieldsChange) return;
    onFieldsChange(showing === 'translated' && translated ? translatedFields : null);
  }, [showing, translated, translatedFields, onFieldsChange]);

  const handleClick = useCallback(async () => {
    if (showing === 'translated') {
      setShowing('original');
      return;
    }
    if (translated) {
      setShowing('translated');
      return;
    }
    if (!sourceText.trim()) return;
    const requestedFor = subject;
    setLoading(true);
    try {
      const translateText = (type: string, text: string) => api.post<UgcTranslateResponse>('/v2/ugc-translate', {
        content_type: type,
        content_id: contentId,
        source_text: text,
        source_locale: normalisedSource || undefined,
        target_locale: userLocale,
      });
      const [resp, ...fieldResponses] = await Promise.all([
        translateText(contentType, sourceText),
        ...fieldEntries.map(([key, value]) => translateText(`${contentType}_${key}`, value)),
      ]);
      if (subjectRef.current !== requestedFor) return;
      if (resp.success && resp.data) {
        // A field that could not be translated keeps its original wording.
        const fields: Record<string, string> = {};
        fieldEntries.forEach(([key, value], index) => {
          const fieldResp = fieldResponses[index];
          fields[key] = fieldResp?.success && fieldResp.data?.translated_text ? fieldResp.data.translated_text : value;
        });
        setTranslatedFields(fields);
        setTranslated(resp.data.translated_text);
        setShowing('translated');
      } else {
        const message = resp.error?.trim() ? resp.error : t('translate.failed');
        toast.error(message);
      }
    } catch {
      if (subjectRef.current !== requestedFor) return;
      toast.showToast(t('translate.failed'), 'error');
    } finally {
      if (subjectRef.current === requestedFor) setLoading(false);
    }
  // fieldsKey stands for fieldEntries' contents.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, translated, sourceText, contentType, contentId, normalisedSource, userLocale, subject, fieldsKey, toast, t]);

  // Skip rendering when sourceLocale already matches the user's locale.
  if (hidden) return null;
  // The community switched translation off (Admin → Translation settings).
  if (translationSwitchedOff) return null;
  if (normalisedSource && normalisedSource === userLocale) return null;
  if (!sourceText || !sourceText.trim()) return null;

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
