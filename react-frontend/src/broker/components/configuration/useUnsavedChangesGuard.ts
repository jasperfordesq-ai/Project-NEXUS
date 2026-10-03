// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warn before leaving a page with unsaved changes.
 *
 * The app runs on `BrowserRouter`, not a data router, so React Router's
 * `useBlocker` is unavailable. Two guards cover the common exits instead:
 *
 *   - `beforeunload` for a reload, a closed tab or a typed address;
 *   - a capture-phase click listener for every in-app link (the sidebar,
 *     the breadcrumbs, the help link). It asks through the shared confirm
 *     dialog and navigates itself when the broker agrees.
 *
 * Programmatic navigation (the command palette's `navigate()`) and the
 * browser back button are not intercepted; the owner's own unsaved-changes
 * chip and save bar remain the visible reminder for those.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/ui';

/** True for a plain left click that would let the browser follow the link. */
function isPlainNavigationClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function useUnsavedChangesGuard(when: boolean): void {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { t } = useTranslation('broker');

  useEffect(() => {
    if (!when) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers read a string; modern ones show their own wording.
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !isPlainNavigationClick(event)) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href') ?? '';
      if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same document (a hash change) is not leaving.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const ok = await confirm({
          title: t('configuration.unsaved_leave_title'),
          body: t('configuration.unsaved_leave_body'),
          confirmLabel: t('configuration.unsaved_leave_confirm'),
          cancelLabel: t('configuration.unsaved_leave_stay'),
          status: 'warning',
        });
        if (ok) navigate(`${url.pathname}${url.search}${url.hash}`);
      })();
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [when, confirm, navigate, t]);
}

export default useUnsavedChangesGuard;
