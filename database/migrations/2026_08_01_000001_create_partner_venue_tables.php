<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Partner venues — a tenant-managed directory of local partner premises
 * (cafés, shops, leisure venues) plus the member pass and visit ledger that
 * record engagement when a member is recognised at one.
 *
 * This deliberately records ENGAGEMENT ONLY. `offer_summary` is display text
 * describing whatever the venue itself chooses to offer; the platform issues
 * no coupon, applies no discount, and moves no money here. Discount mechanics
 * live in the marketplace/merchant-coupon modules and are not involved.
 *
 * Staff authorisation reuses the existing typed `org_members` pivot with
 * org_type='partner_venue' (third ID space after 'volunteer' and 'club'), so
 * a venue can have several staff accounts without a bespoke pivot table.
 * `org_members.role` is a shared enum('owner','admin','member') and is NOT
 * altered here — venue roles map onto those existing values.
 *
 * IDs are int(11) signed to match users.id / tenants.id across this schema.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasTable('tenants')) {
            return;
        }

        $this->createVenues();
        $this->createMemberPasses();
        $this->createVisits();
    }

    public function down(): void
    {
        Schema::dropIfExists('partner_venue_visits');
        Schema::dropIfExists('partner_member_passes');
        Schema::dropIfExists('partner_venues');
    }

    private function createVenues(): void
    {
        if (Schema::hasTable('partner_venues')) {
            return;
        }

        Schema::create('partner_venues', function (Blueprint $table): void {
            $table->integer('id')->autoIncrement();
            $table->integer('tenant_id');
            $table->string('name');
            $table->string('slug')->nullable();
            $table->text('description')->nullable();
            $table->string('category', 50)->nullable()
                ->comment('cafe|shop|leisure|community|other — display grouping only');
            $table->string('offer_summary')->nullable()
                ->comment('Display-only description of the venue\'s own offer; not enforced by the platform');
            $table->string('address_line')->nullable();
            $table->string('city', 100)->nullable();
            $table->string('postcode', 20)->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->string('website')->nullable();
            $table->string('contact_email')->nullable();
            $table->string('logo_url')->nullable();
            $table->string('status', 20)->default('active')
                ->comment('active|paused|archived');
            $table->char('poster_token', 64)->nullable()
                ->comment('Reserved for venue-poster self-service check-in; not issued in v1');
            $table->integer('created_by')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'slug'], 'partner_venues_tenant_slug_unique');
            $table->unique('poster_token', 'partner_venues_poster_token_unique');
            $table->index(['tenant_id', 'status'], 'partner_venues_tenant_status_index');

            $table->foreign('tenant_id', 'partner_venues_tenant_id_foreign')
                ->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('created_by', 'partner_venues_created_by_foreign')
                ->references('id')->on('users')->nullOnDelete();
        });
    }

    private function createMemberPasses(): void
    {
        if (Schema::hasTable('partner_member_passes')) {
            return;
        }

        Schema::create('partner_member_passes', function (Blueprint $table): void {
            $table->integer('id')->autoIncrement();
            $table->integer('tenant_id');
            $table->integer('user_id');
            $table->char('token', 64)
                ->comment('Opaque bearer of the member pass QR; rotatable in place');
            $table->string('status', 20)->default('active')
                ->comment('active|revoked');
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->unique('token', 'partner_member_passes_token_unique');
            $table->unique(['tenant_id', 'user_id'], 'partner_member_passes_tenant_user_unique');

            $table->foreign('tenant_id', 'partner_member_passes_tenant_id_foreign')
                ->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('user_id', 'partner_member_passes_user_id_foreign')
                ->references('id')->on('users')->cascadeOnDelete();
        });
    }

    private function createVisits(): void
    {
        if (Schema::hasTable('partner_venue_visits')) {
            return;
        }

        Schema::create('partner_venue_visits', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->integer('tenant_id');
            $table->integer('venue_id');
            $table->integer('user_id')->comment('Member whose engagement is recorded');
            $table->integer('recorded_by_user_id')->nullable()
                ->comment('Venue staff account that recorded the visit');
            $table->string('source', 20)->default('member_pass')
                ->comment('member_pass|venue_poster');
            $table->date('visited_on');
            $table->timestamp('visited_at')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamps();

            // One visit per member per venue per day. This is both the
            // idempotency key (a second scan the same day is a no-op rather
            // than an error) and the anti-gaming ceiling.
            $table->unique(
                ['tenant_id', 'venue_id', 'user_id', 'visited_on'],
                'partner_venue_visits_daily_unique',
            );
            $table->index(['tenant_id', 'venue_id', 'visited_at'], 'partner_venue_visits_venue_index');
            $table->index(['tenant_id', 'user_id', 'visited_at'], 'partner_venue_visits_user_index');

            $table->foreign('tenant_id', 'partner_venue_visits_tenant_id_foreign')
                ->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('venue_id', 'partner_venue_visits_venue_id_foreign')
                ->references('id')->on('partner_venues')->cascadeOnDelete();
            $table->foreign('user_id', 'partner_venue_visits_user_id_foreign')
                ->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('recorded_by_user_id', 'partner_venue_visits_recorded_by_foreign')
                ->references('id')->on('users')->nullOnDelete();
        });
    }
};
