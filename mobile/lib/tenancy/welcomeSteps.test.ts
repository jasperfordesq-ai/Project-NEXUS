// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { welcomeStepsMustBeFinished, welcomeStepsSwitchedOn } from './welcomeSteps';

describe('welcomeStepsSwitchedOn', () => {
  it('is on when the community has said nothing (older server, or still loading)', () => {
    expect(welcomeStepsSwitchedOn(undefined)).toBe(true);
    expect(welcomeStepsSwitchedOn(null)).toBe(true);
    expect(welcomeStepsSwitchedOn({})).toBe(true);
  });

  it('is off only for a literal false', () => {
    expect(welcomeStepsSwitchedOn({ onboarding_enabled: false })).toBe(false);
    expect(welcomeStepsSwitchedOn({ onboarding_enabled: true })).toBe(true);
  });
});

describe('welcomeStepsMustBeFinished', () => {
  it('needs both: switched on, and compulsory', () => {
    expect(welcomeStepsMustBeFinished({ onboarding_enabled: true, onboarding_mandatory: true })).toBe(true);
    expect(welcomeStepsMustBeFinished({ onboarding_enabled: true, onboarding_mandatory: false })).toBe(false);
  });

  // The admin page could once save "off" with "must finish" still on.
  it('is never compulsory while the steps are switched off', () => {
    expect(welcomeStepsMustBeFinished({ onboarding_enabled: false, onboarding_mandatory: true })).toBe(false);
  });

  it('is compulsory by default, as it was before the settings existed', () => {
    expect(welcomeStepsMustBeFinished(undefined)).toBe(true);
    expect(welcomeStepsMustBeFinished({ region: 'IE' })).toBe(true);
  });
});
