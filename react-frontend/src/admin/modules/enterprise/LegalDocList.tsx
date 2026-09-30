// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Legal Document List
 * DataTable of legal documents with CRUD + version management entry points.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import FileText from 'lucide-react/icons/file-text';
import FilePlus from 'lucide-react/icons/file-plus';
import Scale from 'lucide-react/icons/scale';
import { useTenant, useToast } from '@/contexts';
import { adminLegalDocs } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { Column } from '../../components/DataTable';
import type { LegalDocument } from '../../api/types';
import { useAdminPageMeta } from '../../AdminMetaContext';

import { useTranslation } from 'react-i18next';
import { Button, Chip, Card, CardBody } from '@/components/ui';

/** Human-friendly labels for legal document types */
const DOC_TYPE_KEYS: Record<string, string> = {
  terms: 'legal_doc_form.doc_type_terms',
  privacy: 'legal_doc_form.doc_type_privacy',
  cookies: 'legal_doc_form.doc_type_cookies',
  accessibility: 'legal_doc_form.doc_type_accessibility',
  community_guidelines: 'legal_doc_form.doc_type_community_guidelines',
  acceptable_use: 'legal_doc_form.doc_type_acceptable_use',
};

type DerivedStatus = 'published' | 'draft' | 'no_content';

function deriveStatus(doc: LegalDocument): DerivedStatus {
  if (doc.current_version_id != null) return 'published';
  if ((doc.version_count ?? 0) > 0) return 'draft';
  return 'no_content';
}

const STATUS_META: Record<DerivedStatus, { key: string; color: 'success' | 'warning' | 'default' }> = {
  published: { key: 'enterprise.status_published', color: 'success' },
  draft: { key: 'enterprise.status_draft_content', color: 'warning' },
  no_content: { key: 'enterprise.status_no_content', color: 'default' },
};

export function LegalDocList() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.legal_doc_list_title') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [docs, setDocs] = useState<LegalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<LegalDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminLegalDocs.list();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setDocs(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_legal_documents'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminLegalDocs.delete(deleteTarget.id);

      if (res.success) {
        toast.success(t('enterprise.document_deleted'));
        setDeleteTarget(null);
        loadData();
      } else {
        // The server refuses (409 RESOURCE_CONFLICT) to delete a document that
        // was ever published or accepted — the acceptance records would
        // cascade away — so tell the admin to deactivate it instead (F-276).
        const hasPublishedRecord = res.code === 'RESOURCE_CONFLICT';
        toast.error(
          hasPublishedRecord
            ? t('enterprise.document_has_published_record')
            : t('enterprise.failed_to_delete_document')
        );
      }
    } catch {
      toast.error(t('enterprise.failed_to_delete_document'));
    } finally {
      setDeleting(false);
    }
  };

  const manageContent = (doc: LegalDocument) => {
    // No versions yet → drop straight into authoring the first one.
    const target = (doc.version_count ?? 0) > 0
      ? `/admin/legal-documents/${doc.id}/versions`
      : `/admin/legal-documents/${doc.id}/versions/new`;
    navigate(tenantPath(target));
  };

  const columns: Column<LegalDocument>[] = [
    {
      key: 'title',
      label: t('enterprise.label_title'),
      sortable: true,
      render: (doc) => (
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-accent shrink-0" />
          <span className={`font-medium ${!doc.is_active ? 'text-[var(--color-text-tertiary)]' : ''}`}>
            {doc.title}
          </span>
          {!doc.is_active && (
            <Chip size="sm" variant="soft" color="default">{t('enterprise.chip_inactive')}</Chip>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      label: t('enterprise.label_type'),
      sortable: true,
      render: (doc) => (
        <Chip size="sm" variant="soft">
          {DOC_TYPE_KEYS[doc.type] ? t(DOC_TYPE_KEYS[doc.type] ?? '') : t('enterprise.doc_type_unknown')}
        </Chip>
      ),
    },
    {
      key: 'version_number',
      label: t('enterprise.col_current_version'),
      render: (doc) => doc.version_number || '—',
    },
    {
      key: 'version_count',
      label: t('enterprise.col_version_count'),
      render: (doc) => doc.version_count ?? 0,
    },
    {
      key: 'status',
      label: t('enterprise.label_status'),
      render: (doc) => {
        const meta = STATUS_META[deriveStatus(doc)];
        return <Chip size="sm" color={meta.color}>{t(meta.key)}</Chip>;
      },
    },
    {
      key: 'updated_at',
      label: t('enterprise.label_last_updated'),
      sortable: true,
      render: (doc) => doc.updated_at ? new Date(doc.updated_at).toLocaleDateString(getFormattingLocale()) : '—',
    },
    {
      key: 'actions',
      label: t('enterprise.label_actions'),
      render: (doc) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            startContent={<FileText size={14} />}
            onPress={() => manageContent(doc)}
          >
            {t('enterprise.btn_manage_content')}
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => navigate(tenantPath(`/admin/legal-documents/${doc.id}/edit`))}
            aria-label={t('enterprise.label_edit_document')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setDeleteTarget(doc)}
            aria-label={t('enterprise.label_delete_document')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const showEmptyState = !loading && docs.length === 0;

  return (
    <div>
      <PageHeader
        title={t('enterprise.legal_doc_list_title')}
        description={t('enterprise.legal_doc_list_desc')}
        actions={
          <Button
            as={Link}
            to={tenantPath('/admin/legal-documents/create')}
            startContent={<Plus size={16} />}
            size="sm"
          >
            {t('legal_doc_form.create_document')}
          </Button>
        }
      />

      {showEmptyState ? (
        <Card>
          <CardBody className="flex flex-col items-center text-center gap-4 py-14 px-6">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Scale size={28} />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="text-lg font-semibold">{t('enterprise.empty_docs_title')}</h3>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('enterprise.empty_docs_desc')}</p>
            </div>
            <Button
              as={Link}
              to={tenantPath('/admin/legal-documents/create')}
              startContent={<FilePlus size={16} />}
            >
              {t('enterprise.empty_docs_cta')}
            </Button>
          </CardBody>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={docs}
          isLoading={loading}
          onRefresh={loadData}
          searchable={false}
          emptyContent={t('enterprise.no_legal_documents')}
        />
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('enterprise.label_delete_document')}
        message={t('enterprise.delete_document_confirm')}
        confirmLabel={t('enterprise.delete')}
        confirmColor="danger"
        isLoading={deleting}
      />
    </div>
  );
}

export default LegalDocList;
