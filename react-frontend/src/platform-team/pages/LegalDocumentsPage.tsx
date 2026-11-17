// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Legal documents.
 *
 * Per community: its terms and its privacy notice (always listed, even when
 * the community has none) and any other legal document it has; whether each
 * is published, which version and since when; whether members must accept it;
 * and, where they must, how many members have not accepted the current
 * version. A summary names the communities without a published privacy
 * notice. One card per community at every width, because each community has
 * a different set of documents. Every state is shown with an icon AND words.
 *
 * 🔴 Counts only: no member is named on this page. Read-only; documents are
 * written and published in each community's own admin panel.
 *
 * A figure the server could not read arrives as null and is shown as "Not
 * available", never as zero: "everyone has accepted" would be a comforting lie.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { FiguresRefresh, withRefresh } from '../components/FiguresRefresh';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { joinList } from '@/lib/listFormat';
import { logError } from '@/lib/logger';
import CircleCheck from 'lucide-react/icons/circle-check';
import CircleDashed from 'lucide-react/icons/circle-dashed';
import CircleHelp from 'lucide-react/icons/circle-help';
import Eye from 'lucide-react/icons/eye';
import FileX from 'lucide-react/icons/file-x';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { getFormattingLocale } from '@/lib/helpers';

export interface LegalDocument {
  type: string;
  exists: boolean;
  published: boolean;
  version_number: string | null;
  published_at: string | null;
  requires_acceptance: boolean | null;
  members_asked: number | null;
  members_not_accepted: number | null;
}

export interface LegalDocumentsRow {
  id: number;
  name: string;
  slug: string | null;
  is_active: boolean;
  no_privacy_notice: boolean | null;
  documents: LegalDocument[] | null;
}

export interface LegalDocuments {
  unavailable: string[];
  totals: { communities: number; no_privacy_notice: number | null };
  communities: LegalDocumentsRow[];
  /** When the server worked these figures out (absent from an older server). */
  generated_at?: string | null;
}

/** The document kinds the server knows; anything else is shown by its raw kind. */
const KNOWN_TYPES = ['terms', 'privacy', 'cookies', 'accessibility', 'community_guidelines', 'acceptable_use'];

