// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Every picker call in the app passed `quality: 0.82`–`0.88` and nothing else.
 * `quality` re-encodes; it does not resize. A photo from a modern phone camera therefore
 * left the device at full pixel dimensions — several megabytes against an 8 MB server
 * limit and a 60-second upload timeout — so on mobile data the member waited out the
 * minute and was told the upload had failed. Audit 2026-09-09, item 6.
 *
 * The last two tests matter as much as the first: a resize that can lose a photo, or lose
 * a logo's transparency, would be a worse defect than the one being fixed.
 */

import { prepareImageForUpload, DEFAULT_MAX_EDGE, MARKETPLACE_MAX_EDGE } from './prepareImageForUpload';

const mockResize = jest.fn();
const mockRenderAsync = jest.fn();
const mockSaveAsync = jest.fn();
const mockManipulate = jest.fn();
const mockReportException = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('@/lib/observability/report', () => ({
  reportException: (...args: unknown[]) => mockReportException(...args),
}));

describe('prepareImageForUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const context = { resize: mockResize, renderAsync: mockRenderAsync };
    mockResize.mockReturnValue(context);
    mockManipulate.mockReturnValue(context);
    mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
    mockSaveAsync.mockResolvedValue({ uri: 'file:///cache/resized.jpg', width: 1600, height: 1200 });
  });

  it('shrinks a camera photo to the default longest edge', async () => {
    const result = await prepareImageForUpload({ uri: 'file:///dcim/photo.jpg', width: 4032, height: 3024 });

    expect(mockManipulate).toHaveBeenCalledWith('file:///dcim/photo.jpg');
    // Landscape, so the WIDTH is constrained and the height follows the ratio.
    expect(mockResize).toHaveBeenCalledWith({ width: DEFAULT_MAX_EDGE });
    expect(result.uri).toBe('file:///cache/resized.jpg');
  });

  it('constrains the height of a portrait photo, not the width', async () => {
    // Capping the width of a tall photo would leave it taller than the limit.
    await prepareImageForUpload({ uri: 'file:///dcim/tall.jpg', width: 3024, height: 4032 });

    expect(mockResize).toHaveBeenCalledWith({ height: DEFAULT_MAX_EDGE });
  });

  it('allows a marketplace photo the larger edge a buyer zooms into', async () => {
    await prepareImageForUpload({ uri: 'file:///dcim/item.jpg', width: 4032, height: 3024 }, { maxEdge: MARKETPLACE_MAX_EDGE });

    expect(mockResize).toHaveBeenCalledWith({ width: MARKETPLACE_MAX_EDGE });
  });

  it('leaves a photo that is already small enough completely alone', async () => {
    // Re-encoding a small image wastes time and can make the file bigger.
    const asset = { uri: 'file:///dcim/small.jpg', width: 800, height: 600 };
    const result = await prepareImageForUpload(asset);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(result).toBe(asset);
  });

  it('keeps a PNG as a PNG, so a transparent logo does not gain a black background', async () => {
    await prepareImageForUpload({ uri: 'file:///dcim/logo.png', width: 3000, height: 3000 });

    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'png' });
  });

  it('re-encodes anything else as JPEG', async () => {
    await prepareImageForUpload({ uri: 'file:///dcim/photo.jpg', width: 3000, height: 2000 });

    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
  });

  it('still uploads the original when the resize fails', async () => {
    // 🔴 The resize is an improvement, not a gate. A member whose photo could not be
    // shrunk must still be able to post it; the server's own limit is the real boundary.
    mockRenderAsync.mockRejectedValue(new Error('native module unavailable'));
    const asset = { uri: 'file:///dcim/photo.jpg', width: 4032, height: 3024 };

    const result = await prepareImageForUpload(asset);

    expect(result).toBe(asset);
    expect(mockReportException).toHaveBeenCalled();
  });

  it('attempts a resize when the picker reported no dimensions', async () => {
    // Some providers omit width/height. Guessing "small" there would ship the full photo.
    await prepareImageForUpload({ uri: 'file:///dcim/unknown.jpg' });

    expect(mockManipulate).toHaveBeenCalled();
  });
});
