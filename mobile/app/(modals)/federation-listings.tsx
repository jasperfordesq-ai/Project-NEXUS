// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import FederationDirectoryScreen from '@/components/federation/FederationDirectoryScreen';
import { withRouteGate } from '@/components/withRouteGate';

function FederationListingsScreen() {
  return <FederationDirectoryScreen mode="listings" />;
}

export default withRouteGate(FederationListingsScreen, 'federation-listings');
