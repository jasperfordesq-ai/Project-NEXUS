// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { responsiveActionStyle } from './responsiveActions';

describe('responsiveActionStyle', () => {
  it('uses two readable columns on an ordinary phone', () => {
    expect(responsiveActionStyle(360, 1)).toEqual({ flexBasis: '47%', flexGrow: 1 });
  });

  it('uses one column in a narrow window', () => {
    expect(responsiveActionStyle(319, 1)).toEqual({ flexBasis: '100%', flexGrow: 1 });
  });

  it('uses one column when the user enables large text', () => {
    expect(responsiveActionStyle(360, 1.31)).toEqual({ flexBasis: '100%', flexGrow: 1 });
  });
});
