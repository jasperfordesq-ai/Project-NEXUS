// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CreateOpportunityPage in edit mode (/volunteering/opportunities/:id/edit).
 * Until 6 Oct 2026 nothing on the website could edit an opportunity.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  Trans: ({ children }: { children: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '42' }),
  };
});

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

// Default contexts: tenantPath(p) is "/test" + p.
vi.mock('@/contexts', async () => (await import('@/test/mock-contexts')).createMockContexts());

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/navigation', () => ({ Breadcrumbs: () => null }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ value }: { value: string }) => <input aria-label="location" value={value} readOnly />,
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import CreateOpportunityPage from './CreateOpportunityPage';
import { api } from '@/lib/api';

const editable = {
  id: 42,
  title: 'Park Cleanup Drive',
  description: 'Help clean the local park on Saturday mornings.',
  location: '',
  is_remote: true,
  latitude: null,
  longitude: null,
  skills_needed: 'Gloves',
  start_date: '2026-06-01',
  end_date: null,
  federated_visibility: 'none',
  organization: { id: 7, name: 'Green Dublin' },
  is_owner: false,
  can_manage: true,
};

describe('CreateOpportunityPage — edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the opportunity, keeps its organisation fixed, and saves with PUT', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: editable });
    vi.mocked(api.put).mockResolvedValue({ success: true, data: {} });
    render(<CreateOpportunityPage />);

    const title = await screen.findByDisplayValue('Park Cleanup Drive');
    expect(api.get).toHaveBeenCalledWith('/v2/volunteering/opportunities/42');
    expect(api.get).not.toHaveBeenCalledWith('/v2/volunteering/my-organisations');
    expect(screen.getByDisplayValue('Green Dublin')).toHaveAttribute('readonly');
    expect(screen.getByText('edit_opportunity_title')).toBeInTheDocument();

    fireEvent.change(title, { target: { value: 'Park Cleanup Drive — autumn' } });
    fireEvent.submit(title.closest('form') as HTMLFormElement);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.put).mock.calls[0] ?? [];
    expect(url).toBe('/v2/volunteering/opportunities/42');
    expect(payload).toMatchObject({
      title: 'Park Cleanup Drive — autumn',
      description: 'Help clean the local park on Saturday mornings.',
      is_remote: true,
      start_date: '2026-06-01',
      latitude: '',
      longitude: '',
    });
    expect(payload).not.toHaveProperty('organization_id');
    expect(api.post).not.toHaveBeenCalled();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/test/volunteering/opportunities/42'));
  });

  it('refuses someone who may not manage the opportunity', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { ...editable, can_manage: false, is_owner: false } });
    render(<CreateOpportunityPage />);

    expect(await screen.findByText('edit_not_allowed_title')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Park Cleanup Drive')).not.toBeInTheDocument();
  });

  it('refuses when the opportunity cannot be loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'Not found' });
    render(<CreateOpportunityPage />);

    expect(await screen.findByText('edit_not_allowed_title')).toBeInTheDocument();
  });
});
