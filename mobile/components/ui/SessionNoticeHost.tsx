// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shows notices published by `sessionNoticeStore`.
 *
 * The presentation half of the split described in `lib/notices/sessionNoticeStore.ts`:
 * infrastructure publishes without knowing how a notice is shown, and this component —
 * mounted INSIDE the provider tree, where a ToastProvider genuinely exists — does the
 * showing. It renders nothing itself.
 *
 * Mount it once, below HeroUINativeProvider. `useAppToast()` here is unconditional and
 * fails loudly if the provider is missing, which is the correct behaviour for a component
 * whose only job is to display something.
 */

import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';

import { useAppToast } from './AppToast';
import { sessionNoticeStore } from '@/lib/notices/sessionNoticeStore';

export default function SessionNoticeHost(): null {
  const { show } = useAppToast();
  const notice = useSyncExternalStore(
    sessionNoticeStore.subscribe,
    sessionNoticeStore.getSnapshot,
    sessionNoticeStore.getSnapshot
  );

  useEffect(() => {
    if (!notice) return;
    show({
      title: notice.title,
      description: notice.description,
      variant: notice.variant ?? 'warning',
    });
    // Clear it so a later re-render cannot show the same notice twice. Keyed on
    // notice.id, so two sign-outs with identical wording still show twice.
    sessionNoticeStore.consume();
  }, [notice, show]);

  return null;
}
