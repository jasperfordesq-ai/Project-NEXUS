// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { getUserPreferences } from '@/lib/api/settings';
import { subscribeUgcPreferences } from '@/lib/ugcPreferencesEvents';
type Preferences = { identity: string; automatic: boolean; target: string | null };
const empty: Preferences = { identity: '', automatic: false, target: null };
const Context = createContext(empty);
const locales = new Set(['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'ar', 'ja', 'nl', 'pl']);
export function UgcTranslationPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const identity = user && tenant ? `${tenant.id}:${user.id}` : '';
  const [value, setValue] = useState(empty);
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const read = async () => {
      const request = ++generation;
      setValue(empty);
      if (!identity) return;
      try {
        const response = await getUserPreferences();
        if (cancelled || request !== generation) return;
        const preference = response.translation;
        setValue({ identity, automatic: preference?.auto_translate_ugc === true,
          target: preference?.auto_translate_target_locale && locales.has(preference.auto_translate_target_locale) ? preference.auto_translate_target_locale : null });
      } catch { /* Original content remains available. */ }
    };
    void read();
    const unsubscribe = subscribeUgcPreferences(() => { void read(); });
    return () => { cancelled = true; unsubscribe(); };
  }, [identity]);
  return <Context.Provider value={value.identity === identity ? value : { ...empty, identity }}>{children}</Context.Provider>;
}
export const useUgcTranslationPreferences = () => useContext(Context);
