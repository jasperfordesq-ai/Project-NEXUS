<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * FederationEmailService — Email notifications for cross-tenant federation events.
 *
 * Sends notification emails for federated messages, transactions, monthly digests,
 * and partnership requests using rich HTML templates via EmailTemplateBuilder.
 */
class FederationEmailService
{
    public function __construct()
    {
    }

    /**
     * Send a new message notification to a federation recipient.
     */
    public static function sendNewMessageNotification(int $recipientUserId, int $senderUserId, int $senderTenantId, string $messagePreview, ?int $recipientTenantId = null): bool
    {
        try {
            $recipientTenantId ??= TenantContext::getId();
            if (!$recipientTenantId) {
                return false;
            }

            $recipient = self::getUserWithEmail($recipientUserId, $recipientTenantId);
            if (!$recipient || empty($recipient->email)) {
                return false;
            }

            $sender = self::getUserBasicInfo($senderUserId, $senderTenantId);
            $senderTenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$senderTenantId]);

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($recipientTenantId)) {
                Log::warning('[FederationEmail] Recipient tenant not found for message notification', [
                    'recipient' => $recipientUserId,
                    'tenant_id' => $recipientTenantId,
                ]);
                return false;
            }

            $sent = false;
            try {
                LocaleContext::withLocale($recipient, function () use (&$sent, $recipient, $recipientTenantId, $sender, $senderTenant, $messagePreview) {
                $senderName = $sender ? UserDisplayName::resolve($sender) : __('emails.common.fallback_federation_member');
                $tenantName = $senderTenant->name ?? __('emails.common.fallback_partner_community');
                $preview = mb_substr(strip_tags($messagePreview), 0, 200);

                $recipientName = UserDisplayName::resolve($recipient);
                $safeSenderName = htmlspecialchars($senderName, ENT_QUOTES, 'UTF-8');
                $safeTenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');
                $safePreview = htmlspecialchars($preview, ENT_QUOTES, 'UTF-8');

                $subject = __('emails.federation.message_subject', ['sender' => $senderName]);

                $html = EmailTemplateBuilder::make()
                    ->theme('federation')
                    ->title(__('emails.federation.message_title'))
                    ->previewText(__('emails.federation.message_preview', ['sender' => $senderName, 'community' => $tenantName]))
                    ->greeting($recipientName)
                    ->paragraph(__('emails.federation.message_body', ['sender' => $safeSenderName, 'community' => $safeTenantName]))
                    ->infoCard([
                        __('emails.federation.label_from') => $safeSenderName,
                        __('emails.federation.label_community') => $safeTenantName,
                    ])
                    ->blockquote($safePreview)
                    ->button(__('emails.federation.read_reply'), EmailTemplateBuilder::tenantUrl('/messages'))
                    ->render();

                $sent = EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'federation_message', ['tenant_id' => $recipientTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            if (!$sent) {
                Log::warning('[FederationEmail] Message notification email returned false', [
                    'recipient' => $recipientUserId,
                    'sender' => $senderUserId,
                ]);
            } else {
                Log::info('[FederationEmail] Message notification sent', [
                    'recipient' => $recipientUserId,
                    'sender' => $senderUserId,
                ]);
            }

            return $sent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendNewMessageNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send a transaction notification to a recipient.
     */
    public static function sendTransactionNotification(int $recipientUserId, int $senderUserId, int $senderTenantId, float $amount, string $description, ?int $recipientTenantId = null): bool
    {
        try {
            $recipientTenantId ??= TenantContext::getId();
            if (!$recipientTenantId) {
                return false;
            }

            $recipient = self::getUserWithEmail($recipientUserId, $recipientTenantId);
            if (!$recipient || empty($recipient->email)) {
                return false;
            }

            $sender = self::getUserBasicInfo($senderUserId, $senderTenantId);
            $senderTenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$senderTenantId]);

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($recipientTenantId)) {
                Log::warning('[FederationEmail] Recipient tenant not found for transaction notification', [
                    'recipient' => $recipientUserId,
                    'tenant_id' => $recipientTenantId,
                ]);
                return false;
            }
            $sent = false;
            try {
                LocaleContext::withLocale($recipient, function () use (&$sent, $recipient, $recipientTenantId, $sender, $senderTenant, $amount, $description) {
                $senderName = $sender ? UserDisplayName::resolve($sender) : __('emails.common.fallback_federation_member');
                $tenantName = $senderTenant->name ?? __('emails.common.fallback_partner_community');

                $recipientName = UserDisplayName::resolve($recipient);
                $safeSenderName = htmlspecialchars($senderName, ENT_QUOTES, 'UTF-8');
                $safeTenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');
                $safeDescription = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');

                $subject = __('emails.federation.transaction_received_subject', ['amount' => $amount]);

                $html = EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title(__('emails.federation.transaction_received_title'))
                    ->previewText(__('emails.federation.transaction_received_preview', ['amount' => $amount, 'sender' => $senderName]))
                    ->greeting($recipientName)
                    ->paragraph(__('emails.federation.transaction_received_body', ['sender' => $safeSenderName, 'community' => $safeTenantName]))
                    ->infoCard([
                        __('emails.federation.label_from') => "{$safeSenderName} ({$safeTenantName})",
                        __('emails.federation.label_amount') => __('emails.federation.hours', ['amount' => $amount]),
                        __('emails.federation.label_description') => $safeDescription,
                    ])
                    ->button(__('emails.federation.view_wallet'), EmailTemplateBuilder::tenantUrl('/wallet'))
                    ->render();

                $sent = EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'federation_transaction', ['tenant_id' => $recipientTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            if (!$sent) {
                Log::warning('[FederationEmail] Transaction notification email returned false', [
                    'recipient' => $recipientUserId,
                    'sender' => $senderUserId,
                ]);
            }

            return $sent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendTransactionNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send an inbound external partner message notification.
     */
    public static function sendExternalMessageNotification(
        int $recipientUserId,
        int $recipientTenantId,
        string $senderName,
        string $partnerName,
        string $messagePreview
    ): bool {
        try {
            $recipient = self::getUserWithEmail($recipientUserId, $recipientTenantId);
            if (!$recipient || empty($recipient->email)) {
                return false;
            }

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($recipientTenantId)) {
                Log::warning('[FederationEmail] Recipient tenant not found for external message notification', [
                    'recipient' => $recipientUserId,
                    'tenant_id' => $recipientTenantId,
                ]);
                return false;
            }

            $sent = false;
            try {
                LocaleContext::withLocale($recipient, function () use (&$sent, $recipient, $recipientTenantId, $senderName, $partnerName, $messagePreview) {
                    $recipientName = UserDisplayName::resolve($recipient);
                    $preview = mb_substr(strip_tags($messagePreview), 0, 200);
                    $safeSenderName = htmlspecialchars($senderName, ENT_QUOTES, 'UTF-8');
                    $safePartnerName = htmlspecialchars($partnerName, ENT_QUOTES, 'UTF-8');
                    $safePreview = htmlspecialchars($preview, ENT_QUOTES, 'UTF-8');

                    $subject = __('emails.federation.message_subject', ['sender' => $senderName]);

                    $html = EmailTemplateBuilder::make()
                        ->theme('federation')
                        ->title(__('emails.federation.message_title'))
                        ->previewText(__('emails.federation.message_preview', ['sender' => $senderName, 'community' => $partnerName]))
                        ->greeting($recipientName)
                        ->paragraph(__('emails.federation.message_body', ['sender' => $safeSenderName, 'community' => $safePartnerName]))
                        ->infoCard([
                            __('emails.federation.label_from') => $safeSenderName,
                            __('emails.federation.label_community') => $safePartnerName,
                        ])
                        ->blockquote($safePreview)
                        ->button(__('emails.federation.read_reply'), EmailTemplateBuilder::tenantUrl('/federation/messages'))
                        ->render();

                    $sent = EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'federation_message', ['tenant_id' => $recipientTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            return $sent;
        } catch (\Throwable $e) {
            Log::error('[FederationEmail] sendExternalMessageNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send an inbound external partner transaction notification.
     */
    public static function sendExternalTransactionNotification(
        int $recipientUserId,
        int $recipientTenantId,
        string $senderName,
        string $partnerName,
        float $amount,
        string $description
    ): bool {
        try {
            $recipient = self::getUserWithEmail($recipientUserId, $recipientTenantId);
            if (!$recipient || empty($recipient->email)) {
                return false;
            }

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($recipientTenantId)) {
                Log::warning('[FederationEmail] Recipient tenant not found for external transaction notification', [
                    'recipient' => $recipientUserId,
                    'tenant_id' => $recipientTenantId,
                ]);
                return false;
            }

            $sent = false;
            try {
                LocaleContext::withLocale($recipient, function () use (&$sent, $recipient, $recipientTenantId, $senderName, $partnerName, $amount, $description) {
                    $recipientName = UserDisplayName::resolve($recipient);
                    $safeSenderName = htmlspecialchars($senderName, ENT_QUOTES, 'UTF-8');
                    $safePartnerName = htmlspecialchars($partnerName, ENT_QUOTES, 'UTF-8');
                    $safeDescription = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');

                    $subject = __('emails.federation.transaction_received_subject', ['amount' => $amount]);

                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.federation.transaction_received_title'))
                        ->previewText(__('emails.federation.transaction_received_preview', ['amount' => $amount, 'sender' => $senderName]))
                        ->greeting($recipientName)
                        ->paragraph(__('emails.federation.transaction_received_body', ['sender' => $safeSenderName, 'community' => $safePartnerName]))
                        ->infoCard([
                            __('emails.federation.label_from') => "{$safeSenderName} ({$safePartnerName})",
                            __('emails.federation.label_amount') => __('emails.federation.hours', ['amount' => $amount]),
                            __('emails.federation.label_description') => $safeDescription,
                        ])
                        ->button(__('emails.federation.view_wallet'), EmailTemplateBuilder::tenantUrl('/wallet'))
                        ->render();

                    $sent = EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'federation_transaction', ['tenant_id' => $recipientTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            return $sent;
        } catch (\Throwable $e) {
            Log::error('[FederationEmail] sendExternalTransactionNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send an inbound external partner connection notification.
     */
    public static function sendExternalConnectionNotification(
        int $recipientUserId,
        int $recipientTenantId,
        string $externalUserName,
        string $partnerName,
        string $status
    ): bool {
        try {
            $recipient = self::getUserWithEmail($recipientUserId, $recipientTenantId);
            if (!$recipient || empty($recipient->email)) {
                return false;
            }

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($recipientTenantId)) {
                Log::warning('[FederationEmail] Recipient tenant not found for external connection notification', [
                    'recipient' => $recipientUserId,
                    'tenant_id' => $recipientTenantId,
                ]);
                return false;
            }

            $sent = false;
            try {
                LocaleContext::withLocale($recipient, function () use (&$sent, $recipient, $recipientTenantId, $externalUserName, $partnerName, $status) {
                    $recipientName = UserDisplayName::resolve($recipient);
                    $safeExternalUserName = htmlspecialchars($externalUserName, ENT_QUOTES, 'UTF-8');
                    $safePartnerName = htmlspecialchars($partnerName, ENT_QUOTES, 'UTF-8');
                    $isAccepted = $status === 'accepted';

                    $subject = $isAccepted
                        ? __('emails.federation.connection_accepted_subject', ['name' => $externalUserName])
                        : __('emails.federation.connection_request_subject', ['community' => $partnerName]);
                    $title = $isAccepted
                        ? __('emails.federation.connection_accepted_heading')
                        : __('emails.federation.connection_request_heading');
                    $body = $isAccepted
                        ? __('emails.federation.connection_accepted_body', ['name' => $safeExternalUserName, 'community' => $safePartnerName])
                        : __('emails.federation.connection_request_body', ['name' => $safeExternalUserName, 'community' => $safePartnerName]);
                    $preview = $isAccepted
                        ? __('emails.federation.connection_accepted_body', ['name' => $externalUserName, 'community' => $partnerName])
                        : __('emails.federation.connection_request_body', ['name' => $externalUserName, 'community' => $partnerName]);
                    $cta = $isAccepted
                        ? __('emails.federation.connection_accepted_cta')
                        : __('emails.federation.connection_request_cta');

                    $html = EmailTemplateBuilder::make()
                        ->theme('federation')
                        ->title($title)
                        ->previewText($preview)
                        ->greeting($recipientName)
                        ->paragraph($body)
                        ->button($cta, EmailTemplateBuilder::tenantUrl('/network'))
                        ->render();

                    $sent = EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'federation_connection', ['tenant_id' => $recipientTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            return $sent;
        } catch (\Throwable $e) {
            Log::error('[FederationEmail] sendExternalConnectionNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send a transaction confirmation to the sender.
     */
    public static function sendTransactionConfirmation(int $senderUserId, int $recipientUserId, int $recipientTenantId, float $amount, string $description, float $newBalance): bool
    {
        try {
            $senderTenantId = TenantContext::getId();
            if (!$senderTenantId) {
                return false;
            }

            $sender = self::getUserWithEmail($senderUserId, $senderTenantId);
            if (!$sender || empty($sender->email)) {
                return false;
            }

            $recipient = self::getUserBasicInfo($recipientUserId, $recipientTenantId);
            $recipientTenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$recipientTenantId]);

            $sent = false;
            LocaleContext::withLocale($sender, function () use (&$sent, $sender, $senderTenantId, $recipient, $recipientTenant, $amount, $description, $newBalance) {
                $recipientName = $recipient ? UserDisplayName::resolve($recipient) : __('emails.common.fallback_federation_member');
                $tenantName = $recipientTenant->name ?? __('emails.common.fallback_partner_community');

                $senderName = UserDisplayName::resolve($sender);
                $safeRecipientName = htmlspecialchars($recipientName, ENT_QUOTES, 'UTF-8');
                $safeTenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');
                $safeDescription = htmlspecialchars($description, ENT_QUOTES, 'UTF-8');

                $subject = __('emails.federation.transaction_confirmed_subject', ['amount' => $amount]);

                $html = EmailTemplateBuilder::make()
                    ->theme('success')
                    ->title(__('emails.federation.transaction_confirmed_title'))
                    ->previewText(__('emails.federation.transaction_confirmed_preview', ['amount' => $amount, 'recipient' => $recipientName]))
                    ->greeting($senderName)
                    ->paragraph(__('emails.federation.transaction_confirmed_body'))
                    ->infoCard([
                        __('emails.federation.label_to') => "{$safeRecipientName} ({$safeTenantName})",
                        __('emails.federation.label_amount') => __('emails.federation.hours', ['amount' => $amount]),
                        __('emails.federation.label_description') => $safeDescription,
                        __('emails.federation.label_new_balance') => __('emails.federation.hours', ['amount' => $newBalance]),
                    ])
                    ->button(__('emails.federation.view_wallet'), EmailTemplateBuilder::tenantUrl('/wallet'))
                    ->render();

                $sent = EmailDispatchService::sendRaw($sender->email, $subject, $html, null, null, null, 'federation_transaction', ['tenant_id' => $senderTenantId]);
            });

            if (!$sent) {
                Log::warning('[FederationEmail] Transaction confirmation email returned false', [
                    'sender' => $senderUserId,
                    'recipient' => $recipientUserId,
                ]);
            }

            return $sent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendTransactionConfirmation failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send a weekly federation digest to a user.
     */
    public static function sendWeeklyDigest(int $userId, int $tenantId): bool
    {
        $previousTenantId = TenantContext::currentId();

        try {
            $user = self::getUserWithEmail($userId, $tenantId);
            if (!$user || empty($user->email)) {
                return false;
            }

            // Must set tenant context before any tenant-specific call (mailer, URLs, branding).
            // Without this, whatever tenant was last active bleeds into this email.
            if (!TenantContext::setById($tenantId)) {
                Log::warning('[FederationEmail] Tenant not found for weekly digest', [
                    'user' => $userId,
                    'tenant_id' => $tenantId,
                ]);
                return false;
            }

            $tenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$tenantId]);
            $tenantName = $tenant->name ?? __('emails.common.fallback_tenant_name');

            // Gather stats for the month
            $messageCount = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM federation_messages
                 WHERE (sender_tenant_id = ? OR receiver_tenant_id = ?)
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
                [$tenantId, $tenantId]
            )->cnt ?? 0);

            $transactionCount = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM federation_transactions
                 WHERE (sender_tenant_id = ? OR receiver_tenant_id = ?)
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
                [$tenantId, $tenantId]
            )->cnt ?? 0);

            $connectionCount = (int) (DB::selectOne(
                "SELECT COUNT(*) as cnt FROM federation_connections
                 WHERE (requester_tenant_id = ? OR receiver_tenant_id = ?)
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
                [$tenantId, $tenantId]
            )->cnt ?? 0);

            if ($messageCount === 0 && $transactionCount === 0 && $connectionCount === 0) {
                return false;
            }

            $sent = false;
            LocaleContext::withLocale($user, function () use (&$sent, $user, $tenantId, $tenantName, $messageCount, $transactionCount, $connectionCount) {
                $userName = UserDisplayName::resolve($user);

                $subject = __('emails.federation.digest_subject', ['community' => $tenantName]);

                $builder = EmailTemplateBuilder::make()
                    ->theme('federation')
                    ->title(__('emails.federation.digest_title'))
                    ->previewText(__('emails.federation.digest_preview', ['community' => $tenantName]))
                    ->greeting($userName)
                    ->paragraph(__('emails.federation.digest_body'))
                    ->statCards([
                        ['value' => (string) $messageCount, 'label' => __('emails.federation.label_messages'), 'icon' => "\xF0\x9F\x92\xAC"],
                        ['value' => (string) $transactionCount, 'label' => __('emails.federation.label_transactions'), 'icon' => "\xF0\x9F\x92\xB0"],
                        ['value' => (string) $connectionCount, 'label' => __('emails.federation.label_connections'), 'icon' => "\xF0\x9F\xA4\x9D"],
                    ]);

                $html = $builder
                    ->button(__('emails.federation.explore_federation'), EmailTemplateBuilder::tenantUrl('/federation'))
                    ->render();

                $sent = EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'federation_digest', ['tenant_id' => $tenantId]);
            });

            if (!$sent) {
                Log::warning('[FederationEmail] Monthly digest email returned false', [
                    'user' => $userId,
                    'tenant' => $tenantId,
                ]);
            }

            return $sent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendWeeklyDigest failed', ['error' => $e->getMessage()]);
            return false;
        } finally {
            self::restorePreviousTenant($previousTenantId);
        }
    }

    /**
     * Send a partnership request notification to the admin(s) of the target tenant.
     */
    public static function sendPartnershipRequestNotification(int $targetTenantId, int $requestingTenantId, string $requestingTenantName, int $requestedLevel, ?string $notes = null): bool
    {
        try {
            // Get admin users for target tenant — include preferred_language so each admin's
            // notification renders in their own locale rather than whoever's last touched
            // the app locale.
            $admins = DB::select(
                "SELECT id, email, first_name, last_name, preferred_language FROM users
                 WHERE tenant_id = ? AND role IN ('admin', 'super_admin') AND status = 'active' AND email IS NOT NULL
                 LIMIT 5",
                [$targetTenantId]
            );

            if (empty($admins)) {
                Log::warning('[FederationEmail] No admins found for partnership notification', [
                    'target_tenant' => $targetTenantId,
                ]);
                return false;
            }

            $safeRequestingName = htmlspecialchars($requestingTenantName, ENT_QUOTES, 'UTF-8');
            $previousTenantId = TenantContext::currentId();

            if (!TenantContext::setById($targetTenantId)) {
                return false;
            }

            $allSent = true;
            try {
                foreach ($admins as $admin) {
                    // Level names and fallbacks must render per-admin so they pick up the admin's locale.
                    LocaleContext::withLocale($admin, function () use (&$allSent, $admin, $targetTenantId, $requestingTenantName, $safeRequestingName, $requestedLevel, $notes) {
                        $levelNames = [
                            1 => __('emails.federation.level_discovery'),
                            2 => __('emails.federation.level_social'),
                            3 => __('emails.federation.level_economic'),
                            4 => __('emails.federation.level_integrated'),
                        ];
                        $levelName = $levelNames[$requestedLevel] ?? __('emails.common.fallback_federation_level', ['level' => $requestedLevel]);

                        $adminName = UserDisplayName::resolve($admin);

                        $subject = __('emails.federation.partnership_subject', ['community' => $requestingTenantName]);

                        $builder = EmailTemplateBuilder::make()
                            ->theme('federation')
                            ->title(__('emails.federation.partnership_title'))
                            ->previewText(__('emails.federation.partnership_preview', ['community' => $requestingTenantName]))
                            ->greeting($adminName)
                            ->paragraph(__('emails.federation.partnership_body', ['community' => $safeRequestingName]))
                            // infoCard/blockquote escape at render time —
                            // pre-escaping double-encodes names like St. Mary's.
                            ->infoCard([
                                __('emails.federation.label_from_community') => $requestingTenantName,
                                __('emails.federation.label_requested_level') => $levelName,
                            ]);

                        if ($notes !== null && $notes !== '') {
                            $builder->blockquote($notes, $requestingTenantName);
                        }

                        $html = $builder
                            ->button(__('emails.federation.review_request'), EmailTemplateBuilder::tenantUrl('/admin/federation'))
                            ->render();

                        if (!EmailDispatchService::sendRaw($admin->email, $subject, $html, null, null, null, 'federation_partnership', ['tenant_id' => $targetTenantId])) {
                            $allSent = false;
                            Log::warning('[FederationEmail] Partnership notification email returned false', [
                                'admin' => $admin->id ?? null,
                            ]);
                        }
                    });
                }
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            Log::info('[FederationEmail] Partnership notification sent', [
                'target_tenant' => $targetTenantId,
                'requesting_tenant' => $requestingTenantId,
                'admins_notified' => count($admins),
            ]);

            return $allSent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendPartnershipRequestNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send a connection request notification to the recipient.
     */
    public static function sendConnectionRequestNotification(int $recipientUserId, int $senderUserId, int $senderTenantId, ?int $recipientTenantId = null): bool
    {
        try {
            $recipientTenantId ??= TenantContext::getId();
            if (!$recipientTenantId) {
                return false;
            }

            $recipient = self::getUserWithEmail($recipientUserId, $recipientTenantId);
            if (!$recipient || empty($recipient->email)) {
                return false;
            }

            $sender = self::getUserBasicInfo($senderUserId, $senderTenantId);
            $senderTenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$senderTenantId]);

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($recipientTenantId)) {
                Log::warning('[FederationEmail] Recipient tenant not found for connection request notification', [
                    'recipient' => $recipientUserId,
                    'tenant_id' => $recipientTenantId,
                ]);
                return false;
            }
            $sent = false;
            try {
                LocaleContext::withLocale($recipient, function () use (&$sent, $recipient, $recipientTenantId, $sender, $senderTenant, $senderUserId) {
                $senderName = $sender ? UserDisplayName::resolve($sender) : __('emails.common.fallback_federation_member');
                $tenantName = $senderTenant->name ?? __('emails.common.fallback_partner_community');

                $recipientName = UserDisplayName::resolve($recipient);
                $safeSenderName = htmlspecialchars($senderName, ENT_QUOTES, 'UTF-8');
                $safeTenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');

                $subject = __('emails.federation.connection_request_subject', ['community' => $tenantName]);

                $html = EmailTemplateBuilder::make()
                    ->theme('federation')
                    ->title(__('emails.federation.connection_request_heading'))
                    ->previewText(__('emails.federation.connection_request_body', ['name' => $senderName, 'community' => $tenantName]))
                    ->greeting($recipientName)
                    ->paragraph(__('emails.federation.connection_request_body', ['name' => $safeSenderName, 'community' => $safeTenantName]))
                    ->button(__('emails.federation.connection_request_cta'), EmailTemplateBuilder::tenantUrl('/profile/' . $senderUserId))
                    ->render();

                $sent = EmailDispatchService::sendRaw($recipient->email, $subject, $html, null, null, null, 'federation_connection', ['tenant_id' => $recipientTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            if (!$sent) {
                Log::warning('[FederationEmail] Connection request notification email returned false', [
                    'recipient' => $recipientUserId,
                    'sender' => $senderUserId,
                    'sender_tenant' => $senderTenantId,
                ]);
            } else {
                Log::info('[FederationEmail] Connection request notification sent', [
                    'recipient' => $recipientUserId,
                    'sender' => $senderUserId,
                    'sender_tenant' => $senderTenantId,
                ]);
            }

            return $sent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendConnectionRequestNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Send a connection accepted notification to the original sender.
     */
    public static function sendConnectionAcceptedNotification(int $senderUserId, int $recipientUserId, int $recipientTenantId, ?int $senderTenantId = null): bool
    {
        try {
            $senderTenantId ??= TenantContext::getId();
            if (!$senderTenantId) {
                return false;
            }

            $sender = self::getUserWithEmail($senderUserId, $senderTenantId);
            if (!$sender || empty($sender->email)) {
                return false;
            }

            $recipient = self::getUserBasicInfo($recipientUserId, $recipientTenantId);
            $recipientTenant = DB::selectOne("SELECT name FROM tenants WHERE id = ?", [$recipientTenantId]);

            $previousTenantId = TenantContext::currentId();
            if (!TenantContext::setById($senderTenantId)) {
                Log::warning('[FederationEmail] Sender tenant not found for connection accepted notification', [
                    'sender' => $senderUserId,
                    'tenant_id' => $senderTenantId,
                ]);
                return false;
            }
            $sent = false;
            try {
                LocaleContext::withLocale($sender, function () use (&$sent, $sender, $senderTenantId, $recipient, $recipientTenant, $recipientUserId) {
                $recipientName = $recipient ? UserDisplayName::resolve($recipient) : __('emails.common.fallback_federation_member');
                $tenantName = $recipientTenant->name ?? __('emails.common.fallback_partner_community');

                $senderName = UserDisplayName::resolve($sender);
                $safeRecipientName = htmlspecialchars($recipientName, ENT_QUOTES, 'UTF-8');
                $safeTenantName = htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8');

                $subject = __('emails.federation.connection_accepted_subject', ['name' => $recipientName]);

                $html = EmailTemplateBuilder::make()
                    ->theme('federation')
                    ->title(__('emails.federation.connection_accepted_heading'))
                    ->previewText(__('emails.federation.connection_accepted_body', ['name' => $recipientName, 'community' => $tenantName]))
                    ->greeting($senderName)
                    ->paragraph(__('emails.federation.connection_accepted_body', ['name' => $safeRecipientName, 'community' => $safeTenantName]))
                    ->button(__('emails.federation.connection_accepted_cta'), EmailTemplateBuilder::tenantUrl('/profile/' . $recipientUserId))
                    ->render();

                $sent = EmailDispatchService::sendRaw($sender->email, $subject, $html, null, null, null, 'federation_connection', ['tenant_id' => $senderTenantId]);
                });
            } finally {
                self::restorePreviousTenant($previousTenantId);
            }

            if (!$sent) {
                Log::warning('[FederationEmail] Connection accepted notification email returned false', [
                    'sender' => $senderUserId,
                    'recipient' => $recipientUserId,
                    'recipient_tenant' => $recipientTenantId,
                ]);
            } else {
                Log::info('[FederationEmail] Connection accepted notification sent', [
                    'sender' => $senderUserId,
                    'recipient' => $recipientUserId,
                    'recipient_tenant' => $recipientTenantId,
                ]);
            }

            return $sent;
        } catch (\Exception $e) {
            Log::error('[FederationEmail] sendConnectionAcceptedNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get user with email for notifications.
     */
    private static function getUserWithEmail(int $userId, int $tenantId): ?object
    {
        return DB::selectOne(
            "SELECT u.id, u.email, u.first_name, u.last_name, u.preferred_language,
                    u.federation_notifications_enabled, fus.email_notifications
             FROM users u
             LEFT JOIN federation_user_settings fus ON fus.user_id = u.id
             WHERE u.id = ? AND u.tenant_id = ? AND u.email IS NOT NULL
               AND COALESCE(u.federation_notifications_enabled, 1) = 1
               AND COALESCE(fus.email_notifications, 1) = 1",
            [$userId, $tenantId]
        );
    }

    /**
     * Get basic user info for display in emails.
     */
    private static function getUserBasicInfo(int $userId, int $tenantId): ?object
    {
        return DB::selectOne(
            "SELECT id, first_name, last_name FROM users WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
    }

    private static function restorePreviousTenant(?int $previousTenantId): void
    {
        try {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
                return;
            }
        } catch (\Throwable $e) {
            Log::debug('[FederationEmail] Previous tenant restore failed; resetting context', [
                'previous_tenant_id' => $previousTenantId,
                'error' => $e->getMessage(),
            ]);
        }

        TenantContext::reset();
    }
}
