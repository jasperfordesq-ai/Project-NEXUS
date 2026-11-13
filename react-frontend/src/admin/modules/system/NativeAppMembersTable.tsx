// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Who has the phone app — every member of this community, one row each.
 *
 * Searching and paging happen on the server (`GET
 * /v2/admin/config/native-app/members`), so the list is complete however many
 * members there are; until 13 Nov 2026 the page showed only the 25 most recent
 * phones.
 *
 * A member appears when they have a phone that allowed notifications, or when
 * they are signed in on the app without notifications. Only the first kind
 * tells us Android from iPhone, which is why the phone can be "Not known yet".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Card, CardBody, CardHeader, Chip } from '@/components/ui';
import { useTenant } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { adminSettings } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';

export interface NativeAppMember {
  user_id: number;
  display_name: string | null;
  username: string | null;
  /** Present in a community's own list; never in the all-communities list. */
  email?: string | null;
  /** `android` / `ios`; empty when the member has not allowed notifications. */
  phones: string[];
  notifications_on: boolean;
  first_seen_at: string | null;
  last_opened_at: string | null;
}

const PAGE_SIZE = 25;
/** Wait for the admin to stop typing before asking the server. */
const SEARCH_DELAY_MS = 300;

/** A date in the admin's own language and region, or the "not yet" wording. */
export function formatAppDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium' }).format(parsed);
}

/** "Android", "iPhone" or "Not known yet" — never the raw value the server sends. */
export function PhoneChips({ phones }: { phones: string[] }) {
  const { t } = useTranslation('admin_system');

  if (phones.length === 0) {
    return (
      <Chip size="sm" variant="soft" color="default">
        {t('system.phone_app.members.phone.unknown')}
      </Chip>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {phones.map((phone) => (
        <Chip key={phone} size="sm" variant="soft" color={phone === 'ios' ? 'secondary' : 'success'}>
          {phone === 'ios' ? t('system.phone_app.members.phone.ios') : t('system.phone_app.members.phone.android')}
        </Chip>
      ))}
    </div>
  );
}

export function NativeAppMembersTable() {
  const { t } = useTranslation('admin_system');
  const { tenantPath } = useTenant();

  const [members, setMembers] = useState<NativeAppMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Only the newest request may fill the table: a slow reply to an earlier
  // search must not overwrite the result of a later one.
  const latestRequest = useRef(0);

  // Typing settles into a search, and a new search starts again at page 1.
  useEffect(() => {
    const next = searchText.trim();
    if (next === search) return;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search]);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    try {
      const res = await adminSettings.getNativeAppMembers({ q: search || undefined, page, per_page: PAGE_SIZE });
      if (request !== latestRequest.current) return;
      const rows = Array.isArray(res.data) ? (res.data as unknown as NativeAppMember[]) : [];
      setMembers(rows);
      setTotal(res.meta?.total ?? rows.length);
      setFailed(res.success === false);
    } catch {
      if (request !== latestRequest.current) return;
      setMembers([]);
      setTotal(0);
      setFailed(true);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<Column<NativeAppMember>[]>(() => {
    const noDate = t('system.phone_app.members.no_date');

    return [
      {
        key: 'member',
        label: t('system.phone_app.members.columns.member'),
        isRowHeader: true,
        render: (member) => {
          const name = member.display_name
            ?? (member.username
              ? `@${member.username}`
              : t('system.phone_app.members.unnamed_member', { id: member.user_id }));

          return (
            <div className="min-w-0">
              <Link
                to={tenantPath(`/admin/users/${member.user_id}/edit`)}
                className="font-medium text-foreground hover:text-accent"
              >
                {name}
              </Link>
              {member.email ? <p className="truncate text-xs text-muted">{member.email}</p> : null}
            </div>
          );
        },
      },
      {
        key: 'phone',
        label: t('system.phone_app.members.columns.phone'),
        render: (member) => <PhoneChips phones={member.phones ?? []} />,
      },
      {
        key: 'notifications',
        label: t('system.phone_app.members.columns.notifications'),
        render: (member) => (
          <Chip size="sm" variant="soft" color={member.notifications_on ? 'success' : 'default'}>
            {member.notifications_on
              ? t('system.phone_app.members.notifications_on')
              : t('system.phone_app.members.notifications_off')}
          </Chip>
        ),
      },
      {
        key: 'first_seen_at',
        label: t('system.phone_app.members.columns.first_seen'),
        hideBelow: 'md',
        render: (member) => formatAppDate(member.first_seen_at, noDate),
      },
      {
        key: 'last_opened_at',
        label: t('system.phone_app.members.columns.last_opened'),
        render: (member) => formatAppDate(member.last_opened_at, noDate),
      },
    ];
  }, [t, tenantPath]);

  let emptyContent = t('system.phone_app.members.empty');
  if (failed) emptyContent = t('system.phone_app.members.load_failed');
  else if (search) emptyContent = t('system.phone_app.members.empty_search');

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">{t('system.phone_app.members.title')}</h3>
      </CardHeader>
      <CardBody>
        <DataTable
          columns={columns}
          data={members}
          keyField="user_id"
          isLoading={loading}
          searchPlaceholder={t('system.phone_app.members.search_placeholder')}
          searchValue={searchText}
          onSearch={setSearchText}
          onRefresh={() => void load()}
          totalItems={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          emptyContent={<span className={failed ? 'text-danger' : undefined}>{emptyContent}</span>}
          mobileCards
        />
      </CardBody>
    </Card>
  );
}

export default NativeAppMembersTable;
