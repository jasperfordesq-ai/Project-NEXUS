<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\CommunityEventCreated;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use App\Services\EventNotificationPreferenceResolver;
use App\Services\EventReminderChannelDeliveryService;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use App\Support\UserDisplayName;

/**
 * Notify tenant administrators when a community event is published.
 *
 * Every recipient/channel is represented in the durable Event delivery ledger.
 * A queued-listener retry can therefore resume only incomplete channels without
 * duplicating bells or email that already reached a durable hand-off point.
 */
class NotifyAdminOfNewCommunityEvent implements ShouldQueue
{
    private const NOTIFICATION_TYPE = 'event_created';
    private const EMAIL_CATEGORY = 'admin_new_event';
    private const OUTBOX_ACTION = 'event.admin_publication.created';
    private const DELIVERY_IDENTITY = 'admin-publication-created:v1';

    public int $tries = 5;
    public int $timeout = 60;

    /** @var list<int> */
    public array $backoff = [60, 300, 900, 1800];

    public function __construct(
        private readonly ?EventReminderChannelDeliveryService $channelDeliveries = null,
    ) {
    }

    public function handle(CommunityEventCreated $event): void
    {
        $tenantId = (int) $event->tenantId;
        $communityEvent = $event->event;
        $eventId = (int) ($communityEvent->id ?? 0);
        $previousTenantId = TenantContext::currentId();

        try {
            TenantContext::setById($tenantId);

            if ($eventId <= 0
                || !EventNotificationPreferenceResolver::allowsBackgroundActivity($tenantId, self::NOTIFICATION_TYPE)) {
                return;
            }

            $tenantName = TenantContext::get()['name'] ?? null;
            $baseUrl = TenantContext::getFrontendUrl();
            $basePath = TenantContext::getSlugPrefix();
            $eventUrl = $baseUrl . $basePath . '/events/' . $eventId;
            $eventTitle = $communityEvent->title ?? null;
            $organizerId = (int) ($communityEvent->user_id ?? 0);
            $creatorName = $this->creatorName($tenantId, $organizerId);

            $adminsQuery = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->whereIn('role', ['super_admin', 'admin', 'tenant_admin', 'broker', 'coordinator'])
                ->where('status', 'active')
                ->whereNull('deleted_at');
            if ($organizerId > 0) {
                $adminsQuery->where('id', '<>', $organizerId);
            }

            $admins = $adminsQuery
                ->select(['id', 'tenant_id', 'email', 'first_name', 'name', 'preferred_language'])
                ->get();

            $retryRequired = false;
            foreach ($admins as $admin) {
                try {
                    $statuses = LocaleContext::withLocale(
                        $admin,
                        fn (): array => $this->deliverToAdmin(
                            $admin,
                            $tenantId,
                            $eventId,
                            $eventTitle,
                            $creatorName,
                            $tenantName,
                            $eventUrl,
                        ),
                    );

                    if ($this->hasRetryableChannel($statuses)) {
                        $retryRequired = true;
                    }
                } catch (\Throwable $recipientError) {
                    $retryRequired = true;
                    Log::warning('NotifyAdminOfNewCommunityEvent: recipient fanout failed', [
                        'event_id' => $eventId,
                        'tenant_id' => $tenantId,
                        'admin_id' => (int) $admin->id,
                        'error' => $recipientError->getMessage(),
                    ]);
                }
            }

            if ($retryRequired) {
                throw new RuntimeException('One or more admin event notification channels require retry.');
            }
        } catch (\Throwable $e) {
            Log::error('NotifyAdminOfNewCommunityEvent listener failed', [
                'event_id' => $eventId > 0 ? $eventId : null,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            throw $e;
        } finally {
            TenantContext::restoreAfterScopedListener($previousTenantId);
        }
    }

    private function creatorName(int $tenantId, int $organizerId): ?string
    {
        if ($organizerId <= 0) {
            return null;
        }

        $creator = DB::table('users')
            ->where('id', $organizerId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->select(['first_name', 'last_name', 'profile_type', 'organization_name', 'name'])
            ->first();
        if ($creator === null) {
            return null;
        }

        return UserDisplayName::resolve($creator)
            ?: ($creator->name ?? null);
    }

    /** @return array<string,string> */
    private function deliverToAdmin(
        object $admin,
        int $tenantId,
        int $eventId,
        ?string $eventTitle,
        ?string $creatorName,
        ?string $tenantName,
        string $eventUrl,
    ): array {
        $adminId = (int) $admin->id;
        $localizedTenantName = $tenantName ?: __('emails.common.fallback_tenant_name');
        $localizedEventTitle = $eventTitle ?: __('emails_misc.admin_notify.new_event_fallback_title');
        $localizedCreatorName = $creatorName ?: __('emails.common.fallback_member_name');
        $adminName = $admin->first_name ?? $admin->name ?? __('emails.common.fallback_name');
        $path = '/events/' . $eventId;
        $bellContent = __('emails_misc.admin_notify.new_event_bell', [
            'title' => $localizedEventTitle,
        ]);
        $subject = __('emails_misc.admin_notify.new_event_subject', [
            'community' => $localizedTenantName,
        ]);
        $html = EmailTemplateBuilder::make()
            ->theme('info')
            ->title(__('emails_misc.admin_notify.new_event_title'))
            ->previewText(__('emails_misc.admin_notify.new_event_preview', [
                'community' => $localizedTenantName,
            ]))
            ->greeting($adminName)
            ->paragraph(__('emails_misc.admin_notify.new_event_body', [
                'community' => htmlspecialchars($localizedTenantName, ENT_QUOTES, 'UTF-8'),
            ]))
            ->highlight(htmlspecialchars($localizedEventTitle, ENT_QUOTES, 'UTF-8'))
            ->bulletList([
                __('emails_misc.admin_notify.new_event_by_label') . ': '
                    . htmlspecialchars($localizedCreatorName, ENT_QUOTES, 'UTF-8'),
            ])
            ->button(__('emails_misc.admin_notify.new_event_cta'), $eventUrl)
            ->render();

        $deliveryService = $this->channelDeliveries ?? new EventReminderChannelDeliveryService();
        $deliveries = $deliveryService->ensureChannelsForAction(
            $tenantId,
            $eventId,
            $adminId,
            self::OUTBOX_ACTION,
            self::DELIVERY_IDENTITY,
            ['in_app', 'push', 'email'],
            [
                'schema_version' => 1,
                'notification_type' => self::NOTIFICATION_TYPE,
                'link' => $path,
            ],
        );

        foreach ($deliveries as $channel => $delivery) {
            if ($this->isTerminalDelivery($delivery)) {
                continue;
            }

            if ($channel === 'in_app') {
                $this->deliverInApp($deliveryService, $tenantId, $adminId, $delivery, $bellContent, $path);
            } elseif ($channel === 'push') {
                $this->deliverPush($deliveryService, $tenantId, $adminId, $delivery, $bellContent, $path);
            } elseif ($channel === 'email') {
                $this->deliverEmail(
                    $deliveryService,
                    $tenantId,
                    $eventId,
                    $admin,
                    $delivery,
                    $subject,
                    $html,
                    $bellContent,
                    $path,
                );
            }
        }

        return $deliveryService->statuses($tenantId, $deliveries);
    }

    /** @param array<string,mixed> $delivery */
    private function deliverInApp(
        EventReminderChannelDeliveryService $deliveryService,
        int $tenantId,
        int $adminId,
        array $delivery,
        string $content,
        string $path,
    ): void {
        $claim = $deliveryService->claim($tenantId, (int) $delivery['id']);
        if ($claim === null) {
            return;
        }

        $deliveryId = (int) $claim['id'];
        $claimToken = (string) $claim['claim_token'];

        try {
            DB::transaction(function () use (
                $deliveryService,
                $tenantId,
                $adminId,
                $deliveryId,
                $claimToken,
                $content,
                $path,
            ): void {
                Notification::createNotification(
                    $adminId,
                    $content,
                    $path,
                    self::NOTIFICATION_TYPE,
                );
                if (!$deliveryService->markDelivered(
                    $tenantId,
                    $deliveryId,
                    $claimToken,
                    'database',
                )) {
                    throw new RuntimeException('Admin event bell ledger completion failed.');
                }
            }, 3);
        } catch (\Throwable $e) {
            $deliveryService->markRetrying($tenantId, $deliveryId, $claimToken, $e->getMessage());
            Log::warning('NotifyAdminOfNewCommunityEvent: in-app channel failed', [
                'tenant_id' => $tenantId,
                'admin_id' => $adminId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverPush(
        EventReminderChannelDeliveryService $deliveryService,
        int $tenantId,
        int $adminId,
        array $delivery,
        string $content,
        string $path,
    ): void {
        $claim = $deliveryService->claim($tenantId, (int) $delivery['id']);
        if ($claim === null) {
            return;
        }

        $deliveryId = (int) $claim['id'];
        $claimToken = (string) $claim['claim_token'];

        try {
            NotificationDispatcher::fanOutPush(
                $adminId,
                self::NOTIFICATION_TYPE,
                $content,
                $path,
            );
            if (!$deliveryService->markDelivered(
                $tenantId,
                $deliveryId,
                $claimToken,
                'push_dispatch',
            )) {
                throw new RuntimeException('Admin event push ledger completion failed.');
            }
        } catch (\Throwable $e) {
            $deliveryService->markRetrying($tenantId, $deliveryId, $claimToken, $e->getMessage());
            Log::warning('NotifyAdminOfNewCommunityEvent: push channel failed', [
                'tenant_id' => $tenantId,
                'admin_id' => $adminId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** @param array<string,mixed> $delivery */
    private function deliverEmail(
        EventReminderChannelDeliveryService $deliveryService,
        int $tenantId,
        int $eventId,
        object $admin,
        array $delivery,
        string $subject,
        string $html,
        string $content,
        string $path,
    ): void {
        $deliveryId = (int) $delivery['id'];
        $adminId = (int) $admin->id;

        if (!EventNotificationPreferenceResolver::allowsEmail($adminId, $tenantId)) {
            $deliveryService->markSuppressed(
                $tenantId,
                $deliveryId,
                'Events email disabled by recipient preference',
                EventNotificationPreferenceResolver::EMAIL_PREFERENCE_KEY,
            );
            return;
        }

        $frequency = EventNotificationPreferenceResolver::frequency($adminId, $tenantId);
        if ($frequency === 'off') {
            $deliveryService->markSuppressed(
                $tenantId,
                $deliveryId,
                'Events email cadence is off',
                'frequency',
            );
            return;
        }

        $email = trim((string) ($admin->email ?? ''));
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $deliveryService->markSuppressed(
                $tenantId,
                $deliveryId,
                'Recipient has no valid email address',
            );
            return;
        }

        $claim = $deliveryService->claim($tenantId, $deliveryId);
        if ($claim === null) {
            return;
        }

        $claimToken = (string) $claim['claim_token'];
        $idempotencyKey = (string) $claim['delivery_key'];

        try {
            if ($frequency !== 'instant') {
                DB::transaction(function () use (
                    $deliveryService,
                    $tenantId,
                    $eventId,
                    $adminId,
                    $deliveryId,
                    $claimToken,
                    $idempotencyKey,
                    $frequency,
                    $content,
                    $path,
                    $html,
                ): void {
                    DB::table('notification_queue')->insertOrIgnore([
                        'event_delivery_id' => $deliveryId,
                        'idempotency_key' => $idempotencyKey,
                        'user_id' => $adminId,
                        'tenant_id' => $tenantId,
                        'activity_type' => self::NOTIFICATION_TYPE,
                        'content_snippet' => mb_substr($content, 0, 250),
                        'link' => $path,
                        'frequency' => $frequency,
                        'email_body' => $html,
                        'created_at' => now(),
                        'status' => 'pending',
                    ]);
                    if (!$deliveryService->markDelivered(
                        $tenantId,
                        $deliveryId,
                        $claimToken,
                        'notification_queue',
                    )) {
                        throw new RuntimeException('Admin event email queue ledger completion failed.');
                    }
                }, 3);
                return;
            }

            if ($this->successfulEmailEvidenceExists($tenantId, $adminId, $idempotencyKey)) {
                $deliveryService->markDelivered(
                    $tenantId,
                    $deliveryId,
                    $claimToken,
                    'email_log',
                );
                return;
            }

            $sent = EmailDispatchService::sendRaw(
                $email,
                $subject,
                $html,
                null,
                null,
                EventNotificationPreferenceResolver::unsubscribeUrl($adminId, $tenantId),
                self::EMAIL_CATEGORY,
                [
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'idempotency_key' => $idempotencyKey,
                    'source' => self::class,
                ],
            );
            if (!$sent) {
                throw new RuntimeException('Admin event email provider returned false.');
            }
            if (!$deliveryService->markDelivered(
                $tenantId,
                $deliveryId,
                $claimToken,
                'email',
            )) {
                throw new RuntimeException('Admin event email ledger completion failed.');
            }
        } catch (\Throwable $e) {
            $deliveryService->markRetrying($tenantId, $deliveryId, $claimToken, $e->getMessage());
            Log::warning('NotifyAdminOfNewCommunityEvent: email channel failed', [
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'admin_id' => $adminId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function successfulEmailEvidenceExists(
        int $tenantId,
        int $adminId,
        string $idempotencyKey,
    ): bool {
        if (!Schema::hasTable('email_log') || !Schema::hasColumn('email_log', 'idempotency_key')) {
            return false;
        }

        return DB::table('email_log')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $adminId)
            ->where('category', self::EMAIL_CATEGORY)
            ->where('idempotency_key', $idempotencyKey)
            ->whereIn('status', ['sent', 'delivered'])
            ->exists();
    }

    /** @param array<string,mixed> $delivery */
    private function isTerminalDelivery(array $delivery): bool
    {
        return in_array(
            (string) ($delivery['status'] ?? ''),
            ['delivered', 'suppressed', 'failed_terminal'],
            true,
        );
    }

    /** @param array<string,string> $statuses */
    private function hasRetryableChannel(array $statuses): bool
    {
        foreach ($statuses as $status) {
            if (in_array($status, ['pending', 'retrying', 'claimed', 'direct'], true)) {
                return true;
            }
        }

        return false;
    }
}
