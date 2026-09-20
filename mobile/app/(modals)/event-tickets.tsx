// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Input, Label, Spinner, TextField,  } from 'heroui-native';
import { Button } from '@/components/ui/NativeButton';

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
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { describeApiError } from '@/lib/api/describeApiError';
import { refusalStatus } from '@/lib/api/refusal';
import { ApiResponseError } from '@/lib/api/client';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { withRouteGate } from '@/components/withRouteGate';
import { EventTicketOperationChangedError, reserveEventTicketOperation, completeEventTicketOperation, getPendingEventTicketOperation, eventTicketRequest, type EventTicketOperation } from '@/lib/eventTicketOperation';

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

function EventTicketsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${id ?? 'invalid'}`}>
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
  const [refusedStatus, setRefusedStatus] = useState<number | null>(null);
  const [units, setUnits] = useState<Record<number, string>>({});
  const [allocatingId, setAllocatingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MobileEventTicketEntitlement | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<EventTicketOperation | null>(null);
  const actionPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const loadVersionRef = useRef(0);

  async function recordFirstRefusal(error: unknown, operation: EventTicketOperation | null) {
    // A refusal of a NEW request proves no mutation. A refusal after an unknown
    // earlier attempt does not, so its original retry record must remain intact.
    if (operation?.newlyCreated && error instanceof ApiResponseError
      && [403, 404, 409, 422].includes(error.status)
      && ['EVENT_TICKET_FORBIDDEN', 'EVENT_TICKET_NOT_FOUND', 'EVENT_TICKET_CONFLICT', 'EVENT_TICKET_VALIDATION_FAILED'].includes(error.code ?? '')) {
      await completeEventTicketOperation(operation);
      if (mountedRef.current) setPendingOperation(null);
    }
  }


  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadVersionRef.current += 1;
    };
  }, []);

  const ticketNames = useMemo(() => new Map(
    (catalogue?.ticket_types ?? []).map((ticket) => [ticket.id, ticket.name]),
  ), [catalogue]);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    const version = ++loadVersionRef.current;
    if (safeEventId <= 0) {
      setCatalogue(null);
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadFailed(false);
    setRefusedStatus(null);
    try {
      const [pending, catalogueResult] = await Promise.allSettled([
        getPendingEventTicketOperation(safeEventId),
        getEventTickets(safeEventId),
      ]);
      if (!mountedRef.current || version !== loadVersionRef.current) return;
      if (pending.status === 'rejected') throw pending.reason;
      setPendingOperation(pending.value);
      if (catalogueResult.status === 'rejected') throw catalogueResult.reason;
      const result = catalogueResult.value;
      setCatalogue(result);
      setUnits((current) => {
        const next = { ...current };
        result.ticket_types.forEach((ticket) => {
          if (!next[ticket.id]) next[ticket.id] = '1';
        });
        return next;
      });
    } catch (error) {
      if (!mountedRef.current || version !== loadVersionRef.current) return;
      setRefusedStatus(error instanceof ApiResponseError
        && error.status === 422 && error.code === 'EVENT_TICKET_VALIDATION_FAILED'
        ? 422 : refusalStatus(error));
      setLoadFailed(true);
    } finally {
      if (mountedRef.current && version === loadVersionRef.current) setIsLoading(false);
    }
  }, [safeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function allocate(ticket: MobileEventTicketType) {
    if (!mountedRef.current || actionPendingRef.current || pendingOperation || isLoading || !catalogue || !canAllocate(catalogue, ticket)) return;
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

    actionPendingRef.current = true;
    setAllocatingId(ticket.id);
    const request = JSON.stringify(['allocate', safeEventId, ticket.id, quantity]);
    let operation: EventTicketOperation | null = null;
    try {
      operation = await reserveEventTicketOperation(request);
      if (!mountedRef.current) return;
      setPendingOperation(operation);
      await allocateFreeEventTicket(
        safeEventId,
        ticket.id,
        quantity,
        operation.key,
      );
      await completeEventTicketOperation(operation);
      if (!mountedRef.current) return;
      setPendingOperation(null);
      showToast({
        title: t('tickets.mobile.allocatedTitle'),
        description: t('tickets.mobile.allocatedDescription'),
        variant: 'success',
      });
      await load();
    } catch (err) {
      await recordFirstRefusal(err, operation);
      if (!mountedRef.current) return;
      showToast({
        title: t('tickets.mobile.allocateFailedTitle'),
        description: describeApiError(err, t('tickets.mobile.allocateFailedDescription')),
        variant: 'danger',
      });
    } finally {
      actionPendingRef.current = false;
      if (mountedRef.current) setAllocatingId(null);
    }
  }

  async function confirmCancellation() {
    if (!mountedRef.current || actionPendingRef.current || pendingOperation || isLoading || !cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason || reason.length > 500) {
      showToast({
        title: t('tickets.mobile.reasonInvalidTitle'),
        description: t('tickets.mobile.reasonInvalidDescription'),
        variant: 'warning',
      });
      return;
    }

    actionPendingRef.current = true;
    setIsCancelling(true);
    const request = JSON.stringify(['cancel', safeEventId, cancelTarget.id, cancelTarget.version, reason]);
    let operation: EventTicketOperation | null = null;
    try {
      operation = await reserveEventTicketOperation(request);
      if (!mountedRef.current) return;
      setPendingOperation(operation);
      await cancelEventTicket(
        safeEventId,
        cancelTarget.id,
        cancelTarget.version,
        reason,
        operation.key,
      );
      await completeEventTicketOperation(operation);
      if (!mountedRef.current) return;
      setPendingOperation(null);
      showToast({
        title: t('tickets.mobile.cancelledTitle'),
        description: t('tickets.mobile.cancelledDescription'),
        variant: 'success',
      });
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch (err) {
      await recordFirstRefusal(err, operation);
      if (!mountedRef.current) return;
      showToast({
        title: t('tickets.mobile.cancelFailedTitle'),
        description: describeApiError(err, t('tickets.mobile.cancelFailedDescription')),
        variant: 'danger',
      });
    } finally {
      actionPendingRef.current = false;
      if (mountedRef.current) setIsCancelling(false);
    }
  }

  async function retryPendingOperation() {
    if (!pendingOperation || actionPendingRef.current || !mountedRef.current) return;
    actionPendingRef.current = true;
    const request = eventTicketRequest(pendingOperation.intent);
    if (request[0] === 'allocate') setAllocatingId(request[2]);
    else setIsCancelling(true);
    try {
      const operation = await reserveEventTicketOperation(pendingOperation.intent, pendingOperation.key);
      if (!mountedRef.current) return;
      if (request[0] === 'allocate') {
        await allocateFreeEventTicket(request[1], request[2], request[3], operation.key);
      } else {
        await cancelEventTicket(request[1], request[2], request[3], request[4], operation.key);
      }
      await completeEventTicketOperation(operation);
      if (!mountedRef.current) return;
      setPendingOperation(null);
      setCancelTarget(null);
      setCancelReason('');
      showToast({ title: t(request[0] === 'allocate' ? 'tickets.mobile.allocatedTitle' : 'tickets.mobile.cancelledTitle'), variant: 'success' });
      await load();
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof EventTicketOperationChangedError) {
        await load();
        return;
      }
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(error, t('tickets.mobile.pendingDescription')), variant: 'danger' });
    } finally {
      actionPendingRef.current = false;
      if (mountedRef.current) {
        setAllocatingId(null);
        setIsCancelling(false);
      }
    }
  }

  const pendingRequest = pendingOperation ? eventTicketRequest(pendingOperation.intent) : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']} style={{ flex: 1 }}>
      <AppTopBar
        title={t('tickets.mobile.title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/events"
      />
      <ScrollView
        // iOS only: without it the keyboard covers the fields below. Android is already
        // covered by the manifest's windowSoftInputMode="adjustResize". Audit 2026-09-09.
        automaticallyAdjustKeyboardInsets contentContainerClassName="gap-4 px-4 pb-10">
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('tickets.mobile.gatewayDisabledTitle')}</Alert.Title>
            <Alert.Description>{t('tickets.mobile.gatewayDisabledDescription')}</Alert.Description>
          </Alert.Content>
        </Alert>

        {pendingRequest ? (
          <Card testID="event-ticket-pending">
            <Card.Body>
              <Card.Title>{t('tickets.mobile.pendingTitle')}</Card.Title>
              <Card.Description>{t('tickets.mobile.pendingDescription')}</Card.Description>
              <Text style={{ color: theme.text }}>
                {t(pendingRequest[0] === 'allocate' ? 'tickets.mobile.ticketFallback' : 'tickets.mobile.cancelTitle')}
              </Text>
              <Text style={{ color: theme.text }}>
                {pendingRequest[0] === 'allocate'
                  ? t('tickets.mobile.entitlementSummary', { count: pendingRequest[3], status: t('tickets.mobile.pendingTitle') })
                  : pendingRequest[4]}
              </Text>
            </Card.Body>
            <Card.Footer>
              <Button testID="event-ticket-retry-pending" isDisabled={allocatingId !== null || isCancelling}
                accessibilityState={{ busy: allocatingId !== null || isCancelling }} onPress={() => void retryPendingOperation()}>
                <Button.Label>{t('common:buttons.retry')}</Button.Label>
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        {isLoading && !catalogue ? (
          <View className="items-center py-16" accessibilityLabel={t('tickets.mobile.loading')}>
            <Spinner size="lg" />
          </View>
        ) : refusedStatus !== null ? (
          <EmptyState
            icon="lock-closed-outline"
            title={t(refusedStatus === 422 ? 'tickets.mobile.unavailableTitle' : 'common:errors.notAvailableTitle')}
            subtitle={t(refusedStatus === 422 ? 'tickets.mobile.unavailableDescription' : 'common:errors.notAvailableHint')}
            testID="event-tickets-refused"
          />
        ) : loadFailed || !catalogue ? (
          <ErrorState
            title={t('tickets.mobile.loadFailedTitle')}
            subtitle={t('tickets.mobile.loadFailedDescription')}
            onRetry={() => void load()}
            isRetrying={isLoading}
          />
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
                    isDisabled={isCancelling || allocatingId !== null}
                    onPress={() => {
                      setCancelTarget(null);
                      setCancelReason('');
                    }}
                  >
                    {t('common:buttons.cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    isDisabled={isCancelling || allocatingId !== null || pendingOperation !== null || isLoading}
                    onPress={() => void confirmCancellation()}
                    accessibilityState={{ busy: isCancelling }}
                  >
                    {isCancelling ? <Spinner size="sm" /> : null}
                    <Button.Label>{t('tickets.mobile.confirmCancellation')}</Button.Label>
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
                          isDisabled={allocatingId !== null || isCancelling || pendingOperation !== null || isLoading}
                          onPress={() => void allocate(ticket)}
                          accessibilityState={{ busy: allocatingId === ticket.id }}
                        >
                          {allocatingId === ticket.id ? <Spinner size="sm" /> : null}
                          <Button.Label>{t('tickets.mobile.claimFreeTicket')}</Button.Label>
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

export default withRouteGate(EventTicketsScreen, 'event-tickets');
