// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FadpConsentBanner
 *
 * Sticky bottom banner for Swiss FADP / nDSG deployments.
 * Shown when the tenant has the `fadp_compliance` feature enabled and the
 * member has not yet made an explicit profiling-consent decision this session.
 *
 * Consent decisions (grant or withdrawal) are recorded via
 * POST /v2/me/fadp/consent so they land in the consent ledger.
 */

import { useState } from 'react';

import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldOff from 'lucide-react/icons/shield-off';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth, useTenant } from '@/contexts';
import api from '@/lib/api';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';

const STORAGE_KEY_PREFIX = 'fadp_consented';

export function FadpConsentBanner() {
  const { t } = useTranslation('legal');
  const { isAuthenticated, user } = useAuth();
  const { hasFeature, tenant } = useTenant();
  const storageKey = `${STORAGE_KEY_PREFIX}:${tenant?.id}:${user?.id}`;

  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // The consent endpoint records a decision for a signed-in member only.
  if (!isAuthenticated || !user?.id || !tenant?.id || !hasFeature('fadp_compliance')) return null;
  if (dismissedKey === storageKey || safeLocalStorageGet(storageKey) === 'true') return null;

  const dismiss = () => {
    safeLocalStorageSet(storageKey, 'true');
    setDismissedKey(storageKey);
  };

  const handleConsent = async (action: 'granted' | 'withdrawn') => {
    setLoading(action === 'granted' ? 'accept' : 'decline');
    setSaveFailed(false);
    try {
      const result = await api.post('/v2/me/fadp/consent', {
        consent_type: 'profiling',
        action,
      });
      if (result.success) {
        dismiss();
        return;
      }
      setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div
      className="fixed bottom-[calc(5rem+var(--safe-area-bottom)+var(--miniplayer-offset,0rem))] left-0 right-0 z-[310] px-4 pt-2 pointer-events-none md:bottom-[calc(1rem+var(--miniplayer-offset,0rem))]"
      role="region"
      aria-label={t('fadp.fadp_banner_title')}
      data-nosnippet
    >
      <div className="max-w-3xl mx-auto pointer-events-auto">
        <Card className="border border-accent bg-[var(--color-surface)] shadow-lg">
          <Card.Content className="py-4 px-5">
            <div className="flex items-start gap-4">
              {/* Swiss flag-adjacent icon */}
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-danger-100 flex items-center justify-center mt-0.5">
                <ShieldCheck size={18} className="text-danger-600" />
              </div>

              {/* Text content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  {t('fadp.fadp_banner_title')}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                  {t('fadp.fadp_banner_body')}
                </p>
              </div>

              {/* Dismiss (no preference recorded) */}
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={dismiss}
                aria-label={t('common:common.dismiss')}
                className="mt-0.5 flex-shrink-0 text-muted"
              >
                <X size={16} />
              </Button>
            </div>

            {saveFailed && (
              <p className="mt-3 text-sm text-danger" role="alert">
                {t('common:errors.connection_failed_detail')}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mt-4 pl-13">
              <Button
                size="sm"
                color="primary"
                startContent={<ShieldCheck size={14} />}
                isLoading={loading === 'accept'}
                isDisabled={loading !== null}
                onPress={() => handleConsent('granted')}
              >
                {t('fadp.fadp_accept')}
              </Button>
              <Button
                size="sm"
                variant="bordered"
                startContent={<ShieldOff size={14} />}
                isLoading={loading === 'decline'}
                isDisabled={loading !== null}
                onPress={() => handleConsent('withdrawn')}
              >
                {t('fadp.fadp_decline')}
              </Button>
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}

export default FadpConsentBanner;
