// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ComboBox } from '@/components/ui/ComboBox';
import { Label } from '@/components/ui/Label';
import { ListBoxItem as ComboBoxItem } from '@/components/ui/ListBox';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { NumberField } from '@/components/ui/NumberField';
import { Separator } from '@/components/ui/Separator';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Coins from 'lucide-react/icons/coins';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import Send from 'lucide-react/icons/send';
import ArrowDownCircle from 'lucide-react/icons/arrow-down-circle';
import ArrowUpCircle from 'lucide-react/icons/arrow-up-circle';
import { PageMeta } from '@/components/seo';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
/**
 * RegionalPointsPage — AG28 member-facing UI for the third currency.
 *
 * Shows balance, transaction history and a member-to-member transfer form.
 * Backed by /api/v2/caring-community/regional-points/{summary, history, transfer}.
 *
 * F-225: the recipient is chosen by name from the member directory search
 * (/v2/users?q=, the same public-identity lookup HourGiftPage uses) and the
 * sender confirms the recipient's name before anything is sent — never a
 * bare member id.
 *
 * Disabled tenants see a friendly "not enabled here" message — backend
 * returns FEATURE_DISABLED in that case.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SummaryConfig {
  enabled: boolean;
  label: string;
  label_code?: 'default' | null;
  symbol: string;
  member_transfers_enabled: boolean;
  marketplace_redemption_enabled: boolean;
  points_per_approved_hour: number;
}

interface SummaryResponse {
  enabled: boolean;
  config: SummaryConfig;
  account: {
    user_id: number;
    balance: number;
    lifetime_earned: number;
    lifetime_spent: number;
  };
}

interface PointTransaction {
  id: number;
  user_id: number;
  actor_user_id: number | null;
  type: string;
  direction: 'in' | 'out' | string;
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

interface HistoryResponse {
  items: PointTransaction[];
}

interface MemberSearchResult {
  id: number;
  name: string;
  profile_photo?: string | null;
  avatar_url?: string | null;
}

const RECIPIENT_SEARCH_MIN_CHARS = 2;
const RECIPIENT_SEARCH_LIMIT = 8;
const RECIPIENT_SEARCH_DEBOUNCE_MS = 250;

const activityDateFormatter = () => new Intl.DateTimeFormat(getFormattingLocale(), {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatActivityDate(value: string): string {
  return activityDateFormatter().format(new Date(value));
}

/**
 * Transaction type codes emitted by CaringRegionalPointService.
 * Each has a matching `regional_points.history.types.*` translation key.
 */
const KNOWN_TRANSACTION_TYPES = new Set([
  'earned_for_hours',
  'transfer_in',
  'transfer_out',
  'admin_issue',
  'admin_adjustment',
  'redemption',
  'reversal',
]);

