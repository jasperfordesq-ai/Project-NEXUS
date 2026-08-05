// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tells a member, outside Settings, that a guardian arrangement is waiting for
 * their answer.
 *
 * 🔴 Why this exists. The ward's own screen lives at Settings → Safeguarding,
 * several clicks deep. The only other route in was an email that deep-links
 * there — so a member who missed or never opened that email had a pending
 * decision about who is responsible for them and no way to discover it. For the
 * population this feature is for, "you had to know to go looking in Settings" is
 * not a discoverable design.
 *
 * Renders nothing at all when there is nothing pending, so it costs an ordinary
 * member one cheap request and no visual noise.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ShieldAlert from 'lucide-react/icons/shield-alert';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useTenant } from '@/contexts';

export function GuardianConsentPrompt() {
  const { t } = useTranslation('settings');
  // Project convention: internal links go through the tenant-aware helper on
  // the context, not the bare one in lib/tenant-routing.
  const { tenantPath } = useTenant();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get<{ pending_count?: number }>('/v2/safeguarding/my-guardians');
        // 🔴 api.ts never throws — `success` must be checked explicitly or a
        // failed request reads as "nothing pending" and the prompt never shows.
        if (!cancelled && res.success && res.data) {
          setPending(Number(res.data.pending_count ?? 0));
        }
      } catch (error) {
        // A prompt that cannot load must stay silent rather than break the page.
        logError('Guardian consent prompt failed to load', error);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (pending <= 0) return null;

  return (
    <GlassCard className="border-l-4 border-l-[var(--color-warning)] p-4 sm:p-5" role="status">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]"
            aria-hidden="true"
          />
          {/*
            🔴 Deliberately count-free. i18next pluralises via `key_one` /
            `key_other` SIBLING keys, not a nested object, so a nested
            `{one, other}` shape silently never pluralises. Arabic and Polish also
            need more plural categories than machine translation produced. One
            sentence that reads correctly for one arrangement or several avoids
            the whole class of problem; the page it links to shows how many.
          */}
          <p className="min-w-0 text-sm leading-5 text-theme-primary">
            {t('safeguarding.guardians_prompt.message')}
          </p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/settings?tab=safeguarding')}
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
        >
          {t('safeguarding.guardians_prompt.action')}
        </Button>
      </div>
    </GlassCard>
  );
}

export default GuardianConsentPrompt;
