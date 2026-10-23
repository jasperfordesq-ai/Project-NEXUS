// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

const { mockUpload, mockToast } = vi.hoisted(() => ({
  mockUpload: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: { upload: mockUpload } }));
vi.mock('@/contexts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts')>()),
  useToast: () => mockToast,
}));

import { SharingImageField } from './SharingImageField';

describe('SharingImageField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains what the image is for and the size to use', () => {
    render(<SharingImageField value="" onChange={vi.fn()} />);
    expect(screen.getByText(/shared on Facebook, WhatsApp, LinkedIn, X/)).toBeInTheDocument();
    expect(screen.getByText(/1200 × 630 pixels/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument();
  });

  it('uploads the chosen file to /v2/upload and fills the address in', async () => {
    mockUpload.mockResolvedValue({ success: true, data: { url: 'https://cdn.example/uploads/share.png', path: 'uploads/share.png' } });
    const onChange = vi.fn();
    render(<SharingImageField value="" onChange={onChange} />);

    const file = new File(['png'], 'share.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('sharing-image-input'), { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn.example/uploads/share.png'));
    expect(mockUpload).toHaveBeenCalledWith('/v2/upload', file, 'file');
    expect(mockToast.success).toHaveBeenCalledWith('Image uploaded. Press Save to keep it.');
  });

  it('says so when the upload fails and leaves the address alone', async () => {
    mockUpload.mockRejectedValue(new Error('413'));
    const onChange = vi.fn();
    render(<SharingImageField value="" onChange={onChange} />);

    fireEvent.change(screen.getByTestId('sharing-image-input'), {
      target: { files: [new File(['x'], 'big.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The image could not be uploaded. Try a JPG or PNG under 10 MB.'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a preview and a Remove button once there is an address, and remove clears it', async () => {
    const onChange = vi.fn();
    render(<SharingImageField value="https://cdn.example/share.png" onChange={onChange} />);

    expect(screen.getByRole('img', { name: 'OG Image Preview' })).toHaveAttribute('src', 'https://cdn.example/share.png');
    expect(screen.getByRole('button', { name: 'Replace image' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('accepts a pasted address in the text box', async () => {
    const onChange = vi.fn();
    render(<SharingImageField value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Image address' }), 'h');
    expect(onChange).toHaveBeenCalledWith('h');
  });

  // 2026-10-22: an owner uploaded an image on /admin/seo, refreshed, and lost
  // it. With onPersist the field stores the image itself, at once.
  describe('saving straight away (onPersist)', () => {
    it('stores the uploaded address at once and says so', async () => {
      mockUpload.mockResolvedValue({ success: true, data: { url: 'https://cdn.example/s.png', path: 'p' } });
      const onChange = vi.fn();
      const onPersist = vi.fn().mockResolvedValue(true);
      render(<SharingImageField value="" onChange={onChange} onPersist={onPersist} />);
      expect(screen.getByText('The image is saved as soon as you upload or remove it.')).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('sharing-image-input'), {
        target: { files: [new File(['png'], 's.png', { type: 'image/png' })] },
      });

      await waitFor(() => expect(onPersist).toHaveBeenCalledWith('https://cdn.example/s.png'));
      expect(onChange).toHaveBeenCalledWith('https://cdn.example/s.png');
      expect(mockToast.success).toHaveBeenCalledWith('Image uploaded and saved.');
    });

    it('says when the image uploaded but could not be stored', async () => {
      mockUpload.mockResolvedValue({ success: true, data: { url: 'https://cdn.example/s.png', path: 'p' } });
      const onPersist = vi.fn().mockResolvedValue(false);
      render(<SharingImageField value="" onChange={vi.fn()} onPersist={onPersist} />);

      fireEvent.change(screen.getByTestId('sharing-image-input'), {
        target: { files: [new File(['png'], 's.png', { type: 'image/png' })] },
      });

      await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(
        'The image could not be saved. Try again, or press Save at the bottom of the page.',
      ));
    });

    it('stores the removal at once', async () => {
      const onPersist = vi.fn().mockResolvedValue(true);
      render(<SharingImageField value="https://cdn.example/s.png" onChange={vi.fn()} onPersist={onPersist} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
      await waitFor(() => expect(onPersist).toHaveBeenCalledWith(''));
      expect(mockToast.success).toHaveBeenCalledWith('Image removed.');
    });

    it('without onPersist it only asks the user to press Save', () => {
      render(<SharingImageField value="" onChange={vi.fn()} />);
      expect(screen.getByText('Press Save to keep this image.')).toBeInTheDocument();
    });
  });
});

