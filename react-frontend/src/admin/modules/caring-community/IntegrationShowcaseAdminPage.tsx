import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Spinner, Snippet, Accordion, AccordionItem, Tooltip } from '@/components/ui';
import {
  useCallback,
  useEffect,
  useMemo,
  useState } from 'react';

import { Separator } from '@/components/ui';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import ExternalLink from 'lucide-react/icons/external-link';
import FileCode from 'lucide-react/icons/file-code';
import FileJson from 'lucide-react/icons/file-json';
import Info from 'lucide-react/icons/info';
import KeyRound from 'lucide-react/icons/key-round';
import Network from 'lucide-react/icons/network';
import Plug from 'lucide-react/icons/plug';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Webhook from 'lucide-react/icons/webhook';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { safeHref } from '@/lib/safeHref';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

interface ShowcaseItem {
  code: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

interface SamplePayload {
  code: string;
  kind: 'json' | 'curl';
  body: string;
  headers?: string[];
}

interface Section {
  id: string;
  icon: string;
  items?: ShowcaseItem[];
  samples?: SamplePayload[];
  checklist_codes?: string[];
  docs_link?: string;
  sample_request?: { curl: string };
  verification_note_code?: string;
}

interface Showcase {
  updated_at: string;
  sections: Section[];
}

const ICON_MAP: Record<string, typeof FileJson> = {
  FileJson,
  Plug,
  KeyRound,
  Webhook,
  Network,
  FileCode,
  ClipboardList,
};

const METHOD_COLOUR: Record<string, 'success' | 'primary' | 'warning' | 'danger'> = {
  GET: 'success',
  POST: 'primary',
  PUT: 'warning',
  DELETE: 'danger',
};

type AdminT = (key: string, options?: Record<string, unknown>) => string;

const sectionTitle = (t: AdminT, sectionId: string) =>
  t(`integration_showcase.manifest.sections.${sectionId}.title`);

const sectionBody = (t: AdminT, sectionId: string) =>
  t(`integration_showcase.manifest.sections.${sectionId}.body`);

const endpointLabel = (t: AdminT, code: string) =>
  t(`integration_showcase.manifest.endpoints.${code}`);

const sampleLabel = (t: AdminT, code: string) =>
  t(`integration_showcase.manifest.samples.${code}`);

export default function IntegrationShowcaseAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('integration_showcase.meta.page_title'));
  const { showToast } = useToast();

  const [data, setData] = useState<Showcase | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Showcase>('/v2/admin/caring-community/integration-showcase');
      setData(res.data ?? null);
    } catch {
      showToast(t('integration_showcase.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const updatedLabel = useMemo(
    () => (data?.updated_at ? new Date(data.updated_at).toLocaleString(getFormattingLocale()) : t('integration_showcase.empty.value')),
    [data?.updated_at, t],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('integration_showcase.meta.title')}
        subtitle={t('integration_showcase.meta.subtitle')}
        icon={<Plug size={20} />}
        actions={
          <Tooltip content={t('integration_showcase.actions.refresh')}>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={load}
              isLoading={loading}
              aria-label={t('integration_showcase.actions.refresh_aria')}
            >
              <RefreshCw size={15} />
            </Button>
          </Tooltip>
        }
      />

      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('integration_showcase.about.title')}</p>
              <p className="text-muted">
                {t('integration_showcase.about.body')}
              </p>
              <p className="text-muted text-xs">{t('integration_showcase.about.last_refreshed', { date: updatedLabel })}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading && (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      )}

      {!loading && data && (
        <Accordion variant="splitted" selectionMode="multiple" defaultExpandedKeys={['openapi', 'partner_api']}>
          {data.sections.map((section) => {
            const Icon = ICON_MAP[section.icon] ?? Plug;
            const title = sectionTitle(t, section.id);
            return (
              <AccordionItem
                key={section.id} id={section.id}
                aria-label={title}
                title={
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon size={16} />
                    {title}
                  </span>
                }
              >
                <div className="space-y-4 pb-2">
                  <p className="text-sm text-muted">{sectionBody(t, section.id)}</p>

                  {section.items && section.items.length > 0 && (
                    <div className="space-y-2">
                      {section.items.map((item) => (
                        <div
                          key={`${section.id}-${item.method}-${item.path}`}
                          className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                        >
                          <Chip
                            size="sm"
                            color={METHOD_COLOUR[item.method] ?? 'default'}
                            variant="soft"
                            className="font-mono text-xs"
                          >
                            {item.method}
                          </Chip>
                          <code className="flex-1 text-xs font-mono text-foreground">{item.path}</code>
                          <span className="text-xs text-muted">{endpointLabel(t, item.code)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {section.sample_request && (
                    <Card className="border border-[var(--color-border)]">
                      <CardHeader className="pb-1">
                        <span className="text-xs font-semibold">{t('integration_showcase.sections.sample_request')}</span>
                      </CardHeader>
                      <CardBody className="pt-0">
                        <Snippet
                          variant="tertiary"
                          symbol=""
                          className="text-xs whitespace-pre w-full"
                        >
                          {section.sample_request.curl}
                        </Snippet>
                      </CardBody>
                    </Card>
                  )}

                  {section.verification_note_code && (
                    <Card className="border border-warning bg-warning/10">
                      <CardBody className="py-2 text-xs">
                        {t(`integration_showcase.manifest.verification_notes.${section.verification_note_code}`)}
                      </CardBody>
                    </Card>
                  )}

                  {section.samples && section.samples.length > 0 && (
                    <div className="space-y-3">
                      {section.samples.map((sample, i) => (
                        <Card key={`${section.id}-sample-${i}`} className="border border-[var(--color-border)]">
                          <CardHeader className="pb-1 flex items-center justify-between">
                            <span className="text-xs font-semibold">{sampleLabel(t, sample.code)}</span>
                            <Chip size="sm" variant="soft">{sample.kind.toUpperCase()}</Chip>
                          </CardHeader>
                          <CardBody className="pt-0 space-y-2">
                            {sample.headers && sample.headers.length > 0 && (
                              <div className="rounded bg-[var(--color-surface-alt)] p-2 font-mono text-[11px] text-muted">
                                {sample.headers.map((h, j) => (
                                  <div key={`${section.id}-hdr-${i}-${j}`}>{h}</div>
                                ))}
                              </div>
                            )}
                            <Snippet
                              variant="tertiary"
                              symbol=""
                              className="text-xs whitespace-pre w-full overflow-auto"
                            >
                              {sample.body}
                            </Snippet>
                          </CardBody>
                        </Card>
                      ))}
                    </div>
                  )}

                  {section.checklist_codes && section.checklist_codes.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-foreground space-y-1">
                      {section.checklist_codes.map((code) => (
                        <li key={`${section.id}-cl-${code}`}>
                          {t(`integration_showcase.manifest.checklist.${code}`)}
                        </li>
                      ))}
                    </ul>
                  )}

                  {section.docs_link && (
                    <>
                      <Separator />
                      <a
                        href={safeHref(section.docs_link)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        {t('integration_showcase.sections.read_full_spec')} <ExternalLink size={12} />
                      </a>
                    </>
                  )}
                </div>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
