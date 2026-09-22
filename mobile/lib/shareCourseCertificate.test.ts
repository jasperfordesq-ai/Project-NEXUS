// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { AppState } from 'react-native';
import * as Sharing from 'expo-sharing';
import { authenticatedApiIdentity } from '@/lib/api/client';
import { getCourseCertificate } from '@/lib/api/courses';
import { shareCourseCertificate } from './shareCourseCertificate';
const mockWrite = jest.fn(), mockDispose = jest.fn(), mockRelease = jest.fn(), mockCurrent = jest.fn();
jest.mock('expo-file-system', () => ({ File: class { uri = 'file:///certificate.html'; create() {} write(html: string) { mockWrite(html); } } }));
jest.mock('./auditedExportCache', () => ({ createAuditedExportDirectory: () => ({ directory: {}, dispose: mockDispose, release: mockRelease }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ authenticatedApiIdentity: jest.fn() }));
jest.mock('@/lib/api/courses', () => ({ getCourseCertificate: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks(); mockCurrent.mockReset(); mockWrite.mockReset(); AppState.currentState = 'active';
  jest.mocked(authenticatedApiIdentity).mockResolvedValue({ token: 'test', tenantSlug: 'test', assertCurrent: mockCurrent });
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
  jest.mocked(getCourseCertificate).mockResolvedValue({ certificate: { course_id: 15 }, html: '<html>Certificate</html>' } as never);
});
it('shares server HTML and retains the leased file for the receiving app', async () => {
  await shareCourseCertificate(15, () => true);
  expect(getCourseCertificate).toHaveBeenCalledWith(15);
  expect(mockWrite).toHaveBeenCalledWith('<html>Certificate</html>');
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///certificate.html', { mimeType: 'text/html', UTI: 'public.html' });
  expect(mockRelease).toHaveBeenCalledTimes(1); expect(mockDispose).not.toHaveBeenCalled();
});
it('does not fetch if native sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(shareCourseCertificate(15, () => true)).rejects.toThrow('sharing_unavailable');
  expect(getCourseCertificate).not.toHaveBeenCalled();
});
it('does not write a response after identity replacement', async () => {
  mockCurrent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('identity changed'));
  await expect(shareCourseCertificate(15, () => true)).rejects.toThrow('identity changed');
  expect(mockWrite).not.toHaveBeenCalled(); expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('disposes a prepared file if its screen closes before handoff', async () => {
  let active = true; mockWrite.mockImplementation(() => { active = false; });
  await expect(shareCourseCertificate(15, () => active)).rejects.toThrow('download_cancelled');
  expect(mockDispose).toHaveBeenCalledTimes(1); expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('rejects a certificate for another course', async () => {
  jest.mocked(getCourseCertificate).mockResolvedValue({ certificate: { course_id: 16 }, html: 'wrong' } as never);
  await expect(shareCourseCertificate(15, () => true)).rejects.toThrow('invalid_certificate');
  expect(mockWrite).not.toHaveBeenCalled();
});
