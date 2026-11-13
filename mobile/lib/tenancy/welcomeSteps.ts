// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's choice on Admin → Welcome steps, as the community settings
 * carry it (`settings.onboarding_enabled`, `settings.onboarding_mandatory`).
 *
 * Three states, and only three:
 *  - switched off: nobody is sent to the welcome steps or invited to them;
 *  - offered: members use the app straight away and may open the steps when
 *    they wish;
 *  - must finish: members are taken to the steps before anything else.
 *
 * A missing setting means "on and compulsory" — how the app behaved before the
 * settings existed, and the safe reading while the settings are still loading
 * or came from an older server. The website's copy of this rule is
 * `react-frontend/src/lib/welcomeSteps.ts`; the server's is
 * `OnboardingConfigService::isMandatory()`.
 */

type CommunitySettings = Record<string, unknown> | null | undefined;

/** False only when the community has switched the welcome steps off. */
export function welcomeStepsSwitchedOn(settings: CommunitySettings): boolean {
  return settings?.onboarding_enabled !== false;
}

/** True when members must finish the welcome steps before using the app. */
export function welcomeStepsMustBeFinished(settings: CommunitySettings): boolean {
  return welcomeStepsSwitchedOn(settings) && settings?.onboarding_mandatory !== false;
}

/**
 * Where a member lands straight after signing in. Only a member who has not
 * finished steps their community requires goes to them; everyone else goes Home.
 */
export function routeAfterSignIn(
  onboardingCompleted: boolean | null | undefined,
  settings: CommunitySettings,
): '/(modals)/onboarding' | '/(tabs)/home' {
  return onboardingCompleted === false && welcomeStepsMustBeFinished(settings)
    ? '/(modals)/onboarding'
    : '/(tabs)/home';
}
