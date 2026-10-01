import { Card, CardBody, CardHeader, Input, Button, Spinner, Chip, Select, SelectItem } from '@/components/ui';
import { useState, useEffect } from 'react';
import Mail from 'lucide-react/icons/mail';
import Save from 'lucide-react/icons/save';
import Send from 'lucide-react/icons/send';
import Shield from 'lucide-react/icons/shield';
import Globe from 'lucide-react/icons/globe';
import Copy from 'lucide-react/icons/copy';
import Check from 'lucide-react/icons/check';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { adminSettings } from '../../api/adminApi';
import type { ApiResponse } from '@/lib/api';
import { SecretInput } from '../../components/SecretInput';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Email Settings
 * Configure email providers and delivery settings for the platform.
 */



interface EmailSettingsForm {
  provider: string;
  sendgrid_api_key: string;
  sendgrid_from_email: string;
  sendgrid_from_name: string;
  webhook_url: string;
  gmail_client_id: string;
  gmail_client_secret: string;
  gmail_refresh_token: string;
  gmail_sender_email: string;
  gmail_sender_name: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_password: string;
  smtp_encryption: string;
  smtp_from_email: string;
  smtp_from_name: string;
  platform_default: { provider: string; description_code?: string };
  // Track which secrets are saved on the server
  _sendgrid_api_key_set: boolean;
  _gmail_client_secret_set: boolean;
  _gmail_refresh_token_set: boolean;
  _smtp_password_set: boolean;
}

const INITIAL_FORM: EmailSettingsForm = {
  provider: 'platform_default',
  sendgrid_api_key: '',
  sendgrid_from_email: '',
  sendgrid_from_name: '',
  webhook_url: '',
  gmail_client_id: '',
  gmail_client_secret: '',
  gmail_refresh_token: '',
  gmail_sender_email: '',
  gmail_sender_name: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_password: '',
  smtp_encryption: 'tls',
  smtp_from_email: '',
  smtp_from_name: '',
  platform_default: { provider: 'unknown', description_code: 'platform_environment_configuration' },
  _sendgrid_api_key_set: false,
  _gmail_client_secret_set: false,
  _gmail_refresh_token_set: false,
  _smtp_password_set: false,
};

const PROVIDERS = [
  { key: 'platform_default', labelKey: 'provider_platform_default' },
  { key: 'sendgrid', labelKey: 'provider_sendgrid' },
  { key: 'gmail_api', labelKey: 'provider_gmail_api' },
  { key: 'smtp', labelKey: 'provider_smtp' },
];

const PLATFORM_DEFAULT_DESCRIPTION_KEYS: Record<string, string> = {
  platform_environment_configuration: 'platform_default_desc',
};

