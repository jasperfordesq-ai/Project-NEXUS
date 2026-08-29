import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Heart from 'lucide-react/icons/heart';
import Search from 'lucide-react/icons/search';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import api from '@/lib/api';
import { logError } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserSearchResult {
  id: number;
  name: string;
  avatar_url: string | null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LinkCareReceiverPage() {
  const { t } = useTranslation('caring_community');
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const { showToast } = useToast();

  usePageTitle(t('caregiver.link_title'));

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [relationshipType, setRelationshipType] = useState('family');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Member search
  //
  // 🔴 `/v2/users/search` answers `{ data: { items: [...] } }`, NOT a bare array.
  // `api.get()` unwraps exactly one level, so what reaches this component is
  // `{ items: [...] }` — an object. Reading `.length` on it yields `undefined`,
  // `undefined > 0` is false, and the dropdown fell straight through to "No
  // matching members found" for EVERY query, including ones the API had just
  // answered with a match.
  //
  // That made the caregiver-link form impossible to complete: no member could
  // be selected, so no caregiver relationship could be proposed through the UI
  // at all. It went unnoticed because this page's component test mocks
  // `data: [ ... ]` — a shape the real endpoint never returns — so the test
  // passed against a fiction. Found by walking the journey in a browser.
  //
  // Both shapes are accepted rather than only the real one: the array form is
  // what the existing tests supply, and normalising here keeps the component
  // honest regardless of which the caller hands it.
  const { data: searchPayload, isLoading: searching, error: searchError } = useApi<
    UserSearchResult[] | { items?: UserSearchResult[] }
  >(
    searchQuery.length >= 2 ? `/v2/users/search?q=${encodeURIComponent(searchQuery)}` : null,
    { immediate: true },
  );

  const searchResults: UserSearchResult[] = Array.isArray(searchPayload)
    ? searchPayload
    : (searchPayload?.items ?? []);

  const handleSelectUser = useCallback((user: UserSearchResult) => {
    setSelectedUser(user);
    setSearchQuery(user.name);
  }, []);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!selectedUser) {
      showToast(t('caregiver.select_member_error'), 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.post('/v2/caring-community/caregiver/links', {
        cared_for_id: selectedUser.id,
        relationship_type: relationshipType,
        start_date: startDate,
        notes: notes || undefined,
      });
      if (!res.success) {
        showToast(res.error ?? t('caregiver.link_error'), 'error');
        return;
      }
      showToast(t('caregiver.link_success'), 'success');
      void navigate(tenantPath('/caring-community/caregiver'), { replace: true });
    } catch (err) {
      logError('LinkCareReceiverPage submit failed', err);
      showToast(t('caregiver.link_error'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const relationshipOptions = [
    { key: 'family', label: t('caregiver.relationship_family') },
    { key: 'friend', label: t('caregiver.relationship_friend') },
    { key: 'neighbour', label: t('caregiver.relationship_neighbour') },
    { key: 'professional', label: t('caregiver.relationship_professional') },
  ];

  return (
    <>
      <PageMeta
        title={t('caregiver.link_title')}
        description={t('caregiver.link_subtitle')}
        noIndex
      />

      <div className="space-y-6">
        {/* Back link */}
        <Link
          to={tenantPath('/caring-community/caregiver')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('caregiver.dashboard_title')}
        </Link>

        {/* Page header */}
        <GlassCard className="p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500/15">
              <Heart className="h-6 w-6 text-rose-500" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                {t('caregiver.link_title')}
              </h1>
              <p className="mt-2 text-base leading-7 text-theme-muted">
                {t('caregiver.link_subtitle')}
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Form */}
        <GlassCard className="p-6 sm:p-8">
          <form className="max-w-lg space-y-5" onSubmit={(event) => void handleSubmit(event)} noValidate>

            {/* Member search */}
            <div className="space-y-2">
              <Input
                label={t('caregiver.search_label')}
                placeholder={t('caregiver.search_placeholder')}
                value={searchQuery}
                onValueChange={(v) => {
                  setSearchQuery(v);
                  if (selectedUser && v !== selectedUser.name) {
                    setSelectedUser(null);
                  }
                }}
                startContent={<Search className="h-4 w-4 text-theme-muted" aria-hidden="true" />}
                variant="bordered"
                isDisabled={isSubmitting}
                isInvalid={Boolean(searchError)}
                errorMessage={searchError ? t('caregiver.search_error') : undefined}
              />

              {/* Search results dropdown */}
              {!selectedUser && searchQuery.length >= 2 && (
                <div className="overflow-hidden rounded-lg border border-theme-default bg-theme-surface shadow-lg">
                  {searching ? (
                    <div className="p-3 text-sm text-theme-muted" role="status" aria-live="polite">
                      {t('caregiver.searching')}
                    </div>
                  ) : searchError ? (
                    <div className="p-3 text-sm text-danger" role="alert">
                      {t('caregiver.search_error')}
                    </div>
                  ) : searchResults && searchResults.length > 0 ? (
                    <ul className="divide-y divide-theme-default" role="listbox" aria-label={t('caregiver.search_results_aria')}>
                      {(searchResults as UserSearchResult[]).slice(0, 8).map((user: UserSearchResult) => {
                        const sel = selectedUser as UserSearchResult | null;
                        const isSelected: boolean = sel !== null && sel.id === user.id;
                        return (
                        <li key={user.id} role="option" aria-selected={isSelected}>

                          <Button
                            type="button"
                            variant="tertiary"
                            className="min-h-14 w-full justify-start rounded-none px-4 py-3 text-left"
                            startContent={
                              <Avatar
                                src={user.avatar_url ?? undefined}
                                name={user.name}
                                size="sm"
                              />
                            }
                            onPress={() => handleSelectUser(user)}
                          >
                            <span className="min-w-0 truncate text-sm font-medium text-theme-primary">
                              {user.name}
                            </span>
                          </Button>
                        </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="p-3 text-sm text-theme-muted">{t('caregiver.no_search_results')}</div>
                  )}
                </div>
              )}

              {/* Selected user confirmation */}
              {selectedUser && (
                <div className="flex min-w-0 items-center gap-3 rounded-lg border border-success/40 bg-success/5 px-4 py-3">
                  <Avatar
                    src={selectedUser.avatar_url ?? undefined}
                    name={selectedUser.name}
                    size="sm"
                  />
                  <span className="min-w-0 truncate text-sm font-medium text-success">{selectedUser.name}</span>
                </div>
              )}
            </div>

            {/* Relationship type */}
            <Select
              label={t('caregiver.relationship_label')}
              selectedKeys={[relationshipType]}
              onSelectionChange={(keys) => setRelationshipType(String([...keys][0] ?? 'family'))}
              variant="bordered"
              isDisabled={isSubmitting}
            >
              {relationshipOptions.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
              ))}
            </Select>

            {/* Start date */}
            <Input
              label={t('caregiver.start_date_label')}
              type="date"
              value={startDate}
              onValueChange={setStartDate}
              variant="bordered"
              isDisabled={isSubmitting}
            />

            {/* Notes */}
            <Textarea
              label={t('caregiver.notes_label')}
              placeholder={t('caregiver.notes_placeholder')}
              value={notes}
              onValueChange={setNotes}
              variant="bordered"
              minRows={3}
              isDisabled={isSubmitting}
            />

            {/* Submit */}
            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                color="primary"
                isLoading={isSubmitting}
                isDisabled={!selectedUser || isSubmitting}
              >
                {t('caregiver.link_care_receiver')}
              </Button>
              <Button
                variant="flat"
                as={Link}
                to={tenantPath('/caring-community/caregiver')}
                isDisabled={isSubmitting}
              >
                {t('caregiver.cancel')}
              </Button>
            </div>
          </form>
        </GlassCard>
      </div>
    </>
  );
}

export default LinkCareReceiverPage;
