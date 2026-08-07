// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SafeguardingTab — member self-service view of their safeguarding preferences.
 *
 * Safeguarding Ireland adult-autonomy principle: adults who self-identify as
 * requiring protections have the right to view and revoke those preferences
 * without admin involvement. This tab wires the React UI to the existing
 * SafeguardingPreferenceService::revokePreference backend endpoint.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback } from 'react';

import Shield from 'lucide-react/icons/shield';
import Trash2 from 'lucide-react/icons/trash-2';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import MinusCircle from 'lucide-react/icons/circle-minus';
import Lock from 'lucide-react/icons/lock';
import Users from 'lucide-react/icons/users';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export interface MemberPreference {
  preference_id: number;
  option_id: number;
  option_key: string;
  label: string;
  description: string | null;
  selected_value: string;
  consent_given_at: string | null;
  created_at: string | null;
  policy_review_required?: boolean;
  policy_review_reason_code?: string | null;
  activations: {
    requires_broker_approval: boolean;
    restricts_messaging: boolean;
    restricts_matching: boolean;
    requires_vetted_interaction: boolean;
    vetting_type_required: string | null;
  };
}

interface MyPreferencesResponse {
  preferences: MemberPreference[];
  count: number;
}

/**
 * A guardian arrangement recorded against the signed-in member, as ward.
 *
 * 🔴 Why this section exists. `safeguarding_assignments` pairs a guardian with a
 * ward and carries a `consent_given_at` column. Staff create the assignment and
 * BOTH parties are emailed — and the ward's email deep-links to
 * `/settings?tab=safeguarding`, this very tab, which until now fetched only
 * preferences and vetting status. So a member could be told someone had been made
 * responsible for them, follow the link, and find nothing about it.
 *
 * Worse, nothing in the platform could record their consent: the endpoint that
 * writes that column was added on 2026-08-05 and, until this section, had no
 * caller in either frontend. The admin dashboard's "consented wards" count read a
 * column that no human could populate. An API with no UI is the same bug as a
 * method with no caller — which is exactly what it replaced.
 */
type ArrangementState = 'pending' | 'consented' | 'declined' | 'withdrawn';

/**
 * What a guardian may actually DO. Mirrors App\Support\Safeguarding\SupportTiers.
 *
 * 🔴 Only the supported member sets these, and only here. The linked-accounts
 * screen — which the GUARDIAN drives — refuses staff-recorded arrangements
 * outright, because a guardian granting themselves powers over the person they
 * support is the thing this module exists to prevent. Until this section
 * existed the tiers were unreachable for any pair a coordinator had recorded.
 */
type SupportTier = 'none' | 'assist' | 'co_decide' | 'represent';
type TierCapability = 'activity' | 'listings' | 'credits';

/** `assist` is not offered for actions: there is no draft-only screen behind
 *  it, and offering a level that does nothing is the fault this whole module
 *  has been correcting. */
const GRANTABLE_ACTION_TIERS: SupportTier[] = ['none', 'co_decide', 'represent'];

interface MyGuardian {
  id: number;
  guardian_name: string;
  assigned_at: string | null;
  consent_given_at: string | null;
  consent_declined_at: string | null;
  consent_withdrawn_at: string | null;
  ward_response_reason: string | null;
  state: ArrangementState;
  consent_given: boolean;
  notes: string | null;
  tiers?: Partial<Record<TierCapability, SupportTier>>;
}

/**
 * 🔴 The guardian's own view, which did not exist.
 *
 * A guardian was emailed that they had been made responsible for someone and
 * then had no screen for it, so half the relationship was invisible — including
 * whether the ward had agreed at all.
 */
interface MyWard {
  id: number;
  ward_name: string;
  assigned_at: string | null;
  state: ArrangementState;
}

/** Which response a given position allows. Mirrors the service's transition table. */
const NEXT_ACTIONS: Record<ArrangementState, Array<'consent' | 'decline' | 'withdraw'>> = {
  pending: ['consent', 'decline'],
  consented: ['withdraw'],
  declined: ['consent'],
  withdrawn: ['consent'],
};

const STATE_COLOR: Record<ArrangementState, 'success' | 'warning' | 'danger' | 'default'> = {
  pending: 'warning',
  consented: 'success',
  declined: 'danger',
  withdrawn: 'default',
};

