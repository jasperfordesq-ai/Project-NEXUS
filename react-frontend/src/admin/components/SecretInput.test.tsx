// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecretInput } from './SecretInput';

describe('SecretInput', () => {
  it('is masked and tells password managers not to fill it', () => {
    render(<SecretInput aria-label="API key" value="" onValueChange={() => undefined} />);
    const input = screen.getByLabelText('API key');

    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveAttribute('data-1p-ignore', 'true');
    expect(input).toHaveAttribute('data-lpignore', 'true');
    expect(input).toHaveAttribute('data-bwignore', 'true');
    expect(input).toHaveAttribute('data-form-type', 'other');
  });

  it('can be revealed as plain text without losing the fill guard', () => {
    render(<SecretInput aria-label="API key" type="text" value="" onValueChange={() => undefined} />);
    const input = screen.getByLabelText('API key');

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
  });

  it('cannot be switched back to a fillable field by a caller', () => {
    render(<SecretInput aria-label="API key" autoComplete="current-password" value="" onValueChange={() => undefined} />);

    expect(screen.getByLabelText('API key')).toHaveAttribute('autocomplete', 'new-password');
  });
});
