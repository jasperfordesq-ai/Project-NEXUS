// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'fs';
import path from 'path';

const routeContracts: Record<string, string[]> = {
  'clubs.tsx': ['getClubs', 'ModalErrorBoundary', 'SafeAreaView'],
  'donation-receipt.tsx': ['getDonationReceipt', 'ModalErrorBoundary', 'SafeAreaView'],
  'group-invite.tsx': ['getGroupInvitePreview', 'acceptGroupInvite', 'ModalErrorBoundary'],
  'ideation-campaign-detail.tsx': ['getIdeationCampaign', 'ModalErrorBoundary', 'SafeAreaView'],
  'ideation-campaigns.tsx': ['getIdeationCampaigns', 'ModalErrorBoundary', 'SafeAreaView'],
  'ideation-idea.tsx': ['getIdeationIdea', 'getIdeationComments', 'ModalErrorBoundary'],
  'ideation-outcomes.tsx': ['getIdeationOutcomes', 'ModalErrorBoundary', 'SafeAreaView'],
  'venue-checkin.tsx': ['recordPartnerVenueVisit', 'ModalErrorBoundary', 'SafeAreaView'],
  'venue-pass.tsx': ['getPartnerVenuePass', 'rotatePartnerVenuePass', 'ModalErrorBoundary'],
  'venues.tsx': ['getPartnerVenues', 'ModalErrorBoundary', 'SafeAreaView'],
  'volunteer-checkin.tsx': ['verifyVolunteerCheckIn', 'checkOutVolunteer', 'ModalErrorBoundary'],
};

describe('adult member module route wiring', () => {
  it.each(Object.entries(routeContracts))('%s keeps its API and resilient native screen boundary', (filename, tokens) => {
    const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');

    expect(source).toMatch(/export default function /);
    for (const token of tokens) expect(source).toContain(token);
  });
});