export function EmailSettings() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const { t: tNav } = useTranslation('admin_nav');
  usePageTitle(tNav('advanced'));
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const [formData, setFormData] = useState<EmailSettingsForm>(INITIAL_FORM);

  useEffect(() => {
    adminSettings.getEmailConfig()
      .then((res: ApiResponse<Record<string, unknown>>) => {
        const data = res.data;
        if (data) {
          const sg = data.sendgrid as Record<string, unknown> | undefined;
          const smtp = data.smtp as Record<string, unknown> | undefined;
          const gmail = data.gmail_api as Record<string, unknown> | undefined;
          setFormData({
            ...INITIAL_FORM,
            provider: String(data.provider ?? 'platform_default'),
            webhook_url: String(data.webhook_url ?? ''),
            platform_default: (data.platform_default as EmailSettingsForm['platform_default']) ?? {
              provider: 'unknown',
              description_code: 'platform_environment_configuration',
            },
            // SendGrid
            sendgrid_api_key: sg?.api_key_set ? '********' : '',
            sendgrid_from_email: String(sg?.from_email ?? ''),
            sendgrid_from_name: String(sg?.from_name ?? ''),
            _sendgrid_api_key_set: !!sg?.api_key_set,
            // Gmail API
            gmail_client_id: String(gmail?.client_id ?? ''),
            gmail_client_secret: gmail?.client_secret_set ? '********' : '',
            gmail_refresh_token: gmail?.refresh_token_set ? '********' : '',
            gmail_sender_email: String(gmail?.sender_email ?? ''),
            gmail_sender_name: String(gmail?.sender_name ?? ''),
            _gmail_client_secret_set: !!gmail?.client_secret_set,
            _gmail_refresh_token_set: !!gmail?.refresh_token_set,
            // SMTP
            smtp_host: String(smtp?.host ?? ''),
            smtp_port: String(smtp?.port ?? '587'),
            smtp_user: String(smtp?.user ?? ''),
            smtp_password: smtp?.password_set ? '********' : '',
            smtp_encryption: String(smtp?.encryption ?? 'tls'),
            smtp_from_email: String(smtp?.from_email ?? ''),
            smtp_from_name: String(smtp?.from_name ?? ''),
            _smtp_password_set: !!smtp?.password_set,
          });
        }
      })
      .catch(() => toast.error(t('failed_to_load_email_settings')))
      .finally(() => setLoading(false));
  }, [t, toast])


  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        email_provider: formData.provider,
      };

      if (formData.provider === 'sendgrid') {
        payload.sendgrid_api_key = formData.sendgrid_api_key;
        payload.sendgrid_from_email = formData.sendgrid_from_email;
        payload.sendgrid_from_name = formData.sendgrid_from_name;
      } else if (formData.provider === 'gmail_api') {
        payload.gmail_client_id = formData.gmail_client_id;
        payload.gmail_client_secret = formData.gmail_client_secret;
        payload.gmail_refresh_token = formData.gmail_refresh_token;
        payload.gmail_sender_email = formData.gmail_sender_email;
        payload.gmail_sender_name = formData.gmail_sender_name;
      } else if (formData.provider === 'smtp') {
        payload.smtp_host = formData.smtp_host;
        payload.smtp_port = formData.smtp_port;
        payload.smtp_user = formData.smtp_user;
        payload.smtp_password = formData.smtp_password;
        payload.smtp_encryption = formData.smtp_encryption;
        payload.smtp_from_email = formData.smtp_from_email;
        payload.smtp_from_name = formData.smtp_from_name;
      }

      const res = await adminSettings.updateEmailConfig(payload) as ApiResponse<Record<string, unknown>>;

      if (res.data?.success) {
        toast.success(t('email_settings_saved_successfully'));
      } else {
        toast.error(t('save_failed'));
      }
    } catch {
      toast.error(t('failed_to_save_email_settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) {
      toast.error(t('please_enter_a_test_email_address'));
      return;
    }
    setTesting(true);
    try {
      const res = await adminSettings.testEmailProvider({ to: testEmail }) as ApiResponse<Record<string, unknown>>;

      if (res.data?.success) {
        const providerName = res.data.provider ? String(res.data.provider).toUpperCase() : '';
        toast.success(providerName ? t('test_email_sent_via_provider', { provider: providerName }) : t('test_email_sent'));
      } else {
        toast.error(t('save_failed'));
      }
    } catch {
      toast.error(t('failed_to_send_test_email'));
    } finally {
      setTesting(false);
    }
  };

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(formData.webhook_url);
      setCopied(true);
      toast.success(t('webhook_u_r_l_copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('failed_to_copy'));
    }
  };

  const updateField = <K extends keyof EmailSettingsForm>(key: K, value: EmailSettingsForm[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const secretHint = (isSet: boolean) =>
    isSet ? t('secret_already_saved') : undefined;

  const { provider } = formData;

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('email_settings_title')} description={t('email_settings_desc')} />

      <div className="space-y-4">
        {/* Provider Selection */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Mail aria-hidden="true" size={20} /> {t('email_provider_heading')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted">{t('active_provider')}</span>
              <Chip color="accent" variant="soft">
                {PROVIDERS.find(p => p.key === provider)?.labelKey ? t(PROVIDERS.find(p => p.key === provider)!.labelKey) : provider}
              </Chip>
            </div>
            <Select
              label={t('label_email_provider')}
              selectedKeys={[provider]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v) updateField('provider', String(v));
              }}
              variant="secondary"
            >
              {PROVIDERS.map(p => (
                <SelectItem key={p.key} id={p.key}>{t(p.labelKey)}</SelectItem>
              ))}
            </Select>
          </CardBody>
        </Card>

        {/* SendGrid Config */}
        {provider === 'sendgrid' && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Shield aria-hidden="true" size={20} /> {t('sendgrid_configuration')}
              </h3>
            </CardHeader>
            <CardBody className="gap-4">
              <SecretInput
                label={t('label_a_p_i_key')}
                type="password"
                placeholder={t('placeholder_s_gxxxxx')}
                variant="secondary"
                description={secretHint(formData._sendgrid_api_key_set) || t('sendgrid_api_key_desc')}
                value={formData.sendgrid_api_key}
                onValueChange={(v) => updateField('sendgrid_api_key', v)}
              />
              <Input
                label={t('label_from_email')}
                placeholder={t('placeholder_noreply_example')}
                type="email"
                autoComplete="email"
                variant="secondary"
                value={formData.sendgrid_from_email}
                onValueChange={(v) => updateField('sendgrid_from_email', v)}
              />
              <Input
                label={t('label_from_name')}
                placeholder={t('placeholder_my_timebank')}
                variant="secondary"
                value={formData.sendgrid_from_name}
                onValueChange={(v) => updateField('sendgrid_from_name', v)}
              />
              {formData.webhook_url && (
                <Input
                  isReadOnly
                  label={t('webhook_url_label')}
                  description={t('webhook_url_hint')}
                  value={formData.webhook_url}
                  variant="secondary"
                  classNames={{ input: 'font-mono text-xs' }}
                  endContent={
                    <Button
                      size="sm"
                      variant="secondary"
                      isIconOnly
                      aria-label={copied ? t('copied') : t('copy')}
                      onPress={handleCopyWebhook}
                      className={copied ? 'text-success' : undefined}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                  }
                />
              )}
            </CardBody>
          </Card>
        )}

        {/* Gmail API Config */}
        {provider === 'gmail_api' && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Globe aria-hidden="true" size={20} /> {t('gmail_api_configuration')}
              </h3>
            </CardHeader>
            <CardBody className="gap-4">
              <Input
                label={t('label_client_i_d')}
                placeholder={t('placeholder_xxxxappsgoogleusercontentcom')}
                variant="secondary"
                value={formData.gmail_client_id}
                onValueChange={(v) => updateField('gmail_client_id', v)}
              />
              <SecretInput
                label={t('label_client_secret')}
                type="password"
                placeholder={t('placeholder_gocspx')}
                variant="secondary"
                description={secretHint(formData._gmail_client_secret_set)}
                value={formData.gmail_client_secret}
                onValueChange={(v) => updateField('gmail_client_secret', v)}
              />
              <SecretInput
                label={t('label_refresh_token')}
                type="password"
                variant="secondary"
                description={secretHint(formData._gmail_refresh_token_set)}
                value={formData.gmail_refresh_token}
                onValueChange={(v) => updateField('gmail_refresh_token', v)}
              />
              <Input
                label={t('label_sender_email')}
                placeholder={t('placeholder_noreply_example')}
                variant="secondary"
                value={formData.gmail_sender_email}
                onValueChange={(v) => updateField('gmail_sender_email', v)}
              />
              <Input
                label={t('label_sender_name')}
                placeholder={t('placeholder_my_timebank')}
                variant="secondary"
                value={formData.gmail_sender_name}
                onValueChange={(v) => updateField('gmail_sender_name', v)}
              />
            </CardBody>
          </Card>
        )}

        {/* SMTP Config */}
        {provider === 'smtp' && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Globe aria-hidden="true" size={20} /> {t('smtp_configuration')}
              </h3>
            </CardHeader>
            <CardBody className="gap-4">
              <Input
                label={t('label_host')}
                placeholder={t('placeholder_smtpexamplecom')}
                variant="secondary"
                value={formData.smtp_host}
                onValueChange={(v) => updateField('smtp_host', v)}
              />
              <Input
                label={t('label_port')}
                placeholder={t('placeholder_smtp_port')}
                variant="secondary"
                value={formData.smtp_port}
                onValueChange={(v) => updateField('smtp_port', v)}
              />
              <Input
                label={t('label_username')}
                placeholder={t('placeholder_user_example')}
                variant="secondary"
                value={formData.smtp_user}
                onValueChange={(v) => updateField('smtp_user', v)}
              />
              <SecretInput
                label={t('label_password')}
                type="password"
                variant="secondary"
                description={secretHint(formData._smtp_password_set)}
                value={formData.smtp_password}
                onValueChange={(v) => updateField('smtp_password', v)}
              />
              <Select
                label={t('label_encryption')}
                selectedKeys={[formData.smtp_encryption]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0];
                  if (v) updateField('smtp_encryption', String(v));
                }}
                variant="secondary"
              >
                <SelectItem key="tls" id="tls">{t('encryption_tls')}</SelectItem>
                <SelectItem key="ssl" id="ssl">{t('encryption_ssl')}</SelectItem>
                <SelectItem key="none" id="none">{t('encryption_none')}</SelectItem>
              </Select>
              <Input
                label={t('label_from_email')}
                placeholder={t('placeholder_noreply_example')}
                type="email"
                autoComplete="email"
                variant="secondary"
                value={formData.smtp_from_email}
                onValueChange={(v) => updateField('smtp_from_email', v)}
              />
              <Input
                label={t('label_from_name')}
                placeholder={t('placeholder_my_timebank')}
                variant="secondary"
                value={formData.smtp_from_name}
                onValueChange={(v) => updateField('smtp_from_name', v)}
              />
            </CardBody>
          </Card>
        )}

        {/* Platform Default Info */}
        {provider === 'platform_default' && (
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Globe aria-hidden="true" size={20} /> {t('platform_default_heading')}
              </h3>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-muted">
                {t(PLATFORM_DEFAULT_DESCRIPTION_KEYS[formData.platform_default.description_code ?? ''] ?? 'platform_default_desc')}{' '}
                <Chip size="sm" variant="soft" color="accent">
                  {formData.platform_default.provider || t('not_configured')}
                </Chip>
              </p>
              <p className="text-sm text-muted mt-2">
                {t('platform_default_hint')}
              </p>
            </CardBody>
          </Card>
        )}

        {/* Test Email */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Send aria-hidden="true" size={20} /> {t('test_email_heading')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <p className="text-sm text-muted">
              {t('test_email_hint')}
            </p>
            <Input
              label={t('label_test_email_address')}
              placeholder={t('placeholder_test_example')}
              variant="secondary"
              value={testEmail}
              onValueChange={setTestEmail}
            />
            <Button
              variant="secondary"
              startContent={<Send aria-hidden="true" size={16} />}
              onPress={handleTestEmail}
              isLoading={testing}
            >
              {t('send_test_email')}
            </Button>
          </CardBody>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            startContent={<Save aria-hidden="true" size={16} />}
            onPress={handleSave}
            isLoading={saving}
            isDisabled={saving}
          >
            {t('save_settings')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default EmailSettings;
