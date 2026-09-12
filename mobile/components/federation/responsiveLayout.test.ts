// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { responsiveFederationActionStyle } from './responsiveLayout';

describe('responsiveFederationActionStyle', () => {
  it('uses two readable columns at a standard phone width', () => {
    expect(responsiveFederationActionStyle(360, 1)).toEqual({
      flexBasis: '47%',
      flexGrow: 1,
    });
  });

  it('uses full-width actions on narrow screens and with large text', () => {
    expect(responsiveFederationActionStyle(319, 1).flexBasis).toBe('100%');
    expect(responsiveFederationActionStyle(360, 1.31).flexBasis).toBe('100%');
  });
});
