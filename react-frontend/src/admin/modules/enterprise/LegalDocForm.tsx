// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Legal Document Settings Form
 *
 * Create/edit the metadata of a legal document (title, type, acceptance rules).
 * The document's actual text lives in versions — after creating a document the
 * admin is taken straight to the version editor to author the first version.
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import Save from 'lucide-react/icons/save';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { useTranslation } from 'react-i18next';
import { useTenant, useToast } from '@/contexts';
import { adminLegalDocs } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { CardBody, Card, Select, SelectItem, Button, Spinner, Input, Switch } from '@/components/ui';
import type { LegalDocument } from '../../api/types';

export function LegalDocForm() {
  const { t } = useTranslation('admin_enterprise');
  const { id } = useParams();
  const isEdit = !!id;

  const DOC_TYPES = [
    { value: 'terms', label: t('legal_doc_form.doc_type_terms') },
    { value: 'privacy', label: t('legal_doc_form.doc_type_privacy') },
    { value: 'cookies', label: t('legal_doc_form.doc_type_cookies') },
    { value: 'accessibility', label: t('legal_doc_form.doc_type_accessibility') },
    { value: 'community_guidelines', label: t('legal_doc_form.doc_type_community_guidelines') },
    { value: 'acceptable_use', label: t('legal_doc_form.doc_type_acceptable_use') },
  ];

  const ACCEPTANCE_MODES = [
    { value: 'registration', label: t('legal_doc_form.acceptance_for_registration') },
    { value: 'login', label: t('legal_doc_form.acceptance_for_login') },
    { value: 'first_use', label: t('legal_doc_form.acceptance_for_first_use') },
    { value: 'none', label: t('legal_doc_form.acceptance_for_none') },
  ];

  useAdminPageMeta({ title: isEdit ? t('legal_doc_form.page_title_edit') : t('legal_doc_form.page_title_create') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [type, setType] = useState('terms');
  const [requiresAcceptance, setRequiresAcceptance] = useState(true);
  const [acceptanceRequiredFor, setAcceptanceRequiredFor] = useState('registration');
  const [notifyOnUpdate, setNotifyOnUpdate] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!isEdit || !id) return;
    setLoading(true);
    try {
      const res = await adminLegalDocs.get(parseInt(id));
      if (res.success && res.data) {
        const doc = res.data as LegalDocument;
        setTitle(doc.title || '');
        setType(doc.type || 'terms');
        setRequiresAcceptance(Boolean(doc.requires_acceptance));
        setAcceptanceRequiredFor(doc.acceptance_required_for || 'registration');
        setNotifyOnUpdate(Boolean(doc.notify_on_update));
        setIsActive(Boolean(doc.is_active));
      }
    } catch {
      toast.error(t('legal_doc_form.failed_to_load_document'));
    } finally {
      setLoading(false);
    }
  }, [id, isEdit, t, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error(t('legal_doc_form.title_required'));
      return;
    }

    setSaving(true);
    try {
      if (isEdit && id) {
        const res = await adminLegalDocs.update(parseInt(id), {
          title: title.trim(),
          requires_acceptance: requiresAcceptance,
          acceptance_required_for: acceptanceRequiredFor,
          notify_on_update: notifyOnUpdate,
          is_active: isActive,
        });
        if (res.success) {
          toast.success(t('legal_doc_form.document_updated'));
          navigate(tenantPath('/admin/legal-documents'));
        } else {
          toast.error(res.error || t('legal_doc_form.save_failed_generic'));
        }
      } else {
        const res = await adminLegalDocs.create({
          title: title.trim(),
          type,
          requires_acceptance: requiresAcceptance,
          acceptance_required_for: acceptanceRequiredFor,
          notify_on_update: notifyOnUpdate,
          is_active: isActive,
        });
        if (res.success && res.data) {
          toast.success(t('legal_doc_form.created_next_step_toast'));
          // Land straight in the version editor to author the first version.
          navigate(tenantPath(`/admin/legal-documents/${(res.data as LegalDocument).id}/versions/new`));
        } else {
          toast.error(res.error || t('legal_doc_form.save_failed_generic'));
        }
      }
    } catch {
      toast.error(t('legal_doc_form.failed_to_save_document'));
    } finally {
      setSaving(false);
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
        title={isEdit ? t('legal_doc_form.edit_title') : t('legal_doc_form.create_title')}
        description={isEdit ? t('legal_doc_form.settings_description') : t('legal_doc_form.create_description')}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/admin/legal-documents'))}
            size="sm"
          >
            {t('legal_doc_form.back_to_documents')}
          </Button>
        }
      />

      <div className="space-y-6 max-w-2xl">
        <Card>
          <CardBody className="p-4 space-y-4">
            <h3 className="text-lg font-semibold">{t('legal_doc_form.document_details')}</h3>

            <Input
              label={t('enterprise.label_title')}
              value={title}
              onValueChange={setTitle}
              variant="secondary"
              isRequired
              placeholder={t('legal_doc_form.title_placeholder')}
            />

            <Select
              label={t('enterprise.label_type')}
              selectedKeys={new Set([type])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) setType(selected);
              }}
              variant="secondary"
              isDisabled={isEdit}
              description={isEdit ? t('legal_doc_form.type_locked_hint') : undefined}
            >
              {DOC_TYPES.map((dt) => (
                <SelectItem key={dt.value} id={dt.value}>{dt.label}</SelectItem>
              ))}
            </Select>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="p-4 space-y-4">
            <h3 className="text-lg font-semibold">{t('legal_doc_form.acceptance_settings')}</h3>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('legal_doc_form.label_requires_acceptance')}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('legal_doc_form.requires_acceptance_desc')}</p>
              </div>
              <Switch isSelected={requiresAcceptance} onValueChange={setRequiresAcceptance} />
            </div>

            {requiresAcceptance && (
              <Select
                label={t('legal_doc_form.label_acceptance_required_for')}
                selectedKeys={new Set([acceptanceRequiredFor])}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string;
                  if (selected) setAcceptanceRequiredFor(selected);
                }}
                variant="secondary"
              >
                {ACCEPTANCE_MODES.map((m) => (
                  <SelectItem key={m.value} id={m.value}>{m.label}</SelectItem>
                ))}
              </Select>
            )}

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('legal_doc_form.label_notify_on_update')}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('legal_doc_form.notify_on_update_desc')}</p>
              </div>
              <Switch isSelected={notifyOnUpdate} onValueChange={setNotifyOnUpdate} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium">{t('legal_doc_form.label_is_active')}</p>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('legal_doc_form.is_active_desc')}</p>
              </div>
              <Switch isSelected={isActive} onValueChange={setIsActive} />
            </div>
          </CardBody>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            variant="tertiary"
            onPress={() => navigate(tenantPath('/admin/legal-documents'))}
          >
            {t('legal_doc_form.cancel')}
          </Button>
          <Button
            startContent={<Save size={16} />}
            onPress={handleSubmit}
            isLoading={saving}
          >
            {isEdit ? t('legal_doc_form.update_document') : t('legal_doc_form.create_document')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default LegalDocForm;
