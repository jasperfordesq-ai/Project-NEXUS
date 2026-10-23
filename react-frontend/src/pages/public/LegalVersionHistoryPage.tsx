// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Legal Document Version History Page
 *
 * Shows all published versions of a legal document (terms, privacy, etc.)
 * with a timeline UI. Clicking a version expands it to show the full content
 * with a "Summary of Changes" callout. Each non-original version has a
 * change-comparison button that loads a unified diff from the previous version.
 *
 * Routes:
 *   /terms/versions
 *   /privacy/versions
 *   /cookies/versions
 *   /accessibility/versions
 *   /community-guidelines/versions
 *   /acceptable-use/versions
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';
import { sanitizeRichText } from '@/lib/sanitize';
import { Chip } from '@/components/ui/Chip';
import History from 'lucide-react/icons/history';
import CalendarDays from 'lucide-react/icons/calendar-days';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';
import FileText from 'lucide-react/icons/file-text';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Info from 'lucide-react/icons/info';
import GitCompareArrows from 'lucide-react/icons/git-compare-arrows';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { formatDateValue } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import type {
  LegalDocumentType,
  LegalVersionSummary,
  LegalVersionDetail,
} from '@/hooks/useLegalDocument';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/** Map route slug → API document type */
const SLUG_TO_TYPE: Record<string, LegalDocumentType> = {
  terms: 'terms',
  privacy: 'privacy',
  cookies: 'cookies',
  accessibility: 'accessibility',
  'community-guidelines': 'community_guidelines',
  'acceptable-use': 'acceptable_use',
};

/** Map type → parent page route for "back" link */
const TYPE_TO_ROUTE: Record<string, string> = {
  terms: '/terms',
  privacy: '/privacy',
  cookies: '/cookies',
  accessibility: '/accessibility',
  community_guidelines: '/community-guidelines',
  acceptable_use: '/acceptable-use',
};

/** Map type → `common` key of the document's translated name */
const TYPE_TO_NAME_KEY: Record<string, string> = {
  terms: 'legal.terms_of_service',
  privacy: 'legal.privacy_policy',
  cookies: 'legal.cookie_policy',
  accessibility: 'legal.accessibility',
  community_guidelines: 'legal.type_community_guidelines',
  acceptable_use: 'legal.type_acceptable_use',
};

interface VersionComparison {
  version1: { version_number: string; effective_date: string };
  version2: { version_number: string; effective_date: string };
  diff_html: string;
  changes_count: number;
}