/**
 * Derive the position from the timestamps when the server has not sent `state`.
 *
 * 🔴 Defensive on purpose. `NEXT_ACTIONS[guardian.state]` would be `undefined`
 * for an unexpected or missing value, and `.includes()` on that throws — taking
 * the whole settings tab down. This is the same failure the Hours report had when
 * it called `.map()` on an object the API actually returned. Never index a lookup
 * table with an unvalidated server value.
 */
function normaliseGuardian(raw: MyGuardian): MyGuardian {
  const known: ArrangementState[] = ['pending', 'consented', 'declined', 'withdrawn'];
  if (known.includes(raw.state)) return raw;

  const derived: ArrangementState = raw.consent_withdrawn_at
    ? 'withdrawn'
    : raw.consent_declined_at
      ? 'declined'
      : raw.consent_given_at
        ? 'consented'
        : 'pending';
  return { ...raw, state: derived };
}

function normaliseWard(raw: MyWard): MyWard {
  const known: ArrangementState[] = ['pending', 'consented', 'declined', 'withdrawn'];
  return known.includes(raw.state) ? raw : { ...raw, state: 'pending' };
}

/** The date that explains the current position, so the chip can carry it. */
function stateDate(guardian: MyGuardian): string | null {
  switch (guardian.state) {
    case 'consented': return guardian.consent_given_at;
    case 'declined': return guardian.consent_declined_at;
    case 'withdrawn': return guardian.consent_withdrawn_at;
    default: return null;
  }
}

interface MyVettingStatus {
  policy: {
    configured: boolean;
    contact_policy_available: boolean;
    jurisdiction: string;
    label: string;
    attestation_code: string | null;
    attestation_label: string | null;
    purpose_code: string;
  };
  decision: 'confirmed' | 'revoked' | 'not_confirmed';
  review_status: 'pending' | 'resolved' | null;
  confirmed_at: string | null;
  revoked_at?: string | null;
}

/**
 * The ward records their own agreement. Only the ward can: the endpoint refuses
 * a guardian consenting on their behalf, and there is a test for that boundary
 * specifically — a consent record signed by the wrong person is worse than none
 * at all.
 *
 * Module scope on purpose: declared inside the component this is a fresh object
 * every render, which either destabilises `handleRespond` or has to be omitted
 * from its dependency list.
 */
const RESPONSE_ENDPOINTS = {
  consent: '/v2/safeguarding/consent-to-guardian',
  decline: '/v2/safeguarding/decline-guardian',
  withdraw: '/v2/safeguarding/withdraw-guardian-consent',
} as const;

