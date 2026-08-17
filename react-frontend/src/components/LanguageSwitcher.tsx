// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Language Switcher Component
 * Shows only the languages supported by the current tenant.
 * Reads tenant language config from TenantContext.
 * Stores preference in localStorage as 'nexus_language'.
 */

import { useTranslation } from 'react-i18next';import Globe from 'lucide-react/icons/globe';
import { api,
  tokenManager } from '@/lib/api';
import { logError } from '@/lib/logger';
import { safeLocalStorageSet } from '@/lib/safeStorage';
import { languageDisplayName } from '@/lib/languageDisplayName';
import { useTenantLanguages } from '@/contexts/TenantContext';

import { Button } from '@/components/ui/Button';
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@/components/ui/Dropdown';
interface Language {
  code: string;
  /** Short display label shown in the trigger button */
  short: string;
}

/**
 * All languages the platform supports. Only those present in the tenant's
 * supported_languages config will be shown to the user.
 */
const ALL_LANGUAGES: Language[] = [
  { code: 'en', short: 'EN' },
  { code: 'ga', short: 'GA' },
  { code: 'de', short: 'DE' },
  { code: 'fr', short: 'FR' },
  { code: 'it', short: 'IT' },
  { code: 'pt', short: 'PT' },
  { code: 'es', short: 'ES' },
  { code: 'nl', short: 'NL' },
  { code: 'pl', short: 'PL' },
  { code: 'ja', short: 'JA' },
  { code: 'ar', short: 'AR' },
];

interface LanguageSwitcherProps {
  /** Compact mode: show only icon + short code. Default: true */
  compact?: boolean;
  /** Optional trigger styling override for compact host surfaces such as the utility bar. */
  triggerClassName?: string;
}

export function LanguageSwitcher({ compact = true, triggerClassName }: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation('common');
  const tenantLanguages = useTenantLanguages();

  // Only show languages this tenant supports
  const supportedLanguages = ALL_LANGUAGES.filter(l => tenantLanguages.includes(l.code));

  // If current language isn't in the tenant's list, fall back to the first supported one
  const currentLang = supportedLanguages.find((l) => l.code === i18n.language)
    ?? supportedLanguages[0]
    ?? { code: 'en', short: 'EN' };
  const currentLangLabel = languageDisplayName(currentLang.code, i18n.resolvedLanguage);

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    // Mark that the user explicitly chose a language (not auto-detected).
    // TenantContext checks this flag to decide whether to apply the tenant default.
    safeLocalStorageSet('nexus_language_user_chosen', 'true');

    // Persist to user profile if authenticated.
    //
    // 🔴 This is checked with `res.success`, NOT `.catch()`. The API client
    // never rejects on an API-level failure — `request()` returns
    // `{ success: false, error, code }` and only ever throws from `download()`.
    // The `.catch()` that used to be here could therefore never run, so a
    // failed save was completely silent.
    //
    // That silence had a real cost: the member sees the language change, but
    // the ACCOUNT keeps the old value, and AuthContext reapplies the account
    // language on the next session restore — so their choice reverts on the
    // next page load with nothing logged anywhere to explain it.
    if (tokenManager.hasAccessToken()) {
      void api.put('/v2/users/me/language', { language: code }).then((res) => {
        if (!res.success) {
          logError(
            'Failed to persist language preference; it will revert on next load',
            res.error ?? res.code ?? 'unknown error',
          );
        }
      });
    }
  };

  return (
    <Dropdown placement="bottom-end" shouldBlockScroll={false}>
      <DropdownTrigger>
        <Button
          variant="light"
          size="sm"
          className={triggerClassName ?? 'text-theme-muted hover:text-theme-primary gap-1 min-w-0'}
          aria-label={t('aria.current_language', { language: currentLangLabel })}
          startContent={<Globe className="w-4 h-4 shrink-0" aria-hidden="true" />}
        >
          {compact ? (
            <span className="text-xs font-medium">{currentLang.short}</span>
          ) : (
            <span className="text-sm">{currentLangLabel}</span>
          )}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t('aria.select_language')}
        classNames={{
          base: 'bg-[var(--surface-overlay)] border border-[var(--border-default)] shadow-xl min-w-[140px]',
        }}
        selectedKeys={new Set([currentLang.code])}
        selectionMode="single"
        onAction={(key) => handleLanguageChange(String(key))}
      >
        {supportedLanguages.map((lang) => (
          <DropdownItem
            key={lang.code} id={lang.code}
            className={lang.code === currentLang.code ? 'bg-theme-active' : ''}
          >
            <span className="font-medium text-xs text-theme-subtle me-2">{lang.short}</span>
            <span>{languageDisplayName(lang.code, i18n.resolvedLanguage)}</span>
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}

export default LanguageSwitcher;
