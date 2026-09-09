// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';

const mockShowExchange = vi.fn();

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: {
    showExchange: (...args: unknown[]) => mockShowExchange(...args),
  },
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => path,
  }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '14' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'common.loading': 'Loading...',
        'exchanges.detail_title': 'Exchange Details',
        'exchanges.detail_title_with_id': `Exchange #${String(options?.id ?? '')}`,
        'exchanges.detail_default_description': 'Review exchange details',
        'exchanges.back': 'Back',
        'exchanges.detail_back_to_exchanges': 'Back to Exchanges',
        'exchanges.detail_pipeline_title': 'Exchange progress',
        'exchanges.detail_status_label': 'Status',
        'exchanges.detail_created_label': 'Created',
        'exchanges.detail_hours_label': 'Hours',
        'exchanges.detail_approved_label': 'Broker approved',
        'exchanges.detail_requester': 'Requester',
        'exchanges.detail_provider': 'Provider',
        'exchanges.detail_history': 'History',
        'exchanges.detail_history_by': `by ${String(options?.name ?? '')}`,
        'exchanges.detail_no_history': 'No history available.',
        'exchanges.detail_history_actions.request_created': 'Request created',
        'exchanges.detail_history_actions.status_changed': 'Status changed',
        'status.pending': 'Pending',
        'status.pending_broker': 'Pending Broker Approval',
        'status.accepted': 'Accepted',
        'status.completed': 'Completed',
        'status.cancelled': 'Cancelled',
        'status.disputed': 'Disputed',
        'status.in_progress': 'In progress',
      };

      return translations[key] ?? String(options?.defaultValue ?? key);
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

import ExchangeDetailPage from '../ExchangeDetailPage';

const DETAIL = {
  exchange: {
    id: 14,
    status: 'in_progress',
    requester_name: 'Kate Liddell',
    provider_name: 'Nikita Serkevich',
    listing_title: 'Data Protection and Information Security',
    created_at: '2026-03-13T21:24:39Z',
  },
  history: [
    {
      id: 1,
      exchange_id: 14,
      action: 'request_created',
      actor_name: 'hOUR Timebank',
      created_at: '2026-03-13T21:24:39Z',
    },
    {
      id: 2,
      exchange_id: 14,
      action: 'status_changed',
      actor_name: 'Nikita',
      notes: 'Provider accepted request',
      created_at: '2026-03-14T07:58:55Z',
    },
  ],
  risk_tag: null,
};

describe('ExchangeDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders translated history action labels', async () => {
    mockShowExchange.mockResolvedValue({ success: true, data: DETAIL });

    render(<ExchangeDetailPage />);

    await waitFor(() => expect(screen.getByText('Request created')).toBeInTheDocument());

    expect(screen.getByText('Status changed')).toBeInTheDocument();
    expect(screen.queryByText('request_created')).not.toBeInTheDocument();
    expect(screen.queryByText('status_changed')).not.toBeInTheDocument();
    expect(screen.getByText('Provider accepted request')).toBeInTheDocument();
  });

  it('renders the pipeline without a highlighted stage for statuses outside the linear lifecycle', async () => {
    mockShowExchange.mockResolvedValue({ success: true, data: DETAIL });

    render(<ExchangeDetailPage />);

    await waitFor(() => expect(screen.getByText('Kate Liddell')).toBeInTheDocument());

    // in_progress is not one of the linear pipeline stages nor a terminal
    // state — no step is marked current, but the status chip still names it.
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Nikita Serkevich')).toBeInTheDocument();
  });
});
