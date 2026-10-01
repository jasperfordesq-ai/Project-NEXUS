// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin SSO Providers (IT-Sec-05)
 *
 * Per-tenant OIDC single sign-on configuration: register identity
 * providers (generic OIDC, Microsoft Entra ID, Hivebrite), control
 * auto-provisioning and allowed email domains, and probe OIDC
 * discovery before enabling. Client secrets are write-only — stored
 * encrypted, never returned.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';
import KeyRound from 'lucide-react/icons/key-round';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Switch,
  useConfirm,
  useDisclosure,
} from '@/components/ui';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { SecretInput } from '../../components/SecretInput';

interface AdminSsoProvider {
  id: number;
  provider_key: string;
  display_name: string;
  preset: string;
  issuer_url: string;
  client_id: string;
  has_client_secret: boolean;
  scopes: string;
  allowed_email_domains: string[];
  auto_provision: boolean;
  is_enabled: boolean;
  updated_at: string | null;
}

interface TestResult {
  ok: boolean;
  issuer?: string;
  authorization_endpoint?: string;
  error?: string;
}

interface ProviderForm {
  provider_key: string;
  display_name: string;
  preset: string;
  issuer_url: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  allowed_email_domains: string;
  auto_provision: boolean;
  is_enabled: boolean;
}

const PROVIDER_KEY_REGEX = /^[a-z0-9][a-z0-9_-]{1,19}$/;

