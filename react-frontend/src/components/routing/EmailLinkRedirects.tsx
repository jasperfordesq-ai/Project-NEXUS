// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Addresses that emails have sent members to but that are not pages.
 *
 * An email cannot be recalled once sent, so fixing the server only helps
 * emails sent afterwards. These routes catch the old shapes and forward the
 * member to the page that was meant, so links already in inboxes keep working.
 * Audit of every email link, 27 October 2026.
 */

import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/feedback/LoadingScreen';
import { api } from '@/lib/api';
import { extractCollectionItems } from '@/pages/volunteering/extractCollectionItems';

/**
 * Forward to `target`, filling `:param` placeholders from the matched route and
 * keeping the link's query string and fragment.
 */
export function EmailLinkRedirect({ target, keepQuery = true }: { target: string; keepQuery?: boolean }) {
  const { tenantPath } = useTenant();
  const params = useParams<Record<string, string | undefined>>();
  const location = useLocation();
  const resolved = Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value ?? '')),
    target,
  );
  const suffix = keepQuery ? mergeQuery(resolved, location.search) + location.hash : '';
  const [targetPath = resolved] = resolved.split('?');
  return <Navigate to={tenantPath(targetPath) + suffix} replace />;
}

/** The target's own query, plus whatever the link carried. */
function mergeQuery(target: string, linkSearch: string): string {
  const [, targetQuery = ''] = target.split('?');
  const merged = new URLSearchParams(targetQuery);
  new URLSearchParams(linkSearch).forEach((value, key) => {
    if (!merged.has(key)) merged.set(key, value);
  });
  const query = merged.toString();
  return query ? `?${query}` : '';
}

/**
 * `/marketplace/orders/{id}` — order emails linked to a single-order page that
 * does not exist. Send the member to the list that holds the order: their
 * sales if they are the seller, their purchases otherwise.
 */
export function MarketplaceOrderLinkRedirect() {
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const orderId = Number(id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      setTarget('/marketplace/orders');
      return;
    }
    void api
      .get<{ seller?: { id?: number } | null }>(`/v2/marketplace/orders/${orderId}`)
      .then((response) => {
        if (cancelled) return;
        const sellerId = response.success ? response.data?.seller?.id : undefined;
        setTarget(sellerId !== undefined && sellerId === user?.id ? '/marketplace/orders/sales' : '/marketplace/orders');
      })
      .catch(() => {
        if (!cancelled) setTarget('/marketplace/orders');
      });
    return () => {
      cancelled = true;
    };
  }, [id, user?.id]);

  if (!target) return <LoadingScreen />;
  return <Navigate to={tenantPath(target)} replace />;
}

/**
 * `/volunteer-org/wallet` — low-balance alerts linked here without saying which
 * organisation. Open the wallet of the one organisation the member manages;
 * with several (or none, or an error), the list of their organisations.
 */
export function OrganisationWalletLinkRedirect() {
  const { tenantPath } = useTenant();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<unknown>('/v2/volunteering/my-organisations')
      .then((response) => {
        if (cancelled) return;
        const managed = response.success && response.data
          ? extractCollectionItems<{ id: number; member_role?: string }>(response.data)
            .filter((org) => org.member_role === 'owner' || org.member_role === 'admin')
          : [];
        const [only] = managed;
        setTarget(managed.length === 1 && only
          ? `/volunteering/org/${only.id}/dashboard?tab=wallet`
          : '/volunteering/my-organisations');
      })
      .catch(() => {
        if (!cancelled) setTarget('/volunteering/my-organisations');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) return <LoadingScreen />;
  return <Navigate to={tenantPath(target)} replace />;
}
