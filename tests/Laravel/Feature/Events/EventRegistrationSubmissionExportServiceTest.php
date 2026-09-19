<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);
namespace Tests\Laravel\Feature\Events;
use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventRegistrationSubmissionExportService;
use App\Services\EventRegistrationSubmissionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationSubmissionExportServiceTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_maximum_length_reference_exports_without_losing_audit_correlation(): void
    {
        $this->assertReferenceExport(str_repeat('é', 256));
    }

    /** @dataProvider shortReferences */
    public function test_existing_short_reference_hashes_remain_unchanged(string $reference): void
    {
        $this->assertReferenceExport($reference);
    }

    public static function shortReferences(): array
    {
        return [['short-export-reference'], ['  short-export-reference  ']];
    }

    /** @dataProvider invalidEvidence */
    public function test_empty_exports_still_validate_audit_evidence(string $purpose, string $reference, string $reason): void
    {
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int)$owner->id);
        $this->expectException(EventRegistrationFoundationException::class);
        $this->expectExceptionMessage($reason);
        (new EventRegistrationSubmissionExportService())->export($eventId, $owner, $purpose, $reference);
    }

    public static function invalidEvidence(): array
    {
        return [
            [' ', 'reference', 'event_registration_answer_access_purpose_invalid'],
            [str_repeat('a', 501), 'reference', 'event_registration_answer_access_purpose_invalid'],
            ['Operational review', ' ', 'event_registration_idempotency_key_invalid'],
            ['Operational review', str_repeat('é', 257), 'event_registration_idempotency_key_invalid'],
        ];
    }

    private function assertReferenceExport(string $reference): void
    {
        $owner = $this->eventUser(); $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int)$owner->id);
        $settings = $this->registrationSettings($eventId, $owner, $start);
        $form = $this->publishedRegistrationForm($eventId, $owner, $settings, [[
            'stable_key'=>'activity', 'question_type'=>'short_text', 'prompt'=>'Activity', 'is_required'=>true,
            'data_classification'=>'internal', 'purpose'=>'Activity planning', 'retention_days'=>30,
        ]]);
        $registration = $this->canonicalRegistration($eventId, (int)$member->id);
        $service = new EventRegistrationSubmissionService();
        $draft = $service->saveDraft($eventId, $registration, (int)$form->id, $member,
            ['activity'=>'Gardening'], null, 'export-test-save');
        $id = (int)$draft['submission']->id;
        $service->submit($eventId, $id, $member, 1, 'export-test-submit');
        $export = (new EventRegistrationSubmissionExportService())->export($eventId, $owner, 'Operational review', $reference);
        self::assertCount(1, $export['rows']);
        self::assertSame('Gardening', $export['rows'][0][7]);
        $audit = DB::table('event_registration_answer_access_audits')->where('event_id', $eventId)->sole();
        self::assertSame('export', $audit->action);
        self::assertSame('Operational review', $audit->purpose);
        $derived = $reference . ':' . $id;
        if (strlen($derived) > 512) $derived = hash('sha256', $derived);
        self::assertSame(hash('sha256', trim($derived)), $audit->correlation_hash);
    }
}
