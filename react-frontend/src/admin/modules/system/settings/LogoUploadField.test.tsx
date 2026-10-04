// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { LogoUploadField } from './LogoUploadField';

const base = {
  id: 'partner',
  label: 'Partner Logo',
  uploading: false,
  onUpload: vi.fn(),
  onRemove: vi.fn(),
};

describe('LogoUploadField', () => {
  it('offers Upload with no image and Replace + Remove with one, previewing on both backgrounds', () => {
    const { rerender } = render(<LogoUploadField {...base} value={null} persistence="immediate" />);
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<LogoUploadField {...base} value="https://cdn.test/logo.svg" persistence="immediate" />);
    expect(screen.getByRole('button', { name: /replace image/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('On a light background')).toBeInTheDocument();
    expect(screen.getByText('On a dark background')).toBeInTheDocument();
  });

  it('explains when changes persist, per slot', () => {
    const { rerender } = render(<LogoUploadField {...base} value={null} persistence="immediate" />);
    expect(screen.getByText(/apply straight away. They are not part of Save/)).toBeInTheDocument();
    rerender(<LogoUploadField {...base} value={null} persistence="deferred" />);
    expect(screen.getByText(/Removing takes effect when you save/)).toBeInTheDocument();
  });

  it('shows the pending-removal chip for a deferred removal', () => {
    render(<LogoUploadField {...base} value={null} persistence="deferred" pendingRemoval />);
    expect(screen.getByText('Removal pending. Save to apply.')).toBeInTheDocument();
  });

  it('passes the chosen file to onUpload and calls onRemove', () => {
    const onUpload = vi.fn();
    const onRemove = vi.fn();
    render(
      <LogoUploadField {...base} value="https://cdn.test/logo.png" persistence="deferred" onUpload={onUpload} onRemove={onRemove} />
    );
    const input = screen.getByTestId('logo-input-partner') as HTMLInputElement;
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('replaces a broken image with a placeholder instead of a blank box', () => {
    render(<LogoUploadField {...base} value="https://cdn.test/missing.png" persistence="immediate" />);
    const [light] = screen.getAllByRole('img');
    fireEvent.error(light!);
    expect(screen.getByText('Image could not be loaded')).toBeInTheDocument();
  });
});
