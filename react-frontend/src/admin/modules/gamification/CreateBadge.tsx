import { Card, CardBody, CardHeader, Button, Input, Textarea, Select, SelectItem, Switch } from '@/components/ui';
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Award from 'lucide-react/icons/award';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminGamification } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Create Badge
 * Form to create a new custom badge.
 * Parity: PHP Admin\CustomBadgeController@store
 */


// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ICON_OPTIONS = [
  { key: 'award', labelKey: 'gamification.icon_award' },
  { key: 'star', labelKey: 'gamification.icon_star' },
  { key: 'trophy', labelKey: 'gamification.icon_trophy' },
  { key: 'medal', labelKey: 'gamification.icon_medal' },
  { key: 'shield', labelKey: 'gamification.icon_shield' },
  { key: 'heart', labelKey: 'gamification.icon_heart' },
  { key: 'zap', labelKey: 'gamification.icon_zap' },
  { key: 'flame', labelKey: 'gamification.icon_flame' },
  { key: 'crown', labelKey: 'gamification.icon_crown' },
  { key: 'gem', labelKey: 'gamification.icon_gem' },
  { key: 'target', labelKey: 'gamification.icon_target' },
  { key: 'rocket', labelKey: 'gamification.icon_rocket' },
] as const;

const CATEGORY_OPTIONS = [
  { key: 'special', labelKey: 'gamification.category_special' },
  { key: 'achievement', labelKey: 'gamification.category_achievement' },
  { key: 'participation', labelKey: 'gamification.category_participation' },
  { key: 'milestone', labelKey: 'gamification.category_milestone' },
  { key: 'community', labelKey: 'gamification.category_community' },
  { key: 'expertise', labelKey: 'gamification.category_expertise' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface FormData {
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  xp: number;
  is_active: boolean;
}

export function CreateBadge() {
  const { t } = useTranslation('admin_gamification');
  usePageTitle(t('gamification.create_badge_page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [formData, setFormData] = useState<FormData>({
    name: '',
    slug: '',
    description: '',
    icon: 'award',
    category: 'special',
    xp: 0,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const updateField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setFormData((prev) => {
      const updated = { ...prev, [key]: value };
      // Auto-generate slug from name if slug hasn't been manually edited
      if (key === 'name' && typeof value === 'string') {
        const autoSlug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        updated.slug = autoSlug;
      }
      return updated;
    });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t('gamification.badge_name_required'));
      return;
    }

    setSaving(true);

    const res = await adminGamification.createBadge({
      name: formData.name.trim(),
      slug: formData.slug.trim() || undefined,
      description: formData.description.trim(),
      icon: formData.icon,
      category: formData.category,
      xp: formData.xp,
      is_active: formData.is_active,
    });

    if (res.success) {
      toast.success(t('gamification.badge_created'));
      navigate(tenantPath('/admin/custom-badges'));
    } else {
      // admin-i18n-ignore: localized server message — the API renders this refusal
      // through __() in the caller's locale (AdminGamificationController::createBadge:
      // both error returns use __()).
      // Show the server's own reason — "Slug already taken", a field validation
      // message — instead of a blanket "Failed to create badge" that leaves the
      // admin editing blind. Falls back through `error` → first `errors[]`
      // message → the generic string.
      const errorMsg = res.error
        || res.errors?.find(detail => detail.message)?.message
        || t('gamification.failed_to_create_badge');
      toast.error(errorMsg);
    }

    setSaving(false);
  };

  return (
    <div>
      <PageHeader
        title={t('gamification.create_badge')}
        description={t('gamification.create_badge_desc')}
        actions={
          <Button as={Link} to={tenantPath("/admin/custom-badges")} variant="tertiary" startContent={<ArrowLeft size={16} />}>
            {t('gamification.back_to_badges')}
          </Button>
        }
      />

      <Card  className="max-w-2xl">
        <CardHeader className="flex items-center gap-2 pb-0">
          <Award size={20} className="text-success" />
          <h3 className="text-lg font-semibold text-foreground">{t('gamification.badge_details')}</h3>
        </CardHeader>
        <CardBody className="gap-4">
          <Input
            label={t('gamification.name')}
            placeholder={t('gamification.badge_name_placeholder')}
            value={formData.name}
            onValueChange={(v) => updateField('name', v)}
            isRequired
            variant="secondary"
            autoFocus
          />

          <Input
            label={t('gamification.slug')}
            placeholder={t('gamification.slug_placeholder')}
            value={formData.slug}
            onValueChange={(v) => setFormData((prev) => ({ ...prev, slug: v }))}
            variant="secondary"
            description={t('gamification.slug_description')}
            classNames={{ input: 'font-mono text-sm' }}
          />

          <Textarea
            label={t('gamification.description')}
            placeholder={t('gamification.badge_description_placeholder')}
            value={formData.description}
            onValueChange={(v) => updateField('description', v)}
            variant="secondary"
            minRows={3}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label={t('gamification.icon')}
              selectedKeys={new Set([formData.icon])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) updateField('icon', selected);
              }}
              variant="secondary"
            >
              {ICON_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{t(opt.labelKey)}</SelectItem>
              ))}
            </Select>

            <Select
              label={t('gamification.category')}
              selectedKeys={new Set([formData.category])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) updateField('category', selected);
              }}
              variant="secondary"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{t(opt.labelKey)}</SelectItem>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('gamification.xp_value')}
              type="number"
              placeholder="0"
              value={String(formData.xp)}
              onValueChange={(v) => updateField('xp', parseInt(v) || 0 as never)}
              variant="secondary"
              min={0}
              max={10000}
              description={t('gamification.xp_value_description')}
            />
            <div className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium">{t('gamification.active')}</p>
                <p className="text-xs text-muted">{t('gamification.badge_active_description')}</p>
              </div>
              <Switch
                isSelected={formData.is_active}
                onValueChange={(v) => updateField('is_active', v as never)}
                size="sm"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted mb-2 uppercase tracking-wider font-semibold">{t('gamification.preview')}</p>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                <Award size={24} />
              </div>
              <div>
                <p className="font-semibold text-foreground">{formData.name || t('gamification.badge_name_preview')}</p>
                <p className="text-sm text-muted">{formData.description || t('gamification.badge_description_preview')}</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button as={Link} to={tenantPath("/admin/custom-badges")} variant="tertiary" isDisabled={saving}>{t('gamification.cancel')}</Button>
            <Button
              startContent={<Save size={16} />}
              onPress={handleSave}
              isLoading={saving}
            >
              {t('gamification.create_badge')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default CreateBadge;
