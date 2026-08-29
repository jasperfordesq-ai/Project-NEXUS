// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from './client';
import { acceptGroupInvite, getGroupInvitePreview } from './groups';
import { recordPartnerVenueVisit } from './venues';
import { checkOutVolunteer, verifyVolunteerCheckIn } from './volunteering';

jest.mock('./client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() }, ApiResponseError: class extends Error {} }));

describe('member entry-link API contracts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('previews and accepts a group invite without losing the opaque token', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { group: { id: 4, name: 'Gardeners' }, membership: { status: 'none' }, invite: { id: 2, type: 'link', status: 'active' } } });
    (api.post as jest.Mock).mockResolvedValue({ data: { action: 'joined', group: { id: 4, name: 'Gardeners' }, membership: { status: 'active', role: 'member' } } });
    await getGroupInvitePreview('abc/123');
    await acceptGroupInvite('abc/123');
    expect(api.get).toHaveBeenCalledWith('/api/v2/groups/invite/abc%2F123');
    expect(api.post).toHaveBeenCalledWith('/api/v2/groups/invite/abc%2F123/accept', {});
  });

  it('records venue and volunteering check-ins only after an explicit POST', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { status: 'recorded', member: { id: 7, name: 'Alex' } } })
      .mockResolvedValueOnce({ data: { status: 'checked_in', user: { id: 7, name: 'Alex' } } })
      .mockResolvedValueOnce({ data: { status: 'checked_out' } });
    await recordPartnerVenueVisit('venue token', 9);
    await verifyVolunteerCheckIn('shift token');
    await checkOutVolunteer('shift token');
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/partner-venues/visits/verify/venue%20token', { venue_id: 9 });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/volunteering/checkin/verify/shift%20token', {});
    expect(api.post).toHaveBeenNthCalledWith(3, '/api/v2/volunteering/checkin/checkout/shift%20token', {});
  });
});
