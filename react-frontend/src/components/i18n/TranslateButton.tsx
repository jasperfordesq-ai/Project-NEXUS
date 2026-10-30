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

import { useCallback, useEffect, useState } from 'react';import Languages from 'lucide-react/icons/languages';
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
}: TranslateButtonProps) {
  const { t, i18n } = useTranslation('common');
  const toast = useToast();
  const translationSwitchedOff = useTenant().tenant?.translation?.enabled === false;

  const userLocale = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);
  const normalisedSource = (sourceLocale || '').slice(0, 2).toLowerCase();

  const [translated, setTranslated] = useState<string | null>(null);
  const [showing, setShowing] = useState<'original' | 'translated'>('original');
  const [loading, setLoading] = useState(false);

  // Notify parent whenever we toggle so it can swap the displayed body in place.
  useEffect(() => {
    if (!onTextChange) return;
    if (showing === 'translated' && translated) {
      onTextChange(translated, true);
    } else {
      onTextChange(sourceText, false);
    }
  }, [showing, translated, sourceText, onTextChange]);

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
    setLoading(true);
    try {
      const resp = await api.post<UgcTranslateResponse>('/v2/ugc-translate', {
        content_type: contentType,
        content_id: contentId,
        source_text: sourceText,
        source_locale: normalisedSource || undefined,
        target_locale: userLocale,
      });
      if (resp.success && resp.data) {
        setTranslated(resp.data.translated_text);
        setShowing('translated');
      } else {
        const message = resp.error?.trim() ? resp.error : t('translate.failed');
        toast.error(message);
      }
    } catch {
      toast.showToast(t('translate.failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showing, translated, sourceText, contentType, contentId, normalisedSource, userLocale, toast, t]);

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
