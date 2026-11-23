// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HowToPayEditor
 * Where whoever is paid writes their one "how to pay" note: the platform team
 * for the platform (Billing control), a parent community's manager for the
 * communities that pay it (Branch plans). Owner decision, 23 Nov 2026.
 *
 * The note is plain text. The server keeps it as written, never as markup,
 * and shows it to the communities that pay this payee: on their Billing page,
 * on their admin warning line and in their payment emails
 * (App\Support\Billing\HowToPay).
 *
 * `PlatformHowToPayDialog` is the same editor in a dialog, loading the
 * platform's note itself.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Modal, ModalBody, ModalContent, ModalHeader, Spinner, Textarea } from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/helpers';

/** What both note addresses answer with. */
interface NoteAnswer {
  how_to_pay: string | null;
  how_to_pay_max: number;
}

interface HowToPayEditorProps {
  /** Who reads the note: decides the sentence that says where it is shown. */
  audience: 'platform' | 'parent';
  /** The note as saved; null when none has been written. */
  note: string | null;
  /** Longest note the server takes, in characters. */
  max: number;
  /** The address the note is saved to (PUT `{ note }`). */
  saveUrl: string;
  onSaved?: (note: string | null) => void;
}

export function HowToPayEditor({ audience, note, max, saveUrl, onSaved }: HowToPayEditorProps) {
  const { t } = useTranslation('admin_billing');
  const toast = useToast();

  const [saved, setSaved] = useState(note ?? '');
  const [draft, setDraft] = useState(note ?? '');
  const [saving, setSaving] = useState(false);

  // Another payee was chosen, or the page loaded its note: start from that.
  useEffect(() => {
    setSaved(note ?? '');
    setDraft(note ?? '');
  }, [note, saveUrl]);

  const length = Array.from(draft.trim()).length;
  const tooLong = length > max;
  const changed = draft.trim() !== saved.trim();

  const save = async () => {
    setSaving(true);
    const text = draft.trim();
    const response = await api.put<NoteAnswer>(saveUrl, { note: text === '' ? null : text });
    setSaving(false);

    if (response.success && response.data) {
      const now = response.data.how_to_pay ?? '';
      setSaved(now);
      setDraft(now);
      toast.success(now === '' ? t('control.how_to_pay_removed') : t('control.how_to_pay_saved'));
      onSaved?.(response.data.how_to_pay);
      return;
    }

    // The draft stays on screen so it can be corrected.
    // admin-i18n-ignore: localized server message — AdminSuperController::saveHowToPay refusals (lang/*/api.php)
    toast.error(response.error || t('control.how_to_pay_save_failed'));
  };

  return (
    <div data-testid="how-to-pay-editor" className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {audience === 'platform' ? t('control.how_to_pay_help_platform') : t('control.how_to_pay_help_parent')}
      </p>

      {saved === '' ? (
        <Alert color="warning">
          <span>{t('control.how_to_pay_none_yet')}</span>
        </Alert>
      ) : null}

      <Textarea
        label={t('own_billing.how_to_pay_title')}
        placeholder={t('control.how_to_pay_placeholder')}
        value={draft}
        onValueChange={setDraft}
        minRows={5}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          data-testid="how-to-pay-count"
          role={tooLong ? 'alert' : undefined}
          className={`text-xs ${tooLong ? 'font-semibold text-danger' : 'text-muted'}`}
        >
          {t('control.how_to_pay_count', { used: formatNumber(length), max: formatNumber(max) })}
        </p>
        <Button onPress={() => void save()} isLoading={saving} isDisabled={!changed || tooLong || saving}>
          {t('control.how_to_pay_save')}
        </Button>
      </div>
    </div>
  );
}

const PLATFORM_URL = '/v2/admin/super/billing/how-to-pay';

interface PlatformHowToPayDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The platform's own note, in a dialog on Billing control. Platform team only. */
export function PlatformHowToPayDialog({ isOpen, onClose }: PlatformHowToPayDialogProps) {
  const { t } = useTranslation('admin_billing');
  const [answer, setAnswer] = useState<NoteAnswer | 'failed' | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    setAnswer(null);
    void api.get<NoteAnswer>(PLATFORM_URL).then((response) => {
      if (!alive) return;
      setAnswer(response.success && response.data && typeof response.data === 'object' ? response.data : 'failed');
    });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalContent>
        <ModalHeader>{t('control.how_to_pay_edit_title')}</ModalHeader>
        <ModalBody className="pb-6">
          {answer === null ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-6">
              <Spinner size="md" />
            </div>
          ) : answer === 'failed' ? (
            <Alert color="danger" role="alert">
              <span>{t('control.how_to_pay_load_failed')}</span>
            </Alert>
          ) : (
            <HowToPayEditor
              audience="platform"
              note={answer.how_to_pay}
              max={answer.how_to_pay_max}
              saveUrl={PLATFORM_URL}
              onSaved={(note) => setAnswer({ ...answer, how_to_pay: note })}
            />
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default HowToPayEditor;
