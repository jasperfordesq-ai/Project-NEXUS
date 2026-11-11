// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback } from 'react';

import { sanitizeRichText } from '@/lib/sanitize';
import GitCompare from 'lucide-react/icons/git-compare';
import FileText from 'lucide-react/icons/file-text';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
import { adminLegalDocs } from '@/admin/api/adminApi';
import type { VersionComparison } from '@/admin/api/types';
import { Button, Chip, Spinner, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';

interface LegalDocVersionComparisonProps {
  documentId: number;
  version1Id: number;
  version2Id: number;
  onClose: () => void;
}

export default function LegalDocVersionComparison({
  documentId,
  version1Id,
  version2Id,
  onClose,
}: LegalDocVersionComparisonProps) {
  const { t } = useTranslation('admin_enterprise');
  const { error } = useToast();

  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [loading, setLoading] = useState(true);

  const loadComparison = useCallback(async () => {
    try {
      setLoading(true);
      const response = await adminLegalDocs.compareVersions(documentId, version1Id, version2Id);

      if (response.success && response.data) {
        setComparison(response.data);
      } else {
        error(t('enterprise.comparison.failed_to_load'));
      }
    } catch {
      error(t('enterprise.comparison.failed_to_load'));
    } finally {
      setLoading(false);
    }
  }, [documentId, version1Id, version2Id, error, t]);


  useEffect(() => {
    loadComparison();
  }, [loadComparison]);

  return (
    <>
      <ModalHeader className="flex items-center gap-2">
        <GitCompare size={20} />
        <span>{t('enterprise.comparison.title')}</span>
      </ModalHeader>

      <ModalBody>
        {loading ? (
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center items-center min-h-[300px]">
            <Spinner size="lg" />
          </div>
        ) : comparison ? (
          <div className="space-y-6">
            {/* Version Headers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={16} />
                  <span className="font-semibold">
                    {t('enterprise.comparison.version')}
                  </span>
                  {comparison.version1.is_current && (
                    <Chip size="sm" color="success">{t('enterprise.version_list.current')}</Chip>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('enterprise.comparison.created')}: {new Date(comparison.version1.created_at).toLocaleDateString(getFormattingLocale())}
                </p>
                {comparison.version1.effective_date && (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t('enterprise.version_list.effective')}: {new Date(comparison.version1.effective_date).toLocaleDateString(getFormattingLocale())}
                  </p>
                )}
              </div>

              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <FileText size={16} />
                  <span className="font-semibold">
                    {t('enterprise.comparison.version')}
                  </span>
                  {comparison.version2.is_current && (
                    <Chip size="sm" color="success">{t('enterprise.version_list.current')}</Chip>
                  )}
                </div>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('enterprise.comparison.created')}: {new Date(comparison.version2.created_at).toLocaleDateString(getFormattingLocale())}
                </p>
                {comparison.version2.effective_date && (
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    {t('enterprise.version_list.effective')}: {new Date(comparison.version2.effective_date).toLocaleDateString(getFormattingLocale())}
                  </p>
                )}
              </div>
            </div>

            {/* Changes Count */}
            <div className="flex items-center gap-2 p-3 bg-accent-soft dark:bg-accent-soft rounded-lg">
              <AlertCircle size={18} className="text-accent" />
              <span className="text-sm">
                {comparison.changes_count > 0
                  ? t('enterprise.comparison.changes_detected')
                  : t('enterprise.comparison.no_changes')}
              </span>
            </div>

            {/* Diff Display */}
            <div>
              <h3 className="font-semibold mb-3">{t('enterprise.comparison.content_comparison')}</h3>
              <div
                className="version-diff-content typography-prose max-w-none p-4 border rounded-lg bg-[var(--color-surface)]"
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(comparison.diff_html) }}
              />
            </div>

            {/* Summary of Changes */}
            {comparison.version1.summary_of_changes && (
              <div>
                <h3 className="font-semibold mb-2">
                  {t('enterprise.comparison.summary_version')}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] p-3 bg-[var(--color-surface)] rounded-lg">
                  {comparison.version1.summary_of_changes}
                </p>
              </div>
            )}

            {comparison.version2.summary_of_changes && (
              <div>
                <h3 className="font-semibold mb-2">
                  {t('enterprise.comparison.summary_version')}
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] p-3 bg-[var(--color-surface)] rounded-lg">
                  {comparison.version2.summary_of_changes}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <AlertCircle size={48} className="mx-auto text-[var(--color-text-tertiary)] mb-4" />
            <p className="text-[var(--color-text-secondary)]">{t('enterprise.comparison.failed_to_load')}</p>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button onPress={onClose}>
          {t('enterprise.btn_close')}
        </Button>
      </ModalFooter>
    </>
  );
}
