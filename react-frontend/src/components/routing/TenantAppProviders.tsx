// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import { NotificationsProvider } from '@/contexts/NotificationsContext';
import { PusherProvider } from '@/contexts/PusherContext';
import { MenuProvider } from '@/contexts/MenuContext';
import { PresenceProvider } from '@/contexts/PresenceContext';
import { PodcastPlayerProvider } from '@/contexts/PodcastPlayerContext';
import { IdleLogoutGuard } from '@/components/security/IdleLogoutGuard';
import { UgcTranslationPreferencesProvider } from '@/contexts/UgcTranslationPreferencesContext';

export default function TenantAppProviders({ children }: { children: ReactNode }) {
  return (
    <PusherProvider>
      <NotificationsProvider>
        <PresenceProvider>
          <MenuProvider>
            <PodcastPlayerProvider>
              <UgcTranslationPreferencesProvider>{children}</UgcTranslationPreferencesProvider>
            </PodcastPlayerProvider>
            <IdleLogoutGuard />
          </MenuProvider>
        </PresenceProvider>
      </NotificationsProvider>
    </PusherProvider>
  );
}
