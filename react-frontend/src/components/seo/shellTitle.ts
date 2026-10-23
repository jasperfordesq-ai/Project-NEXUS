// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';

/** id of the <title> in react-frontend/index.html. */
export const SHELL_TITLE_ID = 'nexus-shell-title';

/**
 * Remove index.html's placeholder <title> once a page's own title is in place.
 *
 * The placeholder must exist: the offline / can't-connect screen renders before
 * the app's layout and would otherwise have no title (WCAG document-title,
 * e2e/tests/app-shell-a11y.spec.ts). But under React 19, Helmet adds its own
 * <title> instead of reusing it, so every crawler snapshot carried two titles,
 * the platform placeholder second (2026-10-23). Only PageMeta calls this,
 * because PageMeta always writes a title; a page that renders no PageMeta
 * keeps the placeholder as its one title.
 */
export function useRemoveShellTitle(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.getElementById(SHELL_TITLE_ID)?.remove();
  }, []);
}
