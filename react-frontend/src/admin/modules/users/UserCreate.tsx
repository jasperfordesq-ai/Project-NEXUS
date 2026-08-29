import { CardBody, Card, Select, SelectItem, Button, Input, Switch } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin User Create
 * Form to create a new user with role assignment and optional welcome email.
 * Parity: PHP Admin\UserController::create()
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminUsers } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { CreateUserPayload } from '../../api/types';

export function UserCreate() {
  const { t } = useTranslation('admin_users');
  usePageTitle(t('users.create_user_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('member');
  const [status, setStatus] = useState('active');
  const [password, setPassword] = useState('');
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Validation state
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!firstName.trim()) {
      newErrors.first_name = t('users.validation_first_name_required');
    }
    if (!lastName.trim()) {
      newErrors.last_name = t('users.validation_last_name_required');
    }
    if (!email.trim()) {
      newErrors.email = t('users.validation_email_required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t('users.validation_email_invalid');
    }
    if (!role) {
      newErrors.role = t('users.validation_role_required');
    }
    if (password.trim() && password.trim().length < 8) {
      newErrors.password = t('users.validation_password_min');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validate()) return;

    setSubmitting(true);

    try {
      const payload: CreateUserPayload = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        role,
        status,
        send_welcome_email: sendWelcomeEmail,
      };

      // Only include password if provided (backend auto-generates if empty)
      if (password.trim()) {
        payload.password = password.trim();
      }
      if (phone.trim()) {
        payload.phone = phone.trim();
      }

      const res = await adminUsers.create(payload);

      if (res.success) {
        toast.success(t('users.create_success'));
        navigate(tenantPath('/admin/users'));
      } else {
        // Show the server's own reason — "Email already taken", a validation
        // message — so the admin knows what to change. A blanket "Failed to
        // create user" leaves them retrying the same form.
        // admin-i18n-ignore: localized server message — the API renders this refusal
        // through __() in the caller's locale (AdminUsersController: all 78 error returns use __()).
        toast.error(res.error || t('users.create_failed'));
      }
    } catch {
      toast.error(t('users.error_occurred'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('users.create_user_title')}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft aria-hidden="true" size={16} />}
            onPress={() => navigate(tenantPath('/admin/users'))}
          >
            {t('users.back_to_users')}
          </Button>
        }
      />

      <form onSubmit={handleSubmit}>
        <Card className="max-w-2xl">
          <CardBody className="gap-5 p-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('users.label_first_name')}
                placeholder={t('users.placeholder_first_name')}
                value={firstName}
                onValueChange={setFirstName}
                isRequired
                isInvalid={!!errors.first_name}
                errorMessage={errors.first_name}
                isDisabled={submitting}
              />
              <Input
                label={t('users.label_last_name')}
                placeholder={t('users.placeholder_last_name')}
                value={lastName}
                onValueChange={setLastName}
                isRequired
                isInvalid={!!errors.last_name}
                errorMessage={errors.last_name}
                isDisabled={submitting}
              />
            </div>

            {/* Email */}
            <Input
              label={t('users.label_email')}
              type="email"
              placeholder={t('users.placeholder_email')}
              value={email}
              onValueChange={setEmail}
              isRequired
              isInvalid={!!errors.email}
              errorMessage={errors.email}
              isDisabled={submitting}
            />

            {/* Phone */}
            <Input
              label={t('users.label_phone')}
              type="tel"
              placeholder={t('users.placeholder_phone')}
              value={phone}
              onValueChange={setPhone}
              isDisabled={submitting}
            />

            {/* Role & Status */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label={t('users.label_role')}
                placeholder={t('users.placeholder_select_role')}
                selectedKeys={role ? [role] : []}
                onSelectionChange={(keys) => setRole(Array.from(keys)[0] as string)}
                isRequired
                isInvalid={!!errors.role}
                errorMessage={errors.role}
                isDisabled={submitting}
              >
                <SelectItem key="member" id="member">{t('users.role_member')}</SelectItem>
                <SelectItem key="broker" id="broker">{t('users.role_broker')}</SelectItem>
                <SelectItem key="admin" id="admin">{t('users.role_admin')}</SelectItem>
              </Select>

              <Select
                label={t('users.label_status')}
                placeholder={t('users.placeholder_select_status')}
                selectedKeys={[status]}
                onSelectionChange={(keys) => setStatus(Array.from(keys)[0] as string)}
                isDisabled={submitting}
              >
                <SelectItem key="active" id="active">{t('users.active')}</SelectItem>
                <SelectItem key="pending" id="pending">{t('users.pending')}</SelectItem>
              </Select>
            </div>

            {/* Password */}
            <Input
              label={t('users.label_password')}
              type="password"
              placeholder={t('users.placeholder_password')}
              description={t('users.password_description')}
              value={password}
              onValueChange={setPassword}
              isDisabled={submitting}
              isInvalid={!!errors.password}
              errorMessage={errors.password}
            />

            {/* Send Welcome Email */}
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">{t('users.send_welcome_email')}</p>
                <p className="text-xs text-muted">
                  {t('users.send_welcome_email_description')}
                </p>
              </div>
              <Switch
                isSelected={sendWelcomeEmail}
                onValueChange={setSendWelcomeEmail}
                isDisabled={submitting}
                aria-label={t('users.send_welcome_email')}
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="tertiary"
                onPress={() => navigate(tenantPath('/admin/users'))}
                isDisabled={submitting}
              >
                {t('users.cancel')}
              </Button>
              <Button
                type="submit"
                startContent={!submitting ? <Save aria-hidden="true" size={16} /> : undefined}
                isLoading={submitting}
              >
                {t('users.create_user_title')}
              </Button>
            </div>
          </CardBody>
        </Card>
      </form>
    </div>
  );
}

export default UserCreate;
