<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\User;
use App\Services\EventInvitationCampaignService;
use App\Services\EventConfigurationService;
use App\Services\EventInvitationService;
use App\Services\EventRegistrationFormService;
use App\Services\EventRegistrationGuestAttendanceService;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationProductQueryService;
use App\Services\EventRegistrationRetentionService;
use App\Services\EventRegistrationSettingsService;
use App\Services\EventRegistrationSubmissionExportService;
use App\Services\EventRegistrationSubmissionService;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

/** Private enterprise surface for registration forms, invitations, and guests. */
final class EventRegistrationProductController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly EventRegistrationProductQueryService $queries,
        private readonly EventRegistrationSettingsService $settings,
        private readonly EventRegistrationFormService $forms,
        private readonly EventRegistrationSubmissionService $submissions,
        private readonly EventRegistrationSubmissionExportService $exports,
        private readonly EventInvitationCampaignService $campaigns,
        private readonly EventInvitationService $invitations,
        private readonly EventRegistrationGuestService $guests,
        private readonly EventRegistrationGuestAttendanceService $guestAttendance,
        private readonly EventRegistrationRetentionService $retention,
        private readonly EventConfigurationService $eventConfiguration,
    ) {
    }

    public function organizerOverview(int $id): JsonResponse
    {
        $pagination = $this->overviewPagination();
        if ($pagination === false) {
            return $this->validation('pagination');
        }

        return $this->execute(
            fn (): array => $this->queries->organizerOverview($id, $this->actor(), $pagination),
        );
    }

    public function attendeeState(int $id): JsonResponse
    {
        return $this->execute(fn (): array => $this->queries->attendeeState($id, $this->actor()));
    }

    public function saveSettings(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        if ($key === false) {
            return $this->validation('idempotency_key');
        }
        $revision = $this->nonNegativeInteger(request()->input('expected_revision'));
        if ($revision === null) {
            return $this->validation('expected_revision');
        }

        return $this->execute(function () use ($id, $key, $revision): array {
            $result = $this->settings->save(
                $id,
                $this->actor(),
                request()->except(['expected_revision', 'idempotency_key']),
                $revision,
                $key,
            );

            return $this->mutation('settings', $result['settings'], $result['changed']);
        }, 201);
    }

    public function publishSettings(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        if ($key === false || $revision === null) {
            return $this->validation($key === false ? 'idempotency_key' : 'expected_revision');
        }

        return $this->execute(function () use ($id, $key, $revision): array {
            $result = $this->settings->publish($id, $this->actor(), $revision, $key);

            return $this->mutation('settings', $result['settings'], $result['changed']);
        });
    }

    public function createForm(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        $settingsRevision = $this->positiveInteger(request()->input('expected_settings_revision'));
        $name = request()->input('name');
        $questions = request()->input('questions');
        if ($key === false || $settingsRevision === null || ! is_string($name) || ! is_array($questions)) {
            return $this->validation('form');
        }

        return $this->execute(function () use ($id, $key, $settingsRevision, $name, $questions): array {
            $description = request()->input('description');
            $result = $this->forms->createDraft(
                $id,
                $this->actor(),
                $name,
                is_string($description) ? $description : null,
                array_values($questions),
                $settingsRevision,
                $key,
            );

            return $this->formMutation($result);
        }, 201);
    }

    public function updateForm(int $id, int $formId): JsonResponse
    {
        $key = $this->requiredKey();
        $formRevision = $this->positiveInteger(request()->input('expected_form_revision'));
        $settingsRevision = $this->positiveInteger(request()->input('expected_settings_revision'));
        if ($key === false || $formRevision === null || $settingsRevision === null) {
            return $this->validation('revision');
        }

        return $this->execute(function () use ($id, $formId, $key, $formRevision, $settingsRevision): array {
            $result = $this->forms->updateDraft(
                $id,
                $formId,
                $this->actor(),
                request()->only(['name', 'description', 'questions']),
                $formRevision,
                $settingsRevision,
                $key,
            );

            return $this->formMutation($result);
        });
    }

    public function forkForm(int $id, int $formId): JsonResponse
    {
        $key = $this->requiredKey();
        $settingsRevision = $this->positiveInteger(request()->input('expected_settings_revision'));
        if ($key === false || $settingsRevision === null) {
            return $this->validation('revision');
        }

        return $this->execute(function () use ($id, $formId, $key, $settingsRevision): array {
            return $this->formMutation($this->forms->forkPublished(
                $id,
                $formId,
                $this->actor(),
                $settingsRevision,
                $key,
            ));
        }, 201);
    }

    public function publishForm(int $id, int $formId): JsonResponse
    {
        $key = $this->requiredKey();
        $formRevision = $this->positiveInteger(request()->input('expected_form_revision'));
        $settingsRevision = $this->positiveInteger(request()->input('expected_settings_revision'));
        if ($key === false || $formRevision === null || $settingsRevision === null) {
            return $this->validation('revision');
        }

        return $this->execute(function () use ($id, $formId, $key, $formRevision, $settingsRevision): array {
            return $this->formMutation($this->forms->publish(
                $id,
                $formId,
                $this->actor(),
                $formRevision,
                $settingsRevision,
                $key,
            ));
        });
    }

    public function saveSubmission(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        $registrationId = $this->positiveInteger(request()->input('registration_id'));
        $formId = $this->positiveInteger(request()->input('form_version_id'));
        $revision = $this->nullableNonNegativeInteger(request()->input('expected_revision'));
        $answers = request()->input('answers');
        if ($key === false || $registrationId === null || $formId === null || $revision === false || ! is_array($answers)) {
            return $this->validation('submission');
        }

        return $this->execute(function () use ($id, $registrationId, $formId, $answers, $revision, $key): array {
            $result = $this->submissions->saveDraft(
                $id,
                $registrationId,
                $formId,
                $this->actor(),
                $answers,
                $revision,
                $key,
            );

            return $this->mutation('submission', $result['submission'], $result['changed']);
        }, 201);
    }

    public function submit(int $id, int $submissionId): JsonResponse
    {
        $key = $this->requiredKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        if ($key === false || $revision === null) {
            return $this->validation('revision');
        }

        return $this->execute(function () use ($id, $submissionId, $key, $revision): array {
            $result = $this->submissions->submit($id, $submissionId, $this->actor(), $revision, $key);

            return $this->mutation('submission', $result['submission'], $result['changed']);
        });
    }

    public function amend(int $id, int $submissionId): JsonResponse
    {
        $key = $this->requiredKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        if ($key === false || $revision === null) {
            return $this->validation('revision');
        }

        return $this->execute(function () use ($id, $submissionId, $key, $revision): array {
            $result = $this->submissions->createAmendment(
                $id,
                $submissionId,
                $this->actor(),
                $revision,
                $key,
            );

            return [
                'submission' => $result['submission'],
                'superseded_submission' => $result['superseded_submission'],
                'changed' => $result['changed'],
                'idempotent_replay' => ! $result['changed'],
            ];
        }, 201);
    }

    public function answers(int $id, int $submissionId): JsonResponse
    {
        $purpose = request()->input('purpose');
        $correlation = request()->input('correlation_id');
        if (! is_string($purpose) || ! is_string($correlation)) {
            return $this->validation('access_evidence');
        }

        return $this->execute(fn (): array => [
            'answers' => $this->submissions->readAnswers(
                $id,
                $submissionId,
                $this->actor(),
                $purpose,
                $correlation,
                'read',
                request()->boolean('include_sensitive'),
            ),
        ]);
    }

    public function export(int $id): JsonResponse|StreamedResponse
    {
        $purpose = request()->input('purpose');
        $correlation = request()->input('correlation_id');
        if (! is_string($purpose) || ! is_string($correlation)) {
            return $this->validation('access_evidence');
        }
        try {
            $csv = $this->exports->export(
                $id,
                $this->actor(),
                $purpose,
                $correlation,
                request()->boolean('include_sensitive'),
            );
        } catch (EventRegistrationFoundationException $exception) {
            return $this->productError($exception);
        } catch (Throwable) {
            return $this->respondWithError('EVENT_REGISTRATION_SERVER_ERROR', __('api.server_error'), null, 500);
        }

        return response()->streamDownload(static function () use ($csv): void {
            $stream = fopen('php://output', 'wb');
            if ($stream === false) {
                return;
            }
            fputcsv($stream, $csv['headers'], ',', '"', '\\');
            foreach ($csv['rows'] as $row) {
                fputcsv($stream, $row, ',', '"', '\\');
            }
            fclose($stream);
        }, "event-registration-{$id}.csv", [
            'Cache-Control' => 'private, no-store',
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    public function previewCampaign(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        $type = request()->input('campaign_type');
        $source = request()->input('source');
        if ($key === false || ! is_string($type) || ! is_array($source)) {
            return $this->validation('campaign');
        }

        return $this->execute(function () use ($id, $type, $source, $key): array {
            $locale = request()->input('default_locale');
            $result = $this->campaigns->preview(
                $id,
                $this->actor(),
                $type,
                $source,
                $key,
                is_string($locale) ? $locale : null,
            );

            return $this->mutation('campaign', $result['campaign'], $result['changed']);
        }, 201);
    }

    public function scheduleCampaign(int $id, int $campaignId): JsonResponse
    {
        $key = $this->requiredKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        $scheduled = request()->input('scheduled_for');
        if ($key === false || $revision === null || ! is_string($scheduled)) {
            return $this->validation('campaign_schedule');
        }

        return $this->execute(function () use ($id, $campaignId, $scheduled, $revision, $key): array {
            $result = $this->campaigns->schedule(
                $id,
                $campaignId,
                $this->actor(),
                $scheduled,
                $revision,
                $key,
            );

            return $this->mutation('campaign', $result['campaign'], $result['changed']);
        });
    }

    public function issueCampaign(int $id, int $campaignId): JsonResponse
    {
        $key = $this->requiredKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        $expiry = request()->input('expires_at');
        if ($key === false || $revision === null || ! is_string($expiry)) {
            return $this->validation('campaign_issue');
        }

        return $this->execute(function () use ($id, $campaignId, $revision, $expiry, $key): array {
            $result = $this->invitations->issueCampaign(
                $id,
                $campaignId,
                $this->actor(),
                [],
                $revision,
                $key,
                $expiry,
            );

            return [
                'campaign' => $result['campaign'],
                'invitations' => array_map(static fn (array $item): array => [
                    'invitation' => $item['invitation'],
                    'delivery_queued' => true,
                ], $result['invitations']),
                'changed' => $result['changed'],
                'idempotent_replay' => ! $result['changed'],
            ];
        });
    }

    public function cancelCampaign(int $id, int $campaignId): JsonResponse
    {
        $key = $this->requiredKey();
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        $reason = request()->input('reason');
        if ($key === false || $revision === null || ! is_string($reason)) {
            return $this->validation('campaign_cancellation');
        }

        return $this->execute(function () use ($id, $campaignId, $revision, $reason, $key): array {
            $result = $this->campaigns->cancel(
                $id,
                $campaignId,
                $this->actor(),
                $revision,
                $reason,
                $key,
            );

            return $this->mutation('campaign', $result['campaign'], $result['changed']);
        });
    }

    public function revokeInvitation(int $id, int $invitationId): JsonResponse
    {
        $key = $this->requiredKey();
        $reason = request()->input('reason');
        if ($key === false || ! is_string($reason)) {
            return $this->validation('invitation_revocation');
        }

        return $this->execute(function () use ($id, $invitationId, $reason, $key): array {
            $result = $this->invitations->revoke($id, $invitationId, $this->actor(), $reason, $key);

            return $this->mutation('invitation', $result['invitation'], $result['changed']);
        });
    }

    public function acceptInvitation(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        $token = request()->input('token');
        $email = request()->input('email');
        if ($key === false || ! is_string($token)) {
            return $this->validation('invitation');
        }

        return $this->execute(function () use ($id, $token, $email, $key): array {
            $result = $this->invitations->accept(
                $id,
                $token,
                $this->actor(),
                $key,
                is_string($email) ? $email : null,
            );

            return [
                'invitation' => $result['invitation'],
                'participation' => $result['participation'],
                'changed' => $result['changed'],
                'idempotent_replay' => ! $result['changed'],
            ];
        });
    }

    public function acceptMemberInvitation(int $id, int $invitationId): JsonResponse
    {
        $key = $this->requiredKey();
        if ($key === false) {
            return $this->validation('idempotency_key');
        }

        return $this->execute(function () use ($id, $invitationId, $key): array {
            $result = $this->invitations->acceptMemberById($id, $invitationId, $this->actor(), $key);

            return [
                'invitation' => $result['invitation'],
                'participation' => $result['participation'],
                'changed' => $result['changed'],
                'idempotent_replay' => ! $result['changed'],
            ];
        });
    }

    public function captureGuest(int $id, int $registrationId): JsonResponse
    {
        if (! (bool) $this->eventConfiguration->value('guest_registration_enabled', true)) {
            return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
        }
        $revision = $this->positiveInteger(request()->input('expected_registration_version'));
        $ticketInput = request()->input('ticket_entitlement_id');
        $ticketEntitlementId = $ticketInput === null || $ticketInput === ''
            ? null
            : $this->positiveInteger($ticketInput);
        if ($revision === null) {
            return $this->validation('expected_registration_version');
        }
        if ($ticketInput !== null && $ticketInput !== '' && $ticketEntitlementId === null) {
            return $this->validation('ticket_entitlement_id');
        }

        return $this->execute(function () use ($id, $registrationId, $revision, $ticketEntitlementId): array {
            $result = $this->guests->capture(
                $id,
                $registrationId,
                $this->actor(),
                $revision,
                (string) request()->input('display_name', ''),
                is_string(request()->input('email')) ? request()->input('email') : null,
                is_string(request()->input('phone')) ? request()->input('phone') : null,
                request()->boolean('consent_accepted'),
                (string) request()->input('consent_text', ''),
                (string) request()->input('consent_text_version', ''),
                is_string(request()->input('preferred_locale')) ? request()->input('preferred_locale') : null,
                request()->boolean('notification_consent'),
                is_string(request()->input('notification_consent_text'))
                    ? request()->input('notification_consent_text')
                    : null,
                is_string(request()->input('notification_consent_version'))
                    ? request()->input('notification_consent_version')
                    : null,
                $ticketEntitlementId,
            );

            return ['guest' => $result['guest'], 'party_size' => $result['party_size']];
        }, 201);
    }

    public function cancelGuest(int $id, int $guestId): JsonResponse
    {
        $revision = $this->positiveInteger(request()->input('expected_revision'));
        $reason = request()->input('reason');
        if ($revision === null || ! is_string($reason)) {
            return $this->validation('guest_cancellation');
        }

        return $this->execute(function () use ($id, $guestId, $revision, $reason): array {
            $result = $this->guests->cancel($id, $guestId, $this->actor(), $revision, $reason);

            return [
                'guest' => $result['guest'],
                'party_size' => $result['party_size'],
                'changed' => $result['changed'],
                'idempotent_replay' => ! $result['changed'],
            ];
        });
    }

    public function transitionGuestAttendance(int $id, int $guestId, string $action): JsonResponse
    {
        $key = $this->requiredKey();
        $version = $this->nonNegativeInteger(request()->input('expected_version'));
        if ($key === false || $version === null) {
            return $this->validation('guest_attendance');
        }

        return $this->execute(function () use ($id, $guestId, $action, $version, $key): array {
            $reason = request()->input('reason');
            return $this->guestAttendance->transition(
                $id,
                $guestId,
                $this->actor(),
                $action,
                $version,
                $key,
                is_string($reason) ? $reason : null,
            );
        });
    }

    public function retentionDryRun(int $id): JsonResponse
    {
        $key = $this->requiredKey();
        $asOf = request()->input('as_of');
        if ($key === false || ! is_string($asOf)) {
            return $this->validation('retention');
        }

        return $this->execute(function () use ($id, $asOf, $key): array {
            $result = $this->retention->dryRun($id, $this->actor(), $asOf, $key);

            return $this->mutation('run', $result['run'], $result['changed']);
        }, 201);
    }

    public function retentionApply(int $id, int $dryRunId): JsonResponse
    {
        $key = $this->requiredKey();
        if ($key === false) {
            return $this->validation('idempotency_key');
        }

        return $this->execute(function () use ($id, $dryRunId, $key): array {
            $result = $this->retention->apply($id, $dryRunId, $this->actor(), $key);

            return $this->mutation('run', $result['run'], $result['changed']);
        }, 201);
    }

    /** @param callable():array<string,mixed> $operation */
    private function execute(callable $operation, int $createdStatus = 200): JsonResponse
    {
        try {
            $data = $operation();
        } catch (EventRegistrationFoundationException $exception) {
            return $this->productError($exception);
        } catch (Throwable) {
            return $this->respondWithError('EVENT_REGISTRATION_SERVER_ERROR', __('api.server_error'), null, 500);
        }
        $status = $createdStatus === 201 && (bool) ($data['changed'] ?? true) ? 201 : 200;

        return $this->privateResponse($this->respondWithData($data, null, $status));
    }

    /** @return array<string,mixed> */
    private function mutation(string $key, mixed $value, bool $changed): array
    {
        return [$key => $value, 'changed' => $changed, 'idempotent_replay' => ! $changed];
    }

    /** @param array{form:mixed,changed:bool,settings_revision:int} $result @return array<string,mixed> */
    private function formMutation(array $result): array
    {
        return [
            'form' => $result['form'],
            'settings_revision' => $result['settings_revision'],
            'changed' => $result['changed'],
            'idempotent_replay' => ! $result['changed'],
        ];
    }

    private function actor(): User
    {
        $tenantId = TenantContext::currentId();
        $actor = $tenantId === null ? null : User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->find($this->requireUserId());
        if (! $actor instanceof User) {
            throw new EventRegistrationFoundationException('event_registration_actor_invalid');
        }

        return $actor;
    }

    private function requiredKey(): string|false
    {
        $header = request()->header('Idempotency-Key');
        $body = request()->input('idempotency_key');
        $header = is_string($header) ? trim($header) : null;
        $body = is_string($body) ? trim($body) : null;
        if ($header !== null && $body !== null && ! hash_equals($header, $body)) {
            return false;
        }
        $key = $header ?? $body;

        return $key === null || $key === '' || mb_strlen($key) > 191 ? false : $key;
    }

    private function positiveInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function nonNegativeInteger(mixed $value): ?int
    {
        $parsed = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);

        return $parsed === false ? null : (int) $parsed;
    }

    private function nullableNonNegativeInteger(mixed $value): int|null|false
    {
        return $value === null ? null : ($this->nonNegativeInteger($value) ?? false);
    }

    /** @return array<string,int>|false */
    private function overviewPagination(): array|false
    {
        $pagination = [];
        foreach (['submissions', 'campaigns', 'guests'] as $collection) {
            foreach (['page', 'per_page'] as $parameter) {
                $key = $collection . '_' . $parameter;
                $value = request()->query($key);
                if ($value === null) {
                    continue;
                }
                $parsed = $this->positiveInteger($value);
                if ($parsed === null) {
                    return false;
                }
                $pagination[$key] = $parsed;
            }
        }

        return $pagination;
    }

    private function validation(string $field): JsonResponse
    {
        return $this->respondWithError(
            'EVENT_REGISTRATION_VALIDATION_FAILED',
            __('api.validation_failed'),
            $field,
            422,
        );
    }

    private function privateResponse(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('Pragma', 'no-cache');
        $response->setVary(['Authorization', 'Cookie', 'X-Tenant-ID'], false);

        return $response;
    }

    private function productError(EventRegistrationFoundationException $exception): JsonResponse
    {
        $reason = $exception->getMessage();
        if ($reason === 'event_registration_guest_capacity_full') {
            // Same code/message as a full event on the registration path — from
            // the member's point of view it is the same fact, and the generic
            // 422 "validation failed" fallback would explain nothing.
            return $this->respondWithError(
                'EVENT_CAPACITY_FULL',
                __('event_registration.capacity_full'),
                null,
                409,
            );
        }
        if ($reason === 'event_registration_guests_tenant_disabled') {
            return $this->respondWithError(
                'EVENT_REGISTRATION_GUESTS_DISABLED',
                __('api.events_guests_disabled'),
                'guests_enabled',
                403,
            );
        }
        if (str_contains($reason, 'not_found') || $reason === 'event_invitation_invalid') {
            return $this->respondWithError('EVENT_REGISTRATION_NOT_FOUND', __('api.event_not_found'), null, 404);
        }
        if (str_contains($reason, 'denied')
            || str_contains($reason, 'authorization')
            || str_contains($reason, 'identity_mismatch')
            || str_contains($reason, 'sensitive_answer_access')) {
            return $this->respondWithError('EVENT_REGISTRATION_FORBIDDEN', __('api.forbidden'), null, 403);
        }
        if (str_contains($reason, 'schema_unavailable')
            || str_contains($reason, 'tenant_context_missing')) {
            return $this->respondWithError(
                'EVENT_REGISTRATION_UNAVAILABLE',
                __('api.service_unavailable'),
                null,
                503,
            );
        }
        if (str_contains($reason, 'conflict')
            || str_contains($reason, 'revision')
            || str_contains($reason, 'idempotency')) {
            return $this->respondWithError('EVENT_REGISTRATION_CONFLICT', __('api.invalid_input'), null, 409);
        }

        return $this->respondWithError(
            'EVENT_REGISTRATION_VALIDATION_FAILED',
            __('api.validation_failed'),
            null,
            422,
        );
    }
}
