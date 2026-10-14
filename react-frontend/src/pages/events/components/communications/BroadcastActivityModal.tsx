// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import {
  eventCommunicationsApi,
  type EventBroadcast,
  type EventBroadcastDetail,
} from '@/lib/event-communications-api';
import { logError } from '@/lib/logger';
import { formatWhen, timeZoneCity } from './broadcastPresentation';

export const ACTIVITY_PAGE_SIZE = 50;

interface BroadcastActivityModalProps {
  broadcast: EventBroadcast | null;
  eventTimezone: string;
  onClose: () => void;
}

/** What happened to one message, in plain sentences with dates. No version numbers, no recipients. */
export function BroadcastActivityModal({ broadcast, eventTimezone, onClose }: BroadcastActivityModalProps) {
  const { t } = useTranslation('event_communications');
  const [detail, setDetail] = useState<EventBroadcastDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasError, setHasError] = useState(false);
  const generation = useRef(0);
  const broadcastId = broadcast?.id ?? null;

  useEffect(() => {
    if (broadcastId === null) return undefined;
    const mine = ++generation.current;
    setDetail(null);
    setHasError(false);
    setIsLoading(true);
    void (async () => {
      try {
        const response = await eventCommunicationsApi.get(broadcastId, 1, ACTIVITY_PAGE_SIZE);
        if (mine !== generation.current) return;
        if (!response.success || !response.data) {
          setHasError(true);
          return;
        }
        setDetail(response.data);
      } catch (error) {
        if (mine !== generation.current) return;
        logError('Failed to load event communication history', error);
        setHasError(true);
      } finally {
        if (mine === generation.current) setIsLoading(false);
      }
    })();
    return () => { generation.current += 1; };
  }, [broadcastId]);

  const loadMore = useCallback(async () => {
    if (!detail?.history_meta.has_more || isLoadingMore || broadcastId === null) return;
    const mine = generation.current;
    setIsLoadingMore(true);
    try {
      const response = await eventCommunicationsApi.get(
        broadcastId,
        detail.history_meta.current_page + 1,
        ACTIVITY_PAGE_SIZE,
      );
      if (mine !== generation.current) return;
      if (!response.success || !response.data || response.data.broadcast.id !== broadcastId) {
        setHasError(true);
        return;
      }
      const next = response.data;
      setDetail((current) => {
        if (!current) return next;
        const byId = new Map(current.history.map((entry) => [entry.id, entry]));
        next.history.forEach((entry) => byId.set(entry.id, entry));
        return { ...next, history: [...byId.values()] };
      });
    } catch (error) {
      if (mine !== generation.current) return;
      logError('Failed to load more event communication history', error);
      setHasError(true);
    } finally {
      if (mine === generation.current) setIsLoadingMore(false);
    }
  }, [broadcastId, detail, isLoadingMore]);

  const city = timeZoneCity(eventTimezone);

  return (
    <Modal
      isOpen={broadcast !== null}
      size="2xl"
      scrollBehavior="inside"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>{t('activity.title')}</ModalHeader>
        <ModalBody className="space-y-4">
          {isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <Spinner aria-label={t('activity.loading')} />
            </div>
          ) : detail ? (
            detail.history.length === 0 ? (
              <p className="text-theme-muted">{t('activity.empty')}</p>
            ) : (
              <ol className="space-y-3">
                {detail.history.map((entry) => {
                  const label = formatWhen(entry.created_at, eventTimezone);
                  return (
                    <li key={entry.id} className="rounded-xl border border-theme-default p-4">
                      <p className="font-medium text-theme-primary">{t(`activity.actions.${entry.action}`)}</p>
                      <p className="mt-1 text-sm text-theme-muted">
                        {label ? t('when_with_zone', { when: label, city }) : t('when_unknown')}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )
          ) : null}
          {hasError && <Alert color="danger" description={t('activity.error')} />}
          {detail?.history_meta.has_more && (
            <Button variant="secondary" isPending={isLoadingMore} onPress={() => void loadMore()}>
              {t('activity.load_more')}
            </Button>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onPress={onClose}>{t('close')}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
