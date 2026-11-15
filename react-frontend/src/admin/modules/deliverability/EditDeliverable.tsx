import { Card, CardBody, CardHeader, Input, Textarea, Button, Spinner, Select, SelectItem } from '@/components/ui';
import { useEffect, useState } from 'react';
import Target from 'lucide-react/icons/target';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import { useNavigate, useParams } from 'react-router-dom';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useTenant, useToast } from '@/contexts';
import { adminDeliverability } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Edit Deliverable
 * Form for editing an existing project deliverable.
 * Wired to adminDeliverability.get() + adminDeliverability.update() APIs.
 */



interface DeliverableFormData {
  title: string;
  description: string;
  priority: string;
  status: string;
  due_date: string;
  assigned_to: string;
}

export function EditDeliverable() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_deliverability');
  useAdminPageMeta({ title: tNav('deliverability') });
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [formData, setFormData] = useState<DeliverableFormData>({
    title: '',
    description: '',
    priority: 'medium',
    status: 'planned',
    due_date: '',
    assigned_to: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminDeliverability.get(Number(id));
        if (!cancelled && res?.success && res.data) {
          const d = res.data as {
            title?: string;
            description?: string;
            priority?: string;
            status?: string;
            due_date?: string;
            assigned_to?: number | string;
          };
          setFormData({
            title: d.title || '',
            description: d.description || '',
            priority: d.priority || 'medium',
            status: d.status || 'planned',
            due_date: d.due_date ? String(d.due_date).slice(0, 10) : '',
            assigned_to: d.assigned_to !== undefined && d.assigned_to !== null ? String(d.assigned_to) : '',
          });
        } else if (!cancelled) {
          toast.error(t('deliverability.failed_to_load_deliverables'));
        }
      } catch {
        if (!cancelled) toast.error(t('deliverability.failed_to_load_deliverables'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, t, toast]);


  const handleChange = (field: keyof DeliverableFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!id) return;
    if (!formData.title.trim()) {
      toast.warning(t('deliverability.title_required'));
      return;
    }
    setSaving(true);
    try {
      const res = await adminDeliverability.update(Number(id), {
        title: formData.title,
        description: formData.description || undefined,
        priority: formData.priority || undefined,
        status: formData.status || undefined,
        due_date: formData.due_date || undefined,
        assigned_to: formData.assigned_to || undefined,
      });
      if (res?.success) {
        toast.success(t('deliverability.updated_success'));
        navigate(tenantPath('/platform-team/deliverability/list'));
      } else {
        toast.error(t('deliverability.update_failed'));
      }
    } catch {
      toast.error(t('deliverability.an_unexpected_error_occurred'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title={t('deliverability.edit_title')} description={t('deliverability.edit_description')} />
        <div className="flex justify-center py-12" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('deliverability.edit_title')}
        description={t('deliverability.edit_description')}
        actions={<Button variant="tertiary" startContent={<ArrowLeft size={16} />} onPress={() => navigate(tenantPath('/platform-team/deliverability/list'))}>{t('common.back')}</Button>}
      />

      <Card >
        <CardHeader><h3 className="text-lg font-semibold flex items-center gap-2"><Target size={20} aria-hidden="true" /> {t('deliverability.details_heading')}</h3></CardHeader>
        <CardBody className="gap-4">
          <Input
            label={t('deliverability.title_label')}
            placeholder={t('deliverability.title_placeholder')}
            isRequired
            variant="secondary"
            value={formData.title}
            onValueChange={(v) => handleChange('title', v)}
          />
          <Textarea
            label={t('deliverability.label_description')}
            placeholder={t('deliverability.placeholder_describe_the_deliverable')}
            variant="secondary"
            minRows={3}
            value={formData.description}
            onValueChange={(v) => handleChange('description', v)}
          />
          <Select
            label={t('deliverability.priority_label')}
            variant="secondary"
            selectedKeys={[formData.priority]}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0] as string;
              if (selected) handleChange('priority', selected);
            }}
          >
            <SelectItem key="low" id="low">{t('deliverability.priority_low')}</SelectItem>
            <SelectItem key="medium" id="medium">{t('deliverability.priority_medium')}</SelectItem>
            <SelectItem key="high" id="high">{t('deliverability.priority_high')}</SelectItem>
            <SelectItem key="critical" id="critical">{t('deliverability.priority_critical')}</SelectItem>
          </Select>
          <Select
            label={t('deliverability.status_label')}
            variant="secondary"
            selectedKeys={[formData.status]}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0] as string;
              if (selected) handleChange('status', selected);
            }}
          >
            <SelectItem key="planned" id="planned">{t('deliverability.status_planned')}</SelectItem>
            <SelectItem key="in_progress" id="in_progress">{t('deliverability.status_in_progress')}</SelectItem>
            <SelectItem key="review" id="review">{t('deliverability.status_review')}</SelectItem>
            <SelectItem key="completed" id="completed">{t('deliverability.status_completed')}</SelectItem>
          </Select>
          <Input
            label={t('deliverability.due_date_label')}
            type="date"
            variant="secondary"
            value={formData.due_date}
            onValueChange={(v) => handleChange('due_date', v)}
          />
          <Input
            label={t('deliverability.assigned_to_label')}
            placeholder={t('deliverability.assigned_to_placeholder')}
            variant="secondary"
            value={formData.assigned_to}
            onValueChange={(v) => handleChange('assigned_to', v)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="tertiary" onPress={() => navigate(tenantPath('/platform-team/deliverability/list'))}>{t('common.cancel')}</Button>
            <Button
              startContent={<Save size={16} />}
              onPress={handleSave}
              isLoading={saving}
              isDisabled={saving}
            >
              {t('deliverability.save_deliverable')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default EditDeliverable;