export function LegalDocumentsPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('legal_documents.title'));

  const [data, setData] = useState<LegalDocuments | null>(null);
  const [refused, setRefused] = useState(false);
  /** Figures are on screen: a refused "Check again" keeps them. */
  const shown = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setRefused(false);
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<LegalDocuments>(withRefresh('/v2/platform-team/legal-documents', refresh));
      if (res.success && res.data && Array.isArray(res.data.communities) && res.data.totals) {
        setData(res.data);
        shown.current = true;
      } else if (refresh && shown.current && res.code === 'RATE_LIMIT_EXCEEDED') {
        // Asked again too soon: keep what is on screen and say so.
        setRefused(true);
      } else {
        setData(null);
        shown.current = false;
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load legal documents', err);
      setData(null);
      shown.current = false;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const notAvailable = (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <CircleHelp size={16} className="shrink-0" aria-hidden="true" />
      {t('legal_documents.not_available')}
    </span>
  );

  const typeName = (type: string): string =>
    KNOWN_TYPES.includes(type) ? t(`legal_documents.type.${type}`) : type;

  const status = (document: LegalDocument) => {
    if (!document.exists) {
      return (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <FileX size={16} className="shrink-0" aria-hidden="true" />
          {t('legal_documents.status.missing')}
        </span>
      );
    }
    return document.published ? (
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <CircleCheck size={16} className="shrink-0 text-success" aria-hidden="true" />
        {t('legal_documents.status.published')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <CircleDashed size={16} className="shrink-0" aria-hidden="true" />
        {t('legal_documents.status.not_published')}
      </span>
    );
  };

  const versionLine = (document: LegalDocument): string | null => {
    if (!document.published || document.version_number === null) return null;
    const when = document.published_at ? new Date(document.published_at) : null;
    const date =
      when && !Number.isNaN(when.getTime())
        ? when.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
        : t('legal_documents.date_unknown');
    return t('legal_documents.version', { version: document.version_number, date });
  };

  /** Only for a published document; nothing at all for one that is not. */
  const membersLine = (document: LegalDocument) => {
    if (!document.published) return null;
    if (document.requires_acceptance === false) {
      return <span className="text-muted">{t('legal_documents.no_acceptance_needed')}</span>;
    }
    if (document.members_asked === null || document.members_not_accepted === null) {
      return <span className="text-muted">{t('legal_documents.members_not_available')}</span>;
    }
    if (document.members_not_accepted === 0) {
      return (
        <span className="text-foreground">
          {t('legal_documents.all_accepted', { count: document.members_asked })}
        </span>
      );
    }
    return (
      <span className="font-medium text-warning">
        {t('legal_documents.members_not_accepted', {
          count: document.members_not_accepted,
          asked: new Intl.NumberFormat(getFormattingLocale()).format(document.members_asked),
        })}
      </span>
    );
  };

  const withoutPrivacy = data ? data.communities.filter((c) => c.no_privacy_notice === true) : [];

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('legal_documents.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('legal_documents.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('legal_documents.where_changed')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Eye size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('legal_documents.counts_only')}
          </p>
        </div>
        <FiguresRefresh
          onRefresh={() => void load(true)}
          loading={loading}
          generatedAt={data?.generated_at}
          refused={refused}
        />
      </div>

      {loading && !data ? (
        <div role="status" aria-busy="true" aria-label={t('legal_documents.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !data ? (
        <LoadError title={t('legal_documents.load_error_title')} onRetry={() => void load()} />
      ) : data.communities.length === 0 ? (
        <p className="text-sm text-muted">{t('legal_documents.empty')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {data.unavailable.length > 0 ? (
            <p className="max-w-2xl text-sm text-warning-soft-foreground" role="status">
              {t('legal_documents.unavailable_note')}
            </p>
          ) : null}

          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4" data-testid="legal-documents-privacy">
              <ShieldAlert
                size={20}
                className={`mt-0.5 shrink-0 ${withoutPrivacy.length > 0 ? 'text-danger' : 'text-muted'}`}
                aria-hidden="true"
              />
              <div className="min-w-0 text-sm">
                {data.totals.no_privacy_notice === null ? (
                  <p className="font-medium text-foreground">{t('legal_documents.privacy_unknown')}</p>
                ) : withoutPrivacy.length > 0 ? (
                  <>
                    <p className="font-medium text-foreground">
                      {t('legal_documents.no_privacy_count', { count: withoutPrivacy.length })}
                    </p>
                    <p className="mt-1 break-words text-foreground">
                      {t('legal_documents.no_privacy_names', {
                        names: joinList(withoutPrivacy.map((c) => c.name), i18n.language),
                      })}
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-foreground">{t('legal_documents.all_have_privacy')}</p>
                )}
                <p className="mt-2 text-muted">{t('legal_documents.who_is_asked')}</p>
              </div>
            </CardBody>
          </Card>

          <p className="text-sm text-muted">{t('legal_documents.community_count', { count: data.totals.communities })}</p>

          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="legal-documents-list">
            {data.communities.map((community) => (
              <li key={community.id} className="min-w-0">
                <Card className="h-full">
                  <CardBody className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="min-w-0 break-words text-base font-semibold text-foreground">{community.name}</h2>
                      <div className="flex flex-wrap gap-2">
                        {community.no_privacy_notice ? (
                          <Chip size="sm" variant="soft" color="danger">
                            {t('legal_documents.no_privacy_flag')}
                          </Chip>
                        ) : null}
                        {community.is_active ? null : (
                          <Chip size="sm" variant="soft" color="default">
                            {t('legal_documents.not_active')}
                          </Chip>
                        )}
                      </div>
                    </div>
                    {community.documents === null ? (
                      <p className="mt-3 text-sm">{notAvailable}</p>
                    ) : (
                      <ul className="mt-3 flex flex-col divide-y divide-divider text-sm">
                        {community.documents.map((document) => {
                          const version = versionLine(document);
                          const members = membersLine(document);
                          return (
                            <li
                              key={document.type}
                              className="flex flex-col gap-1 py-2"
                              data-testid={`legal-document-${document.type}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                                <span className="font-medium text-foreground">{typeName(document.type)}</span>
                                {status(document)}
                              </div>
                              {version ? <span className="text-xs text-muted">{version}</span> : null}
                              {members ? <span className="text-xs">{members}</span> : null}
                              {document.type === 'terms' ? (
                                <span className="text-xs text-muted">{t('legal_documents.terms_seeded')}</span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default LegalDocumentsPage;
