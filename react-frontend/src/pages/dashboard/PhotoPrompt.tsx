// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A friendly nudge to add a profile photo (warmth plan N2). A community of
 * faces feels like a community; a page of initials less so. Shown on the
 * dashboard only to a member who has no photo, only to themself, and it can
 * be put away: once closed it stays closed for 30 days.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Camera from 'lucide-react/icons/camera';
import X from 'lucide-react/icons/x';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { isStockAvatar } from '@/components/ui/Avatar';
import { useAuth, useTenant } from '@/contexts';

const DAY_MS = 86_400_000;
const QUIET_FOR_DAYS = 30;

function storageKey(userId: unknown): string {
  return `nexus_photo_prompt_closed_${String(userId)}`;
}

/** True while the member's "not now" is still fresh. */
function isQuiet(key: string, now: number): boolean {
  try {
    const closedAt = Number(localStorage.getItem(key));
    return Number.isFinite(closedAt) && closedAt > 0 && now - closedAt < QUIET_FOR_DAYS * DAY_MS;
  } catch {
    return false;
  }
}

/** Whether the member has a photo of their own (the stock silhouette does not count). */
export function hasOwnPhoto(user: { avatar?: string | null; avatar_url?: string | null } | null | undefined): boolean {
  const photo = user?.avatar_url || user?.avatar;
  return Boolean(photo) && !isStockAvatar(photo);
}

export function PhotoPrompt({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const key = storageKey(user?.id);
  const [closed, setClosed] = useState(() => isQuiet(key, Date.now()));

  if (!user?.id || hasOwnPhoto(user) || closed) return null;

  const close = () => {
    setClosed(true);
    try {
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // Storage unavailable: it simply shows again next visit.
    }
  };

  return (
    <Card data-testid="photo-prompt" className={`border-0 bg-accent-soft shadow-none ${className}`}>
      <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm">
          <Camera className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-theme-primary">{t('photo_prompt.title')}</h2>
          <p className="text-sm leading-6 text-theme-secondary">{t('photo_prompt.body')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button as={Link} to={tenantPath('/settings')} size="sm" className="bg-accent-strong font-medium text-white shadow-sm">
            {t('photo_prompt.action')}
          </Button>
          <Button isIconOnly size="sm" variant="tertiary" aria-label={t('photo_prompt.close')} onPress={close}>
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default PhotoPrompt;
