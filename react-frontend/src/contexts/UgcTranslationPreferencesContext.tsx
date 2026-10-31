// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { SUPPORTED_LOCALE_CODES } from '@/i18n';

export const UGC_PREFERENCES_CHANGED = 'nexus:ugc-preferences-changed';
type Preference = { auto_translate_ugc?: boolean; auto_translate_target_locale?: string | null };
type Value = { identity: string; automatic: boolean; target: string | null };
const empty: Value = { identity: '', automatic: false, target: null };
const Context = createContext<Value>(empty);

export function UgcTranslationPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const identity = user && tenant ? `${tenant.id}:${user.id}` : '';
  const [value, setValue] = useState<Value>(empty);

  useEffect(() => {
    let generation = 0;
    let cancelled = false;
    const read = async () => {
      const request = ++generation;
      if (!identity) return;
      try {
        const response = await api.get<{ translation?: Preference }>('/v2/users/me/preferences');
        if (cancelled || request !== generation || !response.success) return;
        const preference = response.data?.translation;
        const target = preference?.auto_translate_target_locale;
        setValue({
          identity,
          automatic: preference?.auto_translate_ugc === true,
          target: typeof target === 'string' && (SUPPORTED_LOCALE_CODES as readonly string[]).includes(target) ? target : null,
        });
      } catch { /* Preferences unavailable: original content remains readable. */ }
    };
    const refresh = () => { setValue(empty); void read(); };
    void read();
    window.addEventListener(UGC_PREFERENCES_CHANGED, refresh);
    return () => { cancelled = true; window.removeEventListener(UGC_PREFERENCES_CHANGED, refresh); };
  }, [identity]);

  // Never expose the previous account's preferences while the next request loads.
  return <Context.Provider value={value.identity === identity ? value : { ...empty, identity }}>{children}</Context.Provider>;
}

export const useUgcTranslationPreferences = () => useContext(Context);
