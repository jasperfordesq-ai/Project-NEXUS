// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The incident report form used to send only a title, description, severity
 * and category. These tests pin the fields it now sends, and that it still
 * works when the organisation list cannot be loaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/contexts', () => createMockContexts({
  // The override must match the full useAuth shape the shared mock declares.
  useAuth: () => ({
    user: { id: 1, name: 'Reporter' } as User | null,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { ReportIncidentModal } from './ReportIncidentModal';
import { api } from '@/lib/api';

const OPTIONS = {
  organisations: [{ id: 3, name: 'Food Bank' }],
  opportunities: [{ id: 9, title: 'Sorting donations', organization_id: 3, organization_name: 'Food Bank' }],
};

function mockGet(options: unknown = OPTIONS, members: unknown = [{ id: 1, name: 'Reporter' }, { id: 42, name: 'Sam Jones' }]) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/v2/volunteering/incidents/report-options')) {
      return options instanceof Error ? Promise.reject(options) : { success: true, data: options };
    }
    if (url.startsWith('/v2/users?')) return { success: true, data: members };
    return { success: false };
  });
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/safeguarding\.incident_title/), { target: { value: 'Left alone on shift' } });
  fireEvent.change(screen.getByLabelText(/safeguarding\.incident_description/), { target: { value: 'A volunteer was left alone with a client for hours.' } });
}

function renderModal() {
  const onClose = vi.fn();
  const onReported = vi.fn();
  render(<ReportIncidentModal isOpen onClose={onClose} onReported={onReported} />);
  return { onClose, onReported };
}

describe('ReportIncidentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: {} });
  });

  it('says to call the emergency services first, and who will be told, before anything is typed', async () => {
    mockGet();
    renderModal();

    const warning = await screen.findByText('safeguarding.incident_emergency_warning');
    expect(warning.closest('[role="note"]')).not.toBeNull();
    expect(screen.getByText('safeguarding.incident_who_is_told_summary')).toBeInTheDocument();
    expect(screen.getByText('safeguarding.incident_who_is_told_organisation')).toBeInTheDocument();
    // The notices come before the first field.
    const title = screen.getByLabelText(/safeguarding\.incident_title/);
    expect(warning.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('loads the organisations and opportunities to choose from', async () => {
    mockGet();
    renderModal();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/v2/volunteering/incidents/report-options'));
    expect(await screen.findAllByText('safeguarding.incident_organisation')).not.toHaveLength(0);
    expect(screen.getAllByText('safeguarding.incident_opportunity')).not.toHaveLength(0);
  });

  it('sends the incident type, defaulting to a concern, and leaves unanswered fields out', async () => {
    mockGet();
    const { onReported } = renderModal();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /safeguarding\.submit_incident/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, payload] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/v2/volunteering/incidents');
    expect(payload).toEqual({
      title: 'Left alone on shift',
      description: 'A volunteer was left alone with a client for hours.',
      severity: 'low',
      incident_type: 'concern',
    });
    await waitFor(() => expect(onReported).toHaveBeenCalled());
  });

  it('refuses a date in the future without sending anything', async () => {
    mockGet();
    renderModal();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    fillRequired();
    fireEvent.change(screen.getByLabelText(/safeguarding\.incident_date/), { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: /safeguarding\.submit_incident/ }));

    expect(await screen.findByText('safeguarding.incident_date_future')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the date it happened and the member it is about', async () => {
    mockGet();
    renderModal();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    fillRequired();
    fireEvent.change(screen.getByLabelText(/safeguarding\.incident_date/), { target: { value: '2026-01-15' } });
    fireEvent.change(screen.getByLabelText('safeguarding.incident_person_search'), { target: { value: 'Sam' } });

    const result = await screen.findByRole('button', { name: 'Sam Jones' });
    // The reporter is never offered as the person it is about.
    expect(screen.queryByRole('button', { name: 'Reporter' })).not.toBeInTheDocument();
    fireEvent.click(result);
    expect(screen.getByText('Sam Jones')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /safeguarding\.submit_incident/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).toMatchObject({
      incident_date: '2026-01-15',
      subject_user_id: 42,
    });
  });

  it('still lets the member report when the organisation list cannot load', async () => {
    mockGet(new Error('network'));
    renderModal();

    expect(await screen.findByText('safeguarding.incident_options_unavailable')).toBeInTheDocument();

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /safeguarding\.submit_incident/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]?.[1]).not.toHaveProperty('organization_id');
  });

  it('after sending, shows the reference and a link to the report instead of closing', async () => {
    mockGet();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 41 } });
    const { onClose, onReported } = renderModal();
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /safeguarding\.submit_incident/ }));

    expect(await screen.findByText('safeguarding.report_sent_heading')).toBeInTheDocument();
    expect(screen.getByText('safeguarding.report_sent_reference')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'safeguarding.report_view_link' })).toHaveAttribute('href', '/test/volunteering/incidents/41');
    expect(onReported).toHaveBeenCalledWith(41);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'safeguarding.close' }));
    expect(onClose).toHaveBeenCalled();
  });

});
