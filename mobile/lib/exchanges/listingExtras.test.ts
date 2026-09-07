// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockSetExchangeTags = jest.fn();
const mockUploadExchangeImage = jest.fn();
const mockDeleteExchangeImage = jest.fn();

jest.mock('@/lib/api/exchanges', () => ({
  setExchangeTags: (...args: unknown[]) => mockSetExchangeTags(...args),
  uploadExchangeImage: (...args: unknown[]) => mockUploadExchangeImage(...args),
  deleteExchangeImage: (...args: unknown[]) => mockDeleteExchangeImage(...args),
}));

import { remainingListingExtras, saveListingExtras } from './listingExtras';

describe('saveListingExtras', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetExchangeTags.mockResolvedValue({ data: {} });
    mockUploadExchangeImage.mockResolvedValue({ data: {} });
    mockDeleteExchangeImage.mockResolvedValue(undefined);
  });

  it('reports success when everything the listing needed was written', async () => {
    const result = await saveListingExtras(7, { tags: ['gardening'], imageUri: 'file://a.jpg', removeImage: false });

    expect(result.tagsFailed).toBe(false);
    expect(result.imageFailed).toBe(false);
    expect(mockSetExchangeTags).toHaveBeenCalledWith(7, ['gardening']);
    expect(mockUploadExchangeImage).toHaveBeenCalledWith(7, 'file://a.jpg');
  });

  it('does nothing at all when there is nothing to write', async () => {
    const result = await saveListingExtras(7, { tags: null, imageUri: null, removeImage: false });

    expect(result.tagsFailed).toBe(false);
    expect(result.imageFailed).toBe(false);
    expect(mockSetExchangeTags).not.toHaveBeenCalled();
    expect(mockUploadExchangeImage).not.toHaveBeenCalled();
    expect(mockDeleteExchangeImage).not.toHaveBeenCalled();
  });

  /**
   * 🔴 Audit 2026-09-06, F06. The two writes are independent. A failed image must not
   * stop the tags being saved, or the member is told two things failed when one did.
   */
  it('still writes the image when the tags fail', async () => {
    mockSetExchangeTags.mockRejectedValue(new Error('network'));

    const result = await saveListingExtras(7, { tags: ['gardening'], imageUri: 'file://a.jpg', removeImage: false });

    expect(result.tagsFailed).toBe(true);
    expect(result.imageFailed).toBe(false);
    expect(mockUploadExchangeImage).toHaveBeenCalledWith(7, 'file://a.jpg');
  });

  it('still writes the tags when the image fails', async () => {
    mockUploadExchangeImage.mockRejectedValue(new Error('network'));

    const result = await saveListingExtras(7, { tags: ['gardening'], imageUri: 'file://a.jpg', removeImage: false });

    expect(result.tagsFailed).toBe(false);
    expect(result.imageFailed).toBe(true);
    expect(mockSetExchangeTags).toHaveBeenCalledWith(7, ['gardening']);
  });

  it('deletes the existing image when that is what was asked for', async () => {
    const result = await saveListingExtras(7, { tags: null, imageUri: null, removeImage: true });

    expect(result.imageFailed).toBe(false);
    expect(mockDeleteExchangeImage).toHaveBeenCalledWith(7);
    expect(mockUploadExchangeImage).not.toHaveBeenCalled();
  });
});

describe('remainingListingExtras', () => {
  const extras = { tags: ['gardening'], imageUri: 'file://a.jpg', removeImage: false };

  /**
   * 🔴 A retry must re-send ONLY what failed. Re-sending a write that already landed is
   * how a member ends up with the same work applied twice.
   */
  it('narrows a retry to the writes that failed', () => {
    expect(remainingListingExtras(extras, { tagsFailed: true, imageFailed: false }))
      .toEqual({ tags: ['gardening'], imageUri: null, removeImage: false });

    expect(remainingListingExtras(extras, { tagsFailed: false, imageFailed: true }))
      .toEqual({ tags: null, imageUri: 'file://a.jpg', removeImage: false });
  });

  it('keeps an image deletion pending when that is what failed', () => {
    expect(remainingListingExtras(
      { tags: null, imageUri: null, removeImage: true },
      { tagsFailed: false, imageFailed: true },
    )).toEqual({ tags: null, imageUri: null, removeImage: true });
  });

  it('has nothing left to do when both writes landed', () => {
    expect(remainingListingExtras(extras, { tagsFailed: false, imageFailed: false }))
      .toEqual({ tags: null, imageUri: null, removeImage: false });
  });
});
