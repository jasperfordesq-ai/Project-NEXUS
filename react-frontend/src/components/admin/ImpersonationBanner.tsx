// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Impersonation banner — persistent, unmissable notice that this tab is showing
 * somebody else's account, with the way out.
 *
 * Renders only in a tab that holds an impersonated session (per-tab
 * sessionStorage), so the admin's own tabs never show it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react/button';
import UserCog from 'lucide-react/icons/user-cog';
import LogOut from 'lucide-react/icons/log-out';
import { isImpersonatedTab } from '@/lib/api';
import { endImpersonation, readImpersonationContext, type ImpersonationContext } from '@/lib/impersonate';

export function ImpersonationBanner() {
  const { t } = useTranslation('common');
  const [context, setContext] = useState<ImpersonationContext | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!isImpersonatedTab()) return;
    setContext(readImpersonationContext() ?? {
      userId: 0,
      userName: '',
      adminId: 0,
      adminName: '',
      startedAt: Date.now(),
    });
  }, []);

  const handleEnd = useCallback(async () => {
    setEnding(true);
    await endImpersonation();
    // A full document load, not a router navigation: the session this document
    // booted with is gone, so every provider needs to re-initialise from
    // scratch. window.close() is attempted first because the tab was opened by
    // the admin tab and closing it is the tidiest exit.
    window.close();
    window.location.replace('/');
  }, []);

  if (!context) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[10000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[var(--color-warning)] px-4 py-2 text-sm font-medium text-black"
    >
      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {context.userName
          ? t('impersonation.banner_named', { name: context.userName })
          : t('impersonation.banner')}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onPress={() => { void handleEnd(); }}
        isPending={ending}
        className="h-7 min-w-0 px-2"
      >
        <LogOut className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {t('impersonation.stop')}
      </Button>
    </div>
  );
}

export default ImpersonationBanner;
