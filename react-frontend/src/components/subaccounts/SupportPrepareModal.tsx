// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SupportPrepareModal — a supporter prepares a listing or a time-credit
 * transfer for a member they support.
 *
 * What happens on submit depends on the tier the supporter holds for the
 * capability, and the submit button says which, in plain words:
 *
 * - co_decide  → POST /v2/users/me/support-actions. NOTHING happens until the
 *   supported member approves (in-app, or via the emailed one-click link).
 * - represent  → the direct proxy endpoint. It happens immediately, executed
 *   through the member's own code path, attributed to the supporter.
 *
 * 🔴 This renders the REAL forms, not simplified copies of them.
 *
 * It originally carried five hand-rolled listing fields (title, type,
 * category, hours, description) against a real form with fourteen — no
 * location, no photo, no skills, no service type, no accessibility notes.
 * A supporter posting on someone's behalf was therefore forced to produce a
 * worse listing than the member could have posted themselves, which is
 * backwards: the people who need a supporter are the least able to go back
 * and fill in the gaps afterwards.
 *
 * Listing uses `ListingForm` (the same component behind the create page and
 * the composer) with a submitAdapter that redirects the save. Transfer
 * mirrors TransferModal's rules — the SUPPORTED member's balance and the
 * tenant transfer cap, not the supporter's. Adding a field to either original
 * now reaches this screen for free.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalHeading,
  Spinner,
  TextArea,
  Avatar,
} from '@/components/ui';
import { ListingForm, type ListingSubmitPayload, type ListingSubmitResult } from '@/components/listings/ListingForm';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { useToast } from '@/contexts';

export type PrepareActionType = 'listing_create' | 'credit_transfer';

interface RecipientResult {
  id: number;
  first_name: string;
  last_name: string;
  username?: string;
  avatar_url?: string | null;
}

interface SupportPrepareModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: PrepareActionType;
  supportedUserId: number;
  supportedName: string;
  /** The tier the supporter holds for this capability: decides the endpoint. */
  tier: 'co_decide' | 'represent';
  onDone?: () => void;
}

