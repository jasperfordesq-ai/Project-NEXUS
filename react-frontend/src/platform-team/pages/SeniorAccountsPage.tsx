// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Senior accounts.
 *
 * Every account that can administer more than one community (the platform
 * team, global super admins, tenant super admins), with when each last signed
 * in and whether two-step sign-in is on.
 *
 * Since 17 Nov 2026 (owner) this is also where someone is added to the
 * platform team or removed from it. It is the only place: until then the
 * platform team mark was set in the database by hand, and nothing recorded it.
 *
 *   - On a global super admin: "Add to the platform team".
 *   - On a platform team member: "Remove from the platform team". Never on
 *     your own row, so somebody is always left who can add people.
 *   - On a half-set account (the mark without super admin): finish it, or
 *     take the mark off.
 *   - "Add someone" finds any other account by its whole email address and
 *     does both steps (global super admin, then platform team) in one go.
 *
 * 🔴 Every change asks first, and the server asks for a recent sign-in code.
 * The API client handles the code by itself (lib/api.ts): it opens the prompt,
 * sends the same request again, and only then does `api.post()` finish. When
 * the person closes the prompt, the refusal comes back as
 * AUTH_STEP_UP_REQUIRED and nothing was changed; the box stays open.
 *
 * 🔴 The buttons are a convenience. The server decides: platform team only, a
 * recent code, the account active with two-step on, never yourself
 * (PlatformTeamMembershipService). Each change is written to the super admin
 * audit log and shown on the Security page.
 *
 * 🔴 The address searched for goes in the BODY of the request, never in its
 * address, exactly as on the Find an account page.
 *
 * A reply that cannot be loaded shows the error card, never an empty list:
 * "nobody holds senior access" would be a comforting lie.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertDialog, Button, Card, CardBody, Chip, Input, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { useAuth, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api, AUTH_STEP_UP_REQUIRED } from '@/lib/api';
import { logError } from '@/lib/logger';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserMinus from 'lucide-react/icons/user-minus';
import UserPlus from 'lucide-react/icons/user-plus';
import X from 'lucide-react/icons/x';
import { getFormattingLocale } from '@/lib/helpers';

export const SENIOR_LEVELS = ['platform_team', 'global_super_admin', 'tenant_super_admin', 'platform_flag_only'] as const;
export type SeniorLevel = (typeof SENIOR_LEVELS)[number];

/** Account states the server can send besides `active`. Anything else is shown as "Not active". */
const KNOWN_STATUSES = ['inactive', 'suspended', 'banned', 'pending', 'rejected'] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];

/**
 * The wording key for an account that is not active (also used by the access
 * review). An unknown state is "Not active", never left blank.
 */
export function accountStatusKey(status: string): `senior_accounts.status.${KnownStatus | 'other'}` {
  return (KNOWN_STATUSES as readonly string[]).includes(status)
    ? `senior_accounts.status.${status as KnownStatus}`
    : 'senior_accounts.status.other';
}

export interface SeniorAccount {
  id: number;
  name: string | null;
  email: string;
  level: SeniorLevel;
  incomplete_platform_team: boolean;
  community: { id: number; name: string | null } | null;
  status: string;
  last_sign_in_at: string | null;
  two_step_on: boolean;
  has_passkey: boolean;
}

export interface SeniorAccountsList {
  total: number;
  truncated: boolean;
  counts: Record<SeniorLevel, number>;
  accounts: SeniorAccount[];
}

/** One account as the Find an account request sends it (only what is used here). */
interface FoundAccount {
  id: number;
  name: string | null;
  community: { id: number; name: string | null } | null;
  status: string;
  level: string | null;
  two_step_on: boolean;
}

type FinderState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'failed' }
  | { kind: 'too_many' }
  | { kind: 'done'; matches: FoundAccount[] };

/** What the confirmation box is about to do. */
type ChangeKind = 'add' | 'remove' | 'remove_mark';

