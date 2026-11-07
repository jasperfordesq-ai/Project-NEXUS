// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, Oct 2026, point 6: a group's picture and cover
 * can be described for screen readers. The group form sends `avatar_alt` /
 * `cover_alt` whenever there is an image to describe (empty clears it), and
 * nothing for an image being removed (the server clears that itself).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApi } = vi.hoisted(() => ({ mockApi: { upload: vi.fn() } }));
vi.mock('@/lib/api', () => ({ api: mockApi }));

import { createGroupFromDraft, emptyGroupFormDraft, emptyGroupImageDraft, updateGroupFromDraft } from './groupForm';

function sentForm(): FormData {
  return mockApi.upload.mock.calls[0]![1] as FormData;
}

describe('group image descriptions in the group form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.upload.mockResolvedValue({ success: true, data: { id: 9 } });
  });

  it('sends the description of a kept cover, and nothing for a removed picture', async () => {
    const draft = {
      ...emptyGroupFormDraft(),
      name: 'Tree planters',
      avatar: { ...emptyGroupImageDraft('/uploads/picture.jpg', 'Old words'), action: 'remove' as const },
      cover: { ...emptyGroupImageDraft('/uploads/cover.jpg'), alt: '  Members planting trees by the river  ' },
    };

    await updateGroupFromDraft(9, draft);

    const form = sentForm();
    expect(form.get('cover_alt')).toBe('Members planting trees by the river');
    expect(form.has('avatar_alt')).toBe(false);
  });

  it('sends the description with a new picture when creating a group', async () => {
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    const draft = {
      ...emptyGroupFormDraft(),
      name: 'Tree planters',
      avatar: { action: 'replace' as const, file, previewUrl: null, existingUrl: null, alt: 'A green hand holding a seedling' },
    };

    await createGroupFromDraft(draft);

    expect(sentForm().get('avatar_alt')).toBe('A green hand holding a seedling');
    expect(sentForm().has('cover_alt')).toBe(false);
  });
});
