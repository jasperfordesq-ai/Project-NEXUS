// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return { ...actual, formatDateTime: (s: string) => s };
});

const POSTS = [
  {
    id: 1,
    post_type: 'discussion',
    title: 'Monthly Check-in',
    content: 'Hello everyone',
    scheduled_at: '2026-07-01T10:00:00Z',
    is_recurring: false,
    recurrence_pattern: null,
  },
  {
    id: 2,
    post_type: 'announcement',
    title: 'Important Notice',
    content: 'Please read',
    scheduled_at: '2026-07-15T09:00:00Z',
    is_recurring: true,
    recurrence_pattern: 'weekly',
  },
];

import { ScheduledPostPanel } from './ScheduledPostPanel';

// Actual translated strings from public/locales/en/groups.json
const TITLE_TEXT = "Scheduled posts";     // t('scheduled.title')
const ADD_TEXT = "Schedule post";          // t('scheduled.add')
const EMPTY_TEXT = 'No scheduled posts';  // t('scheduled.empty')
const CANCEL_LABEL = 'Cancel scheduled post'; // t('scheduled.cancel_label')
const CREATE_BTN = 'Schedule';             // t('scheduled.create_btn')

describe('ScheduledPostPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: POSTS });
    mockApi.post.mockResolvedValue({ success: true });
    mockApi.delete.mockResolvedValue({ success: true });
  });

  it('renders nothing when isAdmin is false', () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={false} />);
    // The component returns null when not admin — the panel heading and Add button are absent
    expect(screen.queryByText(TITLE_TEXT)).toBeNull();
    expect(screen.queryByText(ADD_TEXT)).toBeNull();
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('shows loading state initially when isAdmin is true', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}));
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);
    // Loading div has role="status" aria-busy="true"
    const busyEl = screen.queryAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(busyEl).toBeDefined();
  });

  it('renders scheduled posts after load', async () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Monthly Check-in')).toBeInTheDocument();
      expect(screen.getByText('Important Notice')).toBeInTheDocument();
    });
  });

  it('shows empty message when no posts', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [] });

    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    });
  });

  it('calls the correct API endpoint with groupId', async () => {
    render(<ScheduledPostPanel groupId={5} isAdmin={true} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        '/v2/groups/5/scheduled-posts',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('shows an error instead of an empty success state when load resolves success=false', async () => {
    mockApi.get.mockResolvedValue({ success: false, code: 'HTTP_500' });
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
  });

  it('shows error toast when load fails', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders the Add button when isAdmin is true', async () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByText('Monthly Check-in')).toBeInTheDocument();
    });
    // t('scheduled.add') => 'scheduled.add'
    expect(screen.getByText(ADD_TEXT)).toBeInTheDocument();
  });

  it('opens schedule modal when Add button is clicked', async () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText(ADD_TEXT)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText(ADD_TEXT));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows error toast when create submitted without required fields', async () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText(ADD_TEXT)).toBeInTheDocument();
    });

    // Open modal
    await userEvent.click(screen.getByText(ADD_TEXT));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click the Create button in the modal footer without filling required fields
    await userEvent.click(screen.getByText(CREATE_BTN));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('calls DELETE endpoint and removes post on cancel', async () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Monthly Check-in')).toBeInTheDocument();
    });

    // Cancel buttons have aria-label="scheduled.cancel_label" (i18n key in test env)
    const cancelBtns = screen.getAllByRole('button', { name: CANCEL_LABEL });
    await userEvent.click(cancelBtns[0]);

    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/groups/1/scheduled-posts/1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Monthly Check-in')).toBeNull();
    });
  });

  it('shows success toast on cancel success', async () => {
    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Monthly Check-in')).toBeInTheDocument();
    });

    const cancelBtns = screen.getAllByRole('button', { name: CANCEL_LABEL });
    await userEvent.click(cancelBtns[0]);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when cancel API returns failure', async () => {
    mockApi.delete.mockResolvedValue({ success: false });

    render(<ScheduledPostPanel groupId={1} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getByText('Monthly Check-in')).toBeInTheDocument();
    });

    const cancelBtns = screen.getAllByRole('button', { name: CANCEL_LABEL });
    await userEvent.click(cancelBtns[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