interface PendingChange {
  kind: ChangeKind;
  id: number;
  /** The account's name, or its email address when no name is recorded. */
  label: string;
  /** Adding it also makes it a global super admin. */
  becomesGlobal: boolean;
}

type ConfirmError = 'step_cancelled' | 'two_step' | 'not_active' | 'already' | 'not_member' | 'gone' | 'too_many' | 'failed';

/** The server's refusal, as the wording that explains it. Anything unknown is "that didn't work". */
function confirmErrorFor(code: string | undefined): ConfirmError {
  switch (code) {
    case AUTH_STEP_UP_REQUIRED:
      return 'step_cancelled';
    case 'PLATFORM_TEAM_TWO_STEP_REQUIRED':
      return 'two_step';
    case 'PLATFORM_TEAM_ACCOUNT_NOT_ACTIVE':
      return 'not_active';
    case 'PLATFORM_TEAM_ALREADY_MEMBER':
      return 'already';
    case 'PLATFORM_TEAM_NOT_A_MEMBER':
      return 'not_member';
    case 'NOT_FOUND':
      return 'gone';
    case 'RATE_LIMIT_EXCEEDED':
      return 'too_many';
    default:
      return 'failed';
  }
}

/** One whole address: something@something, no spaces. Whether an account uses it is the server's answer. */
function wholeAddress(value: string): string | null {
  const email = value.trim();
  if (email === '' || email.length > 255 || /\s/.test(email)) return null;
  const parts = email.split('@');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? email : null;
}

