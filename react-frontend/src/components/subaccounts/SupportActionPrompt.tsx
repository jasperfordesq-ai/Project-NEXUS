// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tells a member, outside Settings, that a supporter has prepared something
 * waiting for their answer. Same reasoning as GuardianConsentPrompt: the
 * answer screen lives on the Linked accounts tab, several clicks deep, and
 * "you had to know to go looking in Settings" is not a discoverable design
 * for the population this feature exists for.
 *
 * Renders nothing when nothing is pending — one cheap request, no noise.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useTenant } from '@/contexts';

export function SupportActionPrompt() {
  const { t } = useTranslation('settings');
  const { tenantPath } = useTenant();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get<{ pending_count?: number }>('/v2/users/me/support-actions');
        // 🔴 api.ts never throws — `success` must be checked explicitly or a
        // failed request reads as "nothing pending" and the prompt never shows.
        if (!cancelled && res.success && res.data) {
          setPending(Number(res.data.pending_count ?? 0));
        }
      } catch (error) {
        // A prompt that cannot load must stay silent rather than break the page.
        logError('Support action prompt failed to load', error);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  if (pending <= 0) return null;

  return (
    <GlassCard className="border-l-4 border-l-[var(--color-warning)] p-4 sm:p-5" role="status">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ClipboardCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]"
            aria-hidden="true"
          />
          {/* Deliberately count-free — same pluralisation reasoning as
              GuardianConsentPrompt; the page it links to shows how many. */}
          <p className="min-w-0 text-sm leading-5 text-theme-primary">
            {t('support_actions.prompt_message')}
          </p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/settings?tab=linked-accounts')}
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
        >
          {t('support_actions.prompt_action')}
        </Button>
      </div>
    </GlassCard>
  );
}

export default SupportActionPrompt;