export function SafeguardingTab() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const confirmModal = useDisclosure();

  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<MemberPreference[]>([]);
  const [vettingStatus, setVettingStatus] = useState<MyVettingStatus | null>(null);
  const [guardians, setGuardians] = useState<MyGuardian[]>([]);
  const [wards, setWards] = useState<MyWard[]>([]);
  const [consentingId, setConsentingId] = useState<number | null>(null);
  const [tierBusyId, setTierBusyId] = useState<number | null>(null);
  // Refusing and withdrawing go through a confirm step with an OPTIONAL reason.
  // Agreeing does not: adding friction to consent is fine, adding it to refusal
  // would be a nudge toward agreeing.
  const [pendingResponse, setPendingResponse] = useState<
    { guardian: MyGuardian; action: 'decline' | 'withdraw' } | null
  >(null);
  const [responseReason, setResponseReason] = useState('');
  const responseModal = useDisclosure();
  const [isRequestingReview, setIsRequestingReview] = useState(false);
  const [isConfirmingPolicyReview, setIsConfirmingPolicyReview] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<MemberPreference | null>(null);

  const loadPreferences = useCallback(async () => {
    try {
      setLoading(true);
      const [preferencesResponse, vettingResponse, guardiansResponse, wardsResponse] = await Promise.all([
        api.get<MyPreferencesResponse>('/v2/safeguarding/my-preferences'),
        api.get<MyVettingStatus>('/v2/safeguarding/my-vetting-status'),
        api.get<{ guardians: MyGuardian[]; pending_count: number }>('/v2/safeguarding/my-guardians'),
        api.get<{ wards: MyWard[] }>('/v2/safeguarding/my-wards'),
      ]);
      if (preferencesResponse.success && preferencesResponse.data) {
        setPreferences(preferencesResponse.data.preferences ?? []);
      } else {
        setPreferences([]);
      }
      setVettingStatus(vettingResponse.success && vettingResponse.data ? vettingResponse.data : null);
      // 🔴 api.ts never throws, so `success` must be checked explicitly — a
      // `catch` here would not see a failed request.
      setGuardians(
        guardiansResponse.success && guardiansResponse.data
          ? (guardiansResponse.data.guardians ?? []).map(normaliseGuardian)
          : [],
      );
      setWards(
        wardsResponse.success && wardsResponse.data
          ? (wardsResponse.data.wards ?? []).map(normaliseWard)
          : [],
      );
    } catch (error) {
      logError('Failed to load safeguarding preferences', error);
      setPreferences([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const handleRevokeClick = (pref: MemberPreference) => {
    setPendingRevoke(pref);
    confirmModal.onOpen();
  };

  const handleRevokeConfirm = useCallback(async () => {
    if (!pendingRevoke) return;
    const optionId = pendingRevoke.option_id;
    try {
      setRevokingId(optionId);
      const res = await api.post('/v2/safeguarding/revoke', {
        option_id: optionId,
      });

      if (res.success) {
        toast.success(t('safeguarding.revoked_toast'));
        setPreferences(prev => prev.filter(p => p.option_id !== optionId));
      } else {
        toast.error(
          t('safeguarding.revoke_error_toast'),
          res.error || ''
        );
      }
    } catch (error) {
      logError('Revoke safeguarding preference failed', error);
      toast.error(t('safeguarding.revoke_error_toast'));
    } finally {
      setRevokingId(null);
      setPendingRevoke(null);
      confirmModal.onClose();
    }
  }, [pendingRevoke, t, toast, confirmModal]);

  const handleRespond = useCallback(async (
    assignmentId: number,
    action: 'consent' | 'decline' | 'withdraw',
    reason?: string,
  ) => {
    if (consentingId !== null) return;
    setConsentingId(assignmentId);
    try {
      const body: Record<string, unknown> = { assignment_id: assignmentId };
      if (reason && reason.trim() !== '') body.reason = reason.trim();

      const res = await api.post<{ state: string; already: boolean }>(RESPONSE_ENDPOINTS[action], body);
      if (!res.success) {
        // 🔴 api.ts never throws, so this check is the only thing standing
        // between a failed request and a false success message.
        toast.error(
          action === 'consent'
            ? t('safeguarding.guardians.consent_error')
            : t('safeguarding.guardians.response_error'),
        );
        return;
      }
      // Re-read rather than guess what the server stored.
      await loadPreferences();
      toast.success(
        action === 'consent'
          ? t('safeguarding.guardians.consent_toast')
          : action === 'decline'
            ? t('safeguarding.guardians.decline_toast')
            : t('safeguarding.guardians.withdraw_toast'),
      );
    } catch (error) {
      logError('Guardian arrangement response failed', error);
      toast.error(t('safeguarding.guardians.response_error'));
    } finally {
      setConsentingId(null);
    }
  }, [consentingId, loadPreferences, t, toast]);

  /**
   * The supported member changes what this guardian may do. Sends only the
   * capability that changed; the server merges, so an absent key means
   * "leave as it was" rather than "reset".
   */
  const handleTierChange = useCallback(async (
    assignmentId: number,
    capability: TierCapability,
    tier: SupportTier,
  ) => {
    if (tierBusyId !== null) return;
    setTierBusyId(assignmentId);
    try {
      const res = await api.post('/v2/safeguarding/guardian-permissions', {
        assignment_id: assignmentId,
        tiers: { [capability]: tier },
      });
      if (!res.success) {
        // 🔴 api.ts never throws — without this the failure reads as success.
        toast.error(res.error || t('safeguarding.guardians.tiers_error'));
        return;
      }
      await loadPreferences();
      toast.success(t('safeguarding.guardians.tiers_toast'));
    } catch (error) {
      logError('Guardian tier change failed', error);
      toast.error(t('safeguarding.guardians.tiers_error'));
    } finally {
      setTierBusyId(null);
    }
  }, [tierBusyId, loadPreferences, t, toast]);

  /** Refusing and withdrawing confirm first, and offer an optional reason. */
  const openResponseModal = useCallback((guardian: MyGuardian, action: 'decline' | 'withdraw') => {
    setPendingResponse({ guardian, action });
    setResponseReason('');
    responseModal.onOpen();
  }, [responseModal]);

  const confirmResponse = useCallback(async () => {
    if (!pendingResponse) return;
    const { guardian, action } = pendingResponse;
    responseModal.onClose();
    setPendingResponse(null);
    await handleRespond(guardian.id, action, responseReason);
    setResponseReason('');
  }, [handleRespond, pendingResponse, responseModal, responseReason]);

  const handleRequestReview = useCallback(async () => {
    if (!vettingStatus?.policy.configured || !vettingStatus.policy.contact_policy_available || isRequestingReview) return;

    setIsRequestingReview(true);
    try {
      const response = await api.post('/v2/safeguarding/vetting-review-request');
      if (!response.success) {
        toast.error(t('safeguarding.vetting.review_error'));
        return;
      }

      setVettingStatus((current) => current ? { ...current, review_status: 'pending' } : current);
      toast.success(t('safeguarding.vetting.review_requested_toast'));
    } catch (error) {
      logError('Safeguarding vetting review request failed', error);
      toast.error(t('safeguarding.vetting.review_error'));
    } finally {
      setIsRequestingReview(false);
    }
  }, [isRequestingReview, t, toast, vettingStatus]);

  const handleConfirmPolicyReview = useCallback(async () => {
    if (isConfirmingPolicyReview) return;
    setIsConfirmingPolicyReview(true);
    try {
      const response = await api.post('/v2/safeguarding/confirm-policy-review');
      if (!response.success) {
        toast.error(t('safeguarding.policy_review_error'));
        return;
      }
      setPreferences(current => current.map(preference => ({
        ...preference,
        policy_review_required: false,
        policy_review_reason_code: null,
      })));
      toast.success(t('safeguarding.policy_review_confirmed'));
    } catch (error) {
      logError('Confirm safeguarding policy review failed', error);
      toast.error(t('safeguarding.policy_review_error'));
    } finally {
      setIsConfirmingPolicyReview(false);
    }
  }, [isConfirmingPolicyReview, t, toast]);

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-blue-500/20">
            <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">
              {t('safeguarding.page_title')}
            </h2>
            <p className="text-sm text-theme-muted">
              {t('safeguarding.intro')}
            </p>
          </div>
        </div>

        {preferences.some(preference => preference.policy_review_required) && (
          <div className="mb-6 rounded-xl border border-warning-300 bg-warning-50 p-4 text-warning-900 dark:border-warning-700 dark:bg-warning-950/30 dark:text-warning-100" role="status">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{t('safeguarding.policy_review_title')}</h3>
                <p className="mt-1 text-sm">{t('safeguarding.policy_review_body')}</p>
                <Button
                  className="mt-3"
                  size="sm"
                  color="warning"
                  isLoading={isConfirmingPolicyReview}
                  isDisabled={isConfirmingPolicyReview}
                  onPress={handleConfirmPolicyReview}
                >
                  {t('safeguarding.policy_review_confirm')}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-theme-default bg-theme-surface p-4">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-theme-primary">
                {t('safeguarding.vetting.title')}
              </h3>
              {!vettingStatus ? (
                <>
                  <p className="mt-1 text-sm text-theme-muted">{t('safeguarding.vetting.status_unavailable')}</p>
                  <p className="mt-2 text-xs text-theme-muted">{t('safeguarding.vetting.no_documents')}</p>
                </>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Chip
                      size="sm"
                      variant="soft"
                      color={
                        vettingStatus.decision === 'confirmed'
                          ? 'success'
                          : vettingStatus.decision === 'revoked'
                            ? 'danger'
                            : vettingStatus.review_status === 'pending'
                              ? 'warning'
                              : 'default'
                      }
                    >
                      {t(`safeguarding.vetting.status_${
                        vettingStatus.review_status === 'pending' ? 'review_requested' : vettingStatus.decision
                      }`)}
                    </Chip>
                    {vettingStatus.policy.attestation_label && (
                      <span className="text-sm text-theme-muted">{vettingStatus.policy.attestation_label}</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-theme-muted">
                    {vettingStatus.decision === 'confirmed' && vettingStatus.confirmed_at
                      ? t('safeguarding.vetting.confirmed_on', {
                          date: new Date(vettingStatus.confirmed_at).toLocaleDateString(getFormattingLocale()),
                        })
                      : vettingStatus.review_status === 'pending'
                        ? t('safeguarding.vetting.review_pending_body')
                        : vettingStatus.policy.configured && vettingStatus.policy.contact_policy_available
                          ? t('safeguarding.vetting.not_confirmed_body')
                          : t('safeguarding.vetting.policy_unavailable_body')}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-theme-muted">{t('safeguarding.vetting.no_documents')}</p>
                  {vettingStatus.decision !== 'confirmed' && vettingStatus.policy.configured && vettingStatus.policy.contact_policy_available && (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="secondary"
                      isPending={isRequestingReview}
                      isDisabled={vettingStatus.review_status === 'pending'}
                      onPress={handleRequestReview}
                    >
                      {vettingStatus.review_status === 'pending'
                        ? t('safeguarding.vetting.review_requested_button')
                        : t('safeguarding.vetting.request_review_button')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/*
          Guardian arrangements. Named "Guardian arrangements" and explicitly
          described as staff-recorded, because a member-created link in Linked
          Accounts can ALSO be typed "guardian" — two unrelated things sharing a
          word, in a safeguarding context. The intro states plainly that this
          record confers no ability to act, which is true: no authorisation path
          anywhere consults safeguarding_assignments.
        */}
        <div className="mb-6 rounded-xl border border-theme-default bg-theme-surface p-4">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-theme-primary">
                {t('safeguarding.guardians.title')}
              </h3>
              <p className="mt-1 text-sm leading-6 text-theme-muted">
                {t('safeguarding.guardians.intro')}
              </p>

              {guardians.length === 0 ? (
                <p className="mt-3 text-sm text-theme-muted">
                  {t('safeguarding.guardians.none')}
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {guardians.map((guardian) => (
                    <li
                      key={guardian.id}
                      className="rounded-lg border border-theme-default bg-theme-elevated p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-theme-primary">
                            {guardian.guardian_name}
                          </p>
                          {guardian.assigned_at && (
                            <p className="mt-1 text-xs text-theme-muted">
                              {/*
                                Label and date are rendered separately rather
                                than interpolated. A one-word "Recorded" came
                                back meaning AUDIO recording in ja/es/pl/pt, and
                                the interpolated variant was silently dropped by
                                the translator's placeholder guard in all ten
                                locales. "Date added" survives both.
                              */}
                              {t('safeguarding.guardians.recorded_label')}:{' '}
                              {new Date(guardian.assigned_at).toLocaleDateString(getFormattingLocale())}
                            </p>
                          )}
                          {guardian.notes && (
                            <p className="mt-1 text-xs leading-relaxed text-theme-muted">
                              {guardian.notes}
                            </p>
                          )}
                          {guardian.ward_response_reason && (
                            <p className="mt-1 text-xs leading-relaxed text-theme-muted">
                              <span className="font-medium">
                                {t('safeguarding.guardians.your_reason')}:
                              </span>{' '}
                              {guardian.ward_response_reason}
                            </p>
                          )}
                        </div>
                        {/*
                          One chip stating the current position, then only the
                          responses that position allows — mirroring the service's
                          transition table, so the UI cannot offer an action the
                          backend will refuse.
                        */}
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <Chip size="sm" variant="soft" color={STATE_COLOR[guardian.state]}>
                            {t(`safeguarding.guardians.state_${guardian.state}`)}
                            {stateDate(guardian)
                              ? `: ${new Date(stateDate(guardian) as string).toLocaleDateString(getFormattingLocale())}`
                              : ''}
                          </Chip>

                          {NEXT_ACTIONS[guardian.state].includes('consent') && (
                            <Button
                              size="sm"
                              variant="secondary"
                              isLoading={consentingId === guardian.id}
                              isDisabled={consentingId !== null}
                              onPress={() => handleRespond(guardian.id, 'consent')}
                            >
                              {guardian.state === 'pending'
                                ? t('safeguarding.guardians.consent_button')
                                : t('safeguarding.guardians.agree_after_all_button')}
                            </Button>
                          )}

                          {/* Refusing is offered as plainly as agreeing. */}
                          {NEXT_ACTIONS[guardian.state].includes('decline') && (
                            <Button
                              size="sm"
                              variant="danger-soft"
                              isDisabled={consentingId !== null}
                              onPress={() => openResponseModal(guardian, 'decline')}
                            >
                              {t('safeguarding.guardians.decline_button')}
                            </Button>
                          )}

                          {NEXT_ACTIONS[guardian.state].includes('withdraw') && (
                            <Button
                              size="sm"
                              variant="danger-soft"
                              isDisabled={consentingId !== null}
                              onPress={() => openResponseModal(guardian, 'withdraw')}
                            >
                              {t('safeguarding.guardians.withdraw_button')}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/*
                        🔴 What this guardian may actually DO — and the only
                        place in the platform it can be set. The linked-accounts
                        screen is driven by the guardian, so it refuses these
                        arrangements outright; without this section the levels
                        were unreachable for every pair a coordinator recorded.

                        Offered only once the member has AGREED: granting powers
                        under an arrangement you have refused, withdrawn from, or
                        not yet answered would let the grant stand in for the
                        consent. The backend enforces the same rule.
                      */}
                      {guardian.state === 'consented' && (
                        <div className="mt-4 space-y-3 border-t border-theme-default pt-4">
                          <div>
                            <p className="text-sm font-medium text-theme-primary">
                              {t('safeguarding.guardians.tiers_title')}
                            </p>
                            <p className="text-xs text-theme-muted">
                              {t('safeguarding.guardians.tiers_intro', { name: guardian.guardian_name })}
                            </p>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            {(['listings', 'credits'] as const).map((capability) => {
                              const label = t(`safeguarding.guardians.tiers_capability_${capability}`);
                              const current = guardian.tiers?.[capability] ?? 'none';

                              return (
                                <label key={capability} className="flex flex-col gap-1 text-xs text-theme-muted">
                                  {label}
                                  {/*
                                    A plain <select>: this screen is reached by
                                    the people least well served by custom
                                    widgets, and the native control is the most
                                    reliable thing on any device or assistive
                                    technology.
                                  */}
                                  <select
                                    className="rounded-lg border border-theme-default bg-theme-elevated px-3 py-2 text-sm text-theme-primary"
                                    value={current}
                                    disabled={tierBusyId !== null}
                                    aria-label={t('safeguarding.guardians.tiers_aria', {
                                      capability: label,
                                      name: guardian.guardian_name,
                                    })}
                                    onChange={(e) => {
                                      const next = e.target.value as SupportTier;
                                      if (next !== current) handleTierChange(guardian.id, capability, next);
                                    }}
                                  >
                                    {GRANTABLE_ACTION_TIERS.map((tier) => (
                                      <option key={tier} value={tier}>
                                        {t(`safeguarding.guardians.tiers_option_${tier}`)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              );
                            })}
                          </div>

                          <p className="text-xs text-theme-muted">
                            {t('safeguarding.guardians.tiers_explainer')}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/*
          The other half of the relationship. A guardian used to see nothing at
          all — they were emailed and then had no screen. Only rendered when they
          actually support someone, so it does not clutter every member's settings.
        */}
        {wards.length > 0 && (
          <div className="mb-6 rounded-xl border border-theme-default bg-theme-surface p-4">
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-theme-primary">
                  {t('safeguarding.guardians.wards_title')}
                </h3>
                <p className="mt-1 text-sm leading-6 text-theme-muted">
                  {t('safeguarding.guardians.wards_intro')}
                </p>
                <ul className="mt-3 space-y-2">
                  {wards.map((ward) => (
                    <li
                      key={ward.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-theme-default bg-theme-elevated p-3"
                    >
                      <span className="text-sm font-medium text-theme-primary">{ward.ward_name}</span>
                      <Chip size="sm" variant="soft" color={STATE_COLOR[ward.state]}>
                        {t(`safeguarding.guardians.ward_state_${ward.state}`)}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {preferences.length === 0 ? (
          <div className="p-6 text-center rounded-lg bg-theme-elevated border border-theme-default">
            <Lock className="w-8 h-8 mx-auto mb-2 text-theme-muted opacity-50" />
            <p className="text-sm text-theme-muted">
              {t('safeguarding.no_preferences')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {preferences.map(pref => {
              const activationChips: string[] = [];
              if (pref.activations.requires_broker_approval) {
                activationChips.push(t('safeguarding.chip_broker_review'));
              }
              if (pref.activations.restricts_matching) {
                activationChips.push(t('safeguarding.chip_match_approval'));
              }
              if (pref.activations.requires_vetted_interaction) {
                activationChips.push(t('safeguarding.chip_vetted_only'));
              }

              const isDeclination = pref.option_key === 'none_apply';

              return (
                <div
                  key={pref.preference_id}
                  className="p-4 rounded-lg border border-theme-default bg-theme-surface"
                >
                  <div className="flex items-start gap-3">
                    {isDeclination
                      ? <MinusCircle className="w-5 h-5 text-theme-muted shrink-0 mt-0.5" />
                      : <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm ${isDeclination ? 'text-theme-muted' : 'text-theme-primary'}`}>
                        {pref.label}
                      </p>
                      {pref.description && (
                        <p className="text-xs text-theme-muted mt-1 leading-relaxed">
                          {pref.description}
                        </p>
                      )}
                      {pref.consent_given_at && (
                        <p className="text-xs text-theme-muted mt-2">
                          {t('safeguarding.selected_on', {
                            date: new Date(pref.consent_given_at).toLocaleDateString(getFormattingLocale()),
                          })}
                        </p>
                      )}
                      {/* Never show activation chips for the declination option */}
                      {!isDeclination && activationChips.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {activationChips.map((label) => (
                            <Chip key={label} size="sm" variant="soft" color="warning">
                              {label}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="danger-soft"
                      className="shrink-0"
                      onPress={() => handleRevokeClick(pref)}
                      isLoading={revokingId === pref.option_id}
                      startContent={revokingId !== pref.option_id ? <Trash2 className="w-3 h-3" /> : undefined}
                    >
                      {t('safeguarding.revoke_button')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/*
        Confirm refusing or withdrawing, with an OPTIONAL reason.

        🔴 The reason must never be required. Making somebody justify refusing a
        safeguarding arrangement is pressure to consent, which would defeat the
        purpose of offering the choice at all. The hint says so explicitly.
      */}
      <Modal isOpen={responseModal.isOpen} onOpenChange={responseModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {pendingResponse?.action === 'withdraw'
                  ? t('safeguarding.guardians.withdraw_confirm_title')
                  : t('safeguarding.guardians.decline_confirm_title')}
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-theme-secondary">
                  {pendingResponse?.action === 'withdraw'
                    ? t('safeguarding.guardians.withdraw_confirm_body')
                    : t('safeguarding.guardians.decline_confirm_body')}
                </p>
                {pendingResponse?.guardian && (
                  <p className="mt-2 text-sm font-medium text-theme-primary">
                    {pendingResponse.guardian.guardian_name}
                  </p>
                )}
                <Textarea
                  className="mt-3"
                  label={t('safeguarding.guardians.reason_label')}
                  description={t('safeguarding.guardians.reason_hint')}
                  value={responseReason}
                  onValueChange={setResponseReason}
                  maxLength={500}
                  minRows={2}
                  maxRows={5}
                />
              </ModalBody>
              <ModalFooter>
                {/*
                  Reuses the already-translated common "Cancel" rather than
                  adding a new key. A one-word string is skipped by the
                  translator's single-word guard (it treats them as code values),
                  and overriding that guard is how "Recorded" came back meaning
                  audio recording in four languages.
                */}
                <Button variant="tertiary" onPress={onClose}>
                  {t('cancel', { ns: 'common' })}
                </Button>
                <Button
                  variant="danger"
                  onPress={confirmResponse}
                  isLoading={consentingId !== null}
                >
                  {pendingResponse?.action === 'withdraw'
                    ? t('safeguarding.guardians.withdraw_confirm_yes')
                    : t('safeguarding.guardians.decline_confirm_yes')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Confirm revocation */}
      <Modal isOpen={confirmModal.isOpen} onOpenChange={confirmModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('safeguarding.revoke_confirm_title')}
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-theme-secondary">
                  {t('safeguarding.revoke_confirm_body')}
                </p>
                {pendingRevoke && (
                  <p className="text-sm font-medium text-theme-primary mt-2">
                    {pendingRevoke.label}
                  </p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('safeguarding.revoke_confirm_no')}
                </Button>
                <Button
                  variant="danger"
                  onPress={handleRevokeConfirm}
                  isLoading={revokingId !== null}
                >
                  {t('safeguarding.revoke_confirm_yes')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default SafeguardingTab;
