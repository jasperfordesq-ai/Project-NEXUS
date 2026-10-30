import { Alert, Card, CardBody, CardHeader, Spinner, Button, Input, Select, SelectItem, Switch, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';

import { Separator } from '@/components/ui';
import Settings from 'lucide-react/icons/settings';
import BookOpen from 'lucide-react/icons/book-open';
import Trash2 from 'lucide-react/icons/trash-2';
import Plus from 'lucide-react/icons/plus';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { Link } from 'react-router-dom';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { languageDisplayName } from '@/lib/languageDisplayName';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Translation Configuration (INT9 + INT10)
 * Per-tenant translation settings and glossary management.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GlossaryEntry {
  id: number;
  source_term: string;
  target_term: string;
  target_language: string;
}

type ConfigValue = string | number | boolean;

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// The only translation provider the platform has. The page used to offer DeepL
// and Google as well; nothing ever read that choice (owner check of AWID's
// settings, 30 Oct 2026), so it now says which provider is used.
const PROVIDER_LABEL_KEY = 'config.translation_provider_openai';

const LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'ga', 'nl', 'pl', 'ja', 'ar'] as const;

const CONFIG_KEYS: Record<string, { labelKey: string; descKey: string }> = {
  'translation.enabled': {
    labelKey: 'config.translation_enabled_label',
    descKey: 'config.translation_enabled_desc',
  },
  'translation.engine': {
    labelKey: 'config.translation_engine_label',
    descKey: 'config.translation_engine_desc',
  },
  'translation.context_aware': {
    labelKey: 'config.translation_context_aware_label',
    descKey: 'config.translation_context_aware_desc',
  },
  'translation.context_messages': {
    labelKey: 'config.translation_context_messages_label',
    descKey: 'config.translation_context_messages_desc',
  },
  'translation.auto_translate_default': {
    labelKey: 'config.translation_auto_translate_label',
    descKey: 'config.translation_auto_translate_desc',
  },
  'translation.max_per_user_per_hour': {
    labelKey: 'config.translation_rate_limit_label',
    descKey: 'config.translation_rate_limit_desc',
  },
  'translation.glossary_enabled': {
    labelKey: 'config.translation_glossary_enabled_label',
    descKey: 'config.translation_glossary_enabled_desc',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TranslationConfig() {
  const { t, i18n } = useTranslation('admin_config');
  usePageTitle(t('config.translation_settings_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  // Translation runs on the community's AI. When AI is off every translation is
  // refused, and this page must say so (AWID had AI off, 30 Oct 2026).
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  const meta = (key: string) => {
    const entry = CONFIG_KEYS[key];
    if (!entry) return { label: key, description: '' };
    return { label: t(entry.labelKey), description: t(entry.descKey) };
  };

  // Config state
  const [config, setConfig] = useState<Record<string, ConfigValue>>({});
  const [defaults, setDefaults] = useState<Record<string, ConfigValue>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Glossary state
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [glossaryLoading, setGlossaryLoading] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newLang, setNewLang] = useState('');
  const [addingEntry, setAddingEntry] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<{ config: Record<string, ConfigValue>; defaults: Record<string, ConfigValue> }>('/v2/admin/config/translation');
      // API client already unwraps response.data.data → response.data
      const payload = response.data as { config?: Record<string, ConfigValue>; defaults?: Record<string, ConfigValue> } | undefined;
      if (payload) {
        setConfig(payload.config || {});
        setDefaults(payload.defaults || {});
      }
    } catch {
      toast.error(t('config.translation_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  const loadGlossary = useCallback(async () => {
    try {
      setGlossaryLoading(true);
      const response = await api.get<{ items: GlossaryEntry[]; total: number }>('/v2/admin/translation/glossary');
      const payload = response.data as { items?: GlossaryEntry[] } | undefined;
      if (payload) {
        setGlossary(payload.items || []);
      }
    } catch {
      toast.error(t('config.translation_glossary_load_failed'));
    } finally {
      setGlossaryLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ ai_enabled?: boolean }>('/v2/admin/config/ai')
      .then((response) => {
        const value = (response?.data as { ai_enabled?: unknown } | undefined)?.ai_enabled;
        if (!cancelled && typeof value === 'boolean') setAiEnabled(value);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const isGlossaryEnabled = config['translation.glossary_enabled'];

  useEffect(() => {
    if (isGlossaryEnabled) {
      loadGlossary();
    }
  }, [isGlossaryEnabled, loadGlossary]);

  // ── Config save ───────────────────────────────────────────────────────────

  const getValue = (key: string): ConfigValue => {
    return config[key] ?? defaults[key] ?? '';
  };

  const saveSetting = async (key: string, value: ConfigValue) => {
    setSaving(key);
    try {
      const res = await api.put('/v2/admin/config/translation', { key, value });
      if (res.success) {
        setConfig((prev) => ({ ...prev, [key]: value }));
        toast.success(t('config.translation_setting_updated', { setting: meta(key).label }));
      } else {
        toast.error(t('config.translation_setting_update_failed', { setting: meta(key).label }));
      }
    } catch {
      toast.error(t('config.translation_setting_update_failed', { setting: meta(key).label }));
    } finally {
      setSaving(null);
    }
  };

  // ── Glossary actions ──────────────────────────────────────────────────────

  const handleAddEntry = async () => {
    if (!newSource.trim() || !newTarget.trim() || !newLang) {
      toast.error(t('config.translation_glossary_fields_required'));
      return;
    }
    setAddingEntry(true);
    try {
      const res = await api.post('/v2/admin/translation/glossary', {
        source_term: newSource.trim(),
        target_term: newTarget.trim(),
        target_language: newLang,
      });
      if (res.success) {
        toast.success(t('config.translation_glossary_entry_added'));
        setNewSource('');
        setNewTarget('');
        setNewLang('');
        loadGlossary();
      } else {
        toast.error(t('config.translation_glossary_add_failed'));
      }
    } catch {
      toast.error(t('config.translation_glossary_add_failed'));
    } finally {
      setAddingEntry(false);
    }
  };

  const handleDeleteEntry = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await api.delete(`/v2/admin/translation/glossary/${id}`);
      if (res.success) {
        setGlossary((prev) => prev.filter((e) => e.id !== id));
        toast.success(t('config.translation_glossary_entry_removed'));
      } else {
        toast.error(t('config.translation_glossary_delete_failed'));
      }
    } catch {
      toast.error(t('config.translation_glossary_delete_failed'));
    } finally {
      setDeletingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
      </div>
    );
  }

  const glossaryEnabled = !!getValue('translation.glossary_enabled');

  return (
    <div>
      <PageHeader
        title={t('config.translation_settings_title')}
        description={t('config.translation_settings_desc')}
      />

      <div className="space-y-6">
        {aiEnabled === false && (
          <Alert
            color="warning"
            title={t('config.translation_ai_off_title')}
            description={t('config.translation_ai_off_desc')}
            endContent={(
              <Link className="text-sm font-medium text-accent underline" to={tenantPath('/admin/ai-settings')}>
                {t('config.translation_ai_off_link')}
              </Link>
            )}
          />
        )}

        {/* General Settings */}
        <Card >
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Settings size={18} className="text-accent" />
            <h3 className="font-semibold">{t('config.translation_general_settings')}</h3>
          </CardHeader>
          <CardBody className="divide-y divide-divider px-4">
            {/* translation.enabled */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.enabled').label}</p>
                <p className="text-sm text-muted">{meta('translation.enabled').description}</p>
              </div>
              <Switch
                isSelected={!!getValue('translation.enabled')}
                onValueChange={(val) => saveSetting('translation.enabled', val)}
                isDisabled={saving === 'translation.enabled'}
                size="sm"
              />
            </div>

            {/* Provider: fixed. There is no other provider to choose. */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.engine').label}</p>
                <p className="text-sm text-muted">{t('config.translation_provider_fixed_desc')}</p>
              </div>
              <p className="font-medium">{t(PROVIDER_LABEL_KEY)}</p>
            </div>

            {/* translation.context_aware */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.context_aware').label}</p>
                <p className="text-sm text-muted">{meta('translation.context_aware').description}</p>
              </div>
              <Switch
                isSelected={!!getValue('translation.context_aware')}
                onValueChange={(val) => saveSetting('translation.context_aware', val)}
                isDisabled={saving === 'translation.context_aware'}
                size="sm"
              />
            </div>

            {/* translation.context_messages */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.context_messages').label}</p>
                <p className="text-sm text-muted">{meta('translation.context_messages').description}</p>
              </div>
              <Input
                aria-label={meta('translation.context_messages').label}
                type="number"
                min={1}
                max={20}
                value={String(getValue('translation.context_messages') || 5)}
                onBlur={(e) => {
                  const num = Math.min(20, Math.max(1, parseInt(e.target.value) || 5));
                  saveSetting('translation.context_messages', num);
                }}
                className="max-w-[100px]"
                size="sm"
                isDisabled={saving === 'translation.context_messages'}
              />
            </div>

            {/* translation.auto_translate_default */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.auto_translate_default').label}</p>
                <p className="text-sm text-muted">{meta('translation.auto_translate_default').description}</p>
              </div>
              <Switch
                isSelected={!!getValue('translation.auto_translate_default')}
                onValueChange={(val) => saveSetting('translation.auto_translate_default', val)}
                isDisabled={saving === 'translation.auto_translate_default'}
                size="sm"
              />
            </div>

            {/* translation.max_per_user_per_hour */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.max_per_user_per_hour').label}</p>
                <p className="text-sm text-muted">{meta('translation.max_per_user_per_hour').description}</p>
              </div>
              <Input
                aria-label={meta('translation.max_per_user_per_hour').label}
                type="number"
                min={10}
                max={1000}
                value={String(getValue('translation.max_per_user_per_hour') || 100)}
                onBlur={(e) => {
                  const num = Math.min(1000, Math.max(10, parseInt(e.target.value) || 100));
                  saveSetting('translation.max_per_user_per_hour', num);
                }}
                className="max-w-[100px]"
                size="sm"
                isDisabled={saving === 'translation.max_per_user_per_hour'}
              />
            </div>

            <Separator />

            {/* translation.glossary_enabled */}
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{meta('translation.glossary_enabled').label}</p>
                <p className="text-sm text-muted">{meta('translation.glossary_enabled').description}</p>
              </div>
              <Switch
                isSelected={glossaryEnabled}
                onValueChange={(val) => saveSetting('translation.glossary_enabled', val)}
                isDisabled={saving === 'translation.glossary_enabled'}
                size="sm"
              />
            </div>
          </CardBody>
        </Card>

        {/* Glossary Management — only when glossary is enabled */}
        {glossaryEnabled && (
          <Card >
            <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
              <BookOpen size={18} className="text-accent" />
              <h3 className="font-semibold">{t('config.translation_glossary_management')}</h3>
              <span className="text-sm text-muted">{t('config.translation_glossary_management_desc')}</span>
            </CardHeader>
            <CardBody className="px-4 pb-4 space-y-4">
              {/* Add entry form */}
              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label={t('config.translation_source_term')}
                  placeholder={t('config.translation_source_term_placeholder')}
                  value={newSource}
                  onValueChange={setNewSource}
                  className="min-w-[160px] flex-1"
                  size="sm"
                />
                <Input
                  label={t('config.translation_target_term')}
                  placeholder={t('config.translation_target_term_placeholder')}
                  value={newTarget}
                  onValueChange={setNewTarget}
                  className="min-w-[160px] flex-1"
                  size="sm"
                />
                <Select
                  label={t('config.translation_language')}
                  aria-label={t('config.translation_target_language')}
                  selectedKeys={newLang ? [newLang] : []}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) setNewLang(val);
                  }}
                  className="min-w-[150px] flex-1"
                  size="sm"
                >
                  {LANGUAGES.map((code) => (
                    <SelectItem key={code} id={code}>{languageDisplayName(code, i18n.resolvedLanguage)}</SelectItem>
                  ))}
                </Select>
                <Button
                  startContent={<Plus size={16} />}
                  onPress={handleAddEntry}
                  isLoading={addingEntry}
                  isDisabled={addingEntry}
                  size="sm"
                >
                  {t('config.translation_add')}
                </Button>
              </div>

              <Separator />

              {/* Glossary table */}
              {glossaryLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
                </div>
              ) : glossary.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted">
                  {t('config.translation_glossary_empty')}
                </p>
              ) : (
                <Table aria-label={t('config.translation_glossary_entries')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('config.translation_col_source_term')}</TableColumn>
                    <TableColumn>{t('config.translation_col_target_term')}</TableColumn>
                    <TableColumn>{t('config.translation_col_language')}</TableColumn>
                    <TableColumn width={60}>{''}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {glossary.map((entry) => {
                      const langLabel = languageDisplayName(entry.target_language, i18n.resolvedLanguage);
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>{entry.source_term}</TableCell>
                          <TableCell>{entry.target_term}</TableCell>
                          <TableCell>{langLabel}</TableCell>
                          <TableCell>
                            <Button
                              isIconOnly
                              size="sm"
                              variant="danger"
                              onPress={() => handleDeleteEntry(entry.id)}
                              isDisabled={deletingId === entry.id}
                              aria-label={t('config.translation_delete_entry', { term: entry.source_term })}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

export default TranslationConfig;
