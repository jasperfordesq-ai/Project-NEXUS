import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Input, Button, Spinner, Chip, Textarea } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';
import Wallet from 'lucide-react/icons/wallet';
import Plus from 'lucide-react/icons/plus';
import History from 'lucide-react/icons/history';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useToast } from '@/contexts';
import { adminUsers, adminTimebanking } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import type { AdminUser, WalletGrant } from '../../api/types';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Starting Balances (W7)
 * Admin page for granting starting time credits to members.
 * Allows searching members, granting credits, and viewing grant history.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Member Search + Grant Form
// ─────────────────────────────────────────────────────────────────────────────

function GrantCreditsForm({ onGranted }: { onGranted: () => void }) {
  const { t } = useTranslation('admin_timebanking');
  const toast = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [granting, setGranting] = useState(false);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await adminUsers.list({ search: query, limit: 10 });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setSearchResults(data);
        } else if (data && typeof data === 'object') {
          const pd = data as { data: AdminUser[] };
          setSearchResults(pd.data || []);
        }
      }
    } catch {
      // Silently handle search errors
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSelectUser = (user: AdminUser) => {
    setSelectedUser(user);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleGrant = async () => {
    if (!selectedUser) {
      toast.error(t('timebanking.please_select_a_member'));
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast.error(t('timebanking.please_enter_a_valid_credit_amount_great'));
      return;
    }
    if (!reason.trim()) {
      toast.error(t('timebanking.please_provide_a_reason_for_this_grant'));
      return;
    }

    setGranting(true);
    try {
      const res = await adminTimebanking.grantCredits({
        user_id: selectedUser.id,
        amount: parsedAmount,
        reason: reason.trim(),
      });

      if (res?.success) {
        toast.success(t('timebanking.granted_credits'));
        setSelectedUser(null);
        setAmount('');
        setReason('');
        onGranted();
      } else {
        toast.error(t('timebanking.failed_to_grant_credits'));
      }
    } catch {
      toast.error(t('timebanking.an_unexpected_error_occurred'));
    } finally {
      setGranting(false);
    }
  };

  return (
    <Card >
      <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
        <Plus size={18} className="text-accent" aria-hidden="true" />
        <h3 className="font-semibold">{t('timebanking.grant_starting_credits')}</h3>
      </CardHeader>
      <CardBody className="px-4 pb-4 space-y-4">
        {/* Member search */}
        {!selectedUser ? (
          <div>
            <Input type="search" name="admin-search" autoComplete="off"
              label={t('timebanking.label_search_member')}
              placeholder={t('timebanking.placeholder_search_by_name_or_email')}
              startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
              value={searchQuery}
              onValueChange={handleSearch}
              size="sm"
              variant="secondary"
            />
            {searching && (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-4">
                <Spinner size="sm" />
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto border border-divider rounded-lg">
                {searchResults.map((user) => (
                  <Button
                    key={user.id}
                    variant="tertiary"
                    className="flex items-center justify-between w-full px-3 py-2 min-h-12 rounded-none"
                    onPress={() => handleSelectUser(user)}
                  >
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-foreground truncate">
                        {user.name}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {user.email}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-xs text-muted">{t('timebanking.col_balance')}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {formatNumber(user.balance, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}
                      </p>
                    </div>
                  </Button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="text-sm text-muted text-center py-2 mt-2">
                {t('timebanking.no_members_found')}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between border border-divider rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                <Users size={16} className="text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {selectedUser.name}
                </p>
                <p className="text-xs text-muted">
                  {selectedUser.email} &middot; {t('timebanking.current_balance')}: {formatNumber(selectedUser.balance, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => setSelectedUser(null)}
            >
              {t('timebanking.change')}
            </Button>
          </div>
        )}

        {/* Amount input */}
        <Input
          label={t('timebanking.label_credit_amount')}
          placeholder={t('timebanking.placeholder_credit_amount')}
          type="number"
          min="0.25"
          step="0.25"
          value={amount}
          onValueChange={setAmount}
          size="sm"
          variant="secondary"
          startContent={
            <Wallet size={16} className="text-muted" />
          }
          description={t('timebanking.desc_amount_of_time_credits_to_grant_in_hours')}
        />

        {/* Reason */}
        <Textarea
          label={t('timebanking.label_reason')}
          placeholder={t('timebanking.placeholder_grant_reason')}
          value={reason}
          onValueChange={setReason}
          size="sm"
          variant="secondary"
          minRows={2}
          maxRows={4}
          description={t('timebanking.desc_required_this_will_be_recorded_in_the_g')}
        />

        {/* Submit */}
        <Button
          startContent={<Plus size={16} />}
          onPress={handleGrant}
          isLoading={granting}
          isDisabled={!selectedUser || !amount || !reason.trim()}
          className="w-full sm:w-auto"
        >
          {t('timebanking.grant_credits')}
        </Button>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grant History Table
// ─────────────────────────────────────────────────────────────────────────────

function GrantHistory({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation('admin_timebanking');
  const toast = useToast();

  const [grants, setGrants] = useState<WalletGrant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const loadGrants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTimebanking.getGrants({
        page,
        search: search || undefined,
      });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setGrants(data);
          const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
          setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
        } else if (data && typeof data === 'object') {
          // GET /v2/admin/wallet/grants (AdminWalletGrantController::index) sends
          // `{ grants, total, page, per_page }` with the server's own field names.
          // This used to read `data` / `meta.total` and `user_name` / `reason`,
          // none of which that endpoint sends, so the history was always empty.
          const pd = data as {
            grants?: ServerWalletGrant[];
            data?: WalletGrant[];
            total?: number;
            meta?: { total?: number };
          };
          const rows = Array.isArray(pd.grants) ? pd.grants.map(toWalletGrant) : (pd.data || []);
          setGrants(rows);
          setTotal(pd.total ?? pd.meta?.total ?? rows.length);
        }
      }
    } catch {
      toast.error(t('timebanking.failed_to_load_grant_history'));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey intentionally triggers reload
  }, [page, search, refreshKey, toast]);

  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  const columns: Column<WalletGrant>[] = [
    {
      key: 'user_name',
      label: t('timebanking.col_member'),
      sortable: true,
      render: (item) => (
        <div>
          <p className="text-sm font-medium text-foreground">{item.user_name}</p>
          <p className="text-xs text-muted">{item.user_email}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      label: t('timebanking.col_amount'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color="success">
          {formatNumber(item.amount, { signDisplay: 'always', style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}
        </Chip>
      ),
    },
    {
      key: 'reason',
      label: t('timebanking.label_reason'),
      render: (item) => (
        <span className="text-sm text-muted line-clamp-2">
          {item.reason}
        </span>
      ),
    },
    {
      key: 'granted_by',
      label: t('timebanking.col_granted_by'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.granted_by || '—'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: t('timebanking.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <History size={16} className="text-accent" aria-hidden="true" />
        {t('timebanking.grant_history')}
      </h3>
      <DataTable
        columns={columns}
        data={grants}
        isLoading={loading}
        searchPlaceholder={t('timebanking.search_grants_placeholder')}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onRefresh={loadGrants}
        totalItems={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        emptyContent={t('timebanking.no_credit_grants')}
      />
    </div>
  );
}

/** A grant row exactly as GET /v2/admin/wallet/grants sends it. */
interface ServerWalletGrant {
  id: number;
  receiver_id: number;
  amount: number;
  description?: string;
  created_at: string;
  recipient_name?: string;
  recipient_email?: string;
  admin_name?: string;
}

function toWalletGrant(row: ServerWalletGrant): WalletGrant {
  return {
    id: row.id,
    user_id: row.receiver_id,
    user_name: row.recipient_name ?? '',
    user_email: row.recipient_email ?? '',
    amount: row.amount,
    reason: row.description ?? '',
    granted_by: row.admin_name ?? '',
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function StartingBalances() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_timebanking');
  useAdminPageMeta({ title: tNav('timebanking') });

  // Key to trigger grant history refresh after new grant
  const [refreshKey, setRefreshKey] = useState(0);

  const handleGranted = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div>
      <PageHeader
        title={t('timebanking.starting_balances_title')}
        description={t('timebanking.starting_balances_desc')}
      />

      <div className="space-y-6">
        <GrantCreditsForm onGranted={handleGranted} />
        <GrantHistory refreshKey={refreshKey} />
      </div>
    </div>
  );
}

export default StartingBalances;
