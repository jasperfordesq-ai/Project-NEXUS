// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { ProfileTimeShared } from './ProfileTimeShared';

function renderInList(given: number, received: number) {
  return render(
    <dl>
      <ProfileTimeShared given={given} received={received} />
    </dl>,
  );
}

describe('ProfileTimeShared', () => {
  it('shows hours given and received as a pair of terms, with the total in the middle of the ring', () => {
    renderInList(6, 2);
    const card = screen.getByTestId('profile-time-shared');
    expect(card).toHaveTextContent('Time shared');
    expect(screen.getByText("Hours given").tagName).toBe('DT');
    expect(screen.getByText('6').tagName).toBe('DD');
    expect(screen.getByText("Hours received").tagName).toBe('DT');
    expect(screen.getByText('2').tagName).toBe('DD');
    expect(screen.getByTestId('profile-time-shared-total')).toHaveTextContent('8');
  });

  it('fills the ring with the share of hours given', () => {
    renderInList(6, 2);
    expect(screen.getByRole('progressbar', { hidden: true })).toHaveAttribute('aria-valuenow', '75');
  });

  it('keeps the ring out of the screen reader, which reads the numbers instead', () => {
    renderInList(1, 1);
    expect(screen.getByTestId('profile-time-shared-ring')).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws the ring in the community colour', () => {
    renderInList(1, 3);
    const fill = screen.getByTestId('profile-time-shared-ring').querySelector('.progress-circle__fill-circle');
    expect(fill?.getAttribute('class')).toContain('stroke-[var(--accent-strong)]');
  });
});
