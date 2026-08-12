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
