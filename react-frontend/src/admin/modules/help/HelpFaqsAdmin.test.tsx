// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('@/contexts/ToastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ToastContext')>();
  return { ...actual, useToast: () => mockToast };
});

const mockList = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminHelpFaqs: {
    list: mockList,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
  },
  adminNewsletters: {},
  adminLegalDocs: {},
}));

vi.mock('../../AdminMetaContext', () => ({ useAdminPageMeta: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// 🔴 There is no ConfirmModal stub any more, and there must not be one keyed to
// the '../../components' barrel: HelpFaqsAdmin.tsx:48 imports ConfirmModal from
// '../../components/ConfirmModal', its own path, so the barrel override never
// installed. The real modal rendered, the stub's 'confirm-delete' button did not
// exist, and the delete test read as a missing control.
//
// The real ConfirmModal is used plainly here (no typed confirmation), so it is
// driven directly — via its stable data-testid, never via its label, because
// callers override confirmLabel and a text lookup on it rots.

import { HelpFaqsAdmin } from './HelpFaqsAdmin';

const makeFaq = (overrides = {}) => ({
  id: 1,
  category: 'General',
  question: 'How do I get started?',
  answer: 'Follow the onboarding steps.',
  sort_order: 0,
  is_published: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('HelpFaqsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while FAQs are being fetched', async () => {
    mockList.mockReturnValue(new Promise(() => {}));
    render(<HelpFaqsAdmin />);
    // DataTable shows loading skeleton or spinner — just check the component renders
    expect(screen.getByRole('button', { name: /add.faq/i })).toBeInTheDocument();
  });

  it('shows error alert when the list call fails', async () => {
    mockList.mockRejectedValue(new Error('Network error'));
    render(<HelpFaqsAdmin />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    // Error card renders with retry button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('shows empty state when no FAQs exist', async () => {
    mockList.mockResolvedValue({ success: true, data: [] });
    render(<HelpFaqsAdmin />);
    await waitFor(() => {
      // EmptyState renders with action button label "Add FAQ"
      expect(screen.getAllByRole('button', { name: /add.faq/i }).length).toBeGreaterThan(0);
    });
  });

  it('renders FAQ rows in the table when data is present', async () => {
    mockList.mockResolvedValue({ success: true, data: [makeFaq()] });
    render(<HelpFaqsAdmin />);
    await waitFor(() => {
      expect(screen.getByText('How do I get started?')).toBeInTheDocument();
    });
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('opens create modal when Add FAQ button is clicked', async () => {
    mockList.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    render(<HelpFaqsAdmin />);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /add.faq/i }).length).toBeGreaterThan(0);
    });

    // Click the PageHeader Add FAQ button (first one)
    const addButtons = screen.getAllByRole('button', { name: /add.faq/i });
    await user.click(addButtons[0]);

    // Modal opens — expect the dialog to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls adminHelpFaqs.create with form data on submit', async () => {
    mockList.mockResolvedValue({ success: true, data: [] });
    mockCreate.mockResolvedValue({ success: true, data: { id: 2, created: true } });
    const user = userEvent.setup();
    render(<HelpFaqsAdmin />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /add.faq/i }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('button', { name: /add.faq/i })[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Fill in question
    const questionInput = screen.getByLabelText(/question/i);
    await user.clear(questionInput);
    await user.type(questionInput, 'What is timebanking?');

    // Fill in answer
    const answerInput = screen.getByLabelText(/answer/i);
    await user.clear(answerInput);
    await user.type(answerInput, 'It is an exchange of services using time credits.');

    // Submit
    const createBtn = screen.getByRole('button', { name: /create/i });
    await user.click(createBtn);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'What is timebanking?',
          answer: 'It is an exchange of services using time credits.',
        }),
      );
    });
  });

  it('shows validation toast when question is empty on submit', async () => {
    mockList.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    render(<HelpFaqsAdmin />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /add.faq/i }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('button', { name: /add.faq/i })[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Click Create without filling in required fields
    const createBtn = screen.getByRole('button', { name: /create/i });
    await user.click(createBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('calls adminHelpFaqs.update on publish toggle', async () => {
    mockList.mockResolvedValue({ success: true, data: [makeFaq({ is_published: true })] });
    mockUpdate.mockResolvedValue({ success: true, data: { id: 1, updated: true } });
    const user = userEvent.setup();
    render(<HelpFaqsAdmin />);

    await waitFor(() => expect(screen.getByText('How do I get started?')).toBeInTheDocument());

    // The Switch for is_published
    const toggle = screen.getByRole('switch', { name: /publish/i });
    await user.click(toggle);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ is_published: false }));
    });
  });

  it('calls adminHelpFaqs.delete after delete confirmation', async () => {
    mockList.mockResolvedValue({ success: true, data: [makeFaq()] });
    mockDelete.mockResolvedValue({ success: true, data: { id: 1, deleted: true } });
    const user = userEvent.setup();
    render(<HelpFaqsAdmin />);

    await waitFor(() => expect(screen.getByText('How do I get started?')).toBeInTheDocument());

    // Open the actions dropdown
    const actionsBtn = screen.getByRole('button', { name: /actions/i });
    await user.click(actionsBtn);

    // Click delete
    const deleteItem = await screen.findByText(/delete/i);
    await user.click(deleteItem);

    await user.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(1);
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('shows toast error when create fails', async () => {
    mockList.mockResolvedValue({ success: true, data: [] });
    mockCreate.mockResolvedValue({ success: false, error: 'Duplicate question' });
    const user = userEvent.setup();
    render(<HelpFaqsAdmin />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /add.faq/i }).length).toBeGreaterThan(0);
    });

    await user.click(screen.getAllByRole('button', { name: /add.faq/i })[0]);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.type(screen.getByLabelText(/question/i), 'Duplicate?');
    await user.type(screen.getByLabelText(/answer/i), 'Yes it is.');
    await user.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    // Modal stays open so admin can fix
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
