// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Feature Gate Component
 * Conditionally renders content based on tenant feature flags or module flags
 *
 * Supports two modes:
 * - feature: checks TenantFeatures (optional add-ons like gamification, goals)
 * - module: checks TenantModules (core modules like listings, wallet, messages)
 *
 * When both are provided, both must be enabled.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import type { TenantFeatures, TenantModules } from '@/types';

interface FeatureGateProps {
  /**
   * The feature flag to check (optional add-on features)
   */
  feature?: keyof TenantFeatures;
  /** Additional feature switches; all must be enabled. */
  features?: readonly (keyof TenantFeatures)[];

  /**
   * The module flag to check (core platform modules)
   */
  module?: keyof TenantModules;

  /**
   * Content to render if feature/module is enabled
   */
  children: ReactNode;

  /**
   * Content to render if feature/module is disabled (optional)
   * If not provided and redirect is not set, nothing is rendered
   */
  fallback?: ReactNode;

  /**
   * Path to redirect to if feature/module is disabled (optional)
   * Takes precedence over fallback
   */
  redirect?: string;
}

export function FeatureGate({
  feature,
  features,
  module,
  children,
  fallback = null,
  redirect,
}: FeatureGateProps) {
  const { hasFeature, hasModule, isLoading, tenantPath } = useTenant();

  // Do not mount protected pages or start their effects before config resolves.
  if (isLoading) {
    return null;
  }

  // Check if feature or module is enabled
  const isEnabled = (!feature || hasFeature(feature))
    && (!features || features.every(hasFeature))
    && (!module || hasModule(module));

  if (!isEnabled) {
    if (redirect) {
      return <Navigate to={tenantPath(redirect)} replace />;
    }
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default FeatureGate;
