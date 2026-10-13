// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Copy from 'lucide-react/icons/copy';
import Download from 'lucide-react/icons/download';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/ui/Modal';
import { useToast } from '@/contexts/ToastContext';
import {
  eventsApi,
  type EventCalendarFeedToken,
} from '@/lib/events-api';
import { formatDateTime } from '@/lib/helpers';
import { explainedApiError } from '@/lib/explained-api-error';
import { logError } from '@/lib/logger';

export function CalendarSubscriptionPanel() {
  const { t } = useTranslation('events');
  const toast = useToast();
  const confirm = useConfirm();
  const revokeInFlight = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [tokens, setTokens] = useState<EventCalendarFeedToken[]>([]);
  const [label, setLabel] = useState('');
  const [createdFeedUrl, setCreatedFeedUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  // The community can switch calendar feeds off; the server then answers 403
  // for every feed call, so say so instead of a generic failure (E-104).
  const [unavailable, setUnavailable] = useState(false);

  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await eventsApi.calendarFeedTokens();
      if (!response.success || !response.data) {
        if (response.code === 'FORBIDDEN' || response.code === 'HTTP_403') {
          setUnavailable(true);
          return;
        }
        toast.error(explainedApiError(response) ?? t('calendar_subscriptions.load_error'));
        return;
      }
      setUnavailable(false);
      setTokens(response.data);
    } catch (error) {
      logError('Failed to load calendar subscriptions', error);
      toast.error(t('calendar_subscriptions.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  const openPanel = () => {
    setCreatedFeedUrl(null);
    setIsOpen(true);
    void loadTokens();
  };

  const createToken = async () => {
    setIsCreating(true);
    try {
      const response = await eventsApi.createCalendarFeedToken(label);
      if (!response.success || !response.data) {
        toast.error(explainedApiError(response) ?? t('calendar_subscriptions.create_error'));
        return;
      }
      setCreatedFeedUrl(response.data.feed_url);
      setLabel('');
      setTokens((current) => [response.data!, ...current]);
      toast.success(t('calendar_subscriptions.created'));
    } catch (error) {
      logError('Failed to create calendar subscription', error);
      toast.error(t('calendar_subscriptions.create_error'));
    } finally {
      setIsCreating(false);
    }
  };

  const revokeToken = async (token: EventCalendarFeedToken) => {
    if (revokeInFlight.current) return;
    revokeInFlight.current = true;
    try {
      const approved = await confirm({
        title: t('calendar_subscriptions.revoke_confirm_title'),
        body: (
          <div className="space-y-2">
            <p>{t('calendar_subscriptions.revoke_confirm_body')}</p>
            <p className="font-medium text-theme-primary">
              {t('calendar_subscriptions.revoke_confirm_identity', {
                label: token.label || t('calendar_subscriptions.unnamed'),
                prefix: token.token_prefix,
              })}
            </p>
          </div>
        ),
        status: 'danger',
        confirmLabel: t('calendar_subscriptions.revoke'),
        cancelLabel: t('calendar_subscriptions.cancel'),
      });
      if (!approved) return;

      setRevokingId(token.id);
      const response = await eventsApi.revokeCalendarFeedToken(token.id);
      if (!response.success) {
        toast.error(t('calendar_subscriptions.revoke_error'));
        return;
      }
      setTokens((current) => current.map((entry) => (
        entry.id === token.id
          ? { ...entry, active: false, revoked_at: new Date().toISOString() }
          : entry
      )));
      toast.success(t('calendar_subscriptions.revoked'));
    } catch (error) {
      logError('Failed to revoke calendar subscription', error);
      toast.error(t('calendar_subscriptions.revoke_error'));
    } finally {
      revokeInFlight.current = false;
      setRevokingId(null);
    }
  };

  const copyCreatedUrl = async () => {
    if (!createdFeedUrl) return;
    try {
      await navigator.clipboard.writeText(createdFeedUrl);
      toast.success(t('calendar_subscriptions.copied'));
    } catch (error) {
      logError('Failed to copy calendar subscription URL', error);
      toast.error(t('calendar_subscriptions.copy_error'));
    }
  };

  const downloadTenantFeed = async () => {
    setIsDownloading(true);
    try {
      await eventsApi.downloadTenantCalendar();
    } catch (error) {
      logError('Failed to download tenant event calendar', error);
      toast.error(t('calendar_subscriptions.download_error'));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <Button
        variant="flat"
        startContent={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
        onPress={openPanel}
      >
        {t('calendar_subscriptions.button')}
      </Button>

      <Modal
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('calendar_subscriptions.title')}</ModalHeader>
              <ModalBody className="space-y-5">
                {unavailable && (
                  <p role="status" className="rounded-lg bg-warning/10 p-3 text-sm text-theme-primary">
                    {t('calendar_subscriptions.unavailable')}
                  </p>
                )}
                <p className="text-sm text-theme-muted">{t('calendar_subscriptions.description')}</p>

                <section aria-labelledby="tenant-calendar-heading" className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                  <h3 id="tenant-calendar-heading" className="font-medium text-theme-primary">
                    {t('calendar_subscriptions.tenant_title')}
                  </h3>
                  <p className="mt-1 text-sm text-theme-muted">
                    {t('calendar_subscriptions.tenant_description')}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="flat"
                    isLoading={isDownloading}
                    startContent={<Download className="h-4 w-4" aria-hidden="true" />}
                    onPress={downloadTenantFeed}
                  >
                    {t('calendar_subscriptions.download_tenant')}
                  </Button>
                </section>

                <section aria-labelledby="personal-calendar-heading" className="space-y-3">
                  <div>
                    <h3 id="personal-calendar-heading" className="font-medium text-theme-primary">
                      {t('calendar_subscriptions.personal_title')}
                    </h3>
                    <p className="mt-1 text-sm text-theme-muted">
                      {t('calendar_subscriptions.personal_description')}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Input
                      label={t('calendar_subscriptions.label')}
                      value={label}
                      maxLength={100}
                      onValueChange={setLabel}
                      className="flex-1"
                    />
                    <Button
                      color="primary"
                      isLoading={isCreating}
                      startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                      onPress={createToken}
                    >
                      {t('calendar_subscriptions.create')}
                    </Button>
                  </div>

                  {createdFeedUrl && (
                    <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                      <p className="font-medium text-theme-primary">
                        {t('calendar_subscriptions.copy_now_title')}
                      </p>
                      <p className="mt-1 text-sm text-theme-muted">
                        {t('calendar_subscriptions.copy_now_description')}
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-theme-surface px-3 py-2 text-xs text-theme-primary">
                          {createdFeedUrl}
                        </code>
                        <Button
                          size="sm"
                          startContent={<Copy className="h-4 w-4" aria-hidden="true" />}
                          onPress={copyCreatedUrl}
                        >
                          {t('calendar_subscriptions.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div aria-busy={isLoading} className="space-y-2">
                    {isLoading ? (
                      <p className="py-4 text-center text-sm text-theme-muted">
                        {t('calendar_subscriptions.loading')}
                      </p>
                    ) : tokens.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-theme-default p-4 text-center text-sm text-theme-muted">
                        {t('calendar_subscriptions.none')}
                      </p>
                    ) : tokens.map((token) => (
                      <div key={token.id} className="flex flex-col gap-3 rounded-lg border border-theme-default p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-theme-primary">
                              {token.label || t('calendar_subscriptions.unnamed')}
                            </p>
                            <Chip size="sm" variant="flat" color={token.active ? 'success' : 'default'}>
                              {token.active
                                ? t('calendar_subscriptions.active')
                                : t('calendar_subscriptions.inactive')}
                            </Chip>
                          </div>
                          <p className="mt-1 text-xs text-theme-subtle">
                            {t('calendar_subscriptions.created_at', {
                              date: token.created_at ? formatDateTime(new Date(token.created_at)) : t('calendar_subscriptions.unknown_date'),
                            })}
                          </p>
                        </div>
                        {token.active && (
                          <Button
                            size="sm"
                            color="danger"
                            variant="flat"
                            isLoading={revokingId === token.id}
                            isDisabled={revokingId !== null}
                            startContent={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                            onPress={() => revokeToken(token)}
                          >
                            {t('calendar_subscriptions.revoke')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  {t('calendar_subscriptions.close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
