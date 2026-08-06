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
 * The recipient picker reuses the wallet transfer search endpoint so the
 * same tenant-scoped member pool applies.
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
  Select,
  SelectItem,
  Spinner,
  TextArea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useToast } from '@/contexts';

export type PrepareActionType = 'listing_create' | 'credit_transfer';

interface RecipientResult {
  id: number;
  first_name: string;
  last_name: string;
  username?: string;
}

interface Category {
  id: number;
  name: string;
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
  const { t } = useTranslation('settings');
  const toast = useToast();

  const [submitting, setSubmitting] = useState(false);
  // Transfer fields
  const [recipient, setRecipient] = useState<RecipientResult | null>(null);
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<RecipientResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  // Listing fields
  const [title, setTitle] = useState('');
  const [listingType, setListingType] = useState<'offer' | 'request'>('offer');
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [hours, setHours] = useState('1');

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset per open, and fetch listing categories when needed.
  useEffect(() => {
    if (!isOpen) return;
    setRecipient(null);
    setRecipientQuery('');
    setRecipientResults([]);
    setAmount('');
    setDescription('');
    setTitle('');
    setListingType('offer');
    setCategoryId(null);
    setHours('1');

    if (actionType === 'listing_create') {
      (async () => {
        try {
          const res = await api.get<Category[] | { categories?: Category[] }>('/v2/categories?type=listing');
          if (res.success && res.data) {
            const list = Array.isArray(res.data) ? res.data : (res.data.categories ?? []);
            setCategories(list);
            if (list.length > 0) setCategoryId(list[0]!.id);
          }
        } catch (error) {
          logError('Failed to load listing categories', error);
        }
      })();
    }
  }, [isOpen, actionType]);

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

  const payload = (): Record<string, unknown> | null => {
    if (actionType === 'credit_transfer') {
      const parsed = Number.parseFloat(amount);
      if (!recipient || !Number.isFinite(parsed) || parsed <= 0) return null;
      return {
        recipient: recipient.id,
        amount: parsed,
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
      };
    }
    if (title.trim() === '' || description.trim() === '' || categoryId === null) return null;
    const parsedHours = Number.parseFloat(hours);
    return {
      title: title.trim(),
      description: description.trim(),
      type: listingType,
      category_id: categoryId,
      hours_estimate: Number.isFinite(parsedHours) && parsedHours > 0 ? parsedHours : 1,
    };
  };

  const submit = async () => {
    const body = payload();
    if (body === null) {
      toast.error(t('support_actions.prepare_incomplete'));
      return;
    }

    setSubmitting(true);
    try {
      const res = tier === 'co_decide'
        ? await api.post('/v2/users/me/support-actions', {
            supported_user_id: supportedUserId,
            action_type: actionType,
            payload: body,
          })
        : actionType === 'credit_transfer'
          ? await api.post(`/v2/users/me/sub-accounts/${supportedUserId}/transfer`, body)
          : await api.post(`/v2/users/me/sub-accounts/${supportedUserId}/listings`, body);

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

  const heading = actionType === 'credit_transfer'
    ? t('support_actions.prepare_transfer_title', { name: supportedName })
    : t('support_actions.prepare_listing_title', { name: supportedName });

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>
              <ModalHeading>{heading}</ModalHeading>
            </ModalHeader>
            <ModalBody>
              {/* What submitting will actually do, stated before any field. */}
              <p className="text-sm text-theme-muted">
                {tier === 'co_decide'
                  ? t('support_actions.prepare_explainer_co_decide', { name: supportedName })
                  : t('support_actions.prepare_explainer_represent', { name: supportedName })}
              </p>

              {actionType === 'credit_transfer' ? (
                <div className="space-y-3">
                  {recipient ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-theme-default p-3">
                      <span className="text-sm font-medium text-theme-primary">
                        {`${recipient.first_name} ${recipient.last_name}`.trim()}
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
                                {`${user.first_name} ${user.last_name}`.trim()}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <Input
                    label={t('support_actions.amount_label')}
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
              ) : (
                <div className="space-y-3">
                  <Input
                    label={t('support_actions.listing_title_label')}
                    value={title}
                    onValueChange={setTitle}
                    maxLength={150}
                  />
                  <Select
                    label={t('support_actions.listing_type_label')}
                    selectedKeys={[listingType]}
                    onSelectionChange={(keys) => {
                      const value = Array.from(keys)[0];
                      if (value === 'offer' || value === 'request') setListingType(value);
                    }}
                  >
                    <SelectItem key="offer" id="offer">{t('support_actions.listing_type_offer')}</SelectItem>
                    <SelectItem key="request" id="request">{t('support_actions.listing_type_request')}</SelectItem>
                  </Select>
                  {categories.length > 0 && (
                    <Select
                      label={t('support_actions.category_label')}
                      selectedKeys={categoryId !== null ? [String(categoryId)] : []}
                      onSelectionChange={(keys) => {
                        const value = Number.parseInt(String(Array.from(keys)[0] ?? ''), 10);
                        if (Number.isFinite(value)) setCategoryId(value);
                      }}
                    >
                      {categories.map((category) => (
                        <SelectItem key={String(category.id)} id={String(category.id)}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                  <Input
                    label={t('support_actions.hours_label')}
                    type="number"
                    min={0.25}
                    step={0.25}
                    value={hours}
                    onValueChange={setHours}
                  />
                  <TextArea
                    label={t('support_actions.description_label')}
                    value={description}
                    onValueChange={setDescription}
                    maxLength={2000}
                    minRows={3}
                    maxRows={6}
                  />
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={onClose} isDisabled={submitting}>
                {t('cancel', { ns: 'common' })}
              </Button>
              <Button color="primary" onPress={() => void submit()} isLoading={submitting}>
                {tier === 'co_decide'
                  ? t('support_actions.submit_prepare')
                  : t('support_actions.submit_direct')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default SupportPrepareModal;
