// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for UrgentRequestModal — an organiser asking volunteers to help with a shift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

const toastSuccess = vi.fn();
const toastWarning = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts === 'object') {
        return `${key}:${Object.entries(opts).map(([k, v]) => `${k}=${String(v)}`).join(',')}`;
      }
      return key;
    },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: toastWarning }),
}));

import { UrgentRequestModal } from './UrgentRequestModal';
import { api } from '@/lib/api';

function renderModal() {
  const onClose = vi.fn();
  const onSent = vi.fn();
  render(<UrgentRequestModal shiftId={7} shiftLabel="Sat 15 Mar" onClose={onClose} onSent={onSent} />);
  return { onClose, onSent };
}

describe('UrgentRequestModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('needs a message before it sends anything', async () => {
    renderModal();
    fireEvent.click(screen.getByTestId('urgent-request-send'));

    expect(await screen.findByRole('alert')).toHaveTextContent('shift_manager.urgent_message_required');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the request for the shift and says how many volunteers were asked', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 3, notified: 4 } });
    const { onClose, onSent } = renderModal();

    fireEvent.change(screen.getByRole('textbox', { name: /shift_manager\.urgent_message_label/ }), {
      target: { value: 'Two people dropped out — can anyone cover?' },
    });
    fireEvent.click(screen.getByTestId('urgent-request-send'));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.post).mock.calls[0]).toEqual([
      '/v2/volunteering/emergency-alerts',
      { shift_id: 7, message: 'Two people dropped out — can anyone cover?', priority: 'urgent', expires_hours: 24 },
    ]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('shift_manager.urgent_sent:count=4'));
    expect(onSent).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('warns when nobody could be asked', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 3, notified: 0 } });
    renderModal();

    fireEvent.change(screen.getByRole('textbox', { name: /shift_manager\.urgent_message_label/ }), { target: { value: 'Help please' } });
    fireEvent.click(screen.getByTestId('urgent-request-send'));

    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith('shift_manager.urgent_sent_none'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows the reason the server gives', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, errors: [{ message: 'This shift has already started.' }] });
    renderModal();

    fireEvent.change(screen.getByRole('textbox', { name: /shift_manager\.urgent_message_label/ }), { target: { value: 'Help please' } });
    fireEvent.click(screen.getByTestId('urgent-request-send'));

    expect(await screen.findByRole('alert')).toHaveTextContent('This shift has already started.');
  });
});
