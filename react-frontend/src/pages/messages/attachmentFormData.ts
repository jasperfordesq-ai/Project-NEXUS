// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { AttachmentPreview } from './components/MessageInputArea';

/**
 * Adds the chosen files to a message send, each photo with the description
 * its sender wrote (`attachment_alts[i]` describes `attachments[i]`; blank for
 * a document or an undescribed photo). AWID accessibility report, point 6.
 */
export function appendAttachments(form: FormData, previews: AttachmentPreview[]): void {
  for (const item of previews) {
    form.append('attachments[]', item.file);
    form.append('attachment_alts[]', item.type === 'image' ? (item.alt ?? '').trim() : '');
  }
}
