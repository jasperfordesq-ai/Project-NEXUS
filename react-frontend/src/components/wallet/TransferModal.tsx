// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
/**
 * Transfer Credits Modal
 * Allows users to send time credits to other members
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from '@/lib/motion';

import X from 'lucide-react/icons/x';
import Send from 'lucide-react/icons/send';
import Search from 'lucide-react/icons/search';
import User from 'lucide-react/icons/user';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { api } from '@/lib/api';
import { formatNumber, getRecipientDisplayName, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { useToast } from '@/contexts';
import { CategorySelect } from './CategorySelect';
import type { WalletUserSearchResult, Transaction } from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
  onTransferComplete: (transaction: Transaction) => void;
  initialRecipientId?: number | null;
}

interface TransferFormData {
  recipient: WalletUserSearchResult | null;
  amount: string;
  description: string;
  category_id: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function TransferModal({
  isOpen,
  onClose,
  currentBalance,
  onTransferComplete,
  initialRecipientId,
}: TransferModalProps) {
  const { t } = useTranslation('wallet');
  const toast = useToast();
  const [maxTransfer, setMaxTransfer] = useState(1000);

  // Form state
  const [formData, setFormData] = useState<TransferFormData>({
    recipient: null,
    amount: '',
    description: '',
    category_id: null,
  });

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WalletUserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Reset form when the modal transitions open. Done during render with a
  // prev-prop comparison (not useEffect) so users never see a stale frame.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setFormData({ recipient: null, amount: '', description: '', category_id: null });
      setSearchQuery('');
      setSearchResults([]);
      setError(null);
    }
  }

  // Async side-effects when the modal opens (config + recipient prefetch).
  useEffect(() => {
    let cancelled = false;

    if (isOpen) {
      // Fetch max transfer limit from wallet config; fall back silently to current state value
      api.get<{ max_transfer?: number }>('/v2/wallet/config')
        .then((res) => {
          if (cancelled) return;
          if (res.success && res.data?.max_transfer != null) {
            setMaxTransfer(res.data.max_transfer);
          }
        })
        .catch(() => { /* use existing default */ });

      // Auto-fill recipient if initialRecipientId is provided
      if (initialRecipientId) {
        api.get<{ id: number; first_name: string; last_name: string; avatar_url?: string; username?: string }>(`/v2/users/${initialRecipientId}`)
          .then((res) => {
            if (cancelled) return;
            if (res.success && res.data) {
              const u = res.data;
              setFormData((prev) => ({
                ...prev,
                recipient: {
                  id: u.id,
                  first_name: u.first_name,
                  last_name: u.last_name,
                  avatar: u.avatar_url || (u as Record<string, unknown>).avatar as string || null,
                  username: u.username || null,
                } as WalletUserSearchResult,
              }));
            } else {
              toast.warning(t('toast.recipient_load_failed'));
            }
          })
          .catch(() => {
            if (cancelled) return;
            toast.warning(t('toast.recipient_load_failed'));
          });
      } else {
        // Focus search input after animation (only when no pre-fill)
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }

    // Cleanup: cancel in-flight request and clear timeout
    return () => {
      cancelled = true;
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [isOpen, initialRecipientId, t, toast]);

  // Debounced user search
  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await api.get<{ users: WalletUserSearchResult[] }>(
        `/v2/wallet/user-search?q=${encodeURIComponent(query)}&limit=10`
      );

      if (response.success && response.data?.users) {
        setSearchResults(response.data.users);
        setShowResults(true);
      } else {
        // Failed search must not look like "no results"
        setSearchResults([]);
        setShowResults(false);
        toast.warning(t('toast.recipient_load_failed'));
      }
    } catch (err) {
      logError('User search failed', err);
    } finally {
      setIsSearching(false);
    }
  }, [t, toast]);

  // Handle search input change with debounce
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setError(null);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      searchUsers(value);
    }, 300);
  };

  // Select a recipient
  const handleSelectRecipient = (user: WalletUserSearchResult) => {
    setFormData((prev) => ({ ...prev, recipient: user }));
    setSearchQuery('');
    setShowResults(false);
    setSearchResults([]);
  };

  // Clear selected recipient
  const handleClearRecipient = () => {
    setFormData((prev) => ({ ...prev, recipient: null }));
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  // Validate form
  const validateForm = (): string | null => {
    if (!formData.recipient) {
      return t('validation.select_recipient');
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      return t('validation.valid_amount');
    }

    if (amount > currentBalance) {
      return t('validation.insufficient_balance');
    }

    // Check for reasonable max (prevent typos)
    if (amount > maxTransfer) {
      return t('validation.max_transfer', { max: maxTransfer });
    }

    return null;
  };

  // Submit transfer
  const handleSubmit = async () => {
    if (isSubmitting) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Idempotency key for this submit: a double-click or network retry of the
    // same transfer collapses to ONE debit server-side (WalletService::transfer
    // replays the original transaction). The api layer reuses these headers on
    // its internal retries, so the key stays stable for this logical transfer.
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const response = await api.post<Transaction>(
        '/v2/wallet/transfer',
        {
          recipient: formData.recipient!.id,
          amount: parseFloat(formData.amount),
          description: formData.description.trim() || undefined,
          category_id: formData.category_id || undefined,
        },
        { headers: { 'Idempotency-Key': idempotencyKey } }
      );

      if (response.success && response.data) {
        onTransferComplete(response.data);
        onClose();
      } else {
        setError(response.error || t('error.transfer_failed'));
      }
    } catch (err) {
      logError('Transfer failed', err);
      setError(t('error.unexpected'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Parse amount for display
  const parsedAmount = parseFloat(formData.amount) || 0;
  const isOverBalance = parsedAmount > currentBalance;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      scrollBehavior="inside"
      classNames={{
        wrapper: 'z-[400]',
        base: 'bg-theme-solid border border-theme-default max-sm:m-0 max-sm:rounded-none max-sm:w-screen max-sm:max-w-none max-sm:h-[100dvh] max-sm:max-h-none',
        header: 'border-b border-theme-default',
        body: 'py-4',
        footer: 'border-t border-theme-default max-sm:pb-[env(safe-area-inset-bottom,0px)]',
      }}
    >
      <ModalContent className="bg-theme-solid">
        {(onModalClose) => (
          <>
            <ModalHeader className="text-xl font-semibold text-theme-primary flex items-center gap-2">
              <Send className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
              {t('send_credits')}
            </ModalHeader>

            <ModalBody className="space-y-5 py-4">
              {/* Balance Display */}
              <div className="bg-theme-elevated rounded-lg p-3 flex justify-between items-center">
                <span className="text-theme-muted text-sm">{t('available_balance')}</span>
                <span className="text-theme-primary font-semibold">{currentBalance} {t('hours').toLowerCase()}</span>
              </div>

              {/* Recipient Search */}
              <div className="space-y-2">

                {formData.recipient ? (
                  // Selected recipient display
                  <div className="flex items-center gap-3 bg-theme-elevated rounded-lg p-3">
                    <Avatar
                      src={resolveAvatarUrl(formData.recipient.avatar) || undefined}
                      name={getRecipientDisplayName(formData.recipient)}
                      size="sm"
                      className="flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-theme-primary font-medium truncate">
                        {getRecipientDisplayName(formData.recipient)}
                      </p>
                      {formData.recipient.username && (
                        <p className="text-theme-subtle text-sm truncate">
                          @{formData.recipient.username}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="tertiary"
                      isIconOnly
                      onPress={handleClearRecipient}
                      className="size-8 min-h-8 p-1 text-theme-subtle transition-colors hover:text-theme-primary"
                      aria-label={t('remove_recipient')}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  // Search input
                  <div className="relative">
                    <Input
                      ref={searchInputRef}
                      type="text"
                      placeholder={t('search_placeholder')}
                      aria-label={t('search_recipient')}
                      value={searchQuery}
                      onValueChange={handleSearchChange}
                      onFocus={() => searchResults.length > 0 && setShowResults(true)}
                      onBlur={(e) => {
                        // Only hide results if focus moved outside the results container
                        const relatedTarget = e.relatedTarget as HTMLElement | null;
                        if (!resultsRef.current?.contains(relatedTarget)) {
                          setShowResults(false);
                        }
                      }}
                      startContent={
                        isSearching ? (
                          <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="sm" color="current" /></div>
                        ) : (
                          <Search className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                        )
                      }
                      classNames={{
                        input: 'bg-transparent text-theme-primary',
                        inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                      }}
                    />

                    {/* Search Results Dropdown */}
                    <AnimatePresence>
                      {showResults && searchResults.length > 0 && (
                        <motion.div
                          ref={resultsRef}
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute top-full left-0 right-0 mt-2 bg-overlay border border-theme-default rounded-lg shadow-xl overflow-hidden z-50 max-h-60 overflow-y-auto"
                          /* A labelled group of result buttons — NOT role="listbox".
                             The HeroUI Button does not forward role="option" to the DOM
                             (React Aria keeps the native button role), so a role="listbox"
                             here wrapped option-less buttons = invalid ARIA (screen readers
                             announced an empty list). Each result stays a real, focusable,
                             Enter-activatable button inside a named group. */
                          role="group"
                          aria-label={t('search_results')}
                        >
                          {searchResults.map((user) => (
                            <Button
                              key={user.id}
                              type="button"
                              variant="ghost"
                              onPress={() => handleSelectRecipient(user)}
                              className="w-full min-h-[64px] flex items-center justify-start gap-3 rounded-none p-3 text-left transition-colors hover:bg-theme-hover"
                            >
                              <Avatar
                                src={resolveAvatarUrl(user.avatar) || undefined}
                                name={getRecipientDisplayName(user)}
                                size="sm"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-theme-primary font-medium truncate">
                                  {getRecipientDisplayName(user)}
                                </p>
                                {user.username && (
                                  <p className="text-theme-subtle text-sm truncate">
                                    @{user.username}
                                  </p>
                                )}
                              </div>
                            </Button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* No results message */}
                    {showResults && searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-overlay border border-theme-default rounded-lg p-4 text-center z-50">
                        <User className="w-8 h-8 text-theme-subtle mx-auto mb-2" aria-hidden="true" />
                        <p className="text-theme-muted text-sm">{t('no_members_found')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Amount Input */}
              <div className="space-y-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  label={t('amount_hours')}
                  aria-label={t('amount_in_hours')}
                  min="0.25"
                  step="0.25"
                  value={formData.amount}
                  onValueChange={(value) => {
                    setFormData((prev) => ({ ...prev, amount: value }));
                    setError(null);
                  }}
                  endContent={<span className="text-theme-subtle text-sm">{t('hours').toLowerCase()}</span>}
                  classNames={{
                    input: `bg-transparent text-theme-primary text-lg font-semibold ${isOverBalance ? 'text-[var(--color-error)]' : ''}`,
                    inputWrapper: `bg-theme-elevated border-theme-default hover:bg-theme-hover ${isOverBalance ? 'border-red-500/50' : ''}`,
                  }}
                />
                {isOverBalance && (
                  <p className="text-[var(--color-error)] text-sm flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" aria-hidden="true" />
                    {t('exceeds_balance')}
                  </p>
                )}
              </div>

              {/* Category (W8) */}
              <CategorySelect
                value={formData.category_id}
                onChange={(id) => setFormData((prev) => ({ ...prev, category_id: id }))}
              />

              {/* Description Input */}
              <div className="space-y-2">
                <Textarea
                  label={t('csv.description')}
                  placeholder={t('description_placeholder')}
                  value={formData.description}
                  onValueChange={(value) =>
                    setFormData((prev) => ({ ...prev, description: value }))
                  }
                  maxLength={255}
                  minRows={2}
                  maxRows={4}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                  }}
                />
                <p className="text-theme-subtle text-xs text-right">
                  {formData.description.length}/255
                </p>
              </div>

              {/* Error Message */}
              <div role="alert" aria-live="assertive" aria-atomic="true">
                {error && (
                  <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-3 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-[var(--color-error)] flex-shrink-0" aria-hidden="true" />
                    <p className="text-[var(--color-error)] text-sm">{error}</p>
                  </div>
                )}
              </div>

              {/* Transfer Summary */}
              {formData.recipient && parsedAmount > 0 && !isOverBalance && (
                <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
                  <p className="text-theme-muted text-sm">
                    {t('transfer_summary', {
                      amount: parsedAmount,
                      unit: t('hours').toLowerCase(),
                      name: getRecipientDisplayName(formData.recipient),
                    })}
                  </p>
                  <p className="text-theme-subtle text-xs mt-1">
                    {t('new_balance_after', {
                      balance: formatNumber(currentBalance - parsedAmount, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </p>
                </div>
              )}
            </ModalBody>

            <ModalFooter className="gap-3">
              <Button
                variant="tertiary"
                className="flex-1 bg-theme-elevated text-theme-primary"
                onPress={onModalClose}
                isDisabled={isSubmitting}
              >
                {t('cancel')}
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={!isSubmitting && <Send className="w-4 h-4" aria-hidden="true" />}
                isLoading={isSubmitting}
                isDisabled={!formData.recipient || !parsedAmount || isOverBalance}
                onPress={handleSubmit}
              >
                {t('send_credits')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default TransferModal;
