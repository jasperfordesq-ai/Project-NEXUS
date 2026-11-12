// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';

/**
 * A form with a live picture of what it is making beside it (warmth plan B6,
 * shared in phase 5). On a wide screen the picture sits in a side column and
 * stays in view while the form scrolls; on a phone it follows the form.
 *
 * The offer form had this layout first; every form with a preview uses it so
 * they all behave the same.
 */
export function FormWithPreview({ children, preview }: { children: ReactNode; preview: ReactNode }) {
  return (
    <div data-testid="form-with-preview" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">{children}</div>
      <aside className="lg:sticky lg:top-24 lg:self-start">{preview}</aside>
    </div>
  );
}

export default FormWithPreview;