export function SupportPrepareModal({
  isOpen,
  onOpenChange,
  actionType,
  supportedUserId,
  supportedName,
  tier,
  onDone,
}: SupportPrepareModalProps) {
  const { t } = useTranslation(['settings', 'common']);
  const toast = useToast();

  const [submitting, setSubmitting] = useState(false);
  // Transfer fields
  const [recipient, setRecipient] = useState<RecipientResult | null>(null);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<RecipientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  // The SUPPORTED member's wallet, not the supporter's — spending their
  // balance against the supporter's would misreport what is available.
  const [balance, setBalance] = useState<number | null>(null);
  const [maxTransfer, setMaxTransfer] = useState<number | null>(null);
  const [loadingWallet, setLoadingWallet] = useState(false);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset per open; load the wallet context the transfer form needs.
  useEffect(() => {
    if (!isOpen) return;
    setRecipient(null);
    setRecipientQuery('');
    setRecipientResults([]);
    setAmount('');
    setDescription('');

    if (actionType !== 'credit_transfer') return;

    let cancelled = false;
    setLoadingWallet(true);
    (async () => {
      try {
        const [walletRes, configRes] = await Promise.all([
          api.get<{ balance?: number }>(`/v2/users/me/sub-accounts/${supportedUserId}/wallet`),
          api.get<{ max_transfer?: number }>('/v2/wallet/config'),
        ]);
        if (cancelled) return;
        if (walletRes.success && typeof walletRes.data?.balance === 'number') {
          setBalance(walletRes.data.balance);
        }
        if (configRes.success && typeof configRes.data?.max_transfer === 'number') {
          setMaxTransfer(configRes.data.max_transfer);
        }
      } catch (error) {
        // A missing balance must not block the form — the server enforces the
        // real limits on submit regardless of what this screen managed to read.
        logError('Failed to load supported member wallet context', error);
      } finally {
        if (!cancelled) setLoadingWallet(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, actionType, supportedUserId]);

  const searchRecipients = useCallback(async (query: string) => {
    if (query.length < 2) {
      setRecipientResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api.get<{ users: RecipientResult[] }>(
        `/v2/wallet/user-search?q=${encodeURIComponent(query)}&limit=10`,
      );
      if (res.success && res.data?.users) setRecipientResults(res.data.users);
    } catch (error) {
      logError('Recipient search failed', error);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleRecipientQuery = (value: string) => {
    setRecipientQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => void searchRecipients(value), 300);
  };

  /** Same validation order as TransferModal, against the SUPPORTED member's
   *  balance and the tenant cap. */
  const transferValidationError = (): string | null => {
    if (!recipient) return t('support_actions.validation_recipient');
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return t('support_actions.validation_amount');
    if (balance !== null && parsed > balance) {
      return t('support_actions.validation_balance', { balance });
    }
    if (maxTransfer !== null && parsed > maxTransfer) {
      return t('support_actions.validation_max', { max: maxTransfer });
    }
    return null;
  };

  const submitTransfer = async () => {
    const invalid = transferValidationError();
    if (invalid) {
      toast.error(invalid);
      return;
    }

    const body: Record<string, unknown> = {
      recipient: recipient!.id,
      amount: Number.parseFloat(amount),
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
    };

    setSubmitting(true);
    try {
      const res = tier === 'co_decide'
        ? await api.post('/v2/users/me/support-actions', {
            supported_user_id: supportedUserId,
            action_type: 'credit_transfer',
            payload: body,
          })
        : await api.post(`/v2/users/me/sub-accounts/${supportedUserId}/transfer`, body);

      if (res.success) {
        toast.success(tier === 'co_decide'
          ? t('support_actions.prepared_toast', { name: supportedName })
          : t('support_actions.done_directly_toast'));
        onOpenChange(false);
        onDone?.();
      } else {
        toast.error(res.error || t('support_actions.action_failed'));
      }
    } catch (error) {
      logError('Failed to prepare support action', error);
      toast.error(t('support_actions.action_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Where ListingForm's save goes when a supporter is acting.
   *
   * co_decide stores the whole payload — skill tags included — so approval
   * recreates exactly what was prepared. represent posts it straight through
   * the proxy endpoint.
   *
   * 🔴 A photo cannot travel on the co_decide path: nothing exists to attach
   * it to until the member approves, and holding an uploaded file against an
   * unapproved action would store someone's image with no listing to own it.
   * The form says so rather than silently dropping it.
   */
  const listingSubmitAdapter = async (
    payload: ListingSubmitPayload,
    extras: { skillTags: string[]; imageFile: File | null },
  ): Promise<ListingSubmitResult> => {
    const body = {
      ...payload,
      ...(extras.skillTags.length > 0 ? { skill_tags: extras.skillTags } : {}),
    };

    if (tier === 'co_decide') {
      if (extras.imageFile) toast.warning(t('support_actions.photo_after_approval'));
      const res = await api.post('/v2/users/me/support-actions', {
        supported_user_id: supportedUserId,
        action_type: 'listing_create',
        payload: body,
      });
      return { success: res.success, error: res.error, errors: res.errors };
    }

    const res = await api.post<{ id: number }>(
      `/v2/users/me/sub-accounts/${supportedUserId}/listings`,
      body,
    );
    if (!res.success) {
      return { success: false, error: res.error, errors: res.errors };
    }

    const newId = res.data?.id;
    if (extras.imageFile && newId) {
      try {
        await api.upload(
          `/v2/users/me/sub-accounts/${supportedUserId}/listings/${newId}/image`,
          extras.imageFile,
          'image',
        );
      } catch (imgErr) {
        // The listing exists and is theirs; only the photo failed. Warn rather
        // than reporting the whole action as failed.
        logError('Failed to upload proxy listing image', imgErr);
        toast.warning(t('support_actions.photo_upload_failed'));
      }
    }
    return { success: true, id: newId };
  };

  const heading = actionType === 'credit_transfer'
    ? t('support_actions.prepare_transfer_title', { name: supportedName })
    : t('support_actions.prepare_listing_title', { name: supportedName });

  const explainer = tier === 'co_decide'
    ? t('support_actions.prepare_explainer_co_decide', { name: supportedName })
    : t('support_actions.prepare_explainer_represent', { name: supportedName });

  const isListing = actionType === 'listing_create';

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size={isListing ? '3xl' : 'lg'}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>
              <ModalHeading>{heading}</ModalHeading>
            </ModalHeader>
            <ModalBody>
              {/* What submitting will actually do, stated before any field. */}
              <p className="text-sm text-theme-muted">{explainer}</p>

              {isListing ? (
                <ListingForm
                  variant="sheet"
                  submitAdapter={listingSubmitAdapter}
                  successMessage={tier === 'co_decide'
                    ? t('support_actions.prepared_toast', { name: supportedName })
                    : t('support_actions.done_directly_toast')}
                  onSuccess={() => {
                    onOpenChange(false);
                    onDone?.();
                  }}
                  onCancel={onClose}
                />
              ) : (
                <div className="space-y-3">
                  {loadingWallet ? (
                    <Spinner size="sm" aria-label={t('common:loading')} />
                  ) : balance !== null ? (
                    <p className="text-sm text-theme-muted">
                      {t('support_actions.their_balance', { name: supportedName, balance })}
                    </p>
                  ) : null}

                  {recipient ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-theme-default p-3">
                      <span className="flex items-center gap-2">
                        <Avatar
                          aria-hidden="true"
                          src={resolveAvatarUrl(recipient.avatar_url)}
                          name={resolveUserDisplayName(recipient)}
                          size="sm"
                        />
                        <span className="text-sm font-medium text-theme-primary">
                          {resolveUserDisplayName(recipient)}
                        </span>
                      </span>
                      <Button size="sm" variant="tertiary" onPress={() => setRecipient(null)}>
                        {t('support_actions.recipient_change')}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        label={t('support_actions.recipient_label')}
                        description={t('support_actions.recipient_hint')}
                        value={recipientQuery}
                        onValueChange={handleRecipientQuery}
                      />
                      {searching && <Spinner size="sm" aria-label={t('support_actions.recipient_searching')} />}
                      {recipientResults.length > 0 && (
                        <ul className="space-y-1" aria-label={t('support_actions.recipient_label')}>
                          {recipientResults.map((user) => (
                            <li key={user.id}>
                              <Button
                                size="sm"
                                variant="tertiary"
                                className="w-full justify-start"
                                onPress={() => {
                                  setRecipient(user);
                                  setRecipientResults([]);
                                  setRecipientQuery('');
                                }}
                              >
                                <span className="flex items-center gap-2">
                                  <Avatar
                                    aria-hidden="true"
                                    src={resolveAvatarUrl(user.avatar_url)}
                                    name={resolveUserDisplayName(user)}
                                    size="sm"
                                  />
                                  {resolveUserDisplayName(user)}
                                </span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <Input
                    label={t('support_actions.amount_label')}
                    description={maxTransfer !== null
                      ? t('support_actions.amount_max_hint', { max: maxTransfer })
                      : undefined}
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={amount}
                    onValueChange={setAmount}
                  />

                  <TextArea
                    label={t('support_actions.description_label')}
                    value={description}
                    onValueChange={setDescription}
                    maxLength={500}
                    minRows={2}
                    maxRows={4}
                  />
                </div>
              )}
            </ModalBody>

            {/* The listing form renders its own footer; only the transfer
                branch needs buttons here. */}
            {!isListing && (
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={submitting}>
                  {t('cancel', { ns: 'common' })}
                </Button>
                <Button color="primary" onPress={() => void submitTransfer()} isLoading={submitting}>
                  {tier === 'co_decide'
                    ? t('support_actions.submit_prepare')
                    : t('support_actions.submit_direct')}
                </Button>
              </ModalFooter>
            )}
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default SupportPrepareModal;