/** Graceful fallback for unknown type codes: "some_new_type" → "Some new type". */
function humanizeTypeCode(code: string): string {
  const text = code.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RegionalPointsPage() {
  const { t } = useTranslation('common');
  const toast = useToast();
  usePageTitle(t('regional_points.title'));

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [history, setHistory] = useState<PointTransaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // Transfer form
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientResults, setRecipientResults] = useState<MemberSearchResult[]>([]);
  const [recipient, setRecipient] = useState<MemberSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [points, setPoints] = useState('');
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const ownUserId = summary?.account.user_id;

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [sumRes, histRes] = await Promise.all([
        api.get<SummaryResponse>('/v2/caring-community/regional-points/summary'),
        api.get<HistoryResponse>('/v2/caring-community/regional-points/history?limit=50'),
      ]);
      if (sumRes.success && sumRes.data) {
        setSummary(sumRes.data);
        setUnavailable(false);
      } else if (sumRes.error) {
        // Feature disabled or not configured.
        setUnavailable(true);
      }
      if (histRes.success && histRes.data) {
        setHistory(histRes.data.items || []);
      }
    } catch (err) {
      logError('RegionalPointsPage: load failed', err);
      toast.error(t('regional_points.errors.load_failed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced recipient search against the member directory (public identity,
  // tenant-scoped on the server).
  useEffect(() => {
    if (recipient !== null) return;
    const q = recipientQuery.trim();
    if (q.length < RECIPIENT_SEARCH_MIN_CHARS) {
      setRecipientResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<{ items?: MemberSearchResult[] } | MemberSearchResult[]>(
          `/v2/users?q=${encodeURIComponent(q)}&limit=${RECIPIENT_SEARCH_LIMIT}`,
        );
        const items: MemberSearchResult[] = Array.isArray(res.data)
          ? res.data
          : (res.data as { items?: MemberSearchResult[] } | undefined)?.items ?? [];
        setRecipientResults(
          items.filter((m) => m.id !== ownUserId).slice(0, RECIPIENT_SEARCH_LIMIT),
        );
      } catch (err) {
        logError('RegionalPointsPage: recipient search failed', err);
      } finally {
        setSearching(false);
      }
    }, RECIPIENT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [recipientQuery, recipient, ownUserId]);

  // First step: validate, then show the recipient's name for confirmation.
  const handleReview = useCallback(() => {
    const amount = parseFloat(points);
    if (!recipient) {
      toast.error(t('regional_points.transfer.errors.choose_recipient'));
      return;
    }
    if (!amount || amount <= 0) {
      toast.error(t('regional_points.transfer.errors.invalid_amount'));
      return;
    }
    setConfirmOpen(true);
  }, [recipient, points, toast, t]);

  const handleTransfer = useCallback(async () => {
    const amount = parseFloat(points);
    if (!recipient || !amount || amount <= 0) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/v2/caring-community/regional-points/transfer', {
        recipient_user_id: recipient.id,
        points: amount,
        message: message.trim() || null,
      });
      if (res.success) {
        toast.success(t('regional_points.transfer.success'));
        setConfirmOpen(false);
        setRecipient(null);
        setRecipientQuery('');
        setPoints('');
        setMessage('');
        await load();
      } else {
        setConfirmOpen(false);
        toast.error(res.error || t('regional_points.errors.transfer_failed'));
      }
    } catch (err) {
      logError('RegionalPointsPage: transfer failed', err);
      setConfirmOpen(false);
      toast.error(t('regional_points.errors.transfer_failed'));
    } finally {
      setSubmitting(false);
    }
  }, [recipient, points, message, toast, t, load]);

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (unavailable || !summary) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <PageMeta
          title={t('regional_points.title')}
          description={t('regional_points.subtitle')}
        />
        <EmptyState
          title={t('regional_points.unavailable.title')}
          description={t('regional_points.unavailable.description')}
        />
      </div>
    );
  }

  const cfg = summary.config;
  const account = summary.account;
  const symbol = cfg.symbol || t('regional_points.default_symbol');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <PageMeta
        title={t('regional_points.title')}
        description={t('regional_points.subtitle')}
      />

      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface/80 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2 text-foreground">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
              <Coins className="w-6 h-6" aria-hidden="true" />
            </span>
            {cfg.label || t('regional_points.title')}
          </h1>
          <p className="text-sm text-muted mt-2 max-w-2xl">
            {t('regional_points.subtitle')}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="w-full sm:w-auto"
          startContent={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
          onPress={() => void load()}
          isDisabled={refreshing}
        >
          {t('refresh')}
        </Button>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border border-border bg-surface/80 shadow-sm">
          <CardBody>
            <p className="text-xs uppercase text-muted tracking-wide">
              {t('regional_points.balance')}
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {account.balance.toFixed(2)} <span className="text-base text-muted">{symbol}</span>
            </p>
          </CardBody>
        </Card>
        <Card className="border border-border bg-surface/80 shadow-sm">
          <CardBody>
            <p className="text-xs uppercase text-muted tracking-wide">
              {t('regional_points.lifetime_earned')}
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {account.lifetime_earned.toFixed(2)} <span className="text-base text-muted">{symbol}</span>
            </p>
          </CardBody>
        </Card>
        <Card className="border border-border bg-surface/80 shadow-sm">
          <CardBody>
            <p className="text-xs uppercase text-muted tracking-wide">
              {t('regional_points.lifetime_spent')}
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1">
              {account.lifetime_spent.toFixed(2)} <span className="text-base text-muted">{symbol}</span>
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Transfer */}
      {cfg.member_transfers_enabled && (
        <Card className="border border-border bg-surface/80 shadow-sm">
          <CardHeader className="flex items-center gap-2">
            <Send className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold">
              {t('regional_points.transfer.title')}
            </h2>
          </CardHeader>
          <Separator />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="mb-1.5 text-sm font-medium text-foreground">
                  {t('regional_points.transfer.recipient_label')}
                </p>
                {recipient ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-secondary px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar
                        src={recipient.profile_photo ?? recipient.avatar_url ?? undefined}
                        name={recipient.name}
                        size="sm"
                      />
                      <span className="truncate font-medium text-foreground" data-testid="regional-points-recipient">
                        {recipient.name}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="light"
                      onPress={() => {
                        setRecipient(null);
                        setRecipientQuery('');
                      }}
                    >
                      {t('regional_points.transfer.change_recipient')}
                    </Button>
                  </div>
                ) : (
                  <ComboBox
                    aria-label={t('regional_points.transfer.recipient_label')}
                    placeholder={t('regional_points.transfer.recipient_search_placeholder')}
                    items={recipientResults}
                    inputValue={recipientQuery}
                    onInputChange={setRecipientQuery}
                    menuTrigger="input"
                    allowsEmptyCollection
                    startContent={<Search className="h-4 w-4 text-muted" aria-hidden="true" />}
                    onSelectionChange={(key) => {
                      if (key == null) return;
                      const member = recipientResults.find((m) => String(m.id) === String(key));
                      if (member) {
                        setRecipient(member);
                        setRecipientResults([]);
                        setRecipientQuery('');
                      }
                    }}
                    renderEmptyState={() =>
                      searching ? (
                        <div role="status" aria-busy="true" className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                          <Spinner size="sm" /> {t('loading')}
                        </div>
                      ) : recipientQuery.trim().length < RECIPIENT_SEARCH_MIN_CHARS ? (
                        <div className="px-3 py-2 text-sm text-muted">{t('regional_points.transfer.recipient_hint')}</div>
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted">{t('regional_points.transfer.recipient_no_results')}</div>
                      )
                    }
                  >
                    {(member: MemberSearchResult) => (
                      <ComboBoxItem id={member.id} textValue={member.name}>
                        <div className="flex items-center gap-2">
                          <Avatar
                            src={member.profile_photo ?? member.avatar_url ?? undefined}
                            name={member.name}
                            size="sm"
                          />
                          <span className="min-w-0 truncate text-sm">{member.name}</span>
                        </div>
                      </ComboBoxItem>
                    )}
                  </ComboBox>
                )}
              </div>
              <NumberField
                minValue={0}
                step={0.01}
                value={points === '' ? undefined : parseFloat(points)}
                onChange={(value) =>
                  setPoints(value === undefined || Number.isNaN(value) ? '' : String(value))
                }
                fullWidth
              >
                <Label>{t('regional_points.transfer.amount')}</Label>
                <NumberField.Group>
                  <NumberField.DecrementButton />
                  <NumberField.Input placeholder={t('regional_points.transfer.amount_placeholder')} />
                  <span className="px-2 text-xs text-muted">{symbol}</span>
                  <NumberField.IncrementButton />
                </NumberField.Group>
              </NumberField>
            </div>
            <Textarea
              label={t('regional_points.transfer.message')}
              placeholder={t('regional_points.transfer.message_placeholder')}
              value={message}
              onValueChange={setMessage}
              minRows={2}
              maxRows={4}
            />
            <div className="flex justify-end">
              <Button
                startContent={<Send className="w-4 h-4" />}
                onPress={handleReview}
                isLoading={submitting}
              >
                {t('regional_points.transfer.submit')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* History */}
      <Card className="border border-border bg-surface/80 shadow-sm">
        <CardHeader className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-warning" />
          <h2 className="text-base font-semibold">
            {t('regional_points.history.title')}
          </h2>
          <Chip size="sm" variant="tertiary" className="ml-auto">
            {history?.length ?? 0}
          </Chip>
        </CardHeader>
        <Separator />
        <CardBody className="p-0">
          {!history || history.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted">
              {t('regional_points.history.empty')}
            </div>
          ) : (
            <Table aria-label={t('regional_points.history.table_aria')} mobileCards removeWrapper>
              <TableHeader>
                <TableColumn>{t('regional_points.history.date')}</TableColumn>
                <TableColumn>{t('regional_points.history.type')}</TableColumn>
                <TableColumn>{t('regional_points.history.description')}</TableColumn>
                <TableColumn align="end">{t('regional_points.history.amount')}</TableColumn>
                <TableColumn align="end">{t('regional_points.history.balance_after')}</TableColumn>
              </TableHeader>
              <TableBody>
                  {history.map((row) => {
                    const inbound = row.direction === 'in';
                    return (
                      <TableRow key={row.id}>
                        <TableCell>{formatActivityDate(row.created_at)}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            {inbound ? (
                              <ArrowDownCircle className="w-4 h-4 text-success" />
                            ) : (
                              <ArrowUpCircle className="w-4 h-4 text-danger" />
                            )}
                            {KNOWN_TRANSACTION_TYPES.has(row.type)
                              ? t(`regional_points.history.types.${row.type}`)
                              : humanizeTypeCode(row.type)}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted">{row.description || t('empty_dash')}</TableCell>
                        <TableCell className={`text-right tabular-nums ${inbound ? 'text-success' : 'text-danger'}`}>
                          {inbound ? '+' : '-'}
                          {row.points.toFixed(2)} {symbol}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted">
                          {row.balance_after.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Transfer confirmation — the sender sees who the points go to */}
      <Modal isOpen={confirmOpen} onOpenChange={setConfirmOpen} placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {recipient
                  ? t('regional_points.transfer.confirm_title', {
                      points: parseFloat(points) || 0,
                      symbol,
                      name: recipient.name,
                    })
                  : ''}
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-muted">{t('regional_points.transfer.confirm_body')}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose} isDisabled={submitting}>
                  {t('regional_points.transfer.cancel')}
                </Button>
                <Button
                  color="primary"
                  isLoading={submitting}
                  onPress={() => void handleTransfer()}
                >
                  {t('regional_points.transfer.confirm_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
