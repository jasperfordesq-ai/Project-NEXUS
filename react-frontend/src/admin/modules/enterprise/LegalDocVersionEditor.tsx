// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Legal Document Version Editor (full page)
 *
 * Authors a legal document version — the metadata plus the rich-text body. This
 * replaces the old cramped modal (which could not scroll and discarded work on a
 * backdrop click). Create mode adds a new version; edit mode edits an existing
 * DRAFT (published versions are immutable, enforced by the backend).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import Save from 'lucide-react/icons/save';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useTranslation } from 'react-i18next';
import { useTenant, useToast } from '@/contexts';
import { adminLegalDocs } from '../../api/adminApi';
import type { LegalDocument, LegalDocumentVersion } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { LegalDocEditor } from '@/admin/components';
import { Card, CardBody, Button, Input, Textarea, Switch, Spinner } from '@/components/ui';

export function LegalDocVersionEditor() {
  const { t } = useTranslation('admin_enterprise');
  const { id, versionId } = useParams<{ id: string; versionId?: string }>();
  const isEdit = !!versionId;
  const documentId = parseInt(id || '0', 10);

  const { tenantPath } = useTenant();
  const { success, error } = useToast();
  const navigate = useNavigate();

  useAdminPageMeta({ title: isEdit ? t('legal_versions.editor_title_edit') : t('legal_versions.editor_title_create') });

  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);

  const [formData, setFormData] = useState({
    version_number: '',
    version_label: '',
    content: '',
    summary_of_changes: '',
    effective_date: '',
    is_draft: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const versionsPath = useMemo(
    () => tenantPath(`/admin/legal-documents/${documentId}/versions`),
    [tenantPath, documentId],
  );

  const patch = useCallback((next: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...next }));
    setDirty(true);
  }, []);

  // Load the parent document (for header context) and — in edit mode — the draft.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!documentId) {
        navigate(versionsPath);
        return;
      }
      setLoading(true);
      try {
        const docRes = await adminLegalDocs.get(documentId);
        if (!cancelled && docRes.success && docRes.data) {
          setDoc(docRes.data as LegalDocument);
        }

        if (isEdit) {
          const vRes = await adminLegalDocs.getVersions(documentId);
          const list = (vRes.success && vRes.data ? vRes.data : []) as LegalDocumentVersion[];
          const target = list.find((v) => v.id === parseInt(versionId || '0', 10));

          if (!target) {
            if (!cancelled) {
              error(t('legal_versions.version_not_found'));
              navigate(versionsPath);
            }
            return;
          }
          if (!target.is_draft) {
            if (!cancelled) {
              error(t('legal_versions.only_drafts_editable'));
              navigate(versionsPath);
            }
            return;
          }
          if (!cancelled) {
            setFormData({
              version_number: target.version_number ?? '',
              version_label: target.version_label ?? '',
              content: target.content ?? '',
              summary_of_changes: target.summary_of_changes ?? '',
              effective_date: target.effective_date ?? '',
              is_draft: true,
            });
          }
        }
      } catch {
        if (!cancelled) {
          error(t('enterprise.failed_to_load_versions'));
          navigate(versionsPath);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [documentId, isEdit, versionId, navigate, versionsPath, error, t]);

  // Warn on browser navigation / refresh while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!formData.version_number.trim()) {
      next.version_number = t('enterprise.version_form.version_number_required');
    }
    if (!formData.content.trim()) {
      next.content = t('enterprise.version_form.content_required');
    }
    if (!formData.effective_date) {
      next.effective_date = t('enterprise.version_form.effective_date_required');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    const payload = {
      version_number: formData.version_number.trim(),
      version_label: formData.version_label.trim() || undefined,
      content: formData.content,
      summary_of_changes: formData.summary_of_changes.trim() || undefined,
      effective_date: formData.effective_date,
    };

    try {
      setSubmitting(true);
      const response = isEdit
        ? await adminLegalDocs.updateVersion(documentId, parseInt(versionId || '0', 10), payload)
        : await adminLegalDocs.createVersion(documentId, { ...payload, is_draft: formData.is_draft });

      if (response.success) {
        success(isEdit ? t('enterprise.version_form.version_updated') : t('enterprise.version_form.version_created'));
        setDirty(false);
        navigate(versionsPath);
      } else {
        error((isEdit ? t('enterprise.version_form.failed_to_update') : t('enterprise.version_form.failed_to_create')));
      }
    } catch {
      error(isEdit ? t('enterprise.version_form.failed_to_update') : t('enterprise.version_form.failed_to_create'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (dirty) {
      setShowDiscard(true);
    } else {
      navigate(versionsPath);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? t('legal_versions.editor_title_edit') : t('legal_versions.editor_title_create')}
        description={doc?.title
          ? t('legal_versions.editor_description_for', { title: doc.title })
          : (isEdit ? t('legal_versions.editor_description_edit') : t('legal_versions.editor_description_create'))}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={handleCancel}
            size="sm"
          >
            {t('legal_versions.back_to_versions')}
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardBody className="p-4 space-y-4">
            {/* Info banner */}
            <div className="flex items-start gap-3 p-3 bg-accent-soft dark:bg-accent-soft rounded-lg">
              <AlertCircle size={20} className="text-accent shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium mb-1">{t('enterprise.version_form.version_management')}</p>
                <p className="text-[var(--color-text-secondary)]">
                  {isEdit ? t('enterprise.version_form.edit_info') : t('enterprise.version_form.create_info')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('enterprise.version_form.label_version_number')}
                placeholder={t('enterprise.version_form.placeholder_version_number')}
                value={formData.version_number}
                onChange={(e) => patch({ version_number: e.target.value })}
                isInvalid={!!errors.version_number}
                errorMessage={errors.version_number}
                isRequired
              />
              <Input
                label={t('enterprise.version_form.label_version_label')}
                placeholder={t('enterprise.version_form.placeholder_version_label')}
                value={formData.version_label}
                onChange={(e) => patch({ version_label: e.target.value })}
              />
            </div>

            <Input
              type="date"
              label={t('enterprise.version_form.label_effective_date')}
              value={formData.effective_date}
              onChange={(e) => patch({ effective_date: e.target.value })}
              isInvalid={!!errors.effective_date}
              errorMessage={errors.effective_date}
              isRequired
            />

            <Textarea
              label={t('enterprise.version_form.label_summary_of_changes')}
              description={t('legal_versions.email_summary_help')}
              placeholder={t('enterprise.version_form.placeholder_summary')}
              value={formData.summary_of_changes}
              onChange={(e) => patch({ summary_of_changes: e.target.value })}
              minRows={3}
            />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4">
            <LegalDocEditor
              value={formData.content}
              onChange={(html) => patch({ content: html })}
              disabled={submitting}
              errorMessage={errors.content}
            />
          </CardBody>
        </Card>

        {/* Save-as-draft toggle — create mode only; edits are always drafts */}
        {!isEdit && (
          <Card>
            <CardBody className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{t('enterprise.version_form.save_as_draft')}</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t('enterprise.version_form.draft_description')}
                  </p>
                </div>
                <Switch
                  isSelected={formData.is_draft}
                  onValueChange={(checked) => patch({ is_draft: checked })}
                />
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Sticky action bar — Save is always reachable regardless of content length */}
      <div className="sticky bottom-0 z-30 -mx-1 mt-6 flex justify-end gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 backdrop-blur">
        <Button variant="tertiary" onPress={handleCancel}>
          {t('enterprise.cancel')}
        </Button>
        <Button
          startContent={<Save size={16} />}
          onPress={handleSubmit}
          isLoading={submitting}
        >
          {isEdit ? t('enterprise.version_form.btn_update') : t('enterprise.version_form.btn_create')}
        </Button>
      </div>

      <ConfirmModal
        isOpen={showDiscard}
        onClose={() => setShowDiscard(false)}
        onConfirm={() => { setDirty(false); setShowDiscard(false); navigate(versionsPath); }}
        title={t('legal_versions.unsaved_changes_title')}
        message={t('legal_versions.unsaved_changes_message')}
        confirmLabel={t('legal_versions.discard_changes')}
        confirmColor="danger"
      />
    </div>
  );
}

export default LegalDocVersionEditor;
