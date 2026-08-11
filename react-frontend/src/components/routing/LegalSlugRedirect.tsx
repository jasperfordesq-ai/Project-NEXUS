// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Navigate, useParams } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';

/**
 * Redirects `/legal/{slug}` to this app's own `/{slug}` legal page.
 *
 * 🔴 Why this exists. `LegalDocumentService::notifyUsersOfUpdate()` used to emit
 * two different link shapes for the same event: `/{slug}` in the notification
 * bell (React's shape) and `/legal/{slug}` in the email (the accessible
 * frontend's shape). Each was broken on the frontend the other targeted, so every
 * "we have updated our terms" notification dead-ended for somebody depending on
 * which link they clicked.
 *
 * Both now emit `/legal/{slug}`, which is the accessible frontend's real path and
 * Laravel's own route name. This is React's side of that convergence: it keeps one
 * implementation per legal page rather than registering each of them twice.
 *
 * Underscores are accepted and normalised, because `legal_documents.slug` falls
 * back to the underscored `document_type` and links carrying
 * `community_guidelines` have already been sent.
 */
const KNOWN_SLUGS = new Set([
  'terms',
  'privacy',
  'cookies',
  'accessibility',
  'community-guidelines',
  'acceptable-use',
]);

interface LegalSlugRedirectProps {
  /** Appended to the target, so `/legal/terms/versions` keeps its sub-page. */
  suffix?: string;
}

export function LegalSlugRedirect({ suffix = '' }: LegalSlugRedirectProps) {
  const { slug } = useParams<{ slug: string }>();
  const { tenantPath } = useTenant();

  const normalised = String(slug ?? '')
    .toLowerCase()
    .replace(/_/g, '-');

  // An unknown slug goes to the hub rather than 404ing: the member was sent here
  // by a notification about a real document, so the hub is a better answer than
  // nothing.
  if (!KNOWN_SLUGS.has(normalised)) {
    return <Navigate to={tenantPath('/legal')} replace />;
  }

  return <Navigate to={tenantPath(`/${normalised}${suffix}`)} replace />;
}

export default LegalSlugRedirect;
