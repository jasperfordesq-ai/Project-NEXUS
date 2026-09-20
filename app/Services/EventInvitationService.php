<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventInvitationCampaignStatus;
use App\Enums\EventInvitationCampaignType;
use App\Enums\EventInvitationStatus;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventRegistrationFoundationException;
use App\Exceptions\EventWaitlistException;
use App\Models\EventInvitation;
use App\Models\EventInvitationCampaign;
use App\Models\EventRegistration;
use App\Models\EventWaitlistEntry;
use App\Models\User;
use App\Support\Events\EventInvitationRecipientAuthorizer;
use App\Support\Events\EventInvitationRecipientExpander;
use App\Support\Events\EventRegistrationFoundationSupport;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use stdClass;

/** One-shot invitation issuance, delivery, revocation, expiry, and capacity-safe acceptance. */
final class EventInvitationService
{
    private readonly EventRegistrationService $registrations;
    private readonly EventWaitlistService $waitlist;
    private readonly EventInvitationDeliveryService $delivery;
    private readonly EventInvitationRecipientAuthorizer $recipientAuthorizer;

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventInvitationRecipientExpander $expander = new EventInvitationRecipientExpander(),
        private readonly ?EventParticipationEligibilityService $eligibility = null,
        ?EventRegistrationService $registrations = null,
        ?EventWaitlistService $waitlist = null,
        ?EventInvitationDeliveryService $delivery = null,
        ?EventInvitationRecipientAuthorizer $recipientAuthorizer = null,
    ) {
        $this->registrations = $registrations ?? app(EventRegistrationService::class);
        $this->waitlist = $waitlist ?? app(EventWaitlistService::class);
        $this->delivery = $delivery ?? app(EventInvitationDeliveryService::class);
        $this->recipientAuthorizer = $recipientAuthorizer ?? new EventInvitationRecipientAuthorizer();
    }

    /**
     * Issue the immutable target snapshot created at preview time. `$source` is
     * accepted only for backwards call compatibility and is never re-expanded.
     *
     * @param array<string,mixed> $source
     * @return array{
     *   campaign:EventInvitationCampaign,
     *   changed:bool,
     *   invitations:list<array{invitation:EventInvitation,secret:?string}>
     * }
     */
    public function issueCampaign(
        int $eventId,
        int $campaignId,
        User|int $actor,
        array $source,
        int $expectedRevision,
        string $idempotencyKey,
        DateTimeInterface|string $expiresAt,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $baseKeyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $campaignId,
            $actor,
            $source,
            $expectedRevision,
            $baseKeyHash,
            $expiresAt,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $campaign = $this->campaign($tenantId, $eventId, $campaignId, true);
            $type = EventInvitationCampaignType::from((string) $campaign->campaign_type);
            if (! is_string($campaign->source_snapshot_ciphertext ?? null)
                || trim((string) $campaign->source_snapshot_ciphertext) === '') {
                throw new EventRegistrationFoundationException('event_invitation_campaign_snapshot_unavailable');
            }
            $expanded = $this->expander->restoreSnapshot(
                (string) $campaign->source_snapshot_ciphertext,
                $type,
            );
            if (! hash_equals((string) $campaign->source_hash, $expanded['source_hash'])
                || (int) $campaign->preview_count !== $expanded['preview_count']
                || (int) $campaign->valid_count !== count($expanded['recipients'])
                || (int) $campaign->error_count !== count($expanded['errors'])) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_preview_stale');
            }
            if ($expanded['recipients'] === []) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_has_no_recipients');
            }
            $timezone = $this->support->eventTimezone($event);
            $expiry = $this->support->inputInstant(
                $expiresAt,
                $timezone,
                'event_invitation_expiry_invalid',
            );
            $now = CarbonImmutable::now('UTC');
            if ($expiry === null) {
                throw new EventRegistrationFoundationException('event_invitation_expiry_invalid');
            }

            $prepared = [];
            foreach ($expanded['recipients'] as $recipient) {
                $targetKey = $recipient['type'] === 'member'
                    ? 'member:' . $recipient['member_id']
                    : 'email:' . $this->support->emailBlindHash($tenantId, (string) $recipient['email']);
                $issueHash = hash('sha256', $baseKeyHash . '|' . $campaignId . '|' . $targetKey);
                $requestHash = $this->support->requestHash([
                    'action' => 'invitation_issued',
                    'event_id' => $eventId,
                    'campaign_id' => $campaignId,
                    'actor_id' => (int) $persistedActor->id,
                    'expected_revision' => $expectedRevision,
                    'target_key' => $targetKey,
                    'expires_at' => $expiry,
                ]);
                $prepared[] = [
                    'recipient' => $recipient,
                    'target_key' => $targetKey,
                    'issue_hash' => $issueHash,
                    'request_hash' => $requestHash,
                ];
            }

            if ((string) $campaign->status === EventInvitationCampaignStatus::Issued->value) {
                $results = [];
                foreach ($prepared as $item) {
                    $existing = DB::table('event_invitations')
                        ->where('tenant_id', $tenantId)
                        ->where('event_id', $eventId)
                        ->where('campaign_id', $campaignId)
                        ->where('issue_idempotency_hash', $item['issue_hash'])
                        ->first();
                    if ($existing === null
                        || ! hash_equals((string) $existing->issue_request_hash, $item['request_hash'])) {
                        throw new EventRegistrationFoundationException('event_invitation_issue_idempotency_conflict');
                    }
                    $results[] = [
                        'invitation' => $this->invitationModel($tenantId, $eventId, (int) $existing->id),
                        'secret' => null,
                    ];
                }

                return [
                    'campaign' => $this->campaignModel($tenantId, $campaignId),
                    'changed' => false,
                    'invitations' => $results,
                ];
            }
            // An exact replay only returns the saved result. Time-window changes must
            // prevent new issuance, not obscure a successful earlier request.
            if (! $expiry->greaterThan($now)
                || $expiry->greaterThan($this->support->eventStart($event))) {
                throw new EventRegistrationFoundationException('event_invitation_expiry_invalid');
            }
            $this->expander->assertSnapshotSourceAuthority(
                $tenantId,
                $type,
                $expanded['snapshot'],
                $persistedActor,
            );
            $this->recipientAuthorizer->assertEligibleForIssue(
                $tenantId,
                $event,
                $persistedActor,
                $expanded['recipients'],
            );
            $campaignStatus = (string) $campaign->status;
            if (! in_array($campaignStatus, [
                EventInvitationCampaignStatus::Previewed->value,
                EventInvitationCampaignStatus::Scheduled->value,
            ], true) || (int) $campaign->revision !== $expectedRevision) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            if ($campaignStatus === EventInvitationCampaignStatus::Scheduled->value
                && ($campaign->scheduled_for_utc === null
                    || CarbonImmutable::parse((string) $campaign->scheduled_for_utc, 'UTC')->greaterThan($now))) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_not_due');
            }

            $issuingRevision = $expectedRevision + 1;
            $issuingKeyHash = hash('sha256', $baseKeyHash . '|campaign|issuing');
            $issuingRequestHash = $this->support->requestHash([
                'action' => EventInvitationCampaignStatus::Issuing->value,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'actor_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'source_hash' => $expanded['source_hash'],
                'expires_at' => $expiry,
            ]);
            if (DB::table('event_invitation_campaigns')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $campaignId)
                ->whereIn('status', [
                    EventInvitationCampaignStatus::Previewed->value,
                    EventInvitationCampaignStatus::Scheduled->value,
                ])
                ->where('revision', $expectedRevision)
                ->update([
                    'status' => EventInvitationCampaignStatus::Issuing->value,
                    'revision' => $issuingRevision,
                    'started_at' => $now,
                    'updated_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            DB::table('event_invitation_campaign_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'revision' => $issuingRevision,
                'action' => EventInvitationCampaignStatus::Issuing->value,
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $issuingKeyHash,
                'request_hash' => $issuingRequestHash,
                'metadata' => json_encode([
                    'valid_count' => count($expanded['recipients']),
                    'expires_at' => $expiry->format('Y-m-d\TH:i:s.u\Z'),
                ], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            $results = [];
            foreach ($prepared as $item) {
                $recipient = $item['recipient'];
                $token = $this->support->token();
                $tokenHash = $this->support->tokenHash($tenantId, $eventId, $token);
                $email = $recipient['email'];
                $invitationId = (int) DB::table('event_invitations')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'campaign_id' => $campaignId,
                    'target_type' => $recipient['type'],
                    'member_user_id' => $recipient['member_id'],
                    'email_ciphertext' => $email === null
                        ? null
                        : $this->support->encrypt((string) $email),
                    'email_blind_hash' => $email === null
                        ? null
                        : $this->support->emailBlindHash($tenantId, (string) $email),
                    'status' => EventInvitationStatus::Issued->value,
                    'invitation_version' => 1,
                    'token_hash' => $tokenHash,
                    'token_fingerprint' => substr($tokenHash, 0, 16),
                    'token_expires_at' => $expiry,
                    'token_used_at' => null,
                    'accepted_by_user_id' => null,
                    'accepted_at' => null,
                    'revoked_at' => null,
                    'expired_at' => null,
                    'issue_idempotency_hash' => $item['issue_hash'],
                    'issue_request_hash' => $item['request_hash'],
                    'created_by' => (int) $persistedActor->id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                DB::table('event_invitation_history')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'invitation_id' => $invitationId,
                    'invitation_version' => 1,
                    'action' => 'issued',
                    'actor_user_id' => (int) $persistedActor->id,
                    'idempotency_hash' => $item['issue_hash'],
                    'request_hash' => $item['request_hash'],
                    'metadata' => json_encode(['target_type' => $recipient['type']], JSON_THROW_ON_ERROR),
                    'created_at' => $now,
                ]);
                $this->delivery->queue(
                    $tenantId,
                    $eventId,
                    $campaignId,
                    $invitationId,
                    1,
                    $recipient,
                    $token,
                    $expiry->format('Y-m-d\TH:i:s.u\Z'),
                    (string) ($campaign->default_locale ?? 'en'),
                );
                $results[] = [
                    'invitation' => $this->invitationModel($tenantId, $eventId, $invitationId),
                    'secret' => $token,
                ];
            }
            $issuedRevision = $issuingRevision + 1;
            if (DB::table('event_invitation_campaigns')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $campaignId)
                ->where('revision', $issuingRevision)
                ->where('status', EventInvitationCampaignStatus::Issuing->value)
                ->update([
                    'status' => EventInvitationCampaignStatus::Issued->value,
                    'revision' => $issuedRevision,
                    'updated_by' => (int) $persistedActor->id,
                    'issued_at' => $now,
                    'completed_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_invitation_campaign_revision_conflict');
            }
            $issuedKeyHash = hash('sha256', $baseKeyHash . '|campaign|issued');
            $issuedRequestHash = $this->support->requestHash([
                'action' => EventInvitationCampaignStatus::Issued->value,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'actor_id' => (int) $persistedActor->id,
                'issuing_revision' => $issuingRevision,
                'issued_count' => count($results),
            ]);
            DB::table('event_invitation_campaign_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'campaign_id' => $campaignId,
                'revision' => $issuedRevision,
                'action' => EventInvitationCampaignStatus::Issued->value,
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $issuedKeyHash,
                'request_hash' => $issuedRequestHash,
                'metadata' => json_encode(['issued_count' => count($results)], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            return [
                'campaign' => $this->campaignModel($tenantId, $campaignId),
                'changed' => true,
                'invitations' => $results,
            ];
        }, 3);
    }

    /**
     * @return array{
     *   invitation:EventInvitation,
     *   changed:bool,
     *   participation:array{status:string,registration:mixed,waitlist:mixed}
     * }
     */
    public function accept(
        int $eventId,
        string $token,
        User|int $actor,
        string $idempotencyKey,
        ?string $acceptedEmail = null,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);
        $tokenHash = $this->validTokenHash($tenantId, $eventId, $token);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $tokenHash,
            $actor,
            $keyHash,
            $acceptedEmail,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $emailBlindHash = null;
            if ($acceptedEmail !== null) {
                $emailBlindHash = $this->support->emailBlindHash($tenantId, $acceptedEmail);
            }
            $requestHash = $this->support->requestHash([
                'action' => 'accepted',
                'event_id' => $eventId,
                'token_hash' => $tokenHash,
                'actor_id' => (int) $persistedActor->id,
                'email_blind_hash' => $emailBlindHash,
            ]);
            $history = DB::table('event_invitation_history')
                ->where('tenant_id', $tenantId)
                ->where('idempotency_hash', $keyHash)
                ->first();
            if ($history !== null) {
                if ((string) $history->action !== 'accepted'
                    || ! hash_equals((string) $history->request_hash, $requestHash)) {
                    throw new EventRegistrationFoundationException('event_invitation_acceptance_idempotency_conflict');
                }

                return [
                    'invitation' => $this->invitationModel(
                        $tenantId,
                        $eventId,
                        (int) $history->invitation_id,
                    ),
                    'changed' => false,
                    'participation' => $this->participation($eventId, (int) $persistedActor->id),
                ];
            }
            $invitation = DB::table('event_invitations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('token_hash', $tokenHash)
                ->lockForUpdate()
                ->first();
            $now = CarbonImmutable::now('UTC');
            if ($invitation === null
                || (string) $invitation->status !== EventInvitationStatus::Issued->value
                || CarbonImmutable::parse((string) $invitation->token_expires_at, 'UTC')->lessThanOrEqualTo($now)) {
                throw new EventRegistrationFoundationException('event_invitation_invalid');
            }
            if ((string) $invitation->target_type === 'member') {
                if ((int) $invitation->member_user_id !== (int) $persistedActor->id
                    || $acceptedEmail !== null) {
                    throw new EventRegistrationFoundationException('event_invitation_invalid');
                }
            } else {
                try {
                    $actorEmail = $this->support->normalizeEmail((string) $persistedActor->email);
                } catch (EventRegistrationFoundationException) {
                    throw new EventRegistrationFoundationException('event_invitation_invalid');
                }
                $actorBlind = $this->support->emailBlindHash($tenantId, $actorEmail);
                if ($acceptedEmail === null
                    || $emailBlindHash === null
                    || ! hash_equals((string) $invitation->email_blind_hash, $emailBlindHash)
                    || ! hash_equals((string) $invitation->email_blind_hash, $actorBlind)) {
                    throw new EventRegistrationFoundationException('event_invitation_invalid');
                }
            }
            ($this->eligibility ?? app(EventParticipationEligibilityService::class))
                ->assertCanParticipate(
                    $event,
                    $persistedActor,
                    'event_invitation_acceptance',
                );
            $participation = $this->activateParticipation(
                $eventId,
                $persistedActor,
                $keyHash,
            );
            $version = (int) $invitation->invitation_version + 1;
            if (DB::table('event_invitations')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $invitation->id)
                ->where('status', EventInvitationStatus::Issued->value)
                ->whereNull('token_used_at')
                ->update([
                    'status' => EventInvitationStatus::Accepted->value,
                    'invitation_version' => $version,
                    'token_used_at' => $now,
                    'accepted_by_user_id' => (int) $persistedActor->id,
                    'accepted_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_invitation_invalid');
            }
            DB::table('event_invitation_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'invitation_id' => (int) $invitation->id,
                'invitation_version' => $version,
                'action' => 'accepted',
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $keyHash,
                'request_hash' => $requestHash,
                'metadata' => json_encode([
                    'target_type' => (string) $invitation->target_type,
                    'participation_status' => $participation['status'],
                ], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            return [
                'invitation' => $this->invitationModel($tenantId, $eventId, (int) $invitation->id),
                'changed' => true,
                'participation' => $participation,
            ];
        }, 3);
    }

    /**
     * Authenticated member acceptance for in-app delivery, where a plaintext
     * email token is intentionally never exposed to the client notification.
     *
     * @return array{
     *   invitation:EventInvitation,
     *   changed:bool,
     *   participation:array{status:string,registration:mixed,waitlist:mixed}
     * }
     */
    public function acceptMemberById(
        int $eventId,
        int $invitationId,
        User|int $actor,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $persistedActor = $this->support->actor($tenantId, $actor, false);
        $invitation = DB::table('event_invitations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $invitationId)
            ->where('target_type', 'member')
            ->where('member_user_id', (int) $persistedActor->id)
            ->first();
        if ($invitation === null) {
            throw new EventRegistrationFoundationException('event_invitation_invalid');
        }
        $outbox = DB::table('event_domain_outbox')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.invitation.issued')
            ->where('aggregate_stream', "event:{$eventId}:invitation:{$invitationId}")
            ->orderByDesc('id')
            ->first(['payload']);
        $payload = $outbox === null ? null : json_decode((string) $outbox->payload, true);
        if (! is_array($payload)
            || (int) ($payload['invitation_id'] ?? 0) !== $invitationId
            || ! is_string($payload['token_ciphertext'] ?? null)) {
            throw new EventRegistrationFoundationException('event_invitation_invalid');
        }

        return $this->accept(
            $eventId,
            $this->support->decrypt($payload['token_ciphertext']),
            $persistedActor,
            $idempotencyKey,
        );
    }

    /** @return array{invitation:EventInvitation,changed:bool} */
    public function revoke(
        int $eventId,
        int $invitationId,
        User|int $actor,
        string $reason,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $keyHash = $this->support->idempotencyHash($idempotencyKey);
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new EventRegistrationFoundationException('event_invitation_revocation_reason_invalid');
        }

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $invitationId,
            $actor,
            $reason,
            $keyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $requestHash = $this->support->requestHash([
                'action' => EventInvitationStatus::Revoked->value,
                'event_id' => $eventId,
                'invitation_id' => $invitationId,
                'actor_id' => (int) $persistedActor->id,
                'reason' => $reason,
            ]);
            $history = DB::table('event_invitation_history')
                ->where('tenant_id', $tenantId)
                ->where('idempotency_hash', $keyHash)
                ->first();
            if ($history !== null) {
                if ((string) $history->action !== EventInvitationStatus::Revoked->value
                    || ! hash_equals((string) $history->request_hash, $requestHash)) {
                    throw new EventRegistrationFoundationException('event_invitation_revocation_idempotency_conflict');
                }

                return [
                    'invitation' => $this->invitationModel($tenantId, $eventId, (int) $history->invitation_id),
                    'changed' => false,
                ];
            }
            $invitation = DB::table('event_invitations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $invitationId)
                ->lockForUpdate()
                ->first();
            if ($invitation === null) {
                throw new EventRegistrationFoundationException('event_invitation_not_found');
            }
            if ((string) $invitation->status !== EventInvitationStatus::Issued->value
                || $invitation->token_used_at !== null) {
                throw new EventRegistrationFoundationException('event_invitation_revocation_invalid');
            }
            $version = (int) $invitation->invitation_version + 1;
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_invitations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $invitationId)
                ->where('status', EventInvitationStatus::Issued->value)
                ->whereNull('token_used_at')
                ->update([
                    'status' => EventInvitationStatus::Revoked->value,
                    'invitation_version' => $version,
                    'revoked_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_invitation_revocation_invalid');
            }
            DB::table('event_invitation_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'invitation_id' => $invitationId,
                'invitation_version' => $version,
                'action' => EventInvitationStatus::Revoked->value,
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $keyHash,
                'request_hash' => $requestHash,
                'metadata' => json_encode(['reason' => $reason], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ]);

            return [
                'invitation' => $this->invitationModel($tenantId, $eventId, $invitationId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{expired:int,invitation_ids:list<int>} */
    public function expireDueForEvent(int $eventId, User|int $actor, int $limit = 500): array
    {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $limit = max(1, min(2000, $limit));

        return DB::transaction(function () use ($tenantId, $eventId, $actor, $limit): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $event);
            $now = CarbonImmutable::now('UTC');
            $rows = DB::table('event_invitations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('status', EventInvitationStatus::Issued->value)
                ->whereNull('token_used_at')
                ->where('token_expires_at', '<=', $now)
                ->orderBy('token_expires_at')
                ->orderBy('id')
                ->limit($limit)
                ->lockForUpdate()
                ->get();
            $ids = [];
            foreach ($rows as $invitation) {
                $invitationId = (int) $invitation->id;
                $version = (int) $invitation->invitation_version + 1;
                $keyHash = hash('sha256', "event-invitation-expired|{$tenantId}|{$invitationId}|{$version}");
                $requestHash = $this->support->requestHash([
                    'action' => EventInvitationStatus::Expired->value,
                    'event_id' => $eventId,
                    'invitation_id' => $invitationId,
                    'version' => $version,
                ]);
                if (DB::table('event_invitations')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('id', $invitationId)
                    ->where('status', EventInvitationStatus::Issued->value)
                    ->whereNull('token_used_at')
                    ->update([
                        'status' => EventInvitationStatus::Expired->value,
                        'invitation_version' => $version,
                        'expired_at' => $now,
                        'updated_at' => $now,
                    ]) !== 1) {
                    continue;
                }
                DB::table('event_invitation_history')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'invitation_id' => $invitationId,
                    'invitation_version' => $version,
                    'action' => EventInvitationStatus::Expired->value,
                    'actor_user_id' => (int) $persistedActor->id,
                    'idempotency_hash' => $keyHash,
                    'request_hash' => $requestHash,
                    'metadata' => json_encode(['expired_at' => $now->format('Y-m-d\TH:i:s.u\Z')], JSON_THROW_ON_ERROR),
                    'created_at' => $now,
                ]);
                $ids[] = $invitationId;
            }

            return ['expired' => count($ids), 'invitation_ids' => $ids];
        }, 3);
    }

    /**
     * Process due scheduled campaigns using the immutable preview snapshot.
     * One failed campaign is reported without preventing later due campaigns.
     *
     * @return list<array{campaign_id:int,status:string,reason:?string}>
     */
    public function issueDueScheduled(int $limit = 100): array
    {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $limit = max(1, min(500, $limit));
        $campaigns = DB::table('event_invitation_campaigns')
            ->where('tenant_id', $tenantId)
            ->where('status', EventInvitationCampaignStatus::Scheduled->value)
            ->where('scheduled_for_utc', '<=', CarbonImmutable::now('UTC'))
            ->orderBy('scheduled_for_utc')
            ->orderBy('id')
            ->limit($limit)
            ->get();
        $results = [];
        foreach ($campaigns as $campaign) {
            try {
                $event = $this->support->concreteEvent($tenantId, (int) $campaign->event_id, false);
                $this->issueCampaign(
                    (int) $campaign->event_id,
                    (int) $campaign->id,
                    (int) $campaign->updated_by,
                    [],
                    (int) $campaign->revision,
                    "scheduled-invitation-campaign:{$campaign->id}:{$campaign->revision}",
                    $this->support->eventStart($event),
                );
                $results[] = ['campaign_id' => (int) $campaign->id, 'status' => 'issued', 'reason' => null];
            } catch (\Throwable $exception) {
                $results[] = [
                    'campaign_id' => (int) $campaign->id,
                    'status' => 'failed',
                    'reason' => $exception->getMessage(),
                ];
            }
        }

        return $results;
    }

    /** Non-enumerable lookup: every invalid, expired, used, or cross-event token is null. */
    public function resolve(int $eventId, string $token): ?EventInvitation
    {
        if (! Schema::hasTable('event_invitations')) {
            return null;
        }
        $tenantId = $this->support->tenantId();
        try {
            $tokenHash = $this->validTokenHash($tenantId, $eventId, $token);
        } catch (EventRegistrationFoundationException) {
            return null;
        }
        $invitation = EventInvitation::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('token_hash', $tokenHash)
            ->where('status', EventInvitationStatus::Issued->value)
            ->where('token_expires_at', '>', CarbonImmutable::now('UTC'))
            ->first();

        return $invitation;
    }

    /** @return array{status:string,registration:mixed,waitlist:mixed} */
    private function activateParticipation(int $eventId, User $actor, string $acceptanceKeyHash): array
    {
        $userId = (int) $actor->getKey();
        $waitlistState = $this->waitlist->stateFor($eventId, $userId);
        if ($waitlistState === EventWaitlistQueueState::Offered) {
            $accepted = $this->waitlist->acceptActiveOffer(
                $eventId,
                $userId,
                $actor,
                'invitation-offer-accept:' . $acceptanceKeyHash,
            );

            return [
                'status' => 'confirmed',
                'registration' => $accepted->registration,
                'waitlist' => $accepted->entry,
            ];
        }
        if ($waitlistState === EventWaitlistQueueState::Waiting) {
            return [
                'status' => 'waitlisted',
                'registration' => null,
                'waitlist' => $this->waitlistModel($eventId, $userId),
            ];
        }

        try {
            $confirmed = $this->registrations->confirm(
                $eventId,
                $userId,
                $actor,
                'invitation-registration-confirm:' . $acceptanceKeyHash,
            );

            return [
                'status' => 'confirmed',
                'registration' => $confirmed->registration,
                'waitlist' => null,
            ];
        } catch (EventRegistrationException $exception) {
            if ($exception->reasonCode === 'event_registration_offer_acceptance_required') {
                $accepted = $this->waitlist->acceptActiveOffer(
                    $eventId,
                    $userId,
                    $actor,
                    'invitation-offer-accept:' . $acceptanceKeyHash,
                );

                return [
                    'status' => 'confirmed',
                    'registration' => $accepted->registration,
                    'waitlist' => $accepted->entry,
                ];
            }
            if ($exception->reasonCode !== 'event_registration_capacity_full') {
                throw $exception;
            }
        }

        try {
            $joined = $this->waitlist->join(
                $eventId,
                $userId,
                $actor,
                'invitation-waitlist-join:' . $acceptanceKeyHash,
            );
        } catch (EventWaitlistException $exception) {
            if ($exception->reasonCode !== 'event_waitlist_capacity_available') {
                throw $exception;
            }
            $confirmed = $this->registrations->confirm(
                $eventId,
                $userId,
                $actor,
                'invitation-registration-confirm-after-race:' . $acceptanceKeyHash,
            );

            return [
                'status' => 'confirmed',
                'registration' => $confirmed->registration,
                'waitlist' => null,
            ];
        }

        return ['status' => 'waitlisted', 'registration' => null, 'waitlist' => $joined->entry];
    }

    /** @return array{status:string,registration:mixed,waitlist:mixed} */
    private function participation(int $eventId, int $userId): array
    {
        $registrationState = $this->registrations->stateFor($eventId, $userId);
        $registration = $this->registrationModel($eventId, $userId);
        if ($registrationState?->consumesCapacity()) {
            return ['status' => 'confirmed', 'registration' => $registration, 'waitlist' => null];
        }
        $waitlistState = $this->waitlist->stateFor($eventId, $userId);
        $waitlist = $this->waitlistModel($eventId, $userId);
        if ($waitlistState !== null && in_array($waitlistState, [
            EventWaitlistQueueState::Waiting,
            EventWaitlistQueueState::Offered,
        ], true)) {
            return ['status' => 'waitlisted', 'registration' => $registration, 'waitlist' => $waitlist];
        }

        return ['status' => 'none', 'registration' => $registration, 'waitlist' => $waitlist];
    }

    private function registrationModel(int $eventId, int $userId): ?EventRegistration
    {
        return EventRegistration::withoutGlobalScopes()
            ->where('tenant_id', $this->support->tenantId())
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->orderBy('id')
            ->first();
    }

    private function waitlistModel(int $eventId, int $userId): ?EventWaitlistEntry
    {
        return EventWaitlistEntry::withoutGlobalScopes()
            ->where('tenant_id', $this->support->tenantId())
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->orderBy('id')
            ->first();
    }

    private function validTokenHash(int $tenantId, int $eventId, string $token): string
    {
        if (preg_match('/^nxi1_[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            throw new EventRegistrationFoundationException('event_invitation_invalid');
        }

        return $this->support->tokenHash($tenantId, $eventId, $token);
    }

    private function campaign(int $tenantId, int $eventId, int $campaignId, bool $lock): stdClass
    {
        $query = DB::table('event_invitation_campaigns')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $campaignId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $row = $query->first();
        if ($row === null) {
            throw new EventRegistrationFoundationException('event_invitation_campaign_not_found');
        }

        return $row;
    }

    private function campaignModel(int $tenantId, int $campaignId): EventInvitationCampaign
    {
        return EventInvitationCampaign::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($campaignId)
            ->firstOrFail();
    }

    private function invitationModel(int $tenantId, int $eventId, int $invitationId): EventInvitation
    {
        return EventInvitation::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereKey($invitationId)
            ->firstOrFail();
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_invitation_campaigns', 'event_invitation_campaign_history',
            'event_invitations', 'event_invitation_history',
            'event_invitation_delivery_evidence', 'event_domain_outbox',
            'event_notification_deliveries', 'event_registrations',
            'event_waitlist_entries',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventRegistrationFoundationException('event_invitation_schema_unavailable');
            }
        }
        foreach ([
            'source_snapshot_ciphertext', 'default_locale', 'scheduled_for_utc',
            'started_at', 'completed_at',
        ] as $column) {
            if (! Schema::hasColumn('event_invitation_campaigns', $column)) {
                throw new EventRegistrationFoundationException('event_invitation_schema_unavailable');
            }
        }
    }
}
