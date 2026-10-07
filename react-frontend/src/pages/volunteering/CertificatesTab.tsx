// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CertificatesTab - Generate and view volunteer impact certificates
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import Award from 'lucide-react/icons/award';
import Download from 'lucide-react/icons/download';
import Plus from 'lucide-react/icons/plus';
import ExternalLink from 'lucide-react/icons/external-link';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Building2 from 'lucide-react/icons/building-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import QrCode from 'lucide-react/icons/qr-code';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useToast } from '@/contexts';

interface Certificate {
  id: number;
  verification_code: string;
  verification_url: string;
  total_hours: number;
  date_range: {
    start: string;
    end: string;
  };
  organizations: { name: string; hours: number; shifts: number }[];
  generated_at: string;
  downloaded_at: string | null;
  /** Set when the community withdrew it; it then fails every check. */
  revoked_at?: string | null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function CertificatesTab() {
  const { t } = useTranslation('volunteering');
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const toast = useToast();

  // Saved as an .html file the member opens and prints. A new tab sent no
  // sign-in token (401), and rendering the server's HTML inside the app
  // would run it with the app's privileges.
  const handleDownload = async (code: string) => {
    try {
      await api.download(`/v2/volunteering/certificates/${encodeURIComponent(code)}/html`, {
        filename: `volunteer-certificate-${code}.html`,
      });
    } catch {
      toast.error(t('common:errors.download_failed'));
    }
  };

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{ certificates?: Certificate[] }>(
        '/v2/volunteering/certificates'
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const payload = response.data as Record<string, unknown>;
        const items = Array.isArray(payload.items)
          ? (payload.items as Certificate[])
          : Array.isArray(payload.certificates)
            ? (payload.certificates as Certificate[])
            : Array.isArray(response.data)
              ? (response.data as unknown as Certificate[])
              : [];
        setCertificates(items);
      } else {
        setError(tRef.current('certificates.error_load'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load certificates', err);
      setError(tRef.current('certificates.error_load_generic'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Abort any in-flight request on unmount so a late response can't set state
    // on an unmounted component.
    return () => abortRef.current?.abort();
  }, [load]);

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);

      const response = await api.post('/v2/volunteering/certificates', {});

      if (response.success) {
        toastRef.current.success(tRef.current('certificates.generated_success'));
        load();
      } else {
        toastRef.current.error(
          response.error ||
          tRef.current('certificates.no_verified_hours')
        );
      }
    } catch (err) {
      logError('Failed to generate certificate', err);
      toastRef.current.error(tRef.current('certificates.generated_error'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-amber-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('certificates.title')}</h2>
        </div>
        <Button
          size="sm"
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white sm:shrink-0"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={handleGenerate}
          isLoading={isGenerating}
        >
          {t('certificates.generate')}
        </Button>
      </div>


      <p className="text-sm text-theme-muted">
        {t('certificates.description')}
      </p>
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('common.try_again')}
          </Button>
        </GlassCard>
      )}

      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && !isLoading && certificates.length === 0 && (
        <EmptyState
          icon={<Award className="w-12 h-12" aria-hidden="true" />}
          title={t('certificates.empty_title')}
          description={t('certificates.empty_description')}
          action={
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              onPress={handleGenerate}
            >
              {t('certificates.generate')}
            </Button>
          }
        />
      )}

      {!error && !isLoading && certificates.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {certificates.map((cert) => (
            <motion.div key={cert.id} variants={itemVariants}>
              <GlassCard className="p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Award className="w-5 h-5 text-amber-400" aria-hidden="true" />
                      <h3 className="font-semibold text-theme-primary text-lg">
                        {t('certificates.verified_hours', { count: cert.total_hours })}
                      </h3>
                      {cert.revoked_at && (
                        <Chip size="sm" color="danger" variant="soft">{t('certificates.revoked')}</Chip>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle mb-3">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        {new Date(cert.date_range.start).toLocaleDateString(getFormattingLocale())}{t('date_range_separator')}{new Date(cert.date_range.end).toLocaleDateString(getFormattingLocale())}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden="true" />
                        {t('certificates.generated_on')} {new Date(cert.generated_at).toLocaleDateString(getFormattingLocale())}
                      </span>
                      <span className="flex items-center gap-1">
                        <QrCode className="w-3 h-3" aria-hidden="true" />
                        {cert.verification_code}
                      </span>
                    </div>

                    {cert.organizations.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {cert.organizations.map((org) => (
                          <Chip key={org.name} size="sm" variant="soft" startContent={<Building2 className="w-3 h-3" />}>
                            {t('certificates.organization_hours', { name: org.name, hours: org.hours })}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>

                  {cert.revoked_at ? (
                    <p className="text-sm text-theme-subtle sm:max-w-xs">{t('certificates.revoked_note')}</p>
                  ) : (
                  <div className="flex flex-col gap-2 sm:flex-shrink-0">
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                      startContent={<Download className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => handleDownload(cert.verification_code)}
                    >
                      {t('certificates.download')}
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<ExternalLink className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => window.open(cert.verification_url, '_blank')}
                    >
                      {t('certificates.verify')}
                    </Button>
                  </div>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      )}

    </div>
  );
}

export default CertificatesTab;
