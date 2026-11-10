// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The site's few shared movements (warmth plan P6). Each component used to
 * write its own fade-up with its own distance and timing; use these instead so
 * the site moves one way: small, quick, and never in the way.
 *
 * Reduced motion needs nothing extra here: the shim runs on CSS transitions,
 * and index.css / tokens.css cut every transition to nothing when the device
 * or the member asks for less movement. The hover lift on cards is plain CSS
 * (`.glass-card-hover` in styles/glass.css) with its own reduced-motion rule.
 */

import type { Transition, Variants } from './index';

/** How long an entrance takes, and how it eases. */
export const ENTER: Transition = { duration: 0.3, ease: 'easeOut' };

/** Something arriving: fades in while rising a little. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

/** Something arriving in place: fades in only (for items that must not shift). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/** A list whose items arrive one after another; give the items `fadeUp`. */
export const staggerList: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
