// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

import { api } from '@/lib/api';
import { AppreciationModal } from './AppreciationModal';

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  receiverId: 42,
  receiverName: 'Alice',
  contextType: 'general' as const,
  contextId: 7,
  onSent: vi.fn(),
};

function renderModal(overrides: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...overrides };
  return render(<AppreciationModal {...props} />);
}

describe('AppreciationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baseProps.onClose = vi.fn();
    baseProps.onSent = vi.fn();
  });

  it('renders the modal when isOpen=true', () => {
    renderModal();
    // Header should contain recipient name
    expect(screen.getByRole("heading", { name: /Alice/i })).toBeInTheDocument();
  });

  it('renders the message textarea', () => {
    renderModal();
    // Textarea is labelled
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders Cancel and Send buttons', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('Send button is disabled when message is empty', () => {
    renderModal();
    const sendBtn = screen.getByRole('button', { name: /send/i });
    // HeroUI isDisabled sets native disabled attribute
    expect(sendBtn).toBeDisabled();
  });

  it('Send button becomes enabled after typing a message', async () => {
    renderModal();
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Thank you so much!' } });
    await waitFor(() => {
      const sendBtn = screen.getByRole('button', { name: /send/i });
      expect(sendBtn).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('submits the correct payload on Send', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderModal();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Great collaboration!' } });

    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/appreciations', {
        receiver_id: 42,
        message: 'Great collaboration!',
        context_type: 'general',
        context_id: 7,
      });
    });
  });

  it('trims whitespace before sending', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Nice work!  ' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/appreciations',
        expect.objectContaining({ message: 'Nice work!' })
      );
    });
  });

  it('shows success toast, calls onSent, and closes on successful submit', async () => {
    const onClose = vi.fn();
    const onSent = vi.fn();
    vi.mocked(api.post).mockResolvedValue({ success: true });

    renderModal({ onClose, onSent });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thanks!' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
      expect(onSent).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error toast when API returns success=false without rate_limit', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Unknown error' });
    renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows rate limit error toast when API returns rate_limit error', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'rate_limit exceeded' });
    renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when API throws', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('Network error'));
    renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls onClose when Cancel is pressed', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  // Owner decision, 12 Nov 2026: the receiver decides whether a note shows on
  // their profile. The sender has no public/private choice and sends none.
  it('offers no public/private choice and never sends is_public', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderModal();

    expect(screen.queryByRole('switch')).toBeNull();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private thanks' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const payload = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('is_public');
  });

  it('says who will see the note', () => {
    renderModal();
    expect(screen.getByTestId('thanks-privacy-hint').textContent).not.toBe('');
  });

  it('says so plainly when the member cannot be thanked', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, code: 'RECEIVER_NOT_FOUND', error: 'receiver_not_found' });
    renderModal();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith("You can't send a thank-you note to this member."));
  });

  it('renders title without receiverName', () => {
    renderModal({ receiverName: undefined });
    // Should not crash and a generic title should appear
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Send button is disabled when message exceeds 500 chars', async () => {
    renderModal();
    const longText = 'a'.repeat(501);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: longText } });
    await waitFor(() => {
      const sendBtn = screen.getByRole('button', { name: /send/i });
      // HeroUI isDisabled sets native disabled attribute
      expect(sendBtn).toBeDisabled();
    });
  });
});
