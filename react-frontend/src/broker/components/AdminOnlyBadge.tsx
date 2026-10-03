// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Admin only" badge for a broker-panel setting the current user can see but
 * not change. A filled warning chip (dark text on solid amber) so it reads at
 * a glance in light and dark themes; the soft grey chip it replaces had
 * almost no contrast with the card behind it. Pages that use it also show a
 * plain-text notice saying to ask an admin, because a tooltip cannot be
 * reached by touch or keyboard.
 */

import { useTranslation } from 'react-i18next';
import Lock from 'lucide-react/icons/lock';
import { Chip, Tooltip } from '@/components/ui';

export function AdminOnlyBadge() {
  const { t } = useTranslation('broker');
  return (
    <Tooltip content={t('admin_only.hint')}>
      <Chip
        size="sm"
        variant="primary"
        color="warning"
        className="shrink-0 font-semibold"
        startContent={<Lock size={12} strokeWidth={2.5} aria-hidden="true" />}
      >
        {t('admin_only.label')}
      </Chip>
    </Tooltip>
  );
}

export default AdminOnlyBadge;
