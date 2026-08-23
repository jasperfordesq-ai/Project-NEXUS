// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Spinner } from 'heroui-native';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import {
  getEventLifecycleHistory,
  type MobileEventLifecycleHistoryEntry,
} from '@/lib/api/eventLifecycleHistory';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

function appendUnique(
  current: MobileEventLifecycleHistoryEntry[],
  incoming: MobileEventLifecycleHistoryEntry[],
): MobileEventLifecycleHistoryEntry[] {
  const seen = new Set(current.map((entry) => entry.id));
  return [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
}

export default function EventLifecycleHistoryScreen() {
  return (
    <ModalErrorBoundary>
      <EventLifecycleHistoryScreenInner />
    </ModalErrorBoundary>
  );
}

function EventLifecycleHistoryScreenInner() {
  const { t, i18n } = useTranslation(['events', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const parsedId = Number(id);
  const eventId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : 0;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const generationRef = useRef(0);
  const [entries, setEntries] = useState<MobileEventLifecycleHistoryEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    setEntries([]);
    setNextCursor(null);
    setLoadFailed(false);
    setLoadMoreFailed(false);
    setIsLoadingMore(false);
    if (eventId <= 0) {
      setIsLoading(false);
      setLoadFailed(true);
      return () => { generationRef.current += 1; };
    }

    setIsLoading(true);
    void getEventLifecycleHistory(eventId)
      .then((response) => {
        if (generation !== generationRef.current) return;
        setEntries(response.data);
        setNextCursor(response.meta.has_more ? response.meta.next_cursor : null);
      })
      .catch(() => {
        if (generation === generationRef.current) setLoadFailed(true);
      })
      .finally(() => {
        if (generation === generationRef.current) setIsLoading(false);
      });

    return () => { generationRef.current += 1; };
  }, [eventId, retryToken]);

  async function loadMore(): Promise<void> {
    if (!nextCursor || isLoadingMore) return;
    const generation = generationRef.current;
    const cursor = nextCursor;
    setLoadMoreFailed(false);
    setIsLoadingMore(true);
    try {
      const response = await getEventLifecycleHistory(eventId, cursor);
      if (generation !== generationRef.current) return;
      setEntries((current) => appendUnique(current, response.data));
      setNextCursor(response.meta.has_more ? response.meta.next_cursor : null);
    } catch {
      if (generation === generationRef.current) setLoadMoreFailed(true);
    } finally {
      if (generation === generationRef.current) setIsLoadingMore(false);
    }
  }

  function dateLabel(value: string | null): string {
    if (!value) return t('lifecycleHistory.timestampUnknown');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('lifecycleHistory.timestampUnknown');
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function stateLabel(axis: 'publication' | 'operational', value: string): string {
    return t(`lifecycleHistory.states.${axis}.${value}`);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']} style={{ flex: 1 }}>
      <AppTopBar
        title={t('lifecycleHistory.title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/events"
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-8"
        accessibilityLabel={t('lifecycleHistory.listLabel')}
      >
        <Card variant="secondary">
          <Card.Body className="gap-2 px-4 py-4">
            <Card.Title>{t('lifecycleHistory.title')}</Card.Title>
            <Card.Description>{t('lifecycleHistory.description')}</Card.Description>
          </Card.Body>
        </Card>

        {isLoading ? (
          <View className="min-h-40 items-center justify-center gap-3" accessibilityRole="progressbar">
            <Spinner size="lg" />
            <Text className="text-sm" style={{ color: theme.textSecondary }}>
              {t('lifecycleHistory.loading')}
            </Text>
          </View>
        ) : loadFailed ? (
          <Card variant="secondary" testID="event-lifecycle-history-error">
            <Card.Body className="gap-3 px-4 py-4">
              <Card.Title>{t('lifecycleHistory.loadFailedTitle')}</Card.Title>
              <Card.Description>{t('lifecycleHistory.loadFailedDescription')}</Card.Description>
              <Button variant="secondary" onPress={() => setRetryToken((value) => value + 1)}>
                <Ionicons name="refresh-outline" size={18} color={primary} />
                <Button.Label>{t('lifecycleHistory.retry')}</Button.Label>
              </Button>
            </Card.Body>
          </Card>
        ) : entries.length === 0 ? (
          <Card variant="secondary" testID="event-lifecycle-history-empty">
            <Card.Body className="gap-2 px-4 py-4">
              <Card.Title>{t('lifecycleHistory.emptyTitle')}</Card.Title>
              <Card.Description>{t('lifecycleHistory.emptyDescription')}</Card.Description>
            </Card.Body>
          </Card>
        ) : (
          <>
            {entries.map((entry) => {
              const cascade = Object.entries(entry.evidence.cascade)
                .filter(([, count]) => typeof count === 'number' && count > 0);
              return (
                <Card
                  key={entry.id}
                  variant="secondary"
                  testID={`event-lifecycle-history-${entry.id}`}
                  accessibilityLabel={t('lifecycleHistory.entryAccessibility', {
                    version: entry.lifecycle_version,
                    date: dateLabel(entry.created_at),
                  })}
                >
                  <Card.Header className="flex-row items-center justify-between gap-3 px-4 pt-4">
                    <Text className="flex-1 text-base font-semibold" style={{ color: theme.text }}>
                      {t('lifecycleHistory.version', { version: entry.lifecycle_version })}
                    </Text>
                    <Chip color="success" size="sm" variant="soft">
                      <Chip.Label>{t('lifecycleHistory.immutable')}</Chip.Label>
                    </Chip>
                  </Card.Header>
                  <Card.Body className="gap-2 px-4 py-4">
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {dateLabel(entry.created_at)}
                    </Text>
                    {entry.evidence.axes_changed.includes('publication') ? (
                      <Text className="text-sm" style={{ color: theme.text }}>
                        {t('lifecycleHistory.publicationTransition', {
                          from: stateLabel('publication', entry.publication.from),
                          to: stateLabel('publication', entry.publication.to),
                        })}
                      </Text>
                    ) : null}
                    {entry.evidence.axes_changed.includes('operational') ? (
                      <Text className="text-sm" style={{ color: theme.text }}>
                        {t('lifecycleHistory.operationalTransition', {
                          from: stateLabel('operational', entry.operational.from),
                          to: stateLabel('operational', entry.operational.to),
                        })}
                      </Text>
                    ) : null}
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      {t('lifecycleHistory.changedBy', {
                        name: entry.actor.display_name
                          ?? t('lifecycleHistory.unknownActor', { id: entry.actor.id }),
                      })}
                    </Text>
                    {entry.reason ? (
                      <Text className="text-sm" style={{ color: theme.text }}>
                        {t('lifecycleHistory.reason', { reason: entry.reason })}
                      </Text>
                    ) : null}
                    {cascade.map(([key, count]) => (
                      <Text key={key} className="text-xs" style={{ color: theme.textSecondary }}>
                        {t(`lifecycleHistory.cascade.${key}`, { count })}
                      </Text>
                    ))}
                    {entry.evidence.series ? (
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {t(`lifecycleHistory.series.${entry.evidence.series.member_type}`, {
                          id: entry.evidence.series.root_event_id,
                        })}
                      </Text>
                    ) : null}
                    {entry.evidence.notifications_suppressed ? (
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {t('lifecycleHistory.notificationsSuppressed')}
                      </Text>
                    ) : null}
                  </Card.Body>
                </Card>
              );
            })}

            {loadMoreFailed ? (
              <Text
                className="text-center text-sm"
                style={{ color: theme.error }}
                accessibilityLiveRegion="polite"
              >
                {t('lifecycleHistory.loadMoreFailed')}
              </Text>
            ) : null}
            {nextCursor ? (
              <Button
                variant="secondary"
                isDisabled={isLoadingMore}
                onPress={() => void loadMore()}
                accessibilityState={{ busy: isLoadingMore }}
              >
                {isLoadingMore ? <Spinner size="sm" /> : <Ionicons name="time-outline" size={18} color={primary} />}
                <Button.Label>
                  {isLoadingMore ? t('lifecycleHistory.loadingMore') : t('lifecycleHistory.loadMore')}
                </Button.Label>
              </Button>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
