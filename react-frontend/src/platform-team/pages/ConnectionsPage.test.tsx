// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }),
}));
// Wording renders as its key, so the tests do not depend on the words chosen.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'done' in options ? `${key}|${String(options.done)}|${String(options.total)}` : key,
    i18n: { language: 'en' },
  }),
}));

import { ConnectionsPage, type ConnectionsReport } from './ConnectionsPage';

const REPORT: ConnectionsReport = {
  connections: [
    { key: 'gmail_api', group: 'email', configured: false },
    { key: 'postmark', group: 'email', configured: true },
    { key: 'stripe', group: 'payments', configured: true },
    { key: 'stripe_webhook', group: 'payments', configured: false },
    { key: 'file_storage', group: 'other', configured: true },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConnectionsPage />
    </MemoryRouter>,
  );

describe('ConnectionsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: REPORT });
  });

  it('asks the platform team request and groups the services', async () => {
    renderPage();

    const email = await screen.findByTestId('connections-group-email');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/connections');
    expect(within(email).getByText('connections.group.email')).toBeInTheDocument();
    expect(within(email).getByText('Gmail API')).toBeInTheDocument();
    expect(within(email).getByText('Postmark')).toBeInTheDocument();
    expect(within(screen.getByTestId('connections-group-payments')).getAllByText('Stripe')).toHaveLength(2);
  });

  it('says set up or not set up in words for each service', async () => {
    renderPage();

    const postmark = await screen.findByTestId('connection-postmark');
    expect(within(postmark).getByText('connections.status.set_up')).toBeInTheDocument();
    const gmail = screen.getByTestId('connection-gmail_api');
    expect(within(gmail).getByText('connections.status.not_set_up')).toBeInTheDocument();
    expect(within(screen.getByTestId('connection-stripe_webhook')).getByText('connections.detail.stripe_webhook')).toBeInTheDocument();
    expect(within(screen.getByTestId('connection-file_storage')).getByText('connections.name.file_storage')).toBeInTheDocument();
  });

  it('names reading the error figures in words, beside sending errors, set up or not, and only when the server lists it', async () => {
    const withErrorRows = (configured: boolean): ConnectionsReport => ({
      connections: [
        ...REPORT.connections,
        { key: 'sentry', group: 'error_reports', configured: true },
        { key: 'sentry_api', group: 'error_reports', configured },
      ],
    });

    apiGet.mockResolvedValue({ success: true, data: withErrorRows(false) });
    const { unmount } = renderPage();
    const group = await screen.findByTestId('connections-group-error_reports');
    const row = within(group).getByTestId('connection-sentry_api');
    expect(within(row).getByText('connections.name.sentry_api')).toBeInTheDocument();
    expect(within(row).getByText('connections.status.not_set_up')).toBeInTheDocument();
    expect(within(group).getByText('Sentry')).toBeInTheDocument();
    unmount();

    apiGet.mockResolvedValue({ success: true, data: withErrorRows(true) });
    const second = renderPage();
    const setUp = await screen.findByTestId('connection-sentry_api');
    expect(within(setUp).getByText('connections.status.set_up')).toBeInTheDocument();
    second.unmount();

    apiGet.mockResolvedValue({ success: true, data: REPORT });
    renderPage();
    await screen.findByTestId('connection-postmark');
    expect(screen.queryByTestId('connection-sentry_api')).not.toBeInTheDocument();
  });

  it('shows an optional key that is not set in neutral words, never as not set up, and leaves it out of the count', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: {
        connections: [
          ...REPORT.connections,
          { key: 'fcm', group: 'notifications', configured: false, optional: false },
          { key: 'expo', group: 'notifications', configured: false, optional: true },
        ],
      },
    });
    renderPage();

    const expo = await screen.findByTestId('connection-expo');
    expect(within(expo).getByText('connections.status.not_needed')).toBeInTheDocument();
    expect(within(expo).queryByText('connections.status.not_set_up')).not.toBeInTheDocument();
    expect(within(expo).getByText('connections.optional_adds.expo')).toBeInTheDocument();
    // A key that is needed still reads as not set up.
    expect(within(screen.getByTestId('connection-fcm')).getByText('connections.status.not_set_up')).toBeInTheDocument();
    // 3 of the 6 that are needed; the optional unset key is not counted against.
    expect(screen.getByText('connections.count|3|6')).toBeInTheDocument();
  });

  it('shows an optional key that is set as set up, with what it adds', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: { connections: [...REPORT.connections, { key: 'expo', group: 'notifications', configured: true, optional: true }] },
    });
    renderPage();

    const expo = await screen.findByTestId('connection-expo');
    expect(within(expo).getByText('connections.status.set_up')).toBeInTheDocument();
    expect(within(expo).getByText('connections.optional_adds.expo')).toBeInTheDocument();
    expect(screen.getByText('connections.count|4|6')).toBeInTheDocument();
  });

  it('counts the services that are set up', async () => {
    renderPage();

    expect(await screen.findByText('connections.count|3|5')).toBeInTheDocument();
  });

  it('says it never shows a key and that expiry dates are not recorded', async () => {
    renderPage();

    await screen.findByTestId('connection-postmark');
    expect(screen.getByText('connections.never_shown')).toBeInTheDocument();
    expect(screen.getByText('connections.no_expiry')).toBeInTheDocument();
  });

  it('ends with where three other controls are', async () => {
    renderPage();

    const section = await screen.findByTestId('connections-elsewhere');
    expect(within(section).getByText('connections.elsewhere.title')).toBeInTheDocument();
    const links = within(section).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/test/admin/enterprise/gdpr/consent-types',
      '/test/admin/module-configuration?configure=identity_verification',
    ]);
    expect(within(section).getByText('connections.elsewhere.secrets_replaced')).toBeInTheDocument();
  });

  it('shows an error with a retry when the request fails', async () => {
    apiGet.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByText('connections.load_error_title')).toBeInTheDocument();
  });

  it('has no control that changes anything: only reload', async () => {
    renderPage();
    await screen.findByTestId('connection-postmark');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
  });
});
