// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Linking } from 'react-native';

import { buildWebUrl } from '@/lib/utils/webUrl';

type PaymentResult =
  | { status: 'completed' }
  | { status: 'canceled' }
  | { status: 'failed'; message?: string }
  | { status: 'redirected' };

interface PresentIdentityPaymentOptions {
  clientSecret: string;
  publishableKey?: string;
  merchantDisplayName: string;
  /**
   * The member's community slug. 🔴 Without it the hand-off lands on the
   * platform landing page on the shared host and the member never reaches
   * verification — see lib/utils/webUrl.ts.
   */
  tenantSlug?: string | null;
}

export async function presentIdentityPayment(options: PresentIdentityPaymentOptions): Promise<PaymentResult> {
  await Linking.openURL(buildWebUrl(options.tenantSlug, '/settings/verify-identity'));
  return { status: 'redirected' };
}
