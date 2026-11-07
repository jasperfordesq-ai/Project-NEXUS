// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, Oct 2026, point 6: a supporter who adds the photo
 * to a listing they post for someone could not describe it for blind members.
 * The listing form's "describe this photo" box now travels WITH the photo
 * (`image_alt` on the supporter photo upload), and never on the co_decide path,
 * where no photo travels either.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { ListingSubmitPayload } from '@/components/listings/ListingForm';

const { mockApi, photo } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), upload: vi.fn() },
  photo: new File(['garden'], 'IMG_4410.jpg', { type: 'image/jpeg' }),
}));

vi.mock('@/lib/api', () => ({ default: mockApi, api: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts());

// The listing form itself is tested elsewhere; here it just hands the modal
// what a supporter typed: a listing, a photo, and the photo's description.
vi.mock('@/components/listings/ListingForm', () => ({
  ListingForm: ({ submitAdapter }: {
    submitAdapter: (payload: ListingSubmitPayload, extras: { skillTags: string[]; imageFile: File | null }) => Promise<unknown>;
  }) => (
    <button
      type="button"
      onClick={() => void submitAdapter({
        title: 'Vegetables from my garden',
        description: 'Fresh vegetables to share with neighbours every Saturday.',
        type: 'offer',
        location: '',
        hours_estimate: 1,
        hours_available: null,
        service_type: 'physical_only',
        image_alt: 'A vegetable patch with ripe tomatoes',
      }, { skillTags: [], imageFile: photo })}
    >
      submit listing
    </button>
  ),
}));

import { SupportPrepareModal } from './SupportPrepareModal';

function renderListing(tier: 'co_decide' | 'represent') {
  return render(
    <SupportPrepareModal
      isOpen
      onOpenChange={() => {}}
      actionType="listing_create"
      supportedUserId={42}
      supportedName="Molly Member"
      tier={tier}
    />,
  );
}

describe('SupportPrepareModal — the listing photo description', () => {
  beforeEach(() => vi.resetAllMocks());

  it('represent: uploads the photo together with its description', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: { id: 55 } } as never);
    mockApi.upload.mockResolvedValue({ success: true, data: { image_url: '/uploads/x.jpg' } } as never);
    renderListing('represent');

    fireEvent.click(screen.getByRole('button', { name: 'submit listing' }));

    await waitFor(() => expect(mockApi.upload).toHaveBeenCalled());
    const [url, form] = mockApi.upload.mock.calls[0] as [string, FormData];
    expect(url).toBe('/v2/users/me/sub-accounts/42/listings/55/image');
    expect(form.get('image')).toBeInstanceOf(File);
    expect(form.get('image_alt')).toBe('A vegetable patch with ripe tomatoes');
  });

  it('co_decide: the description does not travel without its photo', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: { id: 9, status: 'pending' } } as never);
    renderListing('co_decide');

    fireEvent.click(screen.getByRole('button', { name: 'submit listing' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());
    const [url, body] = mockApi.post.mock.calls[0] as [string, { payload: Record<string, unknown> }];
    expect(url).toBe('/v2/users/me/support-actions');
    expect(body.payload).not.toHaveProperty('image_alt');
    expect(body.payload.title).toBe('Vegetables from my garden');
    expect(mockApi.upload).not.toHaveBeenCalled();
  });
});
