// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockGetUserVerificationBadges = jest.fn();

jest.mock('@/lib/api/verification', () => ({
  getUserVerificationBadges: (...args: unknown[]) => mockGetUserVerificationBadges(...args),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    textMuted: '#71717a',
    success: '#16a34a',
    warning: '#f59e0b',
    info: '#2563eb',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'aria.verification_badges': 'Verification badges',
        'verification.not_id_verified': 'Not ID verified',
        'verification.badge.id_verified': 'ID verified',
        'verification.badge.email_verified': 'Email verified',
        'verification.badge.unknown': 'Verified',
        'verification.badge.phone_verified': 'Phone verified',
        'verification.badge.dbs_checked': 'DBS checked',
        'verification.badge.admin_verified': 'Admin verified',
      };
      return map[key] ?? key;
    },
  }),
}));

import VerificationBadgeRow from './VerificationBadgeRow';

describe('VerificationBadgeRow', () => {
  beforeEach(() => {
    mockGetUserVerificationBadges.mockReset();
  });

  it('does not turn a plain user verification flag into an ID verified label', async () => {
    mockGetUserVerificationBadges.mockResolvedValue([]);

    const { getByText, queryByText } = render(<VerificationBadgeRow userId={42} showUnverified />);

    await waitFor(() => expect(getByText('Not ID verified')).toBeTruthy());
    expect(queryByText('ID verified')).toBeNull();
  });

  it('shows ID verified only when the id_verified badge is returned', async () => {
    mockGetUserVerificationBadges.mockResolvedValue([{ badge_type: 'id_verified', label: 'ID verified' }]);

    const { getByText, queryByText } = render(<VerificationBadgeRow userId={42} showUnverified />);

    await waitFor(() => expect(getByText('ID verified')).toBeTruthy());
    expect(queryByText('Not ID verified')).toBeNull();
  });

  it('says nothing at all when the check itself failed, rather than "Not ID verified"', async () => {
    /*
      🔴 S3-07: a failed request set an empty badge list, and with `showUnverified` the row
      then printed "Not ID verified" — a member's own dropped connection rendered as a
      definite statement about someone else's trust status, inside a card headed "Trust
      status" (audit 2026-09-06).
    */
    mockGetUserVerificationBadges.mockRejectedValue(new Error('offline'));

    const { queryByText } = render(<VerificationBadgeRow userId={42} showUnverified />);

    await waitFor(() => expect(mockGetUserVerificationBadges).toHaveBeenCalledWith(42));
    expect(queryByText('Not ID verified')).toBeNull();
    expect(queryByText('ID verified')).toBeNull();
  });

  it('renders each badge type with its own label rather than falling back to "Verified"', async () => {
    mockGetUserVerificationBadges.mockResolvedValue([
      { badge_type: 'email_verified', label: 'Email verified' },
      { badge_type: 'phone_verified', label: 'Phone verified' },
      { badge_type: 'dbs_checked', label: 'DBS checked' },
      { badge_type: 'admin_verified', label: 'Admin verified' },
    ]);

    const { getByText } = render(<VerificationBadgeRow userId={42} />);

    await waitFor(() => expect(getByText('Email verified')).toBeTruthy());
    expect(getByText('Phone verified')).toBeTruthy();
    expect(getByText('DBS checked')).toBeTruthy();
    expect(getByText('Admin verified')).toBeTruthy();
  });

  it('an unrecognised badge type still renders, as a plain "Verified"', async () => {
    mockGetUserVerificationBadges.mockResolvedValue([{ badge_type: 'something_new', label: 'Something new' }]);

    const { getByText } = render(<VerificationBadgeRow userId={42} />);

    await waitFor(() => expect(getByText('Verified')).toBeTruthy());
  });

  it('uses badges passed in directly and never asks the API for them', async () => {
    const { getByText } = render(
      <VerificationBadgeRow userId={42} badges={[{ badge_type: 'id_verified', label: 'ID verified' }]} />,
    );

    await waitFor(() => expect(getByText('ID verified')).toBeTruthy());
    expect(mockGetUserVerificationBadges).not.toHaveBeenCalled();
  });

  it('asks the API for nothing when there is no usable member id', async () => {
    // It still renders the unverified state — it simply has nobody to ask about.
    const { getByText } = render(<VerificationBadgeRow userId={0} showUnverified />);

    expect(mockGetUserVerificationBadges).not.toHaveBeenCalled();
    expect(getByText('Not ID verified')).toBeTruthy();
  });

  it('can suppress the unverified label for dense layouts', async () => {
    mockGetUserVerificationBadges.mockResolvedValue([]);

    const { queryByText } = render(<VerificationBadgeRow userId={42} showUnverified={false} />);

    await waitFor(() => expect(mockGetUserVerificationBadges).toHaveBeenCalledWith(42));
    expect(queryByText('Not ID verified')).toBeNull();
  });
});
