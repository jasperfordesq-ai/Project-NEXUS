// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Classes for the six boxes of a 6-digit authenticator code (HeroUI InputOTP.Slot).
 *
 * This theme sets the field fill to near-white and the field border width to
 * zero, so HeroUI's own slots (either variant) were all but invisible on a
 * white card or dialog. These give each box the same border and fill tokens the
 * rest of the site uses, in light and dark, with the focus colour on the box
 * being typed into.
 */
export const OTP_SLOT_CLASS =
  'border border-[var(--border-hover)] bg-[var(--surface-base)] data-[active=true]:border-[var(--border-focus)]';
