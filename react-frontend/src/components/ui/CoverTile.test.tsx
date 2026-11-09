// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import Building2 from 'lucide-react/icons/building-2';
import { render, screen } from '@/test/test-utils';
import { CoverTile } from './CoverTile';
import { DetailCover } from './DetailCover';
import { coverSeed } from '@/lib/coverSeeds';

describe('CoverTile', () => {
  it('matches the colour of the item\'s page when it has no logo', () => {
    render(<CoverTile seed={coverSeed.organisation(5)} icon={Building2} name="Green Org" className="h-12 w-12" data-testid="tile" />);
    render(<DetailCover seed={coverSeed.organisation(5)} icon={Building2} data-testid="page" />);
    const tile = screen.getByTestId('tile');
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile.getAttribute('data-colour')).toBe(screen.getByTestId('page').getAttribute('data-colour'));
  });

  it('shows the logo instead when there is one', () => {
    render(<CoverTile seed={coverSeed.organisation(5)} icon={Building2} imageUrl="/uploads/logo.png" name="Green Org" className="h-12 w-12" data-testid="tile" />);
    expect(screen.queryByTestId('tile')).toBeNull();
  });
});
