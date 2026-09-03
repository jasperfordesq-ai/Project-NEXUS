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
 * There is no App Store equivalent yet. Do not add one speculatively: the
 * install page reads the presence of a URL as "this store has the app", and a
 * dead link there is worse than the honest "not yet" it renders instead.
 */
export const ANDROID_APP_PACKAGE_ID = 'ie.project.nexus';

export const ANDROID_PLAY_STORE_URL =
  `https://play.google.com/store/apps/details?id=${ANDROID_APP_PACKAGE_ID}`;
