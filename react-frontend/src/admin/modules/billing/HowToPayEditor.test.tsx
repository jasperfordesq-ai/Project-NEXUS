// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => mockToast }));

const HUB_URL = '/v2/admin/super/branch-plans/5/how-to-pay';
const PLATFORM_URL = '/v2/admin/super/billing/how-to-pay';

const box = () => screen.getByLabelText('How to pay') as HTMLTextAreaElement;
const saveButton = () => screen.getByRole('button', { name: 'Save note' });

const renderEditor = async (note: string | null, audience: 'platform' | 'parent' = 'parent', max = 600) => {
  const { HowToPayEditor } = await import('./HowToPayEditor');
  return render(<HowToPayEditor audience={audience} note={note} max={max} saveUrl={HUB_URL} />);
};

describe('HowToPayEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.put.mockImplementation((_url: string, body: { note: string | null }) =>
      Promise.resolve({ success: true, data: { how_to_pay: body.note, how_to_pay_max: 600 } }));
  });

  it('says who is shown the note, and warns while there is none', async () => {
    await renderEditor(null);

    expect(screen.getByText(/Shown to every community that pays this community:/)).toBeInTheDocument();
    expect(screen.getByText('No note is written yet, so these communities are not told how to pay.')).toBeInTheDocument();
    expect(box().value).toBe('');
    expect(saveButton()).toBeDisabled();
  });

  it('says the platform\'s note is for the communities that pay the platform by invoice', async () => {
    await renderEditor('Pay by bank transfer.', 'platform');

    expect(screen.getByText(/Shown to every community that pays the platform by invoice:/)).toBeInTheDocument();
    // There is a note: no warning.
    expect(screen.queryByText('No note is written yet, so these communities are not told how to pay.')).not.toBeInTheDocument();
    expect(box().value).toBe('Pay by bank transfer.');
  });

  it('saves the note as typed and says so', async () => {
    await renderEditor(null);

    fireEvent.change(box(), { target: { value: '  Pay by cheque.\nPost it to Cork.  ' } });
    expect(saveButton()).not.toBeDisabled();
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(HUB_URL, { note: 'Pay by cheque.\nPost it to Cork.' }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Note saved'));
    // Saved: nothing left to save until it changes again.
    await waitFor(() => expect(saveButton()).toBeDisabled());
  });

  it('removes the note when it is emptied, by sending null', async () => {
    await renderEditor('Pay by cheque.');

    fireEvent.change(box(), { target: { value: '   ' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(HUB_URL, { note: null }));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Note removed'));
    expect(await screen.findByText('No note is written yet, so these communities are not told how to pay.')).toBeInTheDocument();
  });

  it('counts the characters and will not save a note that is too long', async () => {
    await renderEditor(null, 'parent', 20);

    fireEvent.change(box(), { target: { value: 'Pay by cheque.' } });
    expect(screen.getByTestId('how-to-pay-count')).toHaveTextContent('14 of 20 characters');
    expect(saveButton()).not.toBeDisabled();

    fireEvent.change(box(), { target: { value: 'Pay by cheque to the hub.' } });
    const count = screen.getByTestId('how-to-pay-count');
    expect(count).toHaveTextContent('25 of 20 characters');
    expect(count).toHaveAttribute('role', 'alert');
    expect(saveButton()).toBeDisabled();
  });

  it('shows the server\'s own refusal and keeps what was typed', async () => {
    mockApi.put.mockResolvedValue({ success: false, error: 'The note is too long. Keep it to 600 characters or fewer.' });
    await renderEditor(null);

    fireEvent.change(box(), { target: { value: 'Pay by cheque.' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The note is too long. Keep it to 600 characters or fewer.'));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(box().value).toBe('Pay by cheque.');
  });
});

describe('PlatformHowToPayDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: { how_to_pay: 'Pay by bank transfer.', how_to_pay_max: 600 } });
    mockApi.put.mockImplementation((_url: string, body: { note: string | null }) =>
      Promise.resolve({ success: true, data: { how_to_pay: body.note, how_to_pay_max: 600 } }));
  });

  const renderDialog = async (isOpen = true) => {
    const { PlatformHowToPayDialog } = await import('./HowToPayEditor');
    return render(<PlatformHowToPayDialog isOpen={isOpen} onClose={vi.fn()} />);
  };

  it('asks for nothing while it is closed', async () => {
    await renderDialog(false);

    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('loads the platform\'s note and saves to the platform\'s address', async () => {
    await renderDialog();

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith(PLATFORM_URL));
    await waitFor(() => expect(box().value).toBe('Pay by bank transfer.'));

    fireEvent.change(box(), { target: { value: 'Pay by bank transfer to the platform.' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith(PLATFORM_URL, { note: 'Pay by bank transfer to the platform.' }));
  });

  it('says so when the note cannot be loaded, and offers no box to overwrite it blind', async () => {
    mockApi.get.mockResolvedValue({ success: false, error: 'nope' });
    await renderDialog();

    expect(await screen.findByText('The note could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByLabelText('How to pay')).not.toBeInTheDocument();
  });
});
