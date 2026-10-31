// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Canonical off-platform URLs.
 *
 * 🔴 The repository URL is legally load-bearing: AGPL-3.0 Section 7(b) requires
 * the running application to link to its source. Tests in Footer, Layout,
 * MobileDrawer and SourceRepositoryLink assert it, and the Laravel and web-uk
 * accessible frontends render the same URL from their own templates — change it
 * here and you must change it there too.
 *
 * The documentation site is on its own domain deliberately. It used to live at a
 * URL derived from the GitHub repository name, which meant renaming the
 * repository broke every link to it with no redirect. Keep it on the domain.
 */
export const PROJECT_NEXUS_REPO_URL = 'https://github.com/jasperfordesq-ai/Project-NEXUS';

export const PROJECT_NEXUS_DOCS_URL = 'https://docs.project-nexus.ie/';

/**
 * The native Android app on Google Play.
 *
 * 🔴 There is ONE Android app for every community on the platform — package
 * `ie.project.nexus`, published as "Timebank Global" — not one per tenant. A
 * member downloads that single app and chooses their community on first open,
 * so this URL is deliberately NOT derived from tenant branding. The same
 * package id is quoted in the Play compliance pages' copy; keep them in step.
 *
 */
export const ANDROID_APP_PACKAGE_ID = 'ie.project.nexus';

export const ANDROID_PLAY_STORE_URL =
  `https://play.google.com/store/apps/details?id=${ANDROID_APP_PACKAGE_ID}`;

/**
 * The same app on Apple's App Store (iPhone and iPad), approved and released
 * on 2026-10-31 as version 1.12.0. App Store Connect app id 6823712395, bundle
 * id `ie.project.nexus` — the same single all-communities app as the Android
 * one above.
 *
 * Deliberately has no country segment (`/ie/`, `/us/`): apps.apple.com
 * redirects to the visitor's own storefront, and on an iPhone or iPad the link
 * opens the App Store app directly.
 */
export const IOS_APP_STORE_ID = '6823712395';

export const IOS_APP_STORE_URL =
  `https://apps.apple.com/app/timebank-global/id${IOS_APP_STORE_ID}`;

/** The store name of the app, shown as published. A brand name — never translated. */
export const NATIVE_APP_STORE_NAME = 'Timebank Global';
