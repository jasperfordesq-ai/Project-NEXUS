// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { BrokerTabCount } from './BrokerTabCount';

describe('BrokerTabCount', () => {
  it('shows a plain total whatever its value, zero included', () => {
    render(<BrokerTabCount value={0} />);
    expect(screen.getByText('0').closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
  });

  it('groups thousands, so a large community reads as 1,248 and not 1248', () => {
    render(<BrokerTabCount value={1248} />);
    expect(screen.getByText(/1.248/)).toBeInTheDocument();
  });

  // An amber or red "0" reads as work waiting. A list that should fall to
  // zero shows no number at all once it has.
  it('shows nothing for a waiting list with nothing in it', () => {
    const { container } = render(
      <>
        <BrokerTabCount value={0} tone="warning" />
        <BrokerTabCount value={0} tone="danger" />
      </>,
    );
    expect(container.querySelector('[data-tone]')).toBeNull();
  });

  it('shows the number waiting, in the tone it was given', () => {
    render(
      <>
        <BrokerTabCount value={3} tone="warning" />
        <BrokerTabCount value={2} tone="danger" />
      </>,
    );
    expect(screen.getByText('3').closest('[data-tone]')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByText('2').closest('[data-tone]')).toHaveAttribute('data-tone', 'danger');
  });

  // A count that could not be read is not zero. Nothing is drawn, so a failed
  // request can never look like an empty list.
  it('shows nothing while the count is unknown', () => {
    const { container } = render(
      <>
        <BrokerTabCount value={null} />
        <BrokerTabCount value={undefined} tone="warning" />
        <BrokerTabCount value={Number.NaN} />
      </>,
    );
    expect(container.querySelector('[data-tone]')).toBeNull();
  });
});
