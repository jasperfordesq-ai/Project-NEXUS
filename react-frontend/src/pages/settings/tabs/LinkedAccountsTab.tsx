// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { GlassCard } from '@/components/ui/GlassCard';
import { SubAccountsManager } from '@/components/subaccounts/SubAccountsManager';
import { SupportActionsPanel } from '@/components/subaccounts/SupportActionsPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LinkedAccountsTab() {
  return (
    <div className="space-y-6">
      {/* Co-decide actions waiting for an answer render FIRST — a pending
          decision about this member's own listings/credits outranks admin of
          the relationships themselves. Renders nothing when nothing pends. */}
      <SupportActionsPanel />
      <GlassCard className="p-6">
        <SubAccountsManager />
      </GlassCard>
    </div>
  );
}