function formatDate(dateStr: string | null, unknownLabel: string): string {
  if (!dateStr) return unknownLabel;
  return formatDateValue(dateStr, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function LegalVersionHistoryPage() {
  const { t } = useTranslation('legal');
  const location = useLocation();
  const { tenantPath, isLoading: tenantLoading, tenant } = useTenant();

  // Extract document slug from URL path: /terms/versions → "terms"
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const versionsIdx = pathSegments.indexOf('versions');
  const slug = versionsIdx > 0 ? (pathSegments[versionsIdx - 1] ?? '') : '';
  const docType = SLUG_TO_TYPE[slug];

  const [title, setTitle] = useState('');
  const [versions, setVersions] = useState<LegalVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedContent, setExpandedContent] = useState<LegalVersionDetail | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Diff state
  const [diffForVersionId, setDiffForVersionId] = useState<number | null>(null);
  const [diffData, setDiffData] = useState<VersionComparison | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  usePageTitle(title ? `${title} - ${t('version_history.page_title')}` : t('version_history.page_title'));

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!docType) return;
    // Wait for tenant context so X-Tenant-ID header is available
    if (tenantLoading || !tenant) return;

    api.get<{ title: string; type: string; versions: LegalVersionSummary[] }>(
      `/v2/legal/${docType}/versions`
    )
      .then((res) => {
        if (res.success && res.data) {
          setTitle(res.data.title);
          setVersions(res.data.versions ?? []);
        }
      })
      .catch((err: unknown) => {
        logError('LegalVersionHistoryPage: failed to load version list', err);
      })
      .finally(() => setLoading(false));
  }, [docType, tenantLoading, tenant]);

  const handleToggle = async (version: LegalVersionSummary) => {
    if (expandedId === version.id) {
      setExpandedId(null);
      setExpandedContent(null);
      // Also close diff if it belongs to this version
      if (diffForVersionId === version.id) {
        setDiffForVersionId(null);
        setDiffData(null);
      }
      return;
    }

    setExpandedId(version.id);
    setExpandedContent(null);
    setLoadingContent(true);

    try {
      const res = await api.get<LegalVersionDetail>(`/v2/legal/version/${version.id}`);
      if (res.success && res.data) {
        setExpandedContent(res.data);
      }
    } catch {
      // Silently handle
    } finally {
      setLoadingContent(false);
    }
  };

  /**
   * Load a diff between the given version and its predecessor.
   * Versions are sorted newest-first, so the "previous" version is at idx + 1.
   */
  const handleViewDiff = useCallback(async (version: LegalVersionSummary, previousVersion: LegalVersionSummary) => {
    // Toggle off if already showing
    if (diffForVersionId === version.id) {
      setDiffForVersionId(null);
      setDiffData(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setDiffForVersionId(version.id);
    setDiffData(null);
    setLoadingDiff(true);

    try {
      const res = await api.get<VersionComparison>(
        `/v2/legal/versions/compare?v1=${previousVersion.id}&v2=${version.id}`
      );
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        setDiffData(res.data);
      }
    } catch {
      // Silently handle
    } finally {
      setLoadingDiff(false);
    }
  }, [diffForVersionId]);

  if (!docType) {
    return (
      <div className="max-w-4xl mx-auto text-center py-16">
        <p className="text-theme-muted">{t('version_history.not_found')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center items-center min-h-[50vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  const backRoute = TYPE_TO_ROUTE[docType] ?? '/terms';
  // The document's own heading, or its translated type name if it has none.
  const documentName = title || t(TYPE_TO_NAME_KEY[docType] ?? 'legal.legal_hub', { ns: 'common' });

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-6"
    >
      {/* Each document's history has its own title (2026-10-23: all six
          shared "Legal Version History"). */}
      <PageMeta
        title={t('page_meta.legal_version_history.title_with_document', { title: documentName })}
        description={t('page_meta.legal_version_history.description_with_document', { title: documentName })}
      />
      {/* Back link */}
      <motion.div variants={itemVariants}>
        <Link
          to={tenantPath(backRoute)}
          className="inline-flex items-center gap-1.5 text-sm text-theme-muted hover:text-theme-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('version_history.back_to', { title: title || t('version_history.document') })}
        </Link>
      </motion.div>

      {/* Hero Header */}
      <motion.div variants={itemVariants} className="text-center">
        <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-slate-500/20 to-blue-500/20 mb-4">
          <History className="w-10 h-10 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-theme-primary mb-3">
          {t('version_history.heading')}
        </h1>
        <p className="text-theme-muted text-lg max-w-2xl mx-auto">
          {title ? t('version_history.subtitle_with_title', { title }) : t('version_history.subtitle_generic')}
        </p>
      </motion.div>

      {/* No versions */}
      {versions.length === 0 && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-8 text-center">
            <FileText className="w-12 h-12 text-theme-subtle mx-auto mb-3" aria-hidden="true" />
            <p className="text-theme-muted">{t('version_history.no_versions')}</p>
            <Button as={Link} to={tenantPath(backRoute)} size="sm" variant="tertiary" className="mt-4 inline-block bg-theme-elevated text-theme-primary">
              {t('version_history.view_current')}
            </Button>
          </GlassCard>
        </motion.div>
      )}

      {/* Timeline */}
      {versions.length > 0 && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-[var(--border-default)] hidden sm:block" />

          {versions.map((version, idx) => {
            const isLastVersion = idx === versions.length - 1;
            const previousVersion = !isLastVersion ? versions[idx + 1] : null;
            const isDiffOpen = diffForVersionId === version.id;

            return (
              <motion.div
                key={version.id}
                variants={itemVariants}
                className="relative sm:pl-16 mb-4"
              >
                {/* Timeline dot */}
                <div className="absolute left-4 top-6 hidden sm:flex items-center justify-center w-5 h-5 rounded-full border-2 border-[var(--border-default)] bg-[var(--surface-base)] z-10">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      version.is_current ? 'bg-emerald-500' : 'bg-[var(--text-subtle)]'
                    }`}
                  />
                </div>

                <GlassCard className="overflow-hidden">
                  {/* Version header (clickable) */}
                  <Button
                    variant="ghost"
                    onPress={() => handleToggle(version)}
                    className="w-full min-h-[76px] flex items-center justify-start gap-3 rounded-none p-5 text-left transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold text-theme-primary text-base">
                          {t('version_history.version_number', { number: version.version_number })}
                        </span>
                        {version.is_current && (
                          <Chip
                            size="sm"
                            variant="tertiary"
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          >
                            <CheckCircle className="w-3 h-3" aria-hidden="true" />
                            {t('version_history.current')}
                          </Chip>
                        )}
                        {!version.is_current && isLastVersion && (
                          <Chip
                            size="sm"
                            variant="tertiary"
                            className="bg-[var(--surface-elevated)] text-theme-subtle"
                          >
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {t('version_history.original')}
                          </Chip>
                        )}
                        {version.version_label && (
                          <span className="text-sm text-theme-subtle italic">
                            {version.version_label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-theme-muted">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                          {t('version_history.effective', {
                            date: formatDate(version.effective_date, t('version_history.unknown_date')),
                          })}
                        </span>
                      </div>
                      {version.summary_of_changes && (
                        <p className="mt-2 text-sm text-theme-muted line-clamp-2">
                          {version.summary_of_changes}
                        </p>
                      )}
                    </div>
                    {expandedId === version.id ? (
                      <ChevronUp className="w-5 h-5 text-theme-subtle shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-theme-subtle shrink-0" aria-hidden="true" />
                    )}
                  </Button>

                  {/* Expanded content */}
                  {expandedId === version.id && (
                    <div className="border-t border-[var(--border-default)]">
                      {loadingContent && (
                        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-8">
                          <Spinner size="md" />
                        </div>
                      )}
                      {expandedContent && (
                        <div className="p-5 sm:p-6 space-y-4">
                          {/* Summary of changes callout */}
                          {expandedContent.summary_of_changes && (
                            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                              <Info className="w-5 h-5 text-[var(--color-info)] mt-0.5 shrink-0" aria-hidden="true" />
                              <div>
                                <h4 className="font-medium text-sm text-blue-600 dark:text-blue-400 mb-1">
                                  {t('version_history.summary_of_changes')}
                                </h4>
                                <p className="text-sm text-theme-muted">
                                  {expandedContent.summary_of_changes}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Diff comparison button — only for non-original versions */}
                          {previousVersion && (
                            <div>
                              <Button
                                size="sm"
                                variant={isDiffOpen ? 'flat' : 'bordered'}
                                className={
                                  isDiffOpen
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                    : 'text-theme-muted border-[var(--border-default)]'
                                }
                                startContent={
                                  isDiffOpen
                                    ? <X className="w-3.5 h-3.5" aria-hidden="true" />
                                    : <GitCompareArrows className="w-3.5 h-3.5" aria-hidden="true" />
                                }
                                onPress={() => handleViewDiff(version, previousVersion)}
                              >
                                {isDiffOpen
                                  ? t('version_history.hide_changes')
                                  : t('version_history.view_changes', {
                                      prev: previousVersion.version_number,
                                    })}
                              </Button>
                            </div>
                          )}

                          {/* Diff panel */}
                          <AnimatePresence>
                            {isDiffOpen && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                {loadingDiff && (
                                  <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-6">
                                    <Spinner size="md" />
                                  </div>
                                )}
                                {diffData && (
                                  <div className="rounded-xl border border-amber-500/20 overflow-hidden">
                                    {/* Diff header */}
                                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/5 border-b border-amber-500/20">
                                      <div className="flex items-center gap-2 text-sm">
                                        <GitCompareArrows className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />
                                        <span className="font-medium text-theme-primary">
                                          {t('version_history.changes_between', {
                                            old: diffData.version1.version_number,
                                            new: diffData.version2.version_number,
                                          })}
                                        </span>
                                        <Chip size="sm" variant="tertiary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                          {t('version_history.changes_count', {
                                            count: diffData.changes_count,
                                          })}
                                        </Chip>
                                      </div>
                                    </div>

                                    {/* Legend */}
                                    <div className="flex items-center gap-4 px-4 py-2 bg-[var(--surface-elevated)] border-b border-[var(--border-default)] text-xs text-theme-muted">
                                      <span className="inline-flex items-center gap-1">
                                        <span className="inline-block w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/30" aria-hidden="true" />
                                        {t('version_history.legend_removed')}
                                      </span>
                                      <span className="inline-flex items-center gap-1">
                                        <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500/20 border border-emerald-500/30" aria-hidden="true" />
                                        {t('version_history.legend_added')}
                                      </span>
                                    </div>

                                    {/* Diff content */}
                                    <div
                                      className="version-diff-content max-h-[500px] overflow-y-auto p-4 text-sm font-mono leading-relaxed"
                                      dangerouslySetInnerHTML={{ __html: sanitizeRichText(diffData.diff_html) }}
                                    />
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Full document content */}
                          <div
                            className="legal-content"
                            dangerouslySetInnerHTML={{ __html: sanitizeRichText(expandedContent.content) }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Back CTA */}
      <motion.div variants={itemVariants} className="text-center pt-2">
        <Button as={Link} to={tenantPath(backRoute)}
          variant="tertiary"
          className="bg-theme-elevated text-theme-primary"
          startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
        >
          {t('version_history.back_to_current', { title })}
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default LegalVersionHistoryPage;
