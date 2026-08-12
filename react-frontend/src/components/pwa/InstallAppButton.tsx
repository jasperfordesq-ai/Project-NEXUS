// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';

/** Public route the install entry points lead to. */
export const INSTALL_APP_PATH = '/install-app';

interface InstallAppButtonProps {
  /** Render-prop pattern — the button chrome is supplied by the parent so we
   * can drop the install affordance into different layouts (mobile drawer
   * row, dropdown item, settings card) without forking the component. The
   * render fn receives an onClick handler and a label.
   */
  children: (args: { onClick: () => void; label: string; sublabel: string }) => React.ReactNode;
}

/**
 * "Get the app" entry point.
 *
 * 🔴 This deliberately does NOT trigger a browser install prompt any more
 * (owner instruction, 2026-08-12). Installing is unreliable on Apple devices,
 * so a one-tap prompt offered a large share of members something that would
 * not work. It now navigates to /install-app, which explains the options in
 * plain English, states what is currently broken, and only shows the native
 * prompt where the browser has actually provided one.
 *
 * It also renders unconditionally: the old `shouldOfferInstall` gate hid the
 * entry on Chrome/Firefox for iOS, which are exactly the users who need to be
 * told that Apple only allows this in Safari.
 */
export function InstallAppButton({ children }: InstallAppButtonProps) {
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const onClick = useCallback(() => {
    navigate(tenantPath(INSTALL_APP_PATH));
  }, [navigate, tenantPath]);

  return (
    <>
      {children({
        onClick,
        label: t('install.menu_cta'),
        sublabel: t('install.menu_sub'),
      })}
    </>
  );
}

export default InstallAppButton;
