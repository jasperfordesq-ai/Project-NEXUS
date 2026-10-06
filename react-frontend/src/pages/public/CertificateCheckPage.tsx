// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public "check a volunteering certificate" page — no account needed.
 *
 * POST /api/v2/volunteering/certificates/check { code, name }
 *
 * Gap C1 (owner decision, 6 Oct 2026). An employer or college enters the code
 * printed on a certificate and the volunteer's name, and is told only whether
 * they match. The code alone reveals nothing, so the page never looks anything
 * up from the address on its own; the code in the address only prefills the box.
 */

import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import Award from 'lucide-react/icons/award';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import XCircle from 'lucide-react/icons/x-circle';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageMeta } from '@/components/seo/PageMeta';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface CheckResult {
  valid: boolean;
  name?: string;
  total_hours?: number;
  date_range?: { start: string; end: string };
  organizations?: Array<{ name?: string; hours?: number }>;
  generated_at?: string;
}

export function CertificateCheckPage() {
  const { t } = useTranslation('volunteering');
  const { code: codeFromAddress } = useParams<{ code?: string }>();
  usePageTitle(t('certificate_check.title'));

  const [code, setCode] = useState(codeFromAddress ?? '');
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<CheckResult>('/v2/volunteering/certificates/check', {
        code: code.trim(),
        name: name.trim(),
      });
      if (res.success && res.data && typeof res.data.valid === 'boolean') {
        setResult(res.data);
      } else {
        setError(t('certificate_check.error'));
      }
    } catch (err) {
      logError('CertificateCheckPage check failed', err);
      setError(t('certificate_check.error'));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
      <PageMeta title={t('certificate_check.title')} description={t('certificate_check.meta_description')} />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-accent/10">
              <Award className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold text-theme-primary">{t('certificate_check.title')}</h1>
          </div>
          <p className="text-sm text-theme-muted mb-6">{t('certificate_check.intro')}</p>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label={t('certificate_check.code_label')}
              isRequired
              value={code}
              onValueChange={(v) => { setCode(v); setResult(null); }}
              autoComplete="off"
              data-testid="certificate-check-code"
            />
            <Input
              label={t('certificate_check.name_label')}
              description={t('certificate_check.name_hint')}
              isRequired
              value={name}
              onValueChange={(v) => { setName(v); setResult(null); }}
              autoComplete="off"
              data-testid="certificate-check-name"
            />
            <Button
              type="submit"
              color="primary"
              isLoading={checking}
              isDisabled={!code.trim() || !name.trim()}
              data-testid="certificate-check-submit"
            >
              {t('certificate_check.submit')}
            </Button>
          </form>

          <div aria-live="polite" className="mt-6">
            {error && (
              <p role="alert" className="text-sm text-theme-danger">{error}</p>
            )}

            {result?.valid === true && (
              <div className="rounded-xl border border-success/30 bg-success/10 p-4 space-y-3" data-testid="certificate-check-valid">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-success" aria-hidden="true" />
                  <h2 className="font-semibold text-theme-primary">{t('certificate_check.valid_title')}</h2>
                </div>
                <p className="text-sm text-theme-muted">{t('certificate_check.valid_body', { name: result.name ?? '' })}</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-theme-subtle">{t('certificate_check.hours')}</dt>
                    <dd className="text-theme-primary font-medium">{result.total_hours}</dd>
                  </div>
                  {result.date_range && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-theme-subtle">{t('certificate_check.period')}</dt>
                      <dd className="text-theme-primary">
                        {formatDate(result.date_range.start)}{t('date_range_separator')}{formatDate(result.date_range.end)}
                      </dd>
                    </div>
                  )}
                  {result.generated_at && (
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-theme-subtle">{t('certificate_check.issued')}</dt>
                      <dd className="text-theme-primary">{formatDate(result.generated_at)}</dd>
                    </div>
                  )}
                  {result.organizations && result.organizations.length > 0 && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-theme-subtle">{t('certificate_check.organisations')}</dt>
                      <dd className="text-theme-primary">
                        <ul className="list-disc ps-5">
                          {result.organizations.map((org, i) => (
                            <li key={`${org.name ?? ''}-${i}`}>
                              {t('certificate_check.organisation_hours', { name: org.name ?? '', hours: Number(org.hours ?? 0) })}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {result?.valid === false && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-4" data-testid="certificate-check-invalid">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-5 h-5 text-warning" aria-hidden="true" />
                  <h2 className="font-semibold text-theme-primary">{t('certificate_check.invalid_title')}</h2>
                </div>
                <p className="text-sm text-theme-muted">{t('certificate_check.invalid_body')}</p>
              </div>
            )}
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default CertificateCheckPage;
