// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


import { useTranslation } from 'react-i18next';
import Share from 'lucide-react/icons/share';
import Plus from 'lucide-react/icons/plus';
import Smartphone from 'lucide-react/icons/smartphone';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';

interface IosInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IosInstallModal({ isOpen, onClose }: IosInstallModalProps) {
  const { t } = useTranslation('common');

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center" size="md" backdrop="blur">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('install.ios_title')}
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-theme-muted">
            {t('install.ios_intro')}
          </p>
          <ol className="space-y-3 mt-2">
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent-soft-foreground text-xs font-semibold inline-flex items-center justify-center">1</span>
              <span className="text-sm">
                {t('install.ios_step_1')} <Share className="inline w-4 h-4 mx-0.5 align-text-bottom" aria-hidden="true" /> {t('install.ios_step_1_after')}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent-soft-foreground text-xs font-semibold inline-flex items-center justify-center">2</span>
              <span className="text-sm">
                {t('install.ios_step_2')} <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-theme-elevated"><Plus className="w-3.5 h-3.5" aria-hidden="true" />{t('install.ios_add_to_home')}</span>{t('install.ios_step_2_after')}
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent-soft-foreground text-xs font-semibold inline-flex items-center justify-center">3</span>
              <span className="text-sm">
                {t('install.ios_step_3')}
              </span>
            </li>
          </ol>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            {t('install.got_it')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default IosInstallModal;
