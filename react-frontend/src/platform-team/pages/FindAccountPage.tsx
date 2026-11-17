// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Find an account, and sign it out everywhere.
 *
 * Type one whole email address; the page shows every account that uses it, in
 * any community. On each account there is one action: "Sign out everywhere",
 * which ends every sign-in of that account after a confirmation and a reason.
 *
 * 🔴 The address is sent in the BODY of the request, never in its address, and
 * the reply does not repeat it. Keep it that way: an address in a web address
 * ends up in logs and in the browser's history.
 *
 * 🔴 One action and no other. Nothing here changes a password, a role or
 * anyone's access, and nothing should be added that does.
 *
 * 🔴 A search that could not be made shows the error card. It never falls
 * back to "No account uses that address", which would be a comforting lie.
 *
 * The second sign-in step: the server asks for a recent code before it signs
 * anyone out. The API client handles that by itself (lib/api.ts): it opens the
 * code prompt (components/security/StepUpPrompt), then sends the same request
 * again, and only then does `api.post()` below finish. When the person closes
 * the prompt, the refusal comes back with the code AUTH_STEP_UP_REQUIRED and
 * nothing was done; the dialog stays open with the reason still in it.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog, Button, Card, CardBody, Chip, Input, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useAuth, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api, AUTH_STEP_UP_REQUIRED } from '@/lib/api';
import { logError } from '@/lib/logger';
import CircleCheck from 'lucide-react/icons/circle-check';
import Info from 'lucide-react/icons/info';
import LogOut from 'lucide-react/icons/log-out';
import Search from 'lucide-react/icons/search';
import SearchX from 'lucide-react/icons/search-x';
import { getFormattingLocale } from '@/lib/helpers';

const FIND_URL = '/v2/platform-team/accounts/find';

/** The server's own limits (FindAccountService). The server checks them again. */
export const REASON_MIN = 5;
export const REASON_MAX = 200;

const LEVELS = ['platform_team', 'global_super_admin', 'tenant_super_admin', 'platform_flag_only'] as const;
type Level = (typeof LEVELS)[number];

/** Roles named on screen. Any other role is shown as "Another role": the old top role's name is never shown. */
const KNOWN_ROLES = ['member', 'admin', 'broker', 'coordinator'] as const;
type KnownRole = (typeof KNOWN_ROLES)[number];

/** Account states the server can send besides `active` and `deleted`. */
const KNOWN_STATUSES = ['inactive', 'suspended', 'banned', 'pending', 'rejected'] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];

export interface AccountMatch {
  id: number;
  name: string | null;
  community: { id: number; name: string | null; slug: string | null } | null;
  status: string;
  role: string;
  level: Level | null;
  last_sign_in_at: string | null;
  two_step_on: boolean;
  has_passkey: boolean;
  signed_in_now: number;
}

interface FindReply {
  matches: AccountMatch[];
  truncated: boolean;
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'failed' }
  | { kind: 'too_many' }
  | { kind: 'done'; reply: FindReply };

type DialogError = 'step_cancelled' | 'failed' | 'gone';

/** One whole address: something@something, no spaces. Whether an account uses it is the server's answer. */
function wholeAddress(value: string): string | null {
  const email = value.trim();
  if (email === '' || email.length > 255 || /\s/.test(email)) return null;
  const parts = email.split('@');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? email : null;
}

