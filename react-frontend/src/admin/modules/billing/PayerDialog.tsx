// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PayerDialog
 * The platform team sets how a community pays: by card, by invoice or bank
 * transfer, through its parent, or not at all. "The usual way" sends
 * `payer: null`, which hands the choice back to the server's own rule
 * (BillingStandingService::defaultPayer()).
 *
 * The usual choice comes first and says what it means for this community. A
 * choice that cannot be made says why, and "by card" says that choosing it
 * does not set a card up (23 Nov 2026).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Radio,
  RadioGroup,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';

export type Payer = 'platform_card' | 'platform_invoice' | 'parent' | 'not_billed';

const PAYERS: Payer[] = ['platform_card', 'platform_invoice', 'parent', 'not_billed'];

/** The radio value standing for "no choice stored"; sent to the server as null. */
const DEFAULT_CHOICE = 'default';

export interface PayerCommunity {
  id: number;
  name: string;
  payer: Payer;
  payerIsDefault: boolean;
  /** Only a community whose parent is below the platform can pay its parent. */
  canPayParent: boolean;
}

interface PayerDialogProps {
  /** null keeps the dialog closed. */
  community: PayerCommunity | null;
  onClose: () => void;
  /** Called after the server accepted the change; the caller closes and reloads. */
  onSaved: () => void;
}

export function PayerDialog({ community, onClose, onSaved }: PayerDialogProps) {
  const { t } = useTranslation('admin_billing');
  const toast = useToast();

  const [choice, setChoice] = useState<string>(DEFAULT_CHOICE);
  const [saving, setSaving] = useState(false);

  const communityId = community?.id ?? null;
  const storedChoice = community ? (community.payerIsDefault ? DEFAULT_CHOICE : community.payer) : DEFAULT_CHOICE;

  useEffect(() => {
    if (communityId === null) return;
    setChoice(storedChoice);
  }, [communityId, storedChoice]);

  const save = async () => {
    if (!community) return;
    setSaving(true);
    const payer = PAYERS.find((p) => p === choice) ?? null;
    const response = await api.post('/v2/admin/super/billing/standing/payer', {
      tenant_id: community.id,
      payer,
    });
    setSaving(false);

    if (response.success) {
      toast.success(t('control.done_payer_set'));
      onSaved();
      return;
    }

    // admin-i18n-ignore: localized server message — AdminSuperController::setCommunityPayer refusals (lang/*/api.php)
    toast.error(response.error || t('billing.standing_failed'));
  };

  return (
    <Modal isOpen={community !== null} onClose={onClose} size="md">
      <ModalContent>
        <ModalHeader>
          {t('control.change_payer')}
          {community && (
            <span className="text-muted text-sm font-normal ml-2">
              — {community.name}
            </span>
          )}
        </ModalHeader>
        <ModalBody>
          <RadioGroup
            label={t('control.payer_label')}
            value={choice}
            onValueChange={setChoice}
          >
            {/* The usual choice first. When it is the one in force, it says
                what the platform's rule comes to for this community. */}
            <Radio
              value={DEFAULT_CHOICE}
              description={[
                t('control.payer_help_default'),
                community?.payerIsDefault
                  ? t('control.payer_default_now', { payer: t(`billing.payer_${community.payer}`) })
                  : null,
              ].filter((part) => part !== null).join(' ')}
            >
              {t('control.payer_default')}
            </Radio>
            {PAYERS.map((payer) => {
              const noParent = payer === 'parent' && community !== null && !community.canPayParent;
              return (
                <Radio
                  key={payer}
                  value={payer}
                  // A greyed-out choice says why, in place of what it would do.
                  description={noParent ? t('control.payer_parent_unavailable') : t(`control.payer_help_${payer}`)}
                  isDisabled={noParent}
                >
                  {t(`billing.payer_${payer}`)}
                </Radio>
              );
            })}
          </RadioGroup>
          {/* BillingStandingService::setPayer() restarts the payment warnings. */}
          <p className="mt-4 border-t border-divider pt-3 text-xs text-muted">{t('control.payer_change_note')}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
            {t('billing.cancel')}
          </Button>
          <Button onPress={() => void save()} isLoading={saving}>
            {t('control.save')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default PayerDialog;
