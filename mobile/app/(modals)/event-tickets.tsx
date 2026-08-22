// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  Spinner,
  TextField,
} from 'heroui-native';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import {
  allocateFreeEventTicket,
  cancelEventTicket,
  getEventTickets,
  type MobileEventTicketCatalogue,
  type MobileEventTicketEntitlement,
  type MobileEventTicketType,
} from '@/lib/api/eventTickets';
import { useTheme } from '@/lib/hooks/useTheme';

function idempotencyKey(action: 'allocate' | 'cancel'): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `mobile-event-ticket-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function allocatableUnits(ticket: MobileEventTicketType): number {
  return Math.min(
    ticket.availability.allocation_remaining,
    ticket.availability.member_remaining,
  );
}

function canAllocate(
  catalogue: MobileEventTicketCatalogue,
  ticket: MobileEventTicketType,
): boolean {
  return catalogue.permissions.allocate_self
    && ticket.kind === 'free'
    && ticket.status === 'active'
    && ticket.availability.eligibility.eligible
    && ticket.availability.sales_window_open
    && ticket.availability.materialization_supported
    && allocatableUnits(ticket) > 0;
}

export default function EventTicketsScreen() {
  return (
    <ModalErrorBoundary>
      <EventTicketsScreenInner />
    </ModalErrorBoundary>
  );
}

function EventTicketsScreenInner() {
  const { t } = useTranslation(['event_tickets', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Number(id);
  const safeEventId = Number.isInteger(eventId) && eventId > 0 ? eventId : 0;
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [catalogue, setCatalogue] = useState<MobileEventTicketCatalogue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [units, setUnits] = useState<Record<number, string>>({});
  const [allocatingId, setAllocatingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MobileEventTicketEntitlement | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);

  const ticketNames = useMemo(() => new Map(
    (catalogue?.ticket_types ?? []).map((ticket) => [ticket.id, ticket.name]),
  ), [catalogue]);

  const load = useCallback(async () => {
    if (safeEventId <= 0) {
      setCatalogue(null);
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const result = await getEventTickets(safeEventId);
      setCatalogue(result);
      setUnits((current) => {
        const next = { ...current };
        result.ticket_types.forEach((ticket) => {
          if (!next[ticket.id]) next[ticket.id] = '1';
        });
        return next;
      });
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [safeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function allocate(ticket: MobileEventTicketType) {
    if (!catalogue || !canAllocate(catalogue, ticket)) return;
    const quantity = Number(units[ticket.id] ?? '1');
    const maximum = allocatableUnits(ticket);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
      showToast({
        title: t('tickets.mobile.unitsInvalidTitle'),
        description: t('tickets.mobile.unitsInvalidDescription', { count: maximum }),
        variant: 'warning',
      });
      return;
    }

    setAllocatingId(ticket.id);
    try {
      await allocateFreeEventTicket(
        safeEventId,
        ticket.id,
        quantity,
        idempotencyKey('allocate'),
      );
      showToast({
        title: t('tickets.mobile.allocatedTitle'),
        description: t('tickets.mobile.allocatedDescription'),
        variant: 'success',
      });
      await load();
    } catch {
      showToast({
        title: t('tickets.mobile.allocateFailedTitle'),
        description: t('tickets.mobile.allocateFailedDescription'),
        variant: 'danger',
      });
    } finally {
      setAllocatingId(null);
    }
  }

  async function confirmCancellation() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason || reason.length > 500) {
      showToast({
        title: t('tickets.mobile.reasonInvalidTitle'),
        description: t('tickets.mobile.reasonInvalidDescription'),
        variant: 'warning',
      });
      return;
    }

    setIsCancelling(true);
    try {
      await cancelEventTicket(
        safeEventId,
        cancelTarget.id,
        cancelTarget.version,
        reason,
        idempotencyKey('cancel'),
      );
      showToast({
        title: t('tickets.mobile.cancelledTitle'),
        description: t('tickets.mobile.cancelledDescription'),
        variant: 'success',
      });
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch {
      showToast({
        title: t('tickets.mobile.cancelFailedTitle'),
        description: t('tickets.mobile.cancelFailedDescription'),
        variant: 'danger',
      });
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']} style={{ flex: 1 }}>
      <AppTopBar
        title={t('tickets.mobile.title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/events"
      />
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10">
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('tickets.mobile.gatewayDisabledTitle')}</Alert.Title>
            <Alert.Description>{t('tickets.mobile.gatewayDisabledDescription')}</Alert.Description>
          </Alert.Content>
        </Alert>

        {isLoading && !catalogue ? (
          <View className="items-center py-16" accessibilityLabel={t('tickets.mobile.loading')}>
            <Spinner size="lg" />
          </View>
        ) : loadFailed || !catalogue ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('tickets.mobile.loadFailedTitle')}</Alert.Title>
              <Alert.Description>{t('tickets.mobile.loadFailedDescription')}</Alert.Description>
            </Alert.Content>
            <Button size="sm" variant="danger" onPress={() => void load()}>
              {t('common:buttons.retry')}
            </Button>
          </Alert>
        ) : (
          <>
            <View className="gap-3">
              <Text className="text-xl font-semibold" style={{ color: theme.text }}>
                {t('tickets.mobile.myTicketsTitle')}
              </Text>
              {catalogue.own_entitlements.length === 0 ? (
                <Text style={{ color: theme.textMuted }}>{t('tickets.mobile.noTickets')}</Text>
              ) : catalogue.own_entitlements.map((entitlement) => (
                <Card key={entitlement.id}>
                  <Card.Body>
                    <Card.Title>
                      {ticketNames.get(entitlement.ticket_type_id) ?? t('tickets.mobile.ticketFallback')}
                    </Card.Title>
                    <Card.Description>
                      {t('tickets.mobile.entitlementSummary', {
                        count: entitlement.units,
                        status: t(`tickets.status.${entitlement.status}`),
                      })}
                    </Card.Description>
                  </Card.Body>
                  {entitlement.status === 'confirmed' && entitlement.kind === 'free' ? (
                    <Card.Footer>
                      <Button
                        variant="danger"
                        onPress={() => {
                          setCancelTarget(entitlement);
                          setCancelReason('');
                        }}
                      >
                        {t('tickets.mobile.cancelTicket')}
                      </Button>
                    </Card.Footer>
                  ) : entitlement.status === 'confirmed' ? (
                    <Card.Footer>
                      <Text style={{ color: theme.textMuted }}>
                        {t('tickets.mobile.timeCreditCancelDisabled')}
                      </Text>
                    </Card.Footer>
                  ) : null}
                </Card>
              ))}
            </View>

            {cancelTarget ? (
              <Card>
                <Card.Body className="gap-4">
                  <Card.Title>{t('tickets.mobile.cancelTitle')}</Card.Title>
                  <Card.Description>{t('tickets.mobile.cancelDescription')}</Card.Description>
                  <TextField isRequired>
                    <Label>{t('tickets.mobile.reasonLabel')}</Label>
                    <Input
                      testID="event-ticket-cancel-reason"
                      value={cancelReason}
                      onChangeText={setCancelReason}
                      maxLength={500}
                    />
                  </TextField>
                </Card.Body>
                <Card.Footer className="gap-3">
                  <Button
                    variant="secondary"
                    isDisabled={isCancelling}
                    onPress={() => {
                      setCancelTarget(null);
                      setCancelReason('');
                    }}
                  >
                    {t('common:buttons.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    isDisabled={isCancelling}
                    onPress={() => void confirmCancellation()}
                  >
                    {isCancelling ? <Spinner size="sm" /> : t('tickets.mobile.confirmCancellation')}
                  </Button>
                </Card.Footer>
              </Card>
            ) : null}

            <View className="gap-3">
              <Text className="text-xl font-semibold" style={{ color: theme.text }}>
                {t('tickets.mobile.catalogueTitle')}
              </Text>
              {catalogue.ticket_types.length === 0 ? (
                <Text style={{ color: theme.textMuted }}>{t('tickets.mobile.catalogueEmpty')}</Text>
              ) : catalogue.ticket_types.map((ticket) => {
                const maximum = allocatableUnits(ticket);
                const available = canAllocate(catalogue, ticket);
                return (
                  <Card key={ticket.id}>
                    <Card.Body className="gap-3">
                      <Card.Title>{ticket.name}</Card.Title>
                      {ticket.description ? <Card.Description>{ticket.description}</Card.Description> : null}
                      <Text style={{ color: theme.textMuted }}>
                        {ticket.kind === 'free'
                          ? t('tickets.mobile.free')
                          : t('tickets.mobile.timeCreditPrice', { credits: ticket.unit_price_credits })}
                      </Text>
                      <Text style={{ color: theme.textMuted }}>
                        {t('tickets.mobile.remaining', { count: ticket.availability.allocation_remaining })}
                      </Text>
                      {ticket.kind === 'time_credit' ? (
                        <Alert status="warning">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Title>{t('tickets.mobile.timeCreditDisabledTitle')}</Alert.Title>
                            <Alert.Description>{t('tickets.mobile.timeCreditDisabledDescription')}</Alert.Description>
                          </Alert.Content>
                        </Alert>
                      ) : available ? (
                        <TextField isRequired>
                          <Label>{t('tickets.mobile.unitsLabel', { count: maximum })}</Label>
                          <Input
                            testID={`event-ticket-units-${ticket.id}`}
                            value={units[ticket.id] ?? '1'}
                            onChangeText={(value) => setUnits((current) => ({ ...current, [ticket.id]: value }))}
                            keyboardType="number-pad"
                            maxLength={4}
                          />
                        </TextField>
                      ) : (
                        <Text style={{ color: theme.textMuted }}>
                          {!catalogue.permissions.allocate_self
                            ? t('tickets.mobile.registrationRequired')
                            : !ticket.availability.eligibility.eligible
                              ? t('tickets.mobile.notEligible')
                              : !ticket.availability.sales_window_open
                                ? t('tickets.mobile.salesClosed')
                                : t('tickets.mobile.soldOut')}
                        </Text>
                      )}
                    </Card.Body>
                    {ticket.kind === 'free' && available ? (
                      <Card.Footer>
                        <Button
                          isDisabled={allocatingId !== null}
                          onPress={() => void allocate(ticket)}
                        >
                          {allocatingId === ticket.id
                            ? <Spinner size="sm" />
                            : t('tickets.mobile.claimFreeTicket')}
                        </Button>
                      </Card.Footer>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
