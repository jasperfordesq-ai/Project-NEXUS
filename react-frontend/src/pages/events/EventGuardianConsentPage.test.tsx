// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventSafetyApi } from '@/lib/event-safety-api';
import { EventGuardianConsentPage } from './EventGuardianConsentPage';

const mockLogError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logError: mockLogError }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenantPath: (path: string) => `/test${path}`, hasFeature: vi.fn((_key: string) => true), hasModule: vi.fn((_key: string) => true) }),
}));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => ({
      'safety.guardian_grant.page_title': 'Guardian consent',
      'safety.guardian_grant.title': 'Review guardian consent',
      'safety.guardian_grant.description': 'Review this private request.',
      'safety.guardian_grant.email_label': 'Guardian email address',
      'safety.guardian_grant.email_hint': 'Use the address that received the request.',
      'safety.guardian_grant.confirm_label': 'I consent to this attendee taking part.',
      'safety.guardian_grant.privacy_notice': 'This response is private.',
      'safety.guardian_grant.submit': 'Give consent',
      'safety.guardian_grant.success_title': 'Consent recorded',
      'safety.guardian_grant.success_description': 'The attendee can continue.',
      'safety.guardian_grant.invalid_title': 'This consent link cannot be used',
      'safety.guardian_grant.invalid_description': 'Ask the attendee for a new request.',
      'safety.guardian_grant.browse_events': 'Browse events',
    } as Record<string, string>)[key] ?? key,
  }),
}));

describe('EventGuardianConsentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires explicit email confirmation and submits the capability without exposing it', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventSafetyApi, 'grantGuardianConsent').mockResolvedValue({
      success: true,
      data: { status: 'granted' },
    });
    const replaceState = vi.spyOn(window.history, 'replaceState');

    render(
      <MemoryRouter
        initialEntries={['/events/101/guardian-consent?token=private-capability']}

      >
        <EventGuardianConsentPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(replaceState).toHaveBeenCalled());
    expect(String(replaceState.mock.calls[0]?.[2])).not.toContain('private-capability');

    const submit = screen.getByRole('button', { name: 'Give consent' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Guardian email address'), 'guardian@example.test');
    fireEvent.click(screen.getByText('I consent to this attendee taking part.'));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(eventSafetyApi.grantGuardianConsent).toHaveBeenCalledWith(
      'private-capability',
      'guardian@example.test',
      expect.stringContaining('event-guardian-grant-'),
    ));
    expect(await screen.findByText('Consent recorded')).toBeInTheDocument();
    expect(mockLogError).not.toHaveBeenCalled();
    expect(screen.queryByText('private-capability')).not.toBeInTheDocument();
    expect(screen.queryByText('guardian@example.test')).not.toBeInTheDocument();
  });

  it('shows one non-enumerating error when the token is absent', () => {
    render(
      <MemoryRouter
        initialEntries={['/events/101/guardian-consent']}

      >
        <EventGuardianConsentPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('This consent link cannot be used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Give consent' })).toBeDisabled();
  });
});
