import { CardBody, Card, Button, Spinner, Input, Textarea, Checkbox } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Role Form
 * Create/Edit role form with name, description, permissions checkboxes.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';

import Save from 'lucide-react/icons/save';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import {
  caringRolePresetDescription,
  caringRolePresetKey,
  caringRolePresetName,
  type CaringRolePresetKey,
} from './caringRolePresetTranslations';
import { logError } from '@/lib/logger';

function permissionToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

export function RoleForm() {
  const { t } = useTranslation('admin_enterprise');
  const { id } = useParams();
  const isEdit = !!id;
  usePageTitle(isEdit ? t('enterprise.page_title_edit_role') : t('enterprise.page_title_create_role'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [presetKey, setPresetKey] = useState<CaringRolePresetKey | null>(null);
  const [storedName, setStoredName] = useState('');
  const [storedDescription, setStoredDescription] = useState('');
  const [presetDisplayName, setPresetDisplayName] = useState('');
  const [presetDisplayDescription, setPresetDisplayDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [allPermissions, setAllPermissions] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load permissions
      const permRes = await adminEnterprise.getPermissions();
      if (permRes.success && permRes.data) {
        setAllPermissions(permRes.data as unknown as Record<string, string[]>);
      }

      // Load role if editing
      if (isEdit && id) {
        const roleRes = await adminEnterprise.getRole(parseInt(id));
        if (roleRes.success && roleRes.data) {
          const role = roleRes.data as unknown as { name: string; description: string | null; permissions: string[] };
          const nextPresetKey = caringRolePresetKey(role.name || '');
          const nextStoredDescription = role.description || '';
          const nextDisplayName = nextPresetKey ? caringRolePresetName(t, nextPresetKey) : role.name || '';
          const nextDisplayDescription = nextPresetKey
            ? caringRolePresetDescription(t, nextPresetKey)
            : nextStoredDescription;

          setPresetKey(nextPresetKey);
          setStoredName(role.name || '');
          setStoredDescription(nextStoredDescription);
          setPresetDisplayName(nextDisplayName);
          setPresetDisplayDescription(nextDisplayDescription);
          setName(nextDisplayName);
          setDescription(nextDisplayDescription);
          setSelectedPermissions(new Set(role.permissions || []));
        }
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_data'));
    } finally {
      setLoading(false);
    }
  }, [id, isEdit, toast, t])


  useEffect(() => {
    loadData();
  }, [loadData]);

  const togglePermission = (perm: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) {
        next.delete(perm);
      } else {
        next.add(perm);
      }
      return next;
    });
  };

  const toggleCategory = (category: string) => {
    const perms = allPermissions[category] || [];
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      const allSelected = perms.every((p) => next.has(p));
      if (allSelected) {
        perms.forEach((p) => next.delete(p));
      } else {
        perms.forEach((p) => next.add(p));
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('enterprise.name_is_required'));
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: presetKey && name.trim() === presetDisplayName ? storedName : name.trim(),
        description: presetKey && description.trim() === presetDisplayDescription
          ? storedDescription
          : description.trim(),
        permissions: Array.from(selectedPermissions),
      };

      let res;
      if (isEdit && id) {
        res = await adminEnterprise.updateRole(parseInt(id), payload);
      } else {
        res = await adminEnterprise.createRole(payload);
      }

      if (res.success) {
        toast.success(isEdit ? t('enterprise.role_updated') : t('enterprise.role_created'));
        navigate(tenantPath('/admin/enterprise/roles'));
      } else {
        const error = t('enterprise.save_failed');
        toast.error(error);
      }
    } catch (err) {
      toast.error(isEdit ? t('enterprise.failed_to_update_role') : t('enterprise.failed_to_create_role'));
      logError('Role save error', err);
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
        title={isEdit ? t('enterprise.edit_role') : t('enterprise.create_role')}
        description={isEdit ? t('enterprise.edit_role_desc') : t('enterprise.create_role_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/admin/enterprise/roles'))}
            size="sm"
          >
            {t('enterprise.back_to_roles')}
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Basic Info */}
        <Card >
          <CardBody className="p-4 space-y-4">
            <h3 className="text-lg font-semibold">{t('enterprise.basic_information')}</h3>
            <Input
              label={t('enterprise.label_role_name')}
              value={name}
              onValueChange={setName}
              variant="secondary"
              isRequired
              placeholder={t('enterprise.placeholder_role_name')}
            />
            <Textarea
              label={t('enterprise.label_description')}
              value={description}
              onValueChange={setDescription}
              variant="secondary"
              placeholder={t('enterprise.placeholder_role_description')}
              minRows={2}
            />
          </CardBody>
        </Card>

        {/* Permissions */}
        <Card >
          <CardBody className="p-4">
            <h3 className="text-lg font-semibold mb-4">{t('enterprise.col_permissions')}</h3>
            <div className="space-y-6">
              {Object.entries(allPermissions).map(([category, perms]) => (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox
                      isSelected={perms.every((p) => selectedPermissions.has(p))}
                      isIndeterminate={
                        perms.some((p) => selectedPermissions.has(p)) &&
                        !perms.every((p) => selectedPermissions.has(p))
                      }
                      onValueChange={() => toggleCategory(category)}
                    >
                      <span className="font-medium">
                        {t(`enterprise.permission_categories.${permissionToken(category)}`, { defaultValue: t('enterprise.permission_category_unknown') })}
                      </span>
                    </Checkbox>
                  </div>
                  <div className="ml-6 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {perms.map((perm) => (
                      <Checkbox
                        key={perm}
                        isSelected={selectedPermissions.has(perm)}
                        onValueChange={() => togglePermission(perm)}
                        size="sm"
                      >
                        <span className="text-sm text-muted">
                          {t(`enterprise.permissions.${permissionToken(perm)}`, { defaultValue: t('enterprise.permission_unknown') })}
                        </span>
                      </Checkbox>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            variant="tertiary"
            onPress={() => navigate(tenantPath('/admin/enterprise/roles'))}
          >
            {t('enterprise.cancel')}
          </Button>
          <Button
            startContent={<Save size={16} />}
            onPress={handleSubmit}
            isLoading={saving}
          >
            {isEdit ? t('enterprise.update_role') : t('enterprise.create_role')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default RoleForm;
