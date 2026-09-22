// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { AppState } from 'react-native';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authenticatedApiIdentity } from '@/lib/api/client';
import { getCourseCertificate } from '@/lib/api/courses';
import { createAuditedExportDirectory } from './auditedExportCache';

/** Share the authenticated server certificate, never an unauthenticated browser URL. */
export async function shareCourseCertificate(courseId: number, isActive: () => boolean): Promise<void> {
  const assertActive = () => {
    if (!isActive() || AppState.currentState !== 'active') throw new Error('download_cancelled');
  };
  assertActive();
  const identity = await authenticatedApiIdentity();
  if (!await Sharing.isAvailableAsync()) throw new Error('sharing_unavailable');
  await identity.assertCurrent(); assertActive();
  const result = await getCourseCertificate(courseId);
  await identity.assertCurrent(); assertActive();
  if (Number(result.certificate?.course_id) !== courseId || !result.html?.trim()) throw new Error('invalid_certificate');
  const lease = createAuditedExportDirectory();
  let handedOff = false;
  try {
    const file = new File(lease.directory, `course-${courseId}-certificate.html`);
    file.create(); file.write(result.html);
    await identity.assertCurrent(); assertActive();
    handedOff = true;
    await Sharing.shareAsync(file.uri, { mimeType: 'text/html', UTI: 'public.html' });
  } finally {
    // Native dismissal does not prove another app has finished reading the file.
    if (handedOff) lease.release();
    else lease.dispose();
  }
}
