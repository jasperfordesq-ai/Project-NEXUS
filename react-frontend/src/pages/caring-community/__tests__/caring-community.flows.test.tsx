// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  upload: vi.fn(),
  showToast: vi.fn(),
  navigate: vi.fn(),
  useApi: vi.fn(),
}));

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenantPath: (path: string) => `/test-timebank${path}`,
    hasFeature: () => true,
  }),
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock('@/hooks/useApi', () => ({
  useApi: (endpoint: string | null) => mocks.useApi(endpoint),
}));
vi.mock('@/lib/api', () => {
  const client = {
    get: mocks.get,
    post: mocks.post,
    upload: mocks.upload,
  };
  return { api: client, default: client };
});

import CareProviderDirectoryPage from '../CareProviderDirectoryPage';
import { LinkCareReceiverPage } from '../LinkCareReceiverPage';
import { RequestHelpPage } from '../RequestHelpPage';

function renderPage(ui: ReactElement, initialEntry = '/test-timebank/caring-community') {
  return render(
    <>
      <MemoryRouter initialEntries={[initialEntry]}>
        {ui}
      </MemoryRouter>
    </>,
  );
}

describe('Caring Community member flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.post.mockResolvedValue({ success: true, data: { id: 123 } });
    mocks.get.mockResolvedValue({ success: true, data: null });
    mocks.upload.mockResolvedValue({ success: true, data: null });
    mocks.useApi.mockImplementation((endpoint: string | null) => {
      if (endpoint?.startsWith('/v2/users/search')) {
        return {
          data: [{ id: 42, name: 'Ada Lovelace', avatar_url: null }],
          isLoading: false,
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (endpoint?.startsWith('/v2/caring-community/providers')) {
        return {
          data: {
            data: [{
              id: 7,
              name: 'Neighbour Care',
              type: 'private',
              description: 'Practical local care',
              categories: [],
              address: 'Main Street',
              contact_phone: '+1 555 123 4567',
              contact_email: 'care@example.org',
              website_url: null,
              opening_hours: null,
              is_verified: true,
            }],
            total: 1,
            per_page: 20,
            current_page: 1,
          },
          isLoading: false,
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: [],
        isLoading: false,
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it('submits a help request and shows a success toast', async () => {
    const user = userEvent.setup();
    renderPage(<RequestHelpPage />);

    await user.type(screen.getByLabelText(/what kind of help/i), 'A lift to an appointment');
    await user.type(screen.getByLabelText(/when do you need it/i), 'Tuesday afternoon');
    await user.click(screen.getByRole('button', { name: /request help/i }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/v2/caring-community/request-help', {
        what: 'A lift to an appointment',
        when: 'Tuesday afternoon',
        contact_preference: 'either',
      });
    });
    expect(mocks.showToast).toHaveBeenCalledWith('Your help request was sent.', 'success');
    expect(screen.getByRole('heading', { name: /request received/i })).toBeInTheDocument();
  });

  it('submits caregiver on-behalf requests with the cared-for member id', async () => {
    const user = userEvent.setup();
    renderPage(
      <RequestHelpPage />,
      '/test-timebank/caring-community/request-help?on_behalf_of=42',
    );

    await user.type(screen.getByLabelText(/what kind of help/i), 'Meal delivery this week');
    await user.type(screen.getByLabelText(/when do you need it/i), 'Friday evening');
    await user.click(screen.getByRole('button', { name: /request help/i }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/v2/caring-community/caregiver/request-on-behalf', {
        cared_for_id: 42,
        title: 'Meal delivery this week',
        description: 'Meal delivery this week',
        when_needed: 'Friday evening',
        contact_preference: 'either',
      });
    });
  });

  it('links a care receiver through keyboard-submittable form controls', async () => {
    const user = userEvent.setup();
    renderPage(<LinkCareReceiverPage />);

    await user.type(screen.getByLabelText(/find member/i), 'Ada');
    await user.click(screen.getByRole('button', { name: /ada lovelace/i }));
    fireEvent.submit(screen.getByRole('button', { name: /link a care receiver/i }).closest('form')!);

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/v2/caring-community/caregiver/links', {
        cared_for_id: 42,
        relationship_type: 'family',
        start_date: expect.any(String),
        notes: undefined,
      });
    });
    // 🔴 The confirmation must NOT say the relationship is established.
    //
    // It used to read "Care receiver linked successfully", which was untrue and
    // actively misleading: creation only ever produces a PENDING link, and no
    // caregiver authority exists until the care recipient consents AND staff
    // verify that consent. Telling someone the link succeeded invites them to
    // believe they may already act for that person.
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Caregiver request sent. It remains pending until consent and safeguarding checks are complete.',
      'success',
    );
  });

  it('passes provider type filters to the provider directory API', async () => {
    const user = userEvent.setup();
    renderPage(<CareProviderDirectoryPage />);

    expect(mocks.useApi).toHaveBeenCalledWith('/v2/caring-community/providers');

    await user.click(screen.getByRole('tab', { name: /private/i }));

    await waitFor(() => {
      expect(mocks.useApi).toHaveBeenCalledWith('/v2/caring-community/providers?type=private');
    });
  });
});
