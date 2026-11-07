// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { appendAttachments } from './attachmentFormData';

describe('appendAttachments', () => {
  it('sends each photo with its description, in the same order, and a blank for a document', () => {
    const photo = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const doc = new File(['x'], 'b.pdf', { type: 'application/pdf' });
    const form = new FormData();

    appendAttachments(form, [
      { file: photo, preview: 'blob:a', type: 'image', alt: '  A red bicycle  ' },
      { file: doc, preview: '', type: 'file', alt: 'ignored' },
    ]);

    expect(form.getAll('attachments[]').map((f) => (f as File).name)).toEqual(['a.jpg', 'b.pdf']);
    expect(form.getAll('attachment_alts[]')).toEqual(['A red bicycle', '']);
  });
});
