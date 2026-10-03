// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerBreadcrumbContext — lets a detail page name the record it shows.
 *
 * The breadcrumbs are built from the URL, which only knows a record by its
 * id. A detail page that has loaded its record calls
 * `useBrokerBreadcrumbLabel(name)` and the current crumb reads the name
 * instead of `#42`; while the page is still loading (null) the id is shown.
 *
 * Works without the provider too (the default is a no-op), so a component
 * rendered outside the broker shell — or in a unit test — never throws.
 */

import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

interface BrokerBreadcrumbContextValue {
  /** The current record's display name, or null when none has been set. */
  label: string | null;
  setLabel: (label: string | null) => void;
}

const BrokerBreadcrumbContext = createContext<BrokerBreadcrumbContextValue>({
  label: null,
  setLabel: () => {},
});

export function BrokerBreadcrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabelState] = useState<string | null>(null);
  const setLabel = useCallback((next: string | null) => {
    setLabelState(next && next.trim() ? next.trim() : null);
  }, []);
  const value = useMemo(() => ({ label, setLabel }), [label, setLabel]);
  return <BrokerBreadcrumbContext.Provider value={value}>{children}</BrokerBreadcrumbContext.Provider>;
}

/** Read the record name a detail page has set (null when none). */
export function useBrokerBreadcrumbRecordLabel(): string | null {
  return use(BrokerBreadcrumbContext).label;
}

/**
 * Name the record the current detail page shows. Pass null until it has
 * loaded; the name is cleared again when the page unmounts.
 *
 *   const { data } = ...;
 *   useBrokerBreadcrumbLabel(data ? data.title : null);
 */
export function useBrokerBreadcrumbLabel(label: string | null): void {
  const { setLabel } = use(BrokerBreadcrumbContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(null);
  }, [label, setLabel]);
}

export default BrokerBreadcrumbContext;
