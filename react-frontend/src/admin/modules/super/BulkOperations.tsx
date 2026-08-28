import { Card, CardBody, CardHeader, Button, Chip, Select, SelectItem, Switch, Checkbox, RadioGroup, Radio } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import Users from 'lucide-react/icons/users';
import Building2 from 'lucide-react/icons/building-2';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCheck from 'lucide-react/icons/check-check';
import XCircle from 'lucide-react/icons/circle-x';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { SuperAdminTenant, SuperAdminUser, BulkOperationResult } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


export function BulkOperations() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();

  const [tenants, setTenants] = useState<SuperAdminTenant[]>([]);
  const [users, setUsers] = useState<SuperAdminUser[]>([]);
  const [loading, setLoading] = useState(false);

  // Bulk Move Users state
  const [sourceTenant, setSourceTenant] = useState('');
  const [targetTenant, setTargetTenant] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [grantSA, setGrantSA] = useState(false);
  const [moveConfirm, setMoveConfirm] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);

  // Bulk Update Tenants state
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [tenantConfirm, setTenantConfirm] = useState(false);
  const [tenantLoading, setTenantLoading] = useState(false);

  const loadTenants = useCallback(async () => {
    const res = await adminSuper.listTenants();
    if (res.success && res.data) {
      setTenants(Array.isArray(res.data) ? res.data as SuperAdminTenant[] : []);
    }
  }, []);

  useEffect(() => { loadTenants(); }, [loadTenants]);

  const loadUsersForTenant = async (tenantId: string) => {
    if (!tenantId) return;
    setLoading(true);
    const res = await adminSuper.listUsers({ tenant_id: Number(tenantId), limit: 100 });
    if (res.success && res.data) {
      setUsers(Array.isArray(res.data) ? res.data as SuperAdminUser[] : []);
    }
    setLoading(false);
  };

  const handleBulkMoveUsers = async () => {
    setMoveLoading(true);
    const res = await adminSuper.bulkMoveUsers({
      user_ids: Array.from(selectedUserIds),
      target_tenant_id: Number(targetTenant),
      grant_super_admin: grantSA,
    });
    if (res?.success) {
      const result = res.data as BulkOperationResult | undefined;
      const moved = result?.moved_count ?? result?.updated_count ?? 0;
      const failed = result?.errors?.length ?? 0;
      // The endpoint returns 200 even when every user failed pre-validation,
      // so a green "moved (0)" toast here used to hide total failure.
      if (moved > 0 && failed === 0) {
        toast.success(t('super.bulk_users_moved_count', { count: moved }));
      } else if (moved > 0) {
        toast.warning(t('super.bulk_users_moved_partial', { moved, failed }));
      } else {
        toast.error(t('super.bulk_move_failed'));
      }
      setSelectedUserIds(new Set());
      loadUsersForTenant(sourceTenant);
    } else {
      toast.error(t('super.bulk_move_failed'));
    }
    setMoveLoading(false);
    setMoveConfirm(false);
  };

  const handleBulkUpdateTenants = async () => {
    setTenantLoading(true);
    const res = await adminSuper.bulkUpdateTenants({
      tenant_ids: Array.from(selectedTenantIds),
      action: bulkAction as 'activate' | 'deactivate' | 'enable_hub' | 'disable_hub',
    });
    if (res?.success) {
      const result = res.data as BulkOperationResult | undefined;
      toast.success(t('super.bulk_tenants_updated_count', { count: result?.updated_count ?? 0 }));
      setSelectedTenantIds(new Set());
      loadTenants();
    } else {
      toast.error(t('super.bulk_update_failed'));
    }
    setTenantLoading(false);
    setTenantConfirm(false);
  };

  const toggleUser = (id: number) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleTenant = (id: number) => {
    setSelectedTenantIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllTenants = () => {
    setSelectedTenantIds(new Set(tenants.filter(t => t.id !== 1).map(t => t.id)));
  };

  const deselectAllTenants = () => {
    setSelectedTenantIds(new Set());
  };

  const availableTenants = tenants.filter(t => t.id !== 1);

  return (
    <div>
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted mb-1">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('super.breadcrumb_super_admin')}</Link>
        <span>/</span>
        <span className="text-foreground">{t('super.bulk_operations_title')}</span>
      </nav>
      <PageHeader title={t('super.bulk_operations_title')} description={t('super.bulk_operations_desc')} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bulk Move Users */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1">
            <div className="flex gap-2 items-center">
              <Users size={20} /> <h3 className="text-lg font-semibold">{t('super.bulk_move_users')}</h3>
            </div>
            <p className="text-xs text-muted">
              {t('super.bulk_move_users_desc')}{' '}
              <Link to={tenantPath('/super-admin/users')} className="text-accent hover:underline">{t('super.manage_individual_users')}</Link>
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <Select label={t('super.label_source_tenant')} selectedKeys={sourceTenant ? [sourceTenant] : []}
              onSelectionChange={(keys) => {
                const val = String(Array.from(keys)[0] || '');
                setSourceTenant(val);
                setSelectedUserIds(new Set());
                if (val) loadUsersForTenant(val);
              }}>
              {tenants.map(t => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
            </Select>

            {users.length > 0 && (
              <div className="max-h-48 overflow-y-auto border rounded-lg p-2">
                {users.map(u => (
                  <Checkbox key={u.id} isSelected={selectedUserIds.has(u.id)}
                    onValueChange={() => toggleUser(u.id)} className="w-full py-1">
                    {u.name} <span className="text-muted text-xs">({u.email})</span>
                  </Checkbox>
                ))}
              </div>
            )}
            {loading && <p className="text-center text-muted text-sm">{t('super.loading_users')}</p>}

            <Separator />
            <Select label={t('super.label_target_tenant')} selectedKeys={targetTenant ? [targetTenant] : []}
              onSelectionChange={(keys) => setTargetTenant(String(Array.from(keys)[0] || ''))}>
              {tenants.filter(t => String(t.id) !== sourceTenant).map(t =>
                <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
            </Select>

            <div className="bg-surface-secondary border border-accent text-accent rounded-[12px] p-3">
              <Switch
                isSelected={grantSA}
                onValueChange={setGrantSA}
                classNames={{
                  wrapper: 'group-data-[selected=true]:bg-gradient-to-r group-data-[selected=true]:from-accent group-data-[selected=true]:to-pink-500',
                }}
              >
                <div>
                  <p className="text-sm font-medium">{t('super.grant_sa_on_arrival')}</p>
                  <p className="text-xs text-muted mt-0.5">{t('super.grant_sa_on_arrival_desc')}</p>
                </div>
              </Switch>
            </div>

            <Button startContent={<ArrowRight size={16} />}
              isDisabled={selectedUserIds.size === 0 || !targetTenant}
              onPress={() => setMoveConfirm(true)}>
              {t('super.move_n_users', { count: selectedUserIds.size })}
            </Button>
          </CardBody>
        </Card>

        {/* Bulk Update Tenants */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1">
            <div className="flex gap-2 items-center">
              <Building2 size={20} /> <h3 className="text-lg font-semibold">{t('super.bulk_update_tenants')}</h3>
            </div>
            <p className="text-xs text-muted">
              {t('super.bulk_update_tenants_desc')}{' '}
              <Link to={tenantPath('/super-admin/tenants')} className="text-accent hover:underline">{t('super.manage_individual_tenants')}</Link>
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium">{t('super.select_tenants')}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  startContent={<CheckCheck size={14} />}
                  onPress={selectAllTenants}
                >
                  {t('super.select_all')}
                </Button>
                <Button
                  size="sm"
                  variant="tertiary"
                  startContent={<XCircle size={14} />}
                  onPress={deselectAllTenants}
                >
                  {t('super.deselect_all')}
                </Button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto border rounded-lg p-2">
              {availableTenants.map(tenant => (
                <Checkbox key={tenant.id} isSelected={selectedTenantIds.has(tenant.id)}
                  onValueChange={() => toggleTenant(tenant.id)} className="w-full py-1">
                  {tenant.name} <Chip size="sm" variant="soft" color={tenant.is_active ? 'success' : 'default'} className="ml-2">
                    {tenant.is_active ? t('super.status_active_label') : t('super.status_inactive_label')}
                  </Chip>
                </Checkbox>
              ))}
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium mb-3">{t('super.select_action')}</p>
              <RadioGroup value={bulkAction} onValueChange={setBulkAction}>
                <div className="grid grid-cols-2 gap-3">
                  {/* Each card div below only widens the pointer hit area. The
                      accessible control is the HeroUI Radio nested inside it:
                      only the Radio's visual `wrapper` slot is hidden, the radio
                      itself is still rendered, focusable, and driven by the
                      RadioGroup — so keyboard users select with arrow keys as
                      normal. Giving these wrappers a tabIndex would add a second
                      tab stop competing with the radio it contains. */}
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <div
                    onClick={() => setBulkAction('activate')}
                    className={`cursor-pointer border-2 rounded-lg p-3 transition-all ${
                      bulkAction === 'activate'
                        ? 'border-success bg-success/10'
                        : 'border-border hover:border-success/50'
                    }`}
                  >
                    <Radio value="activate" classNames={{ wrapper: 'hidden' }}>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-success">{t('super.activate_tenants')}</p>
                        <p className="text-xs text-muted">{t('super.activate_tenants_desc')}</p>
                      </div>
                    </Radio>
                  </div>
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <div
                    onClick={() => setBulkAction('deactivate')}
                    className={`cursor-pointer border-2 rounded-lg p-3 transition-all ${
                      bulkAction === 'deactivate'
                        ? 'border-danger bg-danger/10'
                        : 'border-border hover:border-danger/50'
                    }`}
                  >
                    <Radio value="deactivate" classNames={{ wrapper: 'hidden' }}>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-danger">{t('super.deactivate_tenants')}</p>
                        <p className="text-xs text-muted">{t('super.deactivate_tenants_desc')}</p>
                      </div>
                    </Radio>
                  </div>
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <div
                    onClick={() => setBulkAction('enable_hub')}
                    className={`cursor-pointer border-2 rounded-lg p-3 transition-all ${
                      bulkAction === 'enable_hub'
                        ? 'border-accent bg-accent/10'
                        : 'border-border hover:border-accent/50'
                    }`}
                  >
                    <Radio value="enable_hub" classNames={{ wrapper: 'hidden' }}>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-accent">{t('super.enable_hub')}</p>
                        <p className="text-xs text-muted">{t('super.enable_hub_desc')}</p>
                      </div>
                    </Radio>
                  </div>
                  {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                  <div
                    onClick={() => setBulkAction('disable_hub')}
                    className={`cursor-pointer border-2 rounded-lg p-3 transition-all ${
                      bulkAction === 'disable_hub'
                        ? 'border-warning bg-warning/10'
                        : 'border-border hover:border-warning/50'
                    }`}
                  >
                    <Radio value="disable_hub" classNames={{ wrapper: 'hidden' }}>
                      <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold text-warning-600 dark:text-warning">{t('super.disable_hub')}</p>
                        <p className="text-xs text-muted">{t('super.disable_hub_desc')}</p>
                      </div>
                    </Radio>
                  </div>
                </div>
              </RadioGroup>
            </div>
            <Button
              variant={bulkAction === 'deactivate' ? 'danger' : 'secondary'}
              isDisabled={selectedTenantIds.size === 0 || !bulkAction}
              onPress={() => setTenantConfirm(true)}
            >
              {t('super.apply_to_n_tenants', { count: selectedTenantIds.size })}
            </Button>
          </CardBody>
        </Card>
      </div>

      <ConfirmModal isOpen={moveConfirm} onClose={() => setMoveConfirm(false)}
        onConfirm={handleBulkMoveUsers}
        title={t('super.bulk_move_confirm_title')}
        message={grantSA
          ? t('super.bulk_move_confirm_message_with_grant', { count: selectedUserIds.size })
          : t('super.bulk_move_confirm_message', { count: selectedUserIds.size })}
        confirmLabel={t('super.move_users')} confirmColor="primary" isLoading={moveLoading} />

      <ConfirmModal isOpen={tenantConfirm} onClose={() => setTenantConfirm(false)}
        onConfirm={handleBulkUpdateTenants}
        title={t('super.bulk_update_confirm_title')}
        message={t('super.bulk_update_confirm_message', { count: selectedTenantIds.size })}
        confirmLabel={t('super.apply')} confirmColor={
          bulkAction === 'activate' ? 'primary' :
          bulkAction === 'deactivate' ? 'danger' :
          'warning'
        } isLoading={tenantLoading} />
    </div>
  );
}
export default BulkOperations;