export function FindAccountPage() {
  const { t } = useTranslation('platform_team');
  const { user } = useAuth();
  const toast = useToast();
  usePageTitle(t('accounts.title'));

  const [email, setEmail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [searched, setSearched] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  /** Accounts signed out during this search, so the card can say so. */
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());

  const [target, setTarget] = useState<AccountMatch | null>(null);
  const [reason, setReason] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [dialogError, setDialogError] = useState<DialogError | null>(null);
  /**
   * After a sign-out the button that opened the dialog is replaced by the "done"
   * line, so keyboard focus would be lost. Focus moves to that line instead.
   */
  const [focusDoneId, setFocusDoneId] = useState<number | null>(null);
  const doneLineRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (focusDoneId === null) return;
    // After the dialog has closed and let go of focus.
    const frame = requestAnimationFrame(() => {
      doneLineRef.current?.focus();
      setFocusDoneId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusDoneId]);

  const find = useCallback(async (address: string) => {
    setSearched(address);
    setSearch({ kind: 'searching' });
    setDone(new Set());
    try {
      const res = await api.post<FindReply>(FIND_URL, { email: address });
      if (res.success && res.data && Array.isArray(res.data.matches)) {
        setSearch({ kind: 'done', reply: res.data });
      } else {
        setSearch({ kind: res.code === 'RATE_LIMIT_EXCEEDED' ? 'too_many' : 'failed' });
      }
    } catch (err) {
      // 🔴 Only the error is logged. Never the address.
      logError('The account search did not complete', err);
      setSearch({ kind: 'failed' });
    }
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = wholeAddress(email);
    if (address === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void find(address);
  };

  const openDialog = (account: AccountMatch) => {
    setReason('');
    setDialogError(null);
    setTarget(account);
  };

  const closeDialog = () => {
    if (signingOut) return;
    setTarget(null);
    setReason('');
    setDialogError(null);
  };

  const cleanReason = reason.trim();
  const reasonOk = cleanReason.length >= REASON_MIN && cleanReason.length <= REASON_MAX;

  const signOut = async () => {
    if (!target || !reasonOk || signingOut) return;
    const account = target;
    setSigningOut(true);
    setDialogError(null);
    try {
      // May pause here while the person enters their sign-in code (see the top of this file).
      const res = await api.post<{ signed_out: boolean }>(`/v2/platform-team/accounts/${account.id}/sign-out`, {
        reason: cleanReason,
      });
      if (res.success && res.data?.signed_out === true) {
        setDone((prev) => new Set(prev).add(account.id));
        setFocusDoneId(account.id);
        setTarget(null);
        setReason('');
        toast.success(
          account.name ? t('accounts.done_toast', { name: account.name }) : t('accounts.done_toast_unnamed'),
        );
      } else if (res.code === AUTH_STEP_UP_REQUIRED) {
        setDialogError('step_cancelled');
      } else if (res.code === 'NOT_FOUND') {
        setDialogError('gone');
      } else {
        setDialogError('failed');
      }
    } catch (err) {
      logError('Signing an account out everywhere did not complete', err);
      setDialogError('failed');
    } finally {
      setSigningOut(false);
    }
  };

  const day = (iso: string | null): string => {
    if (!iso) return t('senior_accounts.never');
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('senior_accounts.never')
      : date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /**
   * The role in words, or null when the level chip already says it (a super
   * admin's role string adds nothing, and the old top role's name is never shown).
   */
  const roleLabel = (account: AccountMatch): string | null => {
    if ((KNOWN_ROLES as readonly string[]).includes(account.role)) {
      return t(`accounts.role.${account.role as KnownRole}`);
    }
    return account.level !== null ? null : t('accounts.role.other');
  };

  const statusLabel = (status: string): string => {
    if (status === 'deleted') return t('accounts.status_deleted');
    return (KNOWN_STATUSES as readonly string[]).includes(status)
      ? t(`senior_accounts.status.${status as KnownStatus}`)
      : t('senior_accounts.status.other');
  };

  const isOwnAccount = target !== null && user?.id === target.id;

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">{t('accounts.title')}</h1>
        <p className="mt-2 max-w-2xl text-base text-muted">{t('accounts.intro')}</p>
        <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('accounts.recorded_note')}
        </p>
      </div>

      <Card>
        <CardBody className="p-4">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <Input
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                label={t('accounts.email_label')}
                description={t('accounts.email_hint')}
                value={email}
                onValueChange={(value) => {
                  setEmail(value);
                  if (invalid) setInvalid(false);
                }}
                isInvalid={invalid}
                errorMessage={invalid ? t('accounts.email_invalid') : undefined}
                maxLength={255}
              />
            </div>
            <Button type="submit" variant="primary" isDisabled={search.kind === 'searching'} className="sm:mt-6">
              <Search size={16} aria-hidden="true" />
              {t('accounts.find')}
            </Button>
          </form>
        </CardBody>
      </Card>

      <div className="mt-6" aria-live="polite">
        {search.kind === 'searching' ? (
          <div role="status" aria-busy="true" aria-label={t('accounts.searching')} className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : search.kind === 'failed' ? (
          <LoadError
            title={t('accounts.search_error_title')}
            onRetry={searched !== null ? () => void find(searched) : undefined}
          />
        ) : search.kind === 'too_many' ? (
          <p className="text-sm text-warning-soft-foreground" role="alert">
            {t('accounts.too_many')}
          </p>
        ) : search.kind === 'done' && search.reply.matches.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 p-10 text-center">
              <SearchX size={32} className="text-muted" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">{t('accounts.none')}</h2>
              <p className="text-sm text-muted">{t('accounts.none_note')}</p>
            </CardBody>
          </Card>
        ) : search.kind === 'done' ? (
          <>
            <h2 className="mb-3 text-lg font-semibold text-foreground">
              {t('accounts.found', { count: search.reply.matches.length })}
            </h2>
            {search.reply.truncated ? (
              <p className="mb-3 text-sm text-warning-soft-foreground" role="status">
                {t('accounts.truncated', { count: search.reply.matches.length })}
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {search.reply.matches.map((account) => {
                const wasSignedOut = done.has(account.id);

                return (
                  <li key={account.id} data-testid={`account-${account.id}`}>
                    <Card>
                      <CardBody className="flex flex-col gap-3 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="break-words text-base font-semibold text-foreground">
                              {account.name ?? t('senior_accounts.unnamed')}
                            </h3>
                            <dl className="mt-2 flex flex-col gap-1 text-sm text-muted sm:flex-row sm:flex-wrap sm:gap-x-4">
                              <div className="flex gap-1">
                                <dt className="shrink-0">{t('senior_accounts.community')}</dt>
                                <dd className="break-words font-medium text-foreground">
                                  {account.community === null
                                    ? t('senior_accounts.no_community')
                                    : (account.community.name ??
                                      t('senior_accounts.unnamed_community', { id: account.community.id }))}
                                </dd>
                              </div>
                              {roleLabel(account) !== null ? (
                                <div className="flex gap-1">
                                  <dt className="shrink-0">{t('accounts.role_label')}</dt>
                                  <dd className="font-medium text-foreground">{roleLabel(account)}</dd>
                                </div>
                              ) : null}
                              <div className="flex gap-1">
                                <dt className="shrink-0">{t('senior_accounts.last_sign_in')}</dt>
                                <dd className="font-medium text-foreground">{day(account.last_sign_in_at)}</dd>
                              </div>
                              <div className="flex gap-1">
                                <dt className="shrink-0">{t('accounts.open_sign_ins')}</dt>
                                <dd className="font-medium text-foreground" data-testid={`open-sign-ins-${account.id}`}>
                                  {(wasSignedOut ? 0 : account.signed_in_now).toLocaleString(getFormattingLocale())}
                                </dd>
                              </div>
                            </dl>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-xs sm:justify-end">
                            {account.level !== null && (LEVELS as readonly string[]).includes(account.level) ? (
                              <Chip size="sm" variant="soft" color="warning">
                                {t(`accounts.level.${account.level}`)}
                              </Chip>
                            ) : null}
                            <Chip size="sm" variant="soft" color={account.two_step_on ? 'success' : 'default'}>
                              {account.two_step_on
                                ? t('senior_accounts.two_step_on')
                                : t('senior_accounts.two_step_off')}
                            </Chip>
                            {account.has_passkey ? (
                              <Chip size="sm" variant="soft" color="default">
                                {t('senior_accounts.passkey')}
                              </Chip>
                            ) : null}
                            {account.status !== 'active' ? (
                              <Chip size="sm" variant="soft" color="warning">
                                {statusLabel(account.status)}
                              </Chip>
                            ) : null}
                          </div>
                        </div>

                        {wasSignedOut ? (
                          <p
                            ref={focusDoneId === account.id ? doneLineRef : undefined}
                            tabIndex={-1}
                            className="flex items-start gap-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            role="status"
                          >
                            <CircleCheck size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                            {t('accounts.done')}
                          </p>
                        ) : account.community === null ? (
                          <p className="text-sm text-muted">{t('accounts.no_community_note')}</p>
                        ) : (
                          <div>
                            <Button size="sm" variant="danger" onPress={() => openDialog(account)}>
                              <LogOut size={14} aria-hidden="true" />
                              {t('accounts.sign_out')}
                            </Button>
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </div>

      <AlertDialog.Backdrop
        isOpen={target !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[480px]">
            <AlertDialog.CloseTrigger aria-label={t('accounts.confirm.close')} isDisabled={signingOut} />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>
                {target?.name
                  ? t('accounts.confirm.title', { name: target.name })
                  : t('accounts.confirm.title_unnamed')}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-4">
              <p>{t('accounts.confirm.text')}</p>
              {isOwnAccount ? (
                <p className="font-medium text-warning-soft-foreground" role="status">
                  {t('accounts.confirm.own_account')}
                </p>
              ) : null}
              <Input
                label={t('accounts.confirm.reason_label')}
                description={t('accounts.confirm.reason_hint', { min: REASON_MIN, max: REASON_MAX })}
                value={reason}
                onValueChange={(value) => {
                  setReason(value);
                  if (dialogError) setDialogError(null);
                }}
                autoComplete="off"
                maxLength={REASON_MAX}
                isRequired
                isDisabled={signingOut}
              />
              <p className="text-sm text-muted">{t('accounts.confirm.step_note')}</p>
              {dialogError ? (
                <p className="text-sm font-medium text-danger" role="alert">
                  {t(`accounts.confirm.${dialogError}`)}
                </p>
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" isDisabled={signingOut} onPress={closeDialog}>
                {t('accounts.confirm.cancel')}
              </Button>
              <Button
                variant="danger"
                isLoading={signingOut}
                isDisabled={!reasonOk || signingOut}
                onPress={() => void signOut()}
              >
                {t('accounts.sign_out')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </section>
  );
}

export default FindAccountPage;
