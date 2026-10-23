import { getFormattingLocale } from '@/lib/helpers';
import { useDisclosure, Button, Spinner, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Redirects
 * Manage URL redirects for the platform (301/302).
 */

import { useState, useEffect, useCallback } from 'react';

import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { DataTable, type Column } from '../../components/DataTable';
import { ConfirmModal } from '../../components/ConfirmModal';
import { adminTools } from '../../api/adminApi';

interface Redirect {
  id: number;
  source_url: string;
  destination_url: string;
  hits: number;
  created_at: string;
}

export function Redirects() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const { t: tNav } = useTranslation('admin_nav');
  const { t: tAdmin } = useTranslation('admin_advanced');
  usePageTitle(tNav('advanced'));
  const toast = useToast();

  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add modal
  const { isOpen: isAddOpen, onOpen: onAddOpen, onClose: onAddClose } = useDisclosure();
  const [fromUrl, setFromUrl] = useState('');
  const [toUrl, setToUrl] = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Redirect | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchRedirects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTools.getRedirects();
      setRedirects(res.data ?? []);
    } catch {
      toast.error(t('failed_to_load_redirects'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    fetchRedirects();
  }, [fetchRedirects]);

  const handleAdd = async () => {
    if (!fromUrl.trim() || !toUrl.trim()) {
      toast.warning(t('both_from_u_r_l_and_to_u_r_l_are_required'));
      return;
    }
    setSaving(true);
    try {
      const res = await adminTools.createRedirect({
        source_url: fromUrl.trim(),
        destination_url: toUrl.trim(),
      });

      if (res.success) {
        toast.success(t('redirect_created'));
        setFromUrl('');
        setToUrl('');
        onAddClose();
        await fetchRedirects();
      } else {
        // The server says what is wrong (an invalid source address, a source
        // equal to its destination, a source that already redirects): show
        // that, and keep the form open so it can be corrected.
        // admin-i18n-ignore: localized server message — AdminToolsController redirect validation (lang/*/api.php)
        toast.error(res.error || t('failed_to_create_redirect'));
      }
    } catch {
      toast.error(t('failed_to_create_redirect'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminTools.deleteRedirect(deleteTarget.id);

      if (res.success) {
        toast.success(t('redirect_deleted'));
        setDeleteTarget(null);
        await fetchRedirects();
      } else {
        const error = t('failed_to_delete_redirect');
        toast.error(error);
      }
    } catch {
      toast.error(t('failed_to_delete_redirect'));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Redirect>[] = [
    { key: 'source_url', label: t('col_from_url'), sortable: true },
    { key: 'destination_url', label: t('col_to_url'), sortable: true },
    { key: 'hits', label: t('col_hits'), sortable: true },
    {
      key: 'created_at',
      label: t('col_created'),
      sortable: true,
      render: (item) => new Date(item.created_at).toLocaleDateString(getFormattingLocale()),
    },
    {
      key: 'actions',
      label: '',
      render: (item) => (
        <Button
          isIconOnly
          variant="danger"
          size="sm"
          onPress={() => setDeleteTarget(item)}
          aria-label={t('label_delete_redirect')}
        >
          <Trash2 size={16} />
        </Button>
      ),
    },
  ];

  if (loading) {
    return (
      <div>
        <PageHeader title={t('redirects_title')} description={t('redirects_desc')} />
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('redirects_title')}
        description={t('redirects_desc')}
        actions={
          <Button startContent={<Plus size={16} />} onPress={onAddOpen}>
            {t('add_redirect')}
          </Button>
        }
      />

      {redirects.length === 0 ? (
        <EmptyState
          icon={ArrowRightLeft}
          title={t('no_redirects')}
          description={t('no_redirects_desc')}
          actionLabel={t('add_redirect')}
          onAction={onAddOpen}
        />
      ) : (
        <DataTable
          columns={columns}
          data={redirects}
          searchable={false}
          onRefresh={fetchRedirects}
        />
      )}

      {/* Add Redirect Modal */}
      <Modal isOpen={isAddOpen} onClose={onAddClose} size="lg">
        <ModalContent>
          <ModalHeader>{t('add_redirect')}</ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label={t('col_from_url')}
              placeholder="/old-page"
              variant="secondary"
              value={fromUrl}
              onValueChange={setFromUrl}
              description={t('desc_the_u_r_l_path_to_redirect_from')}
            />
            <Input
              label={t('col_to_url')}
              placeholder="/new-page"
              variant="secondary"
              value={toUrl}
              onValueChange={setToUrl}
              description={t('desc_the_destination_u_r_l_path')}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onAddClose} isDisabled={saving}>
              {t('cancel')}
            </Button>
            <Button onPress={handleAdd} isLoading={saving} isDisabled={saving}>
              {t('create_redirect')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('delete_redirect_title')}
        message={t('delete_redirect_message')}
        confirmLabel={t('delete')}
        confirmColor="danger"
        isLoading={deleting}
      />
    </div>
  );
}

export default Redirects;
