// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';

type ReviewLink = {
  id: number;
  caregiver_id: number;
  caregiver_name: string;
  cared_for_id: number;
  cared_for_name: string;
  relationship_type: 'family' | 'friend' | 'neighbour' | 'professional';
  status: 'pending' | 'active' | 'rejected' | 'inactive';
  recipient_confirmed_at: string | null;
  created_at: string;
};

export default function CaregiverLinkReviewPanel() {
  const { t } = useTranslation('caring_community');
  const toast = useToast();
  const [links, setLinks] = useState<ReviewLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [verified, setVerified] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<ReviewLink[]>('/v2/admin/caring-community/caregiver-links?status=pending');
      setLinks(Array.isArray(response.data) ? response.data : []);
    } catch {
      toast.error(t('caregiver_review.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (link: ReviewLink) => {
    setDecidingId(link.id);
    try {
      const response = await api.post(`/v2/admin/caring-community/caregiver-links/${link.id}/approve`, {
        consent_verified: verified[link.id] === true,
        consent_evidence: evidence[link.id]?.trim() ?? '',
      });
      // 🔴 The server's own message is deliberately NOT carried into this Error.
      // It is discarded by the catch below in favour of a translated toast, so
      // passing it here only creates a route by which an untranslated backend
      // string could reach an admin — which is what the admin-i18n gate flags.
      if (!response.success) throw new Error('caregiver-link-decision-failed');
      setLinks((current) => current.map((item) => (
        item.id === link.id ? { ...item, status: 'active' } : item
      )));
      toast.success(t('caregiver_review.approved'));
    } catch {
      toast.error(t('caregiver_review.approve_failed'));
    } finally {
      setDecidingId(null);
    }
  };

  const reject = async (link: ReviewLink) => {
    setDecidingId(link.id);
    try {
      const response = await api.post(`/v2/admin/caring-community/caregiver-links/${link.id}/reject`, {
        reason: reasons[link.id]?.trim() ?? '',
      });
      // 🔴 The server's own message is deliberately NOT carried into this Error.
      // It is discarded by the catch below in favour of a translated toast, so
      // passing it here only creates a route by which an untranslated backend
      // string could reach an admin — which is what the admin-i18n gate flags.
      if (!response.success) throw new Error('caregiver-link-decision-failed');
      setLinks((current) => current.map((item) => (
        item.id === link.id ? { ...item, status: 'rejected' } : item
      )));
      toast.success(t('caregiver_review.rejected'));
    } catch {
      toast.error(t('caregiver_review.reject_failed'));
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <Card className="mb-6" aria-labelledby="caregiver-link-review-title">
      <CardHeader className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-1 text-accent" />
        <div>
          <h2 id="caregiver-link-review-title" className="text-lg font-semibold">
            {t('caregiver_review.title')}
          </h2>
          <p className="mt-1 text-sm text-muted">{t('caregiver_review.description')}</p>
        </div>
      </CardHeader>
      <CardBody className="gap-4">
        {loading && <div role="status" aria-label={t('caregiver_review.loading')}><Spinner /></div>}
        {!loading && links.length === 0 && <p className="text-sm text-muted">{t('caregiver_review.empty')}</p>}
        {!loading && links.map((link) => {
          const decided = link.status === 'active' || link.status === 'rejected';
          const canApprove = Boolean(link.recipient_confirmed_at)
            && verified[link.id] === true
            && Boolean(evidence[link.id]?.trim());
          const canReject = Boolean(reasons[link.id]?.trim());
          return (
            <section key={link.id} className="rounded-lg border border-divider p-4" aria-labelledby={`caregiver-link-${link.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id={`caregiver-link-${link.id}`} className="font-semibold">{link.caregiver_name}</h3>
                  <p className="text-sm text-muted">
                    {t('caregiver_review.requested_for', { name: link.cared_for_name })}
                  </p>
                </div>
                <Chip color={link.status === 'active' ? 'success' : link.status === 'rejected' ? 'danger' : link.recipient_confirmed_at ? 'success' : 'warning'} variant="soft">
                  {decided
                    ? t(link.status === 'active' ? 'caregiver_review.approved' : 'caregiver_review.rejected')
                    : t(link.recipient_confirmed_at ? 'caregiver_review.recipient_confirmed' : 'caregiver_review.recipient_not_confirmed')}
                </Chip>
              </div>
              {decided ? null : (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <Textarea
                    label={t('caregiver_review.consent_evidence')}
                    value={evidence[link.id] ?? ''}
                    onValueChange={(value) => setEvidence((current) => ({ ...current, [link.id]: value }))}
                  />
                  <Checkbox
                    isSelected={verified[link.id] === true}
                    onValueChange={(value) => setVerified((current) => ({ ...current, [link.id]: value }))}
                  >
                    {t('caregiver_review.confirm_consent')}
                  </Checkbox>
                  <Button color="primary" isDisabled={!canApprove} isLoading={decidingId === link.id} onPress={() => void approve(link)}>
                    {t('caregiver_review.approve')}
                  </Button>
                </div>
                <div className="space-y-3">
                  <Textarea
                    label={t('caregiver_review.rejection_reason')}
                    value={reasons[link.id] ?? ''}
                    onValueChange={(value) => setReasons((current) => ({ ...current, [link.id]: value }))}
                  />
                  <Button color="danger" variant="bordered" isDisabled={!canReject} isLoading={decidingId === link.id} onPress={() => void reject(link)}>
                    {t('caregiver_review.reject')}
                  </Button>
                </div>
              </div>
              )}
            </section>
          );
        })}
      </CardBody>
    </Card>
  );
}
