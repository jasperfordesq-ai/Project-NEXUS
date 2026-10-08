// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member import window. One component, one `step`:
 * choose → checking → (file_error | problems | ready) → running → finished.
 * Nothing is imported until the whole file has passed the server's check; the
 * import itself is driven batch by batch by useMemberImportRunner.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FileUp from 'lucide-react/icons/file-up';
import { Modal, ModalBody, ModalContent, ModalHeader, Spinner } from '@/components/ui';
import { useToast } from '@/contexts';
import { adminMemberImport } from '@/admin/api/adminApi';
import { fileToBase64 } from './csvFiles';
import { ImportChoose } from './ImportChoose';
import { ImportFileError, ImportProblemList } from './ImportProblems';
import { ImportReady } from './ImportReady';
import { ImportProgress } from './ImportProgress';
import { ImportFinished } from './ImportFinished';
import { useMemberImportRunner } from './useMemberImportRunner';
import type { CheckResult } from './types';

type Step = 'choose' | 'checking' | 'file_error' | 'problems' | 'ready' | 'running';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called on close when at least one member was created, so the member list can refresh. */
  onImported: () => void;
}

export function MemberImportModal({ isOpen, onClose, onImported }: Props) {
  const { t } = useTranslation('admin_users');
  const toast = useToast();
  const runner = useMemberImportRunner();
  const [step, setStep] = useState<Step>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);

  const phase = runner.state.phase;
  const finished = step === 'running' && (phase === 'completed' || phase === 'stopped' || phase === 'failed');
  const running = step === 'running' && !finished;
  // Closing while a check or an import is in flight would leave the admin without the result.
  const locked = step === 'checking' || running;

  const chooseAnother = () => { setFile(null); setCheck(null); setStep('choose'); };

  const downloadTemplate = async () => {
    try {
      await adminMemberImport.downloadTemplate();
    } catch {
      toast.error(t('member_import.template_failed'));
    }
  };

  const runCheck = async () => {
    if (!file) return;
    setStep('checking');
    let response;
    try {
      response = await adminMemberImport.check(file.name, await fileToBase64(file));
    } catch {
      response = null;
    }
    if (!response?.success || !response.data) {
      toast.error(t(response?.code === 'RATE_LIMIT_EXCEEDED' ? 'member_import.check_rate_limited' : 'member_import.check_failed'));
      setStep('choose');
      return;
    }
    setCheck(response.data);
    setIdentityChecked(false);
    setStep(response.data.status === 'ready' ? 'ready' : response.data.status === 'problems' ? 'problems' : 'file_error');
  };

  const startImport = () => {
    if (!check?.import_id || !check.summary) return;
    runner.start(check.import_id, check.summary.rows, check.admission?.requires_identity_check ? identityChecked : false);
    setStep('running');
  };

  const close = () => {
    if (locked) return;
    if (finished && runner.state.created > 0) onImported();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} size="2xl" scrollBehavior="inside"
      isDismissable={!locked} isKeyboardDismissDisabled={locked} hideCloseButton={locked || finished}>
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <FileUp size={20} aria-hidden="true" />
          {running ? t('member_import.running.title') : t('member_import.title')}
        </ModalHeader>

        {step === 'choose' && (
          <ImportChoose file={file} onFile={setFile} onCheck={runCheck} onDownloadTemplate={downloadTemplate} onCancel={close} />
        )}
        {step === 'checking' && (
          <ModalBody>
            <div role="status" className="flex items-center gap-3 py-6">
              <Spinner size="md" />
              <span>{t('member_import.checking')}</span>
            </div>
          </ModalBody>
        )}
        {step === 'file_error' && check && (
          <ImportFileError error={check.file_error} onDownloadTemplate={downloadTemplate} onChooseAnother={chooseAnother} />
        )}
        {step === 'problems' && check && <ImportProblemList check={check} onChooseAnother={chooseAnother} />}
        {step === 'ready' && check && (
          <ImportReady check={check} identityChecked={identityChecked} onIdentityChange={setIdentityChecked}
            onImport={startImport} onCancel={close} />
        )}
        {running && <ImportProgress state={runner.state} onStop={runner.stop} />}
        {finished && check && <ImportFinished state={runner.state} check={check} onClose={close} />}
      </ModalContent>
    </Modal>
  );
}

export default MemberImportModal;
