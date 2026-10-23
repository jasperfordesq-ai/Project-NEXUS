// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Helmet } from 'react-helmet-async';

/**
 * Tell the crawler-copy renderer which HTTP status this page should be served
 * with (`<meta name="prerender-status-code">`, read by the prerender worker and
 * applied by nginx). Without it a "not found" page is saved and served as 200,
 * which search engines treat as a soft 404.
 *
 * Render it ONLY when the server confirmed the record is missing — never for a
 * loading state or a server/network error (see `isNotFoundResponse`).
 */
export function PrerenderStatusCode({ code }: { code: 404 | 410 | 503 }) {
  return (
    <Helmet>
      <meta name="prerender-status-code" content={String(code)} />
    </Helmet>
  );
}
