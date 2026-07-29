import { Button, Card, CardBody, CardHeader, Chip, Spinner, Tooltip, RadioGroup, Radio } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Separator } from '@/components/ui';
import Newspaper from 'lucide-react/icons/newspaper';
import Save from 'lucide-react/icons/save';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ExternalLink from 'lucide-react/icons/external-link';
import Info from 'lucide-react/icons/info';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type Cadence = 'off' | 'daily' | 'monthly';

interface CadenceResponse {
  cadence: Cadence | 'weekly';
}

const OPTIONS: Cadence[] = ['off', 'daily', 'monthly'];
const DIGEST_SOURCES = [
  'safety_alerts',
  'project_updates',
  'municipality_announcements',
  'events',
  'vereine',
  'care_providers',
  'marketplace',
  'help_requests',
  'feed_posts',
] as const;

export default function CivicDigestAdminPage() {
  const { t } = useTranslation('caring_community');
  const { t: tAdmin } = useTranslation('admin_caring_community');
  usePageTitle(t('admin.civic_digest.meta_title'));
  const { showToast } = useToast();
  const { tenantPath } = useTenant();

  const [cadence, setCadence] = useState<Cadence>('off');
  const [draft, setDraft] = useState<Cadence>('off');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<CadenceResponse>('/v2/admin/caring-community/digest/cadence');
      const raw = res.data?.cadence ?? 'off';
      const next: Cadence = raw === 'weekly' ? 'monthly' : raw;
      setCadence(next);
      setDraft(next);
    } catch {
      showToast(t('admin.civic_digest.errors.load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (draft === cadence) return;
    setSaving(true);
    try {
      const res = await api.put<CadenceResponse>('/v2/admin/caring-community/digest/cadence', {
        cadence: draft,
      });
      if (!res.success) {
        // The API client returns a failed response instead of throwing, so the
        // catch block below never saw a rejected save: the success toast fired
        // regardless of the outcome, and the server's own refusal was dropped.
        // admin-i18n-ignore: localized server message — CivicDigestService
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        showToast(res.error || t('admin.civic_digest.errors.save'), 'error');
        return;
      }
      const raw = res.data?.cadence ?? draft;
      const next: Cadence = raw === 'weekly' ? 'monthly' : raw;
      setCadence(next);
      setDraft(next);
      showToast(t('admin.civic_digest.messages.saved'), 'success');
    } catch {
      showToast(t('admin.civic_digest.errors.save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = draft !== cadence;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.civic_digest.title')}
        subtitle={t('admin.civic_digest.subtitle')}
        icon={<Newspaper size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              as={Link}
              to={tenantPath('/caring-community/civic-digest')}
              size="sm"
              variant="tertiary"
              endContent={<ExternalLink size={14} />}
            >
              {t('admin.civic_digest.preview_member_view')}
            </Button>
            <Tooltip content={t('admin.common.refresh')}>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                onPress={load}
                isLoading={loading}
                aria-label={t('admin.common.refresh')}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
          </div>
        }
      />

      <Card className="border border-accent/30 bg-accent-soft shadow-sm shadow-accent/10 dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('admin.civic_digest.about.title')}</p>
              <p className="text-muted">{t('admin.civic_digest.about.body')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading && (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      )}

      {!loading && (
        <>
          <Card  className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                <div>
                  <p className="text-sm font-semibold">{t('admin.civic_digest.cadence.title')}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {t('admin.civic_digest.cadence.description')}
                  </p>
                </div>
                <Chip size="sm" variant="soft" color={cadence === 'off' ? 'default' : 'primary'}>
                  {t('admin.civic_digest.cadence.current', { cadence: t(`admin.civic_digest.options.${cadence}.label`) })}
                </Chip>
              </div>
            </CardHeader>
            <CardBody className="pt-0 space-y-4">
              <RadioGroup
                aria-label={t('admin.civic_digest.cadence.title')}
                value={draft}
                onValueChange={(v) => setDraft(v as Cadence)}
              >
                {OPTIONS.map((opt) => (
                  <Radio
                    key={opt}
                    value={opt}
                    description={t(`admin.civic_digest.options.${opt}.description`)}
                  >
                    {t(`admin.civic_digest.options.${opt}.label`)}
                  </Radio>
                ))}
              </RadioGroup>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="tertiary"
                  onPress={() => setDraft(cadence)}
                  isDisabled={!isDirty || saving}
                >
                  {t('admin.civic_digest.reset')}
                </Button>
                <Button
                  startContent={<Save size={14} />}
                  onPress={save}
                  isLoading={saving}
                  isDisabled={!isDirty}
                >
                  {t('admin.civic_digest.save')}
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card  className="border border-divider/70 shadow-sm shadow-black/[0.03]">
            <CardBody className="space-y-2">
              <p className="text-sm font-semibold">{t('admin.civic_digest.includes.title')}</p>
              <p className="text-xs text-muted">
                {t('admin.civic_digest.includes.description')}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {DIGEST_SOURCES.map((tag) => (
                  <Chip key={tag} size="sm" variant="soft">
                    {t(`admin.civic_digest.includes.sources.${tag}`)}
                  </Chip>
                ))}
              </div>
            </CardBody>
          </Card>

          <Separator />
          <p className="text-xs text-muted">
            {t('admin.civic_digest.member_override')}
          </p>
        </>
      )}
    </div>
  );
}
