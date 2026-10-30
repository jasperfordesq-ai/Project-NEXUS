// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E-119 F-608: the website signed members out with no warning. Public-sector
 * accessibility (WCAG 2.2.1, as the GOV.UK/DWP session timeout pattern applies
 * it) needs a warning and a way to stay signed in.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';

const { state } = vi.hoisted(() => ({
  state: { warningOpen: true, secondsLeft: 125, staySignedIn: vi.fn(), signOutNow: vi.fn() },
}));
vi.mock('@/hooks/useIdleLogout', () => ({ useIdleLogout: () => state }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

import { IdleLogoutGuard } from '../IdleLogoutGuard';

describe('IdleLogoutGuard warning', () => {
  it('warns before signing out and offers to stay signed in or sign out now', () => {
    render(<IdleLogoutGuard />);

    expect(screen.getByText('idle_warning_title')).toBeInTheDocument();
    expect(screen.getByText(/idle_warning_message/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'idle_warning_stay' }));
    expect(state.staySignedIn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'idle_warning_sign_out' }));
    expect(state.signOutNow).toHaveBeenCalled();
  });

  it('renders nothing when no warning is due', () => {
    state.warningOpen = false;
    render(<IdleLogoutGuard />);
    expect(screen.queryByText('idle_warning_title')).not.toBeInTheDocument();
  });
});
