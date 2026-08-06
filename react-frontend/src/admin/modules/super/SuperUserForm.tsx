import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Input, Select, SelectItem, Switch } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Link } from 'react-router-dom';

import { Separator } from '@/components/ui';
import Save from 'lucide-react/icons/save';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Crown from 'lucide-react/icons/crown';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { SuperAdminUserDetail, SuperAdminTenant } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


export function SuperUserForm() {
  const { id } = useParams();
  const isEditing = !!id;
  const { t } = useTranslation('admin_super');
  usePageTitle(isEditing ? t('super.title_edit_user') : t('super.title_create_user'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenants, setTenants] = useState<SuperAdminTenant[]>([]);
  const [form, setForm] = useState({
    tenant_id: '', first_name: '', last_name: '', email: '', password: '',
    role: 'member', location: '', phone: '', is_tenant_super_admin: false,
  });
  const [user, setUser] = useState<SuperAdminUserDetail | null>(null);

  // Move tenant state
  const [moveTargetTenant, setMoveTargetTenant] = useState('');
  const [moveLoading, setMoveLoading] = useState(false);

  // Promote state
  const [promoteTargetTenant, setPromoteTargetTenant] = useState('');
  const [promoteLoading, setPromoteLoading] = useState(false);

  const loadTenants = useCallback(async () => {
    const res = await adminSuper.listTenants();
    if (res.success && res.data) {
      setTenants(Array.isArray(res.data) ? res.data as SuperAdminTenant[] : []);
    }
  }, []);

  const loadUser = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await adminSuper.getUser(Number(id));
    if (res.success && res.data) {
      const u = res.data as SuperAdminUserDetail;
      setUser(u);
      setForm({
        tenant_id: String(u.tenant_id), first_name: u.first_name, last_name: u.last_name,
        email: u.email, password: '', role: u.role, location: u.location || '',
        phone: u.phone || '', is_tenant_super_admin: u.is_tenant_super_admin,
      });
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { loadTenants(); }, [loadTenants]);
  useEffect(() => { loadUser(); }, [loadUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    let res;
    if (isEditing) {
      res = await adminSuper.updateUser(Number(id), {
        first_name: form.first_name, last_name: form.last_name, email: form.email,
        role: form.role, location: form.location || null, phone: form.phone || null,
      });
    } else {
      res = await adminSuper.createUser({
        tenant_id: Number(form.tenant_id), first_name: form.first_name, last_name: form.last_name,
        email: form.email, password: form.password, role: form.role,
        location: form.location || undefined, phone: form.phone || undefined,
        is_tenant_super_admin: form.is_tenant_super_admin,
      });
    }
    if (res?.success) {
      toast.success(isEditing ? t('super.user_updated_successfully') : t('super.user_created_successfully'));
      if (isEditing) {
        navigate(tenantPath(`/super-admin/users/${id}`));
      } else {
        const newId = (res as { data?: { user_id?: number } }).data?.user_id;
        navigate(tenantPath(newId ? `/super-admin/users/${newId}` : '/super-admin/users'));
      }
    } else {
      toast.error(t('super.failed_to_save_user'));
    }
    setSaving(false);
  };

  const handleMoveTenant = async () => {
    if (!id || !moveTargetTenant) return;
    setMoveLoading(true);
    const res = await adminSuper.moveUserTenant(Number(id), Number(moveTargetTenant));
    if (res?.success) {
      toast.success(t('super.user_moved_to_new_tenant'));
      setMoveTargetTenant('');
      loadUser();
    } else {
      toast.error(res?.errors?.[0]?.message || t('super.failed_to_move_user'));
    }
    setMoveLoading(false);
  };

  const handleMoveAndPromote = async () => {
    if (!id || !promoteTargetTenant) return;
    setPromoteLoading(true);
    const res = await adminSuper.moveAndPromote(Number(id), Number(promoteTargetTenant));
    if (res?.success) {
      toast.success(t('super.user_moved_and_promoted'));
      setPromoteTargetTenant('');
      loadUser();
    } else {
      toast.error(res?.errors?.[0]?.message || t('super.failed_to_move_and_promote'));
    }
    setPromoteLoading(false);
  };

  const update = (field: string, value: unknown) => setForm(prev => ({ ...prev, [field]: value }));

  if (loading) return <div className="p-8 text-center text-muted">{t('common.loading')}</div>;

  // Hub tenants for promote
  const hubTenants = tenants.filter(t => t.allows_subtenants === true);

  return (
    <div>
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted mb-1">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('super.page_title')}</Link>
        <span>/</span>
        <Link to={tenantPath('/super-admin/users')} className="hover:text-accent">{t('super.users')}</Link>
        <span>/</span>
        <span className="text-foreground">{isEditing ? t('super.breadcrumb_edit') : t('super.breadcrumb_create')}</span>
      </nav>
      <PageHeader
        title={isEditing ? t('super.edit_user') : t('super.create_user')}
        description={isEditing ? t('super.edit_user_desc') : t('super.create_user_desc')}
        actions={
          <Button variant="tertiary" startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath(isEditing ? `/super-admin/users/${id}` : '/super-admin/users'))}>
            {t('super.back')}
          </Button>
        }
      />

      {/* CREATE MODE - Single Column Form */}
      {!isEditing && (
        <Card className="max-w-2xl">
          <CardBody>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Select label={t('super.label_tenant')} isRequired selectedKeys={form.tenant_id ? [form.tenant_id] : []}
                onSelectionChange={(keys) => update('tenant_id', Array.from(keys)[0])}>
                {tenants.map((t) => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
              </Select>
              <div className="grid grid-cols-2 gap-4">
                <Input label={t('super.label_first_name')} isRequired value={form.first_name}
                  onValueChange={(v) => update('first_name', v)} />
                <Input label={t('super.label_last_name')} value={form.last_name}
                  onValueChange={(v) => update('last_name', v)} />
              </div>
              <Input label={t('super.label_email')} type="email" isRequired value={form.email}
                onValueChange={(v) => update('email', v)} />
              <Input label={t('super.label_password')} type="password" isRequired value={form.password}
                onValueChange={(v) => update('password', v)} />
              <Select label={t('super.label_role')} selectedKeys={[form.role]}
                onSelectionChange={(keys) => update('role', Array.from(keys)[0])}>
                <SelectItem key="member" id="member">{t('super.role_member')}</SelectItem>
                <SelectItem key="admin" id="admin">{t('super.role_admin')}</SelectItem>
              </Select>
              <div className="grid grid-cols-2 gap-4">
                <Input label={t('super.label_location')} value={form.location} onValueChange={(v) => update('location', v)} />
                <Input label={t('super.label_phone')} value={form.phone} onValueChange={(v) => update('phone', v)} />
              </div>
              <Separator />
              <div className="bg-gradient-to-br from-accent/10 to-pink-500/10 border border-accent/20 rounded-lg p-4">
                <Switch
                  isSelected={form.is_tenant_super_admin}
                  onValueChange={(v) => update('is_tenant_super_admin', v)}
                  classNames={{
                    wrapper: 'group-data-[selected=true]:bg-gradient-to-r group-data-[selected=true]:from-accent group-data-[selected=true]:to-pink-500',
                  }}
                >
                  <div>
                    <p className="font-medium">{t('super.grant_tenant_sa')}</p>
                    <p className="text-xs text-muted mt-0.5">{t('super.grant_tenant_sa_desc')}</p>
                  </div>
                </Switch>
              </div>
              <Button type="submit" startContent={<Save size={16} />}
                isLoading={saving}>
                {t('super.create_user')}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {/* EDIT MODE - 2-Column Layout */}
      {isEditing && user && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Column (2/3 width) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* User Details Form */}
            <Card>
              <CardHeader className="font-semibold text-lg">{t('super.section_user_details')}</CardHeader>
              <Separator />
              <CardBody>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input label={t('super.label_first_name')} isRequired value={form.first_name}
                      onValueChange={(v) => update('first_name', v)} />
                    <Input label={t('super.label_last_name')} value={form.last_name}
                      onValueChange={(v) => update('last_name', v)} />
                  </div>
                  <Input label={t('super.label_email')} type="email" isRequired value={form.email}
                    onValueChange={(v) => update('email', v)} />
                  <Select label={t('super.label_role')} selectedKeys={[form.role]}
                    onSelectionChange={(keys) => update('role', Array.from(keys)[0])}>
                    <SelectItem key="member" id="member">{t('super.role_member')}</SelectItem>
                    <SelectItem key="admin" id="admin">{t('super.role_admin')}</SelectItem>
                  </Select>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label={t('super.label_location')} value={form.location} onValueChange={(v) => update('location', v)} />
                    <Input label={t('super.label_phone')} value={form.phone} onValueChange={(v) => update('phone', v)} />
                  </div>
                  <Button type="submit" startContent={<Save size={16} />}
                    isLoading={saving}>
                    {t('super.update_user')}
                  </Button>
                </form>
              </CardBody>
            </Card>

            {/* Move to Tenant Form */}
            <Card>
              <CardHeader className="font-semibold text-lg flex items-center gap-2">
                <ArrowRightLeft size={18} />
                {t('super.move_user_to_tenant_title')}
              </CardHeader>
              <Separator />
              <CardBody className="flex flex-col gap-4">
                <div className="bg-accent-soft border border-accent text-accent rounded-[12px] p-3">
                  <p className="text-sm font-medium mb-2">{t('super.how_it_works')}</p>
                  <ol className="text-xs opacity-90 space-y-1 list-decimal list-inside">
                    <li>{t('super.move_step_1')}</li>
                    <li>{t('super.move_step_2')}</li>
                    <li>{t('super.move_step_3')}</li>
                    <li>{t('super.move_step_4')}</li>
                  </ol>
                </div>
                <Select
                  label={t('super.label_target_tenant')}
                  placeholder={t('super.select_tenant')}
                  selectedKeys={moveTargetTenant ? [moveTargetTenant] : []}
                  onSelectionChange={(keys) => setMoveTargetTenant(String(Array.from(keys)[0] || ''))}
                >
                  {tenants
                    .filter(t => t.id !== user.tenant_id)
                    .map(t => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
                </Select>
                <Button
                  color="default"
                  variant="tertiary"
                  startContent={<ArrowRightLeft size={16} />}
                  onPress={handleMoveTenant}
                  isLoading={moveLoading}
                  isDisabled={!moveTargetTenant}
                >
                  {t('super.move_user')}
                </Button>
              </CardBody>
            </Card>

            {/* Move and Promote to Regional SA */}
            <Card>
              <CardHeader className="font-semibold text-lg flex items-center gap-2">
                <Crown size={18} className="text-accent" />
                {t('super.move_and_promote_to_hub')}
              </CardHeader>
              <Separator />
              <CardBody className="flex flex-col gap-4">
                <div className="bg-accent-soft dark:bg-accent/10 border border-accent dark:border-accent/20 rounded-lg p-3">
                  <p className="text-sm text-accent dark:text-accent font-medium mb-2">{t('super.four_step_workflow')}</p>
                  <ol className="text-xs text-accent dark:text-accent space-y-1 list-decimal list-inside">
                    <li>{t('super.promote_step_1')}</li>
                    <li>{t('super.promote_step_2')}</li>
                    <li>{t('super.promote_step_3')}</li>
                    <li>{t('super.promote_step_4')}</li>
                  </ol>
                  <p className="text-xs text-accent dark:text-accent mt-2 font-medium">
                    {t('super.hub_tenants_only')}
                  </p>
                </div>
                <Select
                  label={t('super.label_target_hub_tenant')}
                  placeholder={t('super.select_hub_tenant')}
                  selectedKeys={promoteTargetTenant ? [promoteTargetTenant] : []}
                  onSelectionChange={(keys) => setPromoteTargetTenant(String(Array.from(keys)[0] || ''))}
                >
                  {hubTenants
                    .filter(t => t.id !== user.tenant_id)
                    .map(t => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
                </Select>
                {hubTenants.filter(t => t.id !== user.tenant_id).length === 0 && (
                  <p className="text-xs text-muted">{t('super.no_hub_tenants_found')}</p>
                )}
                <Button
                  color="default"
                  variant="tertiary"
                  startContent={<Crown size={16} />}
                  onPress={handleMoveAndPromote}
                  isLoading={promoteLoading}
                  isDisabled={!promoteTargetTenant}
                >
                  {t('super.move_and_promote')}
                </Button>
              </CardBody>
            </Card>
          </div>

          {/* Sidebar Column (1/3 width) */}
          <div className="flex flex-col gap-6">
            {/* Status Card */}
            <Card>
              <CardHeader className="font-semibold text-lg">{t('super.section_status')}</CardHeader>
              <Separator />
              <CardBody>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-xs text-muted">{t('super.account_status')}</p>
                    <p className="text-sm font-medium">{t(`super.status_${user.status}`, { defaultValue: t('super.status_unknown') })}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('super.label_tenant')}</p>
                    <Link to={tenantPath(`/super-admin/tenants/${user.tenant_id}`)} className="text-sm text-accent hover:underline">
                      {user.tenant_name || t('super.tenant_with_id', { id: user.tenant_id })}
                    </Link>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('super.label_member_since')}</p>
                    <p className="text-sm">{new Date(user.created_at).toLocaleDateString(getFormattingLocale())}</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Super Admin Privileges */}
            <Card className="bg-gradient-to-br from-accent/5 to-pink-500/5 border border-accent/20">
              <CardHeader className="font-semibold text-lg">{t('super.super_admin_privileges')}</CardHeader>
              <Separator />
              <CardBody className="flex flex-col gap-3">
                <div>
                  <p className="text-xs text-muted mb-1">{t('super.tenant_super_admin')}</p>
                  <p className="text-sm">
                    {user.is_tenant_super_admin ? (
                      <span className="text-success">{t('super.granted')}</span>
                    ) : (
                      <span className="text-muted">{t('super.not_granted')}</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-1">{t('super.privilege_global_super_admin')}</p>
                  <p className="text-sm">
                    {user.is_super_admin ? (
                      <span className="text-danger">{t('super.granted_god_level')}</span>
                    ) : (
                      <span className="text-muted">{t('super.not_granted')}</span>
                    )}
                  </p>
                </div>
                <p className="text-xs text-muted mt-2">
                  {t('super.manage_sa_from')}{' '}
                  <Link to={tenantPath(`/super-admin/users/${id}`)} className="text-accent hover:underline">
                    {t('super.user_detail_page')}
                  </Link>
                </p>
              </CardBody>
            </Card>

            {/* Quick Links */}
            <Card>
              <CardHeader className="font-semibold text-lg">{t('super.quick_links')}</CardHeader>
              <Separator />
              <CardBody className="flex flex-col gap-2">
                <Button
                  variant="tertiary"
                  fullWidth
                  onPress={() => navigate(tenantPath(`/super-admin/users/${id}`))}
                >
                  {t('super.view_full_details')}
                </Button>
                <Button
                  variant="tertiary"
                  fullWidth
                  onPress={() => navigate(tenantPath('/super-admin/users'))}
                >
                  {t('super.back_to_users')}
                </Button>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
export default SuperUserForm;