const EMPTY_FORM: ProviderForm = {
  provider_key: '',
  display_name: '',
  preset: 'generic',
  issuer_url: '',
  client_id: '',
  client_secret: '',
  scopes: 'openid profile email',
  allowed_email_domains: '',
  auto_provision: false,
  is_enabled: false,
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SsoProviders() {
  const { t } = useTranslation('admin_system');
  useAdminPageMeta({ title: t('sso.page_title') });
  const toast = useToast();
  const confirm = useConfirm();
  const formModal = useDisclosure();

  const [providers, setProviders] = useState<AdminSsoProvider[]>([]);
  const [presets, setPresets] = useState<string[]>(['generic', 'entra', 'hivebrite']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingHasSecret, setEditingHasSecret] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ providers: AdminSsoProvider[]; presets: string[] }>(
        '/v2/admin/sso/providers'
      );
      if (res.success && res.data) {
        setProviders(res.data.providers);
        if (Array.isArray(res.data.presets) && res.data.presets.length > 0) {
          setPresets(res.data.presets);
        }
      }
    } catch {
      toast.error(t('sso.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateForm = useCallback(<K extends keyof ProviderForm>(field: K, value: ProviderForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingKey(null);
    setEditingHasSecret(false);
    setFormError(null);
    formModal.onOpen();
  }, [formModal]);

  const openEdit = useCallback(
    (provider: AdminSsoProvider) => {
      setForm({
        provider_key: provider.provider_key,
        display_name: provider.display_name,
        preset: provider.preset,
        issuer_url: provider.issuer_url,
        client_id: provider.client_id,
        client_secret: '',
        scopes: provider.scopes || 'openid profile email',
        allowed_email_domains: (provider.allowed_email_domains || []).join(', '),
        auto_provision: provider.auto_provision,
        is_enabled: provider.is_enabled,
      });
      setEditingKey(provider.provider_key);
      setEditingHasSecret(provider.has_client_secret);
      setFormError(null);
      formModal.onOpen();
    },
    [formModal]
  );

  const save = useCallback(async () => {
    const key = form.provider_key.trim();
    if (!PROVIDER_KEY_REGEX.test(key)) {
      setFormError(t('sso.key_invalid'));
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const res = await api.put<{ provider: AdminSsoProvider }>(
        `/v2/admin/sso/providers/${encodeURIComponent(key)}`,
        {
          display_name: form.display_name.trim(),
          preset: form.preset,
          issuer_url: form.issuer_url.trim(),
          client_id: form.client_id.trim(),
          client_secret: form.client_secret,
          scopes: form.scopes.trim(),
          allowed_email_domains: form.allowed_email_domains
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean),
          auto_provision: form.auto_provision,
          is_enabled: form.is_enabled,
        }
      );
      if (res.success && res.data?.provider) {
        const updated = res.data.provider;
        setProviders((prev) => {
          const exists = prev.some((p) => p.provider_key === updated.provider_key);
          return exists
            ? prev.map((p) => (p.provider_key === updated.provider_key ? updated : p))
            : [...prev, updated];
        });
        setTestResults((prev) => {
          const next = { ...prev };
          delete next[updated.provider_key];
          return next;
        });
        toast.success(t('sso.saved'));
        formModal.onClose();
      } else {
        setFormError(t('sso.save_failed'));
      }
    } catch {
      setFormError(t('sso.save_failed'));
    } finally {
      setSaving(false);
    }
  }, [form, formModal, t, toast]);

  const remove = useCallback(
    async (provider: AdminSsoProvider) => {
      const confirmed = await confirm({
        title: t('sso.delete_title'),
        body: t('sso.delete_body', { name: provider.display_name }),
        confirmLabel: t('sso.delete_confirm'),
      });
      if (!confirmed) return;
      setDeletingKey(provider.provider_key);
      try {
        const res = await api.delete<{ deleted: boolean }>(
          `/v2/admin/sso/providers/${encodeURIComponent(provider.provider_key)}`
        );
        if (res.success) {
          setProviders((prev) => prev.filter((p) => p.provider_key !== provider.provider_key));
          toast.success(t('sso.deleted'));
        } else {
          toast.error(t('sso.delete_failed'));
        }
      } catch {
        toast.error(t('sso.delete_failed'));
      } finally {
        setDeletingKey(null);
      }
    },
    [confirm, t, toast]
  );

  const testConnection = useCallback(
    async (provider: AdminSsoProvider) => {
      setTestingKey(provider.provider_key);
      try {
        const res = await api.post<TestResult>(
          `/v2/admin/sso/providers/${encodeURIComponent(provider.provider_key)}/test`,
          {}
        );
        if (res.success && res.data) {
          setTestResults((prev) => ({ ...prev, [provider.provider_key]: res.data as TestResult }));
        } else {
          setTestResults((prev) => ({
            ...prev,
            [provider.provider_key]: { ok: false, error: t('sso.test_failed') },
          }));
        }
      } catch {
        setTestResults((prev) => ({
          ...prev,
          [provider.provider_key]: { ok: false, error: t('sso.test_failed') },
        }));
      } finally {
        setTestingKey(null);
      }
    },
    [t]
  );

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('sso.loading')} className="flex h-32 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sso.page_title')}
        subtitle={t('sso.page_subtitle')}
        icon={<KeyRound size={22} />}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" startContent={<RefreshCw size={14} />} onPress={load}>
              {t('sso.refresh')}
            </Button>
            <Button size="sm" color="primary" startContent={<Plus size={14} />} onPress={openCreate}>
              {t('sso.add_provider')}
            </Button>
          </div>
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <p className="text-sm text-muted">{t('sso.intro')}</p>
          {providers.length === 0 ? (
            <p className="text-sm text-muted">{t('sso.no_providers')}</p>
          ) : (
            providers.map((provider) => {
              const result = testResults[provider.provider_key];
              return (
                <div
                  key={provider.provider_key}
                  className="flex flex-col gap-3 rounded-lg bg-surface-secondary px-4 py-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{provider.display_name}</p>
                        <Chip size="sm" variant="soft">{provider.provider_key}</Chip>
                        <Chip size="sm" variant="soft">
                          {t(`sso.preset_${provider.preset}`, { defaultValue: t('sso.preset_unknown') })}
                        </Chip>
                        <Chip size="sm" color={provider.is_enabled ? 'success' : 'warning'} variant="soft">
                          {provider.is_enabled ? t('sso.enabled') : t('sso.disabled')}
                        </Chip>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted">{provider.issuer_url}</p>
                      <p className="text-xs text-muted">{t('sso.updated_at', { date: formatDate(provider.updated_at) })}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={testingKey === provider.provider_key}
                        onPress={() => testConnection(provider)}
                      >
                        {testingKey === provider.provider_key ? t('sso.testing') : t('sso.test_connection')}
                      </Button>
                      <Button size="sm" variant="secondary" onPress={() => openEdit(provider)}>
                        {t('sso.edit')}
                      </Button>
                      <Button
                        size="sm"
                        color="danger"
                        variant="light"
                        isDisabled={deletingKey === provider.provider_key}
                        onPress={() => remove(provider)}
                      >
                        {t('sso.delete')}
                      </Button>
                    </div>
                  </div>
                  {result && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Chip size="sm" color={result.ok ? 'success' : 'danger'} variant="soft">
                        {result.ok ? t('sso.test_ok') : t('sso.test_error')}
                      </Chip>
                      <span className="text-muted break-all">
                        {result.ok ? result.authorization_endpoint || result.issuer : t('sso.test_failed')}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Modal isOpen={formModal.isOpen} onClose={formModal.onClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {editingKey ? t('sso.edit_provider_title', { name: form.display_name || editingKey }) : t('sso.add_provider')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Input
              label={t('sso.field_key')}
              value={form.provider_key}
              onValueChange={(v) => updateForm('provider_key', v)}
              isDisabled={editingKey !== null}
              variant="secondary"
              description={t('sso.field_key_desc')}
            />
            <Input
              label={t('sso.field_display_name')}
              value={form.display_name}
              onValueChange={(v) => updateForm('display_name', v)}
              variant="secondary"
              description={t('sso.field_display_name_desc')}
            />
            <Select
              label={t('sso.field_preset')}
              selectedKeys={[form.preset]}
              onSelectionChange={(keys) => {
                const key = Array.from(keys as Iterable<string>)[0];
                if (key) updateForm('preset', key);
              }}
              variant="secondary"
              description={form.preset === 'entra' ? t('sso.preset_entra_hint') : undefined}
            >
              {presets.map((preset) => (
                <SelectItem key={preset} id={preset} textValue={t(`sso.preset_${preset}`, { defaultValue: t('sso.preset_unknown') })}>
                  {t(`sso.preset_${preset}`, { defaultValue: t('sso.preset_unknown') })}
                </SelectItem>
              ))}
            </Select>
            <Input
              label={t('sso.field_issuer_url')}
              value={form.issuer_url}
              onValueChange={(v) => updateForm('issuer_url', v)}
              variant="secondary"
              description={t('sso.field_issuer_url_desc')}
            />
            <Input
              label={t('sso.field_client_id')}
              value={form.client_id}
              onValueChange={(v) => updateForm('client_id', v)}
              variant="secondary"
            />
            <SecretInput
              type="password"
              label={t('sso.field_client_secret')}
              value={form.client_secret}
              onValueChange={(v) => updateForm('client_secret', v)}
              variant="secondary"
              placeholder={editingKey && editingHasSecret ? t('sso.secret_keep_placeholder') : undefined}
              description={editingKey && editingHasSecret ? t('sso.secret_keep_desc') : undefined}
            />
            <Input
              label={t('sso.field_scopes')}
              value={form.scopes}
              onValueChange={(v) => updateForm('scopes', v)}
              variant="secondary"
              description={t('sso.field_scopes_desc')}
            />
            <Input
              label={t('sso.field_domains')}
              value={form.allowed_email_domains}
              onValueChange={(v) => updateForm('allowed_email_domains', v)}
              variant="secondary"
              description={t('sso.field_domains_desc')}
            />
            <div className="flex flex-col gap-3">
              <Switch
                isSelected={form.auto_provision}
                onValueChange={(v) => updateForm('auto_provision', v)}
                description={t('sso.field_auto_provision_desc')}
              >
                {t('sso.field_auto_provision')}
              </Switch>
              <Switch
                isSelected={form.is_enabled}
                onValueChange={(v) => updateForm('is_enabled', v)}
                description={t('sso.field_enabled_desc')}
              >
                {t('sso.field_enabled')}
              </Switch>
            </div>
            {formError && <p className="text-sm text-danger">{formError}</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={formModal.onClose} isDisabled={saving}>
              {t('sso.cancel')}
            </Button>
            <Button color="primary" onPress={save} isDisabled={saving}>
              {saving ? t('sso.saving') : t('sso.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default SsoProviders;
