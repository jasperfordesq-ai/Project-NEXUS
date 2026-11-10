// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FaceStack } from './FaceStack';

const PEOPLE = [
  { id: 1, name: 'Maeve Byrne', avatar_url: null },
  { id: 2, first_name: 'Tom', last_name: 'Walsh', avatar: null },
  { id: 3, name: 'Aoife', avatar_url: null },
  { id: 4, name: 'Seán', avatar_url: null },
];

describe('FaceStack', () => {
  it('shows at most the number of faces asked for', () => {
    render(<FaceStack people={PEOPLE} max={3} data-testid="face" />);
    expect(screen.getAllByTestId('face')).toHaveLength(3);
  });

  it('renders nothing when there is no one to show', () => {
    const { container } = render(<FaceStack people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden from screen readers when the people are named in text beside it', () => {
    const { container } = render(<FaceStack people={PEOPLE} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('is one picture with the given words when it carries the names itself', () => {
    render(<FaceStack people={PEOPLE} label="Going: Maeve and Tom" />);
    expect(screen.getByRole('img', { name: 'Going: Maeve and Tom' })).toBeInTheDocument();
  });
});
