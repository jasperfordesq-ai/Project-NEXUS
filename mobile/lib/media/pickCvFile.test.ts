// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }));

import { CV_MAX_MB, pickCvFile } from './pickCvFile';

function asset(overrides: Record<string, unknown> = {}) {
  return {
    canceled: false,
    assets: [{
      uri: 'file:///cache/aoife-cv.pdf',
      name: 'aoife-cv.pdf',
      size: 1024,
      mimeType: 'application/pdf',
      lastModified: 0,
      ...overrides,
    }],
  };
}

beforeEach(() => mockGetDocumentAsync.mockReset());

describe('pickCvFile', () => {
  it('returns the chosen file', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset());

    await expect(pickCvFile()).resolves.toEqual({
      status: 'picked',
      file: { uri: 'file:///cache/aoife-cv.pdf', name: 'aoife-cv.pdf', mimeType: 'application/pdf', size: 1024 },
    });
  });

  it('accepts a Word document, which the API also accepts', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({
      name: 'cv.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));

    await expect(pickCvFile()).resolves.toMatchObject({ status: 'picked' });
  });

  it('reports a cancelled picker rather than an empty file', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true });
    await expect(pickCvFile()).resolves.toEqual({ status: 'cancelled' });

    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [] });
    await expect(pickCvFile()).resolves.toEqual({ status: 'cancelled' });
  });

  /**
   * 🔴 These are the SERVER's limits, checked here only so the member is not asked to write
   * a covering message and then refused. `JobVacanciesController::apply` allows pdf / doc /
   * docx and nothing over 5 MB.
   */
  it('refuses a file the API would refuse, by extension', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ name: 'cv.pages', mimeType: 'application/pdf' }));
    await expect(pickCvFile()).resolves.toEqual({ status: 'unsupported_type' });
  });

  it('refuses a file whose reported type the API would refuse', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ name: 'cv.pdf', mimeType: 'text/html' }));
    await expect(pickCvFile()).resolves.toEqual({ status: 'unsupported_type' });
  });

  /**
   * 🔴 Unlike the podcast audio picker, an unknown type is NOT waved through. The server
   * deliberately drops `application/octet-stream` for CVs because it is the fallback for
   * any unrecognised file, and letting it past here would only earn a refusal after the
   * upload.
   */
  it('refuses a generic octet-stream rather than sending it and being refused', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ mimeType: 'application/octet-stream' }));
    await expect(pickCvFile()).resolves.toEqual({ status: 'unsupported_type' });
  });

  it('allows a file whose type the platform could not report at all', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ mimeType: undefined }));
    await expect(pickCvFile()).resolves.toMatchObject({ status: 'picked', file: { mimeType: '' } });
  });

  it('refuses a file over the API ceiling', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ size: (CV_MAX_MB * 1024 * 1024) + 1 }));
    await expect(pickCvFile()).resolves.toEqual({ status: 'too_large', maxMb: CV_MAX_MB });
  });

  it('allows a file the platform did not measure, and lets the server decide', async () => {
    mockGetDocumentAsync.mockResolvedValue(asset({ size: undefined }));
    await expect(pickCvFile()).resolves.toMatchObject({ status: 'picked', file: { size: null } });
  });
});
