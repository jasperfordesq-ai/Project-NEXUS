// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Members a coordinator has approved to contact a member whose safeguarding
 * choice routes contact through a coordinator (owner decision, 25 Oct 2026).
 * Only coordinators and the members approved here can contact them; nobody
 * else, in either direction. Approving or withdrawing is audited server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import UserCheck from 'lucide-react/icons/user-check';
import { Button } from '@/components/ui';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import { MemberSearchPicker, type MemberSearchMember } from '@/admin/components/MemberSearchPicker';

export interface ApprovedContact {
  id: number;
  contact_user_id: number;
  contact_name: string;
  approved_at: string | null;
}

export function ApprovedContactsSection({ userId, userName }: { userId: number; userName: string }) {
  const { t } = useTranslation('admin_safeguarding');
  const toast = useToast();
  const endpoint = `/v2/admin/safeguarding/members/${userId}/approved-contacts`;

  const [contacts, setContacts] = useState<ApprovedContact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<MemberSearchMember | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<ApprovedContact[]>(endpoint);
      setContacts(res.success && Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      logError('ApprovedContactsSection.load', err);
    }
    setLoaded(true);
  }, [endpoint]);

  useEffect(() => { void load(); }, [load]);

  const approve = useCallback(async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await api.post(endpoint, { contact_user_id: picked.id });
      if (res.success) {
        toast.success(t('safeguarding.approved_contacts.approved_toast', { name: picked.name }));
        setPicked(null);
        setQuery('');
        await load();
      } else {
        // admin-i18n-ignore: localized server message — AdminSafeguardingApprovedContactsController
        toast.error(res.error || t('safeguarding.approved_contacts.failed'));
      }
    } catch (err) {
      logError('ApprovedContactsSection.approve', err);
      toast.error(t('safeguarding.approved_contacts.failed'));
    }
    setBusy(false);
  }, [endpoint, picked, load, t, toast]);

  const withdraw = useCallback(async (contact: ApprovedContact) => {
    setBusy(true);
    try {
      const res = await api.delete(`${endpoint}/${contact.id}`);
      if (res.success) {
        toast.success(t('safeguarding.approved_contacts.removed_toast'));
        await load();
      } else {
        toast.error(t('safeguarding.approved_contacts.failed'));
      }
    } catch (err) {
      logError('ApprovedContactsSection.withdraw', err);
      toast.error(t('safeguarding.approved_contacts.failed'));
    }
    setBusy(false);
  }, [endpoint, load, t, toast]);

  return (
    <section aria-label={t('safeguarding.approved_contacts.heading')} className="rounded-lg border border-divider p-3">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        <UserCheck size={14} aria-hidden="true" />
        {t('safeguarding.approved_contacts.heading')}
      </p>
      <p className="mt-1 text-sm text-muted">{t('safeguarding.approved_contacts.intro', { name: userName })}</p>

      {loaded && contacts.length === 0 && (
        <p className="mt-2 text-sm">{t('safeguarding.approved_contacts.none')}</p>
      )}
      {contacts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{contact.contact_name}</span>
                {contact.approved_at && (
                  <span className="text-muted">
                    {' '}· {t('safeguarding.approved_contacts.approved_on', { when: formatRelativeTime(contact.approved_at) })}
                  </span>
                )}
              </span>
              <Button
                size="sm"
                variant="danger-soft"
                isDisabled={busy}
                onPress={() => void withdraw(contact)}
                aria-label={t('safeguarding.approved_contacts.remove_aria', { name: contact.contact_name })}
              >
                {t('safeguarding.approved_contacts.remove_button')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <MemberSearchPicker
          value={query}
          onValueChange={setQuery}
          selectedMember={picked}
          onSelectedMemberChange={setPicked}
          label={t('safeguarding.approved_contacts.add_label')}
          placeholder={t('safeguarding.approved_contacts.add_placeholder')}
          noResultsText={t('safeguarding.approved_contacts.no_results')}
          clearText={t('safeguarding.approved_contacts.clear')}
          size="sm"
          className="sm:flex-1"
        />
        <Button size="sm" isDisabled={!picked || picked.id === userId || busy} isLoading={busy} onPress={() => void approve()}>
          {t('safeguarding.approved_contacts.approve_button')}
        </Button>
      </div>
    </section>
  );
}

export default ApprovedContactsSection;
