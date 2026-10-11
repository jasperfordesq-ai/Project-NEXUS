<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use App\Services\TenantFeatureConfig;
use Illuminate\Console\Command;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class ExpireEventWaitlistOffersCommandTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.offer_ttl_minutes', 15);
        Config::set('event_waitlist.envelope.active_key_version', 'command-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
    }

    public function test_command_is_globally_bounded_exactly_once_and_restores_tenant_context(): void
    {
        $first = $this->dueOffer($this->testTenantId);
        $second = $this->dueOffer($this->testTenantId);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        TenantContext::setById($this->testTenantId);

        $this->artisan('events:expire-waitlist-offers', ['--limit' => '1'])
            ->assertExitCode(Command::SUCCESS);
        self::assertNull(TenantContext::currentId());
        self::assertSame(1, DB::table('event_waitlist_entries')
            ->whereIn('id', [$first['entry_id'], $second['entry_id']])
            ->where('queue_state', 'expired')
            ->count());
        self::assertSame(1, DB::table('event_waitlist_offer_envelopes')
            ->whereIn('waitlist_entry_id', [$first['entry_id'], $second['entry_id']])
            ->where('status', 'expired')
            ->whereNull('token_ciphertext')
            ->count());

        $this->artisan('events:expire-waitlist-offers', ['--limit' => '1'])
            ->assertExitCode(Command::SUCCESS);
        $this->artisan('events:expire-waitlist-offers', ['--limit' => '1'])
            ->assertExitCode(Command::SUCCESS);
        self::assertSame(2, DB::table('event_waitlist_entries')
            ->whereIn('id', [$first['entry_id'], $second['entry_id']])
            ->where('queue_state', 'expired')
            ->count());
        self::assertSame(2, DB::table('event_waitlist_entry_history')
            ->whereIn('waitlist_entry_id', [$first['entry_id'], $second['entry_id']])
            ->where('action', 'expired')
            ->count());
        self::assertSame(2, DB::table('event_domain_outbox')
            ->whereIn('event_id', [$first['event_id'], $second['event_id']])
            ->where('action', 'event.waitlist.expired')
            ->count());
    }

    public function test_tenant_filter_and_feature_gate_prevent_cross_tenant_expiry(): void
    {
        $foreignTenantId = $this->tenant('Expiry tenant');
        $local = $this->dueOffer($this->testTenantId);
        $foreign = $this->dueOffer($foreignTenantId);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        TenantContext::setById($this->testTenantId);

        $this->artisan('events:expire-waitlist-offers', [
            '--tenant' => (string) $foreignTenantId,
            '--limit' => '20',
        ])->assertExitCode(Command::SUCCESS);
        self::assertNull(TenantContext::currentId());
        self::assertSame('offered', DB::table('event_waitlist_entries')
            ->where('id', $local['entry_id'])->value('queue_state'));
        self::assertSame('expired', DB::table('event_waitlist_entries')
            ->where('id', $foreign['entry_id'])->value('queue_state'));

        $disabled = $this->dueOffer($foreignTenantId);
        DB::table('tenants')->where('id', $foreignTenantId)->update([
            'features' => json_encode(
                array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['events' => false]),
                JSON_THROW_ON_ERROR,
            ),
        ]);
        $this->artisan('events:expire-waitlist-offers', [
            '--tenant' => (string) $foreignTenantId,
            '--limit' => '20',
        ])->assertExitCode(Command::SUCCESS);
        self::assertSame('offered', DB::table('event_waitlist_entries')
            ->where('id', $disabled['entry_id'])->value('queue_state'));
        self::assertNull(TenantContext::currentId());
    }

    public function test_invalid_bounds_are_rejected_without_mutation(): void
    {
        $this->artisan('events:expire-waitlist-offers', ['--limit' => '0'])
            ->assertExitCode(Command::INVALID);
        $this->artisan('events:expire-waitlist-offers', ['--limit' => '1001'])
            ->assertExitCode(Command::INVALID);
        $this->artisan('events:expire-waitlist-offers', ['--tenant' => '-1'])
            ->assertExitCode(Command::INVALID);
    }

    /** @return array{event_id:int,entry_id:int} */
    private function dueOffer(int $tenantId): array
    {
        TenantContext::reset();
        TenantContext::setById($tenantId);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        $organizer = $this->member($tenantId, 'Expiry Organizer');
        $holder = $this->member($tenantId, 'Expiry Holder');
        $waiter = $this->member($tenantId, 'Expiry Waiter');
        $eventId = $this->event($tenantId, (int) $organizer->id);
        $registrations = new EventRegistrationService();
        $waitlist = new EventWaitlistService($registrations);
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'expiry-fill');
        $waitlist->join($eventId, (int) $waiter->id, $waiter, 'expiry-join');
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        DB::table('events')->where('tenant_id', $tenantId)->where('id', $eventId)->increment('max_attendees');
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $waitlist->offerNext($eventId, $organizer, 'expiry-offer');
        self::assertNotNull($offer);
        $past = now()->subMinute();
        DB::table('event_waitlist_entries')->where('id', $offer->entry->id)->update([
            'offer_expires_at' => $past,
        ]);
        DB::table('event_waitlist_offer_envelopes')
            ->where('waitlist_entry_id', $offer->entry->id)
            ->update(['expires_at' => $past]);

        return [
            'event_id' => $eventId,
            'entry_id' => (int) $offer->entry->id,
        ];
    }

    private function tenant(string $name): int
    {
        $suffix = bin2hex(random_bytes(6));

        return (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'event-expiry-' . $suffix,
            'features' => json_encode(
                array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['events' => true]),
                JSON_THROW_ON_ERROR,
            ),
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function member(int $tenantId, string $name): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'name' => $name,
            'first_name' => $name,
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(int $tenantId, int $organizerId): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organizerId,
            'title' => 'Expiry command fixture',
            'description' => 'Bounded scheduler fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => "expiry:{$tenantId}:" . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => 1,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