export function SeniorAccountsPage() {
  const { t } = useTranslation('platform_team');
  const { user } = useAuth();
  const toast = useToast();
  usePageTitle(t('senior_accounts.title'));

  const [list, setList] = useState<SeniorAccountsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmError, setConfirmError] = useState<ConfirmError | null>(null);

  const [finderOpen, setFinderOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailInvalid, setEmailInvalid] = useState(false);
  /** The address last searched for: the label of a found account that has no name. */
  const [searched, setSearched] = useState('');
  const [finder, setFinder] = useState<FinderState>({ kind: 'idle' });

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<SeniorAccountsList>('/v2/platform-team/senior-accounts');
      if (res.success && res.data && Array.isArray(res.data.accounts)) {
        setList(res.data);
      } else {
        setList(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the senior accounts list', err);
      setList(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeFinder = () => {
    setFinderOpen(false);
    setEmail('');
    setEmailInvalid(false);
    setSearched('');
    setFinder({ kind: 'idle' });
  };

  const find = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = wholeAddress(email);
    if (address === null) {
      setEmailInvalid(true);
      return;
    }
    setEmailInvalid(false);
    setSearched(address);
    setFinder({ kind: 'searching' });
    try {
      const res = await api.post<{ matches: FoundAccount[] }>('/v2/platform-team/accounts/find', { email: address });
      if (res.success && res.data && Array.isArray(res.data.matches)) {
        setFinder({ kind: 'done', matches: res.data.matches });
      } else {
        setFinder({ kind: res.code === 'RATE_LIMIT_EXCEEDED' ? 'too_many' : 'failed' });
      }
    } catch (err) {
      // 🔴 Only the error is logged. Never the address.
      logError('The account search did not complete', err);
      setFinder({ kind: 'failed' });
    }
  };

  const ask = (change: PendingChange) => {
    setConfirmError(null);
    setPending(change);
  };

  const closeConfirm = () => {
    if (saving) return;
    setPending(null);
    setConfirmError(null);
  };

  const confirm = async () => {
    if (!pending || saving) return;
    const change = pending;
    setSaving(true);
    setConfirmError(null);
    try {
      // May pause here while the person enters their sign-in code (see the top of this file).
      const res = await api.post<{ added?: boolean; removed?: boolean }>(
        `/v2/platform-team/senior-accounts/${change.id}/${change.kind === 'add' ? 'add-to-team' : 'remove-from-team'}`,
      );
      const done = change.kind === 'add' ? res.data?.added === true : res.data?.removed === true;
      if (res.success && done) {
        setPending(null);
        closeFinder();
        toast.success(
          change.kind === 'add'
            ? t('senior_accounts.added_toast', { name: change.label })
            : change.kind === 'remove'
              ? t('senior_accounts.removed_toast', { name: change.label })
              : t('senior_accounts.mark_removed_toast', { name: change.label }),
        );
        void load();
      } else {
        setConfirmError(confirmErrorFor(res.code));
      }
    } catch (err) {
      logError('A platform team change did not complete', err);
      setConfirmError('failed');
    } finally {
      setSaving(false);
    }
  };

  const day = (iso: string | null): string => {
    if (!iso) return t('senior_accounts.never');
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t('senior_accounts.never')
      : date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const statusLabel = (status: string): string => t(accountStatusKey(status));

  const withoutTwoStep = list ? list.accounts.filter((a) => !a.two_step_on).length : 0;

  /** Why an account cannot be added, in words, or null when it can. The server checks again. */
  const cannotAdd = (account: { status: string; two_step_on: boolean }): string | null => {
    if (account.status !== 'active') return t('senior_accounts.not_active_note');
    if (!account.two_step_on) return t('senior_accounts.needs_two_step');
    return null;
  };

  const addButton = (id: number, label: string, becomesGlobal: boolean) => (
    <Button size="sm" variant="primary" onPress={() => ask({ kind: 'add', id, label, becomesGlobal })}>
      <UserPlus size={14} aria-hidden="true" />
      {t('senior_accounts.add')}
    </Button>
  );

  /** The line under an account's details: its button or buttons, or why there is none. */
  const actionsFor = (account: SeniorAccount) => {
    const label = account.name ?? account.email;

    if (account.level === 'platform_team') {
      return user?.id === account.id ? (
        <p className="text-sm text-muted">{t('senior_accounts.is_you')}</p>
      ) : (
        <Button
          size="sm"
          variant="danger"
          onPress={() => ask({ kind: 'remove', id: account.id, label, becomesGlobal: false })}
        >
          <UserMinus size={14} aria-hidden="true" />
          {t('senior_accounts.remove')}
        </Button>
      );
    }

    if (account.level === 'tenant_super_admin') return null;

    const halfSet = account.level === 'platform_flag_only';
    const blocked = cannotAdd(account);

    return (
      <>
        {blocked === null ? addButton(account.id, label, halfSet) : <p className="text-sm text-muted">{blocked}</p>}
        {halfSet ? (
          <Button
            size="sm"
            variant="danger"
            onPress={() => ask({ kind: 'remove_mark', id: account.id, label, becomesGlobal: false })}
          >
            <UserMinus size={14} aria-hidden="true" />
            {t('senior_accounts.remove_mark')}
          </Button>
        ) : null}
      </>
    );
  };

  const confirmTitle = (change: PendingChange): string =>
    change.kind === 'add'
      ? t('senior_accounts.confirm.add_title', { name: change.label })
      : change.kind === 'remove'
        ? t('senior_accounts.confirm.remove_title', { name: change.label })
        : t('senior_accounts.confirm.remove_mark_title', { name: change.label });

  const confirmText = (kind: ChangeKind): string =>
    kind === 'add'
      ? t('senior_accounts.confirm.add_text')
      : kind === 'remove'
        ? t('senior_accounts.confirm.remove_text')
        : t('senior_accounts.confirm.remove_mark_text');

  const confirmLabel = (kind: ChangeKind): string =>
    kind === 'add'
      ? t('senior_accounts.add')
      : kind === 'remove'
        ? t('senior_accounts.remove')
        : t('senior_accounts.remove_mark');

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('senior_accounts.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('senior_accounts.intro')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('senior_accounts.changes_note')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {list && !finderOpen ? (
            <Button variant="primary" onPress={() => setFinderOpen(true)}>
              <UserPlus size={16} aria-hidden="true" />
              {t('senior_accounts.add_someone')}
            </Button>
          ) : null}
          <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />
            {t('home.refresh')}
          </Button>
        </div>
      </div>

      {loading && !list ? (
        <div role="status" aria-busy="true" aria-label={t('senior_accounts.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !list ? (
        <LoadError title={t('senior_accounts.load_error_title')} onRetry={() => void load()} />
      ) : (
        <div className="flex flex-col gap-6">
          {finderOpen ? (
            <section aria-labelledby="add-someone-heading" data-testid="add-someone">
              <Card>
                <CardBody className="flex flex-col gap-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 id="add-someone-heading" className="text-lg font-semibold text-foreground">
                        {t('senior_accounts.find.title')}
                      </h2>
                      <p className="mt-1 max-w-2xl text-sm text-muted">{t('senior_accounts.find.intro')}</p>
                    </div>
                    <Button size="sm" variant="tertiary" onPress={closeFinder}>
                      <X size={14} aria-hidden="true" />
                      {t('accounts.confirm.close')}
                    </Button>
                  </div>

                  <form onSubmit={(event) => void find(event)} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
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
                          if (emailInvalid) setEmailInvalid(false);
                        }}
                        isInvalid={emailInvalid}
                        errorMessage={emailInvalid ? t('accounts.email_invalid') : undefined}
                        maxLength={255}
                      />
                    </div>
                    <Button type="submit" variant="primary" isDisabled={finder.kind === 'searching'} className="sm:mt-6">
                      <Search size={16} aria-hidden="true" />
                      {t('accounts.find')}
                    </Button>
                  </form>

                  <div aria-live="polite">
                    {finder.kind === 'searching' ? (
                      <div role="status" aria-busy="true" aria-label={t('accounts.searching')} className="flex justify-center py-6">
                        <Spinner />
                      </div>
                    ) : finder.kind === 'failed' ? (
                      <p className="text-sm font-medium text-danger" role="alert">
                        {t('accounts.search_error_title')}
                      </p>
                    ) : finder.kind === 'too_many' ? (
                      <p className="text-sm text-warning-soft-foreground" role="alert">
                        {t('accounts.too_many')}
                      </p>
                    ) : finder.kind === 'done' && finder.matches.length === 0 ? (
                      <p className="text-sm text-muted">{t('accounts.none')}</p>
                    ) : finder.kind === 'done' ? (
                      <ul className="flex flex-col gap-2">
                        {finder.matches.map((found) => {
                          const onTeam = found.level === 'platform_team';
                          const blocked = onTeam ? t('senior_accounts.find.on_team') : cannotAdd(found);
                          const becomesGlobal = found.level !== 'global_super_admin';

                          return (
                            <li
                              key={found.id}
                              data-testid={`found-account-${found.id}`}
                              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0">
                                <p className="break-words text-base font-semibold text-foreground">
                                  {found.name ?? t('senior_accounts.unnamed')}
                                </p>
                                <p className="break-words text-sm text-muted">
                                  {found.community === null
                                    ? t('senior_accounts.no_community')
                                    : (found.community.name ??
                                      t('senior_accounts.unnamed_community', { id: found.community.id }))}
                                </p>
                              </div>
                              {blocked === null ? (
                                <div className="shrink-0">{addButton(found.id, found.name ?? searched, becomesGlobal)}</div>
                              ) : (
                                <p className="text-sm text-muted sm:max-w-xs sm:text-right">{blocked}</p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            </section>
          ) : null}

          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4" data-testid="two-step-summary">
              {withoutTwoStep > 0 ? (
                <ShieldAlert size={22} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              ) : (
                <ShieldCheck size={22} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              )}
              <p className="text-sm text-foreground">
                {withoutTwoStep > 0
                  ? t('senior_accounts.without_two_step', { count: withoutTwoStep, total: new Intl.NumberFormat(getFormattingLocale()).format(list.total) })
                  : t('senior_accounts.all_have_two_step', { total: new Intl.NumberFormat(getFormattingLocale()).format(list.total) })}
              </p>
            </CardBody>
          </Card>

          {list.truncated ? (
            <p className="text-sm text-warning-soft-foreground" role="status">
              {t('senior_accounts.truncated', { count: list.accounts.length })}
            </p>
          ) : null}

          {SENIOR_LEVELS.map((level) => {
            const accounts = list.accounts.filter((a) => a.level === level);
            // The half-set flag is an oddity: say nothing about it unless it exists.
            if (level === 'platform_flag_only' && accounts.length === 0) return null;
            const headingId = `senior-level-${level}`;

            return (
              <section key={level} aria-labelledby={headingId} data-testid={`senior-level-${level}`}>
                <h2 id={headingId} className="text-lg font-semibold text-foreground">
                  {t(`senior_accounts.level.${level}`)}{' '}
                  <span className="font-normal text-muted">({accounts.length})</span>
                </h2>
                <p className="mb-3 mt-1 max-w-2xl text-sm text-muted">{t(`senior_accounts.level_note.${level}`)}</p>

                {accounts.length === 0 ? (
                  <p className="text-sm text-muted">{t('senior_accounts.none_at_level')}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {accounts.map((account) => {
                      const actions = actionsFor(account);

                      return (
                        <li key={account.id} data-testid={`senior-account-${account.id}`}>
                          <Card>
                            <CardBody className="flex flex-col gap-3 p-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <h3 className="break-words text-base font-semibold text-foreground">
                                    {account.name ?? t('senior_accounts.unnamed')}
                                  </h3>
                                  <p className="break-all text-sm text-muted">{account.email}</p>
                                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                                    <div className="flex min-w-0 gap-1">
                                      <dt className="shrink-0">{t('senior_accounts.community')}</dt>
                                      <dd className="min-w-0 break-words font-medium text-foreground">
                                        {account.community === null
                                          ? t('senior_accounts.no_community')
                                          : (account.community.name ??
                                            t('senior_accounts.unnamed_community', { id: account.community.id }))}
                                      </dd>
                                    </div>
                                    <div className="flex gap-1">
                                      <dt>{t('senior_accounts.last_sign_in')}</dt>
                                      <dd className="font-medium text-foreground">{day(account.last_sign_in_at)}</dd>
                                    </div>
                                  </dl>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-xs sm:justify-end">
                                  <Chip size="sm" variant="soft" color={account.two_step_on ? 'success' : 'danger'}>
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
                                  {account.incomplete_platform_team && level !== 'platform_flag_only' ? (
                                    <Chip size="sm" variant="soft" color="warning">
                                      {t('senior_accounts.incomplete')}
                                    </Chip>
                                  ) : null}
                                </div>
                              </div>
                              {actions !== null ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                            </CardBody>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <AlertDialog.Backdrop
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[480px]">
            <AlertDialog.CloseTrigger aria-label={t('accounts.confirm.close')} isDisabled={saving} />
            <AlertDialog.Header>
              <AlertDialog.Icon status={pending?.kind === 'add' ? 'warning' : 'danger'} />
              <AlertDialog.Heading>{pending ? confirmTitle(pending) : null}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-4">
              <p>{pending ? confirmText(pending.kind) : null}</p>
              {pending?.kind === 'add' && pending.becomesGlobal ? (
                <p>{t('senior_accounts.confirm.add_also_global')}</p>
              ) : null}
              <p className="text-sm text-muted">{t('senior_accounts.confirm.recorded')}</p>
              <p className="text-sm text-muted">{t('accounts.confirm.step_note')}</p>
              {confirmError ? (
                <p className="text-sm font-medium text-danger" role="alert">
                  {t(`senior_accounts.confirm.error.${confirmError}`)}
                </p>
              ) : null}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" isDisabled={saving} onPress={closeConfirm}>
                {t('senior_accounts.confirm.cancel')}
              </Button>
              <Button
                variant={pending?.kind === 'add' ? 'primary' : 'danger'}
                isLoading={saving}
                isDisabled={saving}
                onPress={() => void confirm()}
              >
                {pending ? confirmLabel(pending.kind) : null}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </section>
  );
}

export default SeniorAccountsPage;
