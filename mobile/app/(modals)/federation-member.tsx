// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import MemberProfileScreen from './member-profile';
import { withRouteGate } from '@/components/withRouteGate';

export default withRouteGate(MemberProfileScreen, 'federation-member');
