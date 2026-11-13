// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — API Keys
 *
 * Wraps the admin ApiKeys module and hosts the create flow in a modal
 * instead of a separate page: the list's "Create key" buttons open the
 * embedded CreateApiKey form (onDone closes it and bumps refreshToken so
 * the list reloads). The standalone /api-keys/create route remains as a
 * deep-linkable fallback but is no longer part of the primary flow.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import KeyRound from 'lucide-react/icons/key-round';
import ApiKeys from '@/admin/modules/federation/ApiKeys';
import CreateApiKey from '@/admin/modules/federation/CreateApiKey';
import { Modal, ModalContent, ModalHeader, ModalBody } from '@/components/ui';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function ApiKeysPage() {
  const { t } = useTranslation(['partners', 'admin_federation']);
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const closeCreate = () => {
    setCreateOpen(false);
    setRefreshToken((n) => n + 1);
  };

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('partners:pages.api_keys.title')}
      description={t('partners:pages.api_keys.description')}
      icon={KeyRound}
      color="warning"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <ApiKeys onCreateClick={() => setCreateOpen(true)} refreshToken={refreshToken} />
      </AdminEmbed>

      <Modal isOpen={createOpen} onClose={closeCreate} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <KeyRound size={20} className="text-warning" aria-hidden="true" />
            {t('admin_federation:federation.create_api_key_title')}
          </ModalHeader>
          <ModalBody className="pb-6">
            <CreateApiKey onDone={closeCreate} />
          </ModalBody>
        </ModalContent>
      </Modal>
    </PartnersPageShell>
  );
}
