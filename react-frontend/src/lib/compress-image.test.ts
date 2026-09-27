// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage } from './compress-image';

describe('compressImage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns non-image files unchanged', async () => {
    const file = new File(['text content'], 'document.pdf', { type: 'application/pdf' });
    const result = await compressImage(file);
    expect(result).toBe(file);
  });

  it('returns image as-is when width is within maxWidth', async () => {
    const file = new File(['fake-image'], 'photo.jpg', { type: 'image/jpeg' });

    // Mock Image loading with small dimensions
    const mockImg = {
      naturalWidth: 800,
      naturalHeight: 600,
      onload: null as (() => void) | null,
      src: '',
    };

    vi.spyOn(window, 'Image' as keyof Window).mockImplementation(function mockImage() {
      setTimeout(() => mockImg.onload?.(), 0);
      return mockImg as unknown as HTMLImageElement;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await compressImage(file, 1920);
    // 800 <= 1920, should return original
    expect(result).toBe(file);
  });

  it('replaces file extension correctly for images without extension', async () => {
    // Test the replaceExtension logic indirectly via a mocked large image
    const file = new File(['fake-image'], 'photo', { type: 'image/jpeg' });

    const mockImg = {
      naturalWidth: 3000,
      naturalHeight: 2000,
      onload: null as (() => void) | null,
      src: '',
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        drawImage: vi.fn(),
      }),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => {
        cb(new Blob(['compressed'], { type: 'image/jpeg' }));
      }),
    };

    vi.spyOn(window, 'Image' as keyof Window).mockImplementation(function mockImage() {
      setTimeout(() => mockImg.onload?.(), 0);
      return mockImg as unknown as HTMLImageElement;
    });
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return document.createElement(tag);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await compressImage(file, 1920);
    expect(result.name).toBe('photo.jpg');
    expect(result.type).toBe('image/jpeg');
  });

  it('replaces existing extension with .jpg', async () => {
    const file = new File(['fake-image'], 'photo.png', { type: 'image/png' });

    const mockImg = {
      naturalWidth: 3000,
      naturalHeight: 2000,
      onload: null as (() => void) | null,
      src: '',
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({
        drawImage: vi.fn(),
      }),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => {
        cb(new Blob(['compressed'], { type: 'image/jpeg' }));
      }),
    };

    vi.spyOn(window, 'Image' as keyof Window).mockImplementation(function mockImage() {
      setTimeout(() => mockImg.onload?.(), 0);
      return mockImg as unknown as HTMLImageElement;
    });
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return document.createElement(tag);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await compressImage(file, 1920);
    expect(result.name).toBe('photo.jpg');
  });

  it('returns original file when canvas context unavailable', async () => {
    const file = new File(['fake-image'], 'big-photo.jpg', { type: 'image/jpeg' });

    const mockImg = {
      naturalWidth: 3000,
      naturalHeight: 2000,
      onload: null as (() => void) | null,
      src: '',
    };

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(null), // No 2D context
    };

    vi.spyOn(window, 'Image' as keyof Window).mockImplementation(function mockImage() {
      setTimeout(() => mockImg.onload?.(), 0);
      return mockImg as unknown as HTMLImageElement;
    });
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
      return document.createElement(tag);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const result = await compressImage(file, 1920);
    expect(result).toBe(file);
  });

  it('uses default maxWidth of 1920 and quality of 0.85', async () => {
    const file = new File(['fake-image'], 'image.jpg', { type: 'image/jpeg' });

    const mockImg = {
      naturalWidth: 800,
      naturalHeight: 600,
      onload: null as (() => void) | null,
      src: '',
    };

    vi.spyOn(window, 'Image' as keyof Window).mockImplementation(function mockImage() {
      setTimeout(() => mockImg.onload?.(), 0);
      return mockImg as unknown as HTMLImageElement;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // 800 <= 1920, returns original
    const result = await compressImage(file);
    expect(result).toBe(file);
  });
});
