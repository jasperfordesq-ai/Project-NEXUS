<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Seed a rich Swiss caring-community demo tenant.
 *
 * This command is intentionally tenant-scoped and idempotent. It uses stable
 * slugs, emails, and titles so it can be rerun after schema changes without
 * multiplying the visible demo content.
 */
class SeedAgorisDemoData extends Command
{
    protected $signature = 'tenant:seed-agoris-demo
        {slug=agoris : Tenant slug to seed}
        {--dry-run : Show what would be seeded without writing anything}';

    protected $description = 'Seed the Agoris/KISS caring-community demo tenant with rich sample data';

    /**
     * Shared strong demo password for ALL seeded Agoris demo accounts.
     *
     * 23 chars, mixed case, digit, symbol — meets every reasonable strong-password rule.
     * The same passphrase is used by `SeedAgorisRealisticContent` and `SeedAgorisPolish`
     * so a pilot evaluator can sign in as any seeded persona without a per-user lookup.
     * Rotate if Agoris ever moves from a demo/pilot tenant to a production one.
     */
    public const DEMO_PASSWORD = 'Cham-Caring-Pilot-2026!';

    /** @var array<string, list<string>> */
    private array $columns = [];

    /** @var array<string, int> */
    private array $counts = [];

    public function handle(): int
    {
        $slug = ltrim((string) $this->argument('slug'), '/');
        $dryRun = (bool) $this->option('dry-run');

        $tenant = DB::table('tenants')->where('slug', $slug)->first(['id', 'name', 'slug']);
        if (! $tenant) {
            $this->error("No tenant found for slug '{$slug}'. Create the tenant first, then rerun this command.");
            return self::FAILURE;
        }

        $tenantId = (int) $tenant->id;
        $this->info("Tenant: {$tenant->name} (id={$tenantId}, slug={$tenant->slug})");

        if ($dryRun) {
            $this->line('DRY RUN: would apply the caring-community preset and seed users, categories, listings, groups, events, volunteering, wallet activity, feed posts, polls, goals, and resources.');
            return self::SUCCESS;
        }

        $this->call('tenant:apply-caring-community-preset', ['slug' => $slug]);

        $this->seedTenantProfile($tenantId);
        $categories = $this->seedCategories($tenantId);
        $users = $this->seedUsers($tenantId);
        $groups = $this->seedGroups($tenantId, $users);
        $orgs = $this->seedVolunteerOrganizations($tenantId, $users);
        $opportunities = $this->seedVolunteerOpportunities($tenantId, $users, $orgs, $categories);
        $this->seedVolunteerActivity($tenantId, $users, $opportunities);
        $this->seedListings($tenantId, $users, $categories);
        $this->seedEvents($tenantId, $users, $groups, $categories);
        $this->seedTransactions($tenantId, $users);
        $this->seedFeed($tenantId, $users, $groups);
        $this->seedPollsAndGoals($tenantId, $users);
        $this->seedResources($tenantId, $users, $categories);

        $this->newLine();
        $this->info('Agoris demo seed complete.');
        foreach ($this->counts as $label => $count) {
            $this->line(sprintf('  %-24s %d', $label, $count));
        }
        $this->newLine();
        $this->line('Demo admin: agoris.admin@example.test / ' . self::DEMO_PASSWORD);

        return self::SUCCESS;
    }

    private function seedTenantProfile(int $tenantId): void
    {
        $existingConfig = DB::table('tenants')->where('id', $tenantId)->value('configuration');
        $config = is_string($existingConfig) ? (json_decode($existingConfig, true) ?: []) : [];
        $config['default_language'] = 'de';
        $config['supported_languages'] = ['de', 'fr', 'it', 'en', 'es', 'pt'];
        $config['primary_color'] = '#0f766e';
        $config['secondary_color'] = '#ea580c';
        $config['modules'] = array_merge($config['modules'] ?? [], [
            'feed' => true,
            'listings' => true,
            'messages' => true,
            'wallet' => true,
            'notifications' => true,
            'profile' => true,
            'settings' => true,
            'dashboard' => true,
        ]);

        $this->updateById('tenants', $tenantId, [
            'name' => 'Agoris Caring Community',
            'tagline' => 'Digitale Caring Community fuer Zeitbank, Nachbarschaftshilfe und regionale Teilhabe',
            'country_code' => 'CH',
            'configuration' => json_encode($config),
            'is_active' => 1,
            'updated_at' => now(),
        ]);

        $settings = [
            'site_name' => 'Agoris Caring Community',
            'currency_name' => 'Stunden',
            'currency_symbol' => 'h',
            'default_balance' => '5.00',
            'registration_mode' => 'invite',
            'theme' => 'caring-community',
            'general.maintenance_mode' => 'false',
            'onboarding.country_preset' => 'switzerland',
        ];

        foreach ($settings as $key => $value) {
            $this->upsertSetting($tenantId, $key, $value);
        }
    }

    /**
     * @return array<string, int>
     */
    private function seedCategories(int $tenantId): array
    {
        $names = [
            'Alltagshilfe',
            'Begleitung & Besuche',
            'Transport',
            'Digitale Hilfe',
            'Gesundheit & Wohlbefinden',
            'Kinder & Familien',
            'Lokale Wirtschaft',
            'Verwaltung & Formulare',
            'Garten & Haushalt',
            'Sprache & Integration',
        ];

        $ids = [];
        foreach ($names as $sort => $name) {
            $ids[$name] = $this->upsertAndGetId('categories', ['tenant_id' => $tenantId, 'name' => $name], [
                'slug' => Str::slug($name),
                'sort_order' => $sort,
                'is_active' => 1,
                'updated_at' => now(),
            ]);
            $this->bump('categories');
        }

        return $ids;
    }

    /**
     * @return array<string, int>
     */
    private function seedUsers(int $tenantId): array
    {
        $rows = [
            ['key' => 'admin', 'first' => 'Agoris', 'last' => 'Admin', 'email' => 'agoris.admin@example.test', 'role' => 'admin', 'balance' => 120, 'location' => 'Cham, Zug', 'bio' => 'Koordination fuer die Agoris Caring Community.'],
            ['key' => 'anna', 'first' => 'Anna', 'last' => 'Baumann', 'email' => 'anna.baumann@example.test', 'role' => 'member', 'balance' => 32, 'location' => 'Zuerich Altstetten', 'bio' => 'Pensionierte Pflegefachfrau; bietet Begleitung, Vorlesen und kurze Entlastung fuer Angehoerige.'],
            ['key' => 'luca', 'first' => 'Luca', 'last' => 'Meier', 'email' => 'luca.meier@example.test', 'role' => 'member', 'balance' => 18, 'location' => 'Cham', 'bio' => 'Student, hilft mit Smartphone, Tablet und digitalen Formularen.'],
            ['key' => 'maria', 'first' => 'Maria', 'last' => 'Rossi', 'email' => 'maria.rossi@example.test', 'role' => 'member', 'balance' => 41, 'location' => 'Zug', 'bio' => 'Mehrsprachige Nachbarin mit Italienisch, Deutsch und Franzoesisch.'],
            ['key' => 'samira', 'first' => 'Samira', 'last' => 'Keller', 'email' => 'samira.keller@example.test', 'role' => 'member', 'balance' => 24, 'location' => 'Zuerich Oerlikon', 'bio' => 'Koordiniert Familienhilfe, Kinderbetreuung und Fahrgemeinschaften.'],
            ['key' => 'peter', 'first' => 'Peter', 'last' => 'Huber', 'email' => 'peter.huber@example.test', 'role' => 'member', 'balance' => 12, 'location' => 'Baar', 'bio' => 'Benutzt die Zeitbank fuer Gartenhilfe und bietet kleine Reparaturen an.'],
            ['key' => 'elena', 'first' => 'Elena', 'last' => 'Widmer', 'email' => 'elena.widmer@example.test', 'role' => 'member', 'balance' => 27, 'location' => 'Winterthur', 'bio' => 'Freiwillige Besucherin fuer aeltere Menschen und Kulturvermittlerin.'],
            ['key' => 'thomas', 'first' => 'Thomas', 'last' => 'Schmid', 'email' => 'thomas.schmid@example.test', 'role' => 'member', 'balance' => 35, 'location' => 'Zuerich Seefeld', 'bio' => 'Lokaler Gewerbler, engagiert sich fuer regionale Kreislaufwirtschaft.'],
        ];

        $ids = [];
        foreach ($rows as $row) {
            $ids[$row['key']] = $this->upsertAndGetId('users', ['tenant_id' => $tenantId, 'email' => $row['email']], [
                'first_name' => $row['first'],
                'last_name' => $row['last'],
                'name' => "{$row['first']} {$row['last']}",
                'password_hash' => Hash::make(self::DEMO_PASSWORD),
                'role' => $row['role'],
                'status' => 'active',
                'bio' => $row['bio'],
                'location' => $row['location'],
                'phone' => '+41 44 555 ' . random_int(1000, 9999),
                'is_verified' => 1,
                'is_approved' => 1,
                'balance' => $row['balance'],
                'profile_type' => 'individual',
                'onboarding_completed' => 1,
                'email_verified_at' => now(),
                'last_active_at' => now()->subHours(random_int(1, 72)),
                'updated_at' => now(),
            ]);
            $this->bump('users');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $users
     * @return array<string, int>
     */
    private function seedGroups(int $tenantId, array $users): array
    {
        $groups = [
            ['key' => 'kreis4', 'name' => 'Nachbarschaft Kreis 4 hilft', 'owner' => 'anna', 'location' => 'Zuerich Kreis 4', 'description' => 'Lokale Koordination fuer Einkaufshilfe, Begegnung und schnelle Entlastung im Quartier.'],
            ['key' => 'zug', 'name' => 'Caring Community Zug-Cham', 'owner' => 'samira', 'location' => 'Cham und Zug', 'description' => 'Pilotgruppe fuer eine vernetzte Sorgende Gemeinschaft im Kanton Zug.'],
            ['key' => 'digital', 'name' => 'Digitale Alltagshilfe 60+', 'owner' => 'luca', 'location' => 'Hybrid', 'description' => 'Smartphone-Sprechstunden, E-Banking-Basics und digitale Formulare in ruhigem Tempo.'],
        ];

        $ids = [];
        foreach ($groups as $group) {
            $ids[$group['key']] = $this->upsertAndGetId('groups', ['tenant_id' => $tenantId, 'name' => $group['name']], [
                'owner_id' => $users[$group['owner']],
                'description' => $group['description'],
                'visibility' => 'public',
                'location' => $group['location'],
                'is_featured' => 1,
                'cached_member_count' => count($users),
                'updated_at' => now(),
            ]);
            foreach ($users as $userId) {
                $this->upsert('group_members', ['tenant_id' => $tenantId, 'group_id' => $ids[$group['key']], 'user_id' => $userId], [
                    'role' => $userId === $users[$group['owner']] ? 'admin' : 'member',
                    'status' => 'active',
                    'updated_at' => now(),
                ]);
            }
            $this->bump('groups');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $users
     * @return array<string, int>
     */
    private function seedVolunteerOrganizations(int $tenantId, array $users): array
    {
        $orgs = [
            ['key' => 'kiss', 'name' => 'KISS Zeitbank Pilot Zuerich', 'owner' => 'admin', 'email' => 'kiss-zurich@example.test', 'balance' => 220, 'description' => 'Kooperative fuer Zeitvorsorge, Besuchsdienste und gegenseitige Unterstuetzung.'],
            ['key' => 'spitex', 'name' => 'Spitex Partnernetz Zug', 'owner' => 'anna', 'email' => 'spitex-zug@example.test', 'balance' => 90, 'description' => 'Fiktiver Pflege- und Entlastungspartner fuer nicht-medizinische Nachbarschaftshilfe.'],
            ['key' => 'municipality', 'name' => 'Stadt Zuerich Quartierkoordination', 'owner' => 'samira', 'email' => 'quartier@example.test', 'balance' => 150, 'description' => 'Kommunale Koordination fuer quartierbezogene Caring-Community-Aktivitaeten.'],
            ['key' => 'local', 'name' => 'Gewerbe Cham Lokal', 'owner' => 'thomas', 'email' => 'gewerbe-cham@example.test', 'balance' => 60, 'description' => 'Lokale Betriebe, die Zeitbank-Aktionen und niederschwellige Alltagshilfe unterstuetzen.'],
        ];

        $ids = [];
        foreach ($orgs as $org) {
            $ids[$org['key']] = $this->upsertAndGetId('vol_organizations', ['tenant_id' => $tenantId, 'slug' => Str::slug($org['name'])], [
                'user_id' => $users[$org['owner']],
                'name' => $org['name'],
                'description' => $org['description'],
                'contact_email' => $org['email'],
                'website' => 'https://agoris.ch',
                'status' => 'active',
                'auto_pay_enabled' => 1,
                'balance' => $org['balance'],
                'updated_at' => now(),
            ]);
            $this->bump('organisations');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $users
     * @param array<string, int> $orgs
     * @param array<string, int> $categories
     * @return array<string, int>
     */
    private function seedVolunteerOpportunities(int $tenantId, array $users, array $orgs, array $categories): array
    {
        $rows = [
            ['key' => 'visits', 'org' => 'kiss', 'user' => 'anna', 'cat' => 'Begleitung & Besuche', 'title' => 'Woechentliche Besuchsrunde fuer alleinlebende Seniorinnen', 'location' => 'Zuerich Altstetten', 'skills' => 'Zuhoeren, Geduld, Deutsch oder Schweizerdeutsch'],
            ['key' => 'digital', 'org' => 'municipality', 'user' => 'luca', 'cat' => 'Digitale Hilfe', 'title' => 'Smartphone-Sprechstunde im Quartierzentrum', 'location' => 'Zuerich Oerlikon', 'skills' => 'Smartphone, E-Mail, Online-Formulare'],
            ['key' => 'transport', 'org' => 'spitex', 'user' => 'peter', 'cat' => 'Transport', 'title' => 'Begleitfahrten zu Arztterminen und Apotheken', 'location' => 'Zug und Cham', 'skills' => 'Fahrerlaubnis, Zuverlaessigkeit, Diskretion'],
            ['key' => 'market', 'org' => 'local', 'user' => 'thomas', 'cat' => 'Lokale Wirtschaft', 'title' => 'Lokaler Einkauf mit Bringdienst gegen Zeitgutschrift', 'location' => 'Cham Dorfzentrum', 'skills' => 'Organisation, Einkauf, freundlicher Kontakt'],
            ['key' => 'forms', 'org' => 'municipality', 'user' => 'maria', 'cat' => 'Verwaltung & Formulare', 'title' => 'Hilfe bei Formularen, Terminen und Behoerdenbriefen', 'location' => 'Zuerich und online', 'skills' => 'Deutsch, Italienisch, Franzoesisch, Verwaltung'],
        ];

        $ids = [];
        foreach ($rows as $idx => $row) {
            $ids[$row['key']] = $this->upsertAndGetId('vol_opportunities', ['tenant_id' => $tenantId, 'title' => $row['title']], [
                'created_by' => $users[$row['user']],
                'organization_id' => $orgs[$row['org']],
                'description' => $row['title'] . '. Diese Gelegenheit zeigt, wie koordinierte Nachbarschaftshilfe in eine Zeitbank eingebettet werden kann.',
                'location' => $row['location'],
                'skills_needed' => $row['skills'],
                'start_date' => now()->addDays(3 + $idx)->toDateString(),
                'end_date' => now()->addMonths(4)->toDateString(),
                'category_id' => $categories[$row['cat']] ?? null,
                'status' => 'open',
                'is_active' => 1,
                'updated_at' => now(),
            ]);
            $this->bump('opportunities');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $users
     * @param array<string, int> $opportunities
     */
    private function seedVolunteerActivity(int $tenantId, array $users, array $opportunities): void
    {
        $i = 0;
        foreach ($opportunities as $key => $opportunityId) {
            $organizationId = DB::table('vol_opportunities')
                ->where('tenant_id', $tenantId)
                ->where('id', $opportunityId)
                ->value('organization_id');
            $start = Carbon::now()->addDays(7 + $i)->setTime(9 + ($i % 4), 0);
            $shiftId = $this->upsertAndGetId('vol_shifts', ['tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'start_time' => $start], [
                'end_time' => (clone $start)->addHours(3),
                'capacity' => 6,
                'registered_count' => 2,
                'waitlist_count' => 0,
                'updated_at' => now(),
            ]);

            $helperKeys = array_slice(array_keys($users), 1 + ($i % 3), 3);
            foreach ($helperKeys as $helperKey) {
                $this->upsert('vol_applications', ['tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'user_id' => $users[$helperKey]], [
                    'message' => 'Ich kann diese Aufgabe regelmaessig uebernehmen und freue mich auf die Koordination.',
                    'shift_id' => $shiftId,
                    'status' => 'approved',
                    'updated_at' => now(),
                ]);

                $this->upsert('vol_logs', ['tenant_id' => $tenantId, 'opportunity_id' => $opportunityId, 'user_id' => $users[$helperKey], 'date_logged' => now()->subDays(10 + $i)->toDateString()], [
                    'organization_id' => $organizationId,
                    'hours' => 2.5 + ($i % 3),
                    'description' => 'Verifizierte Stunden fuer Caring-Community-Unterstuetzung.',
                    'status' => 'approved',
                    'verified_by' => $users['admin'] ?? null,
                    'verified_at' => now()->subDays(8 + $i),
                    'updated_at' => now(),
                ]);
            }

            $i++;
            $this->bump('shifts');
        }
    }

    /**
     * @param array<string, int> $users
     * @param array<string, int> $categories
     */
    private function seedListings(int $tenantId, array $users, array $categories): void
    {
        $rows = [
            ['user' => 'anna', 'cat' => 'Begleitung & Besuche', 'type' => 'offer', 'hours' => 1.5, 'title' => 'Ich begleite Sie zum Spaziergang oder Kaffee', 'location' => 'Zuerich Altstetten'],
            ['user' => 'luca', 'cat' => 'Digitale Hilfe', 'type' => 'offer', 'hours' => 1, 'title' => 'Smartphone, WhatsApp und Online-Termine ruhig erklaert', 'location' => 'Cham oder online'],
            ['user' => 'peter', 'cat' => 'Garten & Haushalt', 'type' => 'offer', 'hours' => 2, 'title' => 'Kleine Reparaturen und Lampen montieren', 'location' => 'Baar'],
            ['user' => 'maria', 'cat' => 'Sprache & Integration', 'type' => 'offer', 'hours' => 1, 'title' => 'Italienisch-Deutsch Tandem fuer Alltagssituationen', 'location' => 'Zug'],
            ['user' => 'samira', 'cat' => 'Kinder & Familien', 'type' => 'request', 'hours' => 2, 'title' => 'Suche Begleitung fuer Kinderwagenrunde am Mittwoch', 'location' => 'Zuerich Oerlikon'],
            ['user' => 'elena', 'cat' => 'Verwaltung & Formulare', 'type' => 'request', 'hours' => 1.5, 'title' => 'Hilfe beim Ausfuellen eines Versicherungsformulars', 'location' => 'Winterthur'],
            ['user' => 'thomas', 'cat' => 'Lokale Wirtschaft', 'type' => 'request', 'hours' => 3, 'title' => 'Freiwillige fuer Quartiermarkt-Infostand gesucht', 'location' => 'Cham Dorfplatz'],
        ];

        foreach ($rows as $idx => $row) {
            $this->upsert('listings', ['tenant_id' => $tenantId, 'title' => $row['title']], [
                'user_id' => $users[$row['user']],
                'category_id' => $categories[$row['cat']] ?? null,
                'description' => $row['title'] . '. Angebot fuer die Agoris Caring Community mit Zeitgutschrift und Vertrauenssignalen.',
                'type' => $row['type'],
                'status' => 'active',
                'location' => $row['location'],
                'price' => $row['hours'],
                'hours_estimate' => $row['hours'],
                'service_type' => $idx % 2 === 0 ? 'in-person' : 'either',
                'exchange_workflow_required' => 1,
                'availability' => json_encode(['weekday_mornings' => true, 'weekend' => $idx % 2 === 0]),
                'view_count' => 20 + ($idx * 9),
                'contact_count' => 2 + $idx,
                'is_featured' => $idx < 3 ? 1 : 0,
                'featured_until' => $idx < 3 ? now()->addWeeks(3) : null,
                'updated_at' => now(),
            ]);
            $this->bump('listings');
        }
    }

    /**
     * @param array<string, int> $users
     * @param array<string, int> $groups
     * @param array<string, int> $categories
     */
    private function seedEvents(int $tenantId, array $users, array $groups, array $categories): void
    {
        $events = [
            ['title' => 'Halbtageskonferenz: Zeitbank und demografischer Wandel', 'user' => 'admin', 'group' => 'zug', 'cat' => 'Gesundheit & Wohlbefinden', 'days' => 12, 'location' => 'Zuerich, Stadthaus'],
            ['title' => 'Quartier-Cafe: Sorgende Gemeinschaft praktisch starten', 'user' => 'anna', 'group' => 'kreis4', 'cat' => 'Begleitung & Besuche', 'days' => 20, 'location' => 'Zuerich Kreis 4'],
            ['title' => 'Digitale Hilfe 60+: Smartphone und Passkeys', 'user' => 'luca', 'group' => 'digital', 'cat' => 'Digitale Hilfe', 'days' => 28, 'location' => 'Hybrid'],
            ['title' => 'Runder Tisch Kanton Zug: Freiwilligenstunden sichtbar machen', 'user' => 'samira', 'group' => 'zug', 'cat' => 'Verwaltung & Formulare', 'days' => 36, 'location' => 'Cham Gemeindesaal'],
        ];

        foreach ($events as $event) {
            $start = Carbon::now()->addDays($event['days'])->setTime(14, 0);
            $this->upsert('events', ['tenant_id' => $tenantId, 'title' => $event['title']], [
                'user_id' => $users[$event['user']],
                'group_id' => $groups[$event['group']] ?? null,
                'category_id' => $categories[$event['cat']] ?? null,
                'description' => 'Veranstaltung fuer Agoris/KISS-Evaluatorinnen und kommunale Partner.',
                'location' => $event['location'],
                'start_time' => $start,
                'end_time' => (clone $start)->addHours(3),
                'max_attendees' => 80,
                'is_online' => $event['location'] === 'Hybrid' ? 1 : 0,
                'allow_remote_attendance' => 1,
                'updated_at' => now(),
            ]);
            $this->bump('events');
        }
    }

    /**
     * @param array<string, int> $users
     */
    private function seedTransactions(int $tenantId, array $users): void
    {
        $rows = [
            ['from' => 'admin', 'to' => 'anna', 'amount' => 8, 'description' => 'Startgutschrift fuer Besuchsdienst-Pilot'],
            ['from' => 'admin', 'to' => 'luca', 'amount' => 5, 'description' => 'Startgutschrift fuer digitale Alltagshilfe'],
            ['from' => 'samira', 'to' => 'peter', 'amount' => 2.5, 'description' => 'Fahrdienst zum Arzttermin bestaetigt'],
            ['from' => 'elena', 'to' => 'maria', 'amount' => 1.5, 'description' => 'Formularhilfe und Uebersetzung'],
            ['from' => 'thomas', 'to' => 'anna', 'amount' => 3, 'description' => 'Begleitung Quartiermarkt und Besuchsdienst'],
        ];

        foreach ($rows as $row) {
            $this->upsert('transactions', ['tenant_id' => $tenantId, 'description' => $row['description']], [
                'sender_id' => $users[$row['from']],
                'receiver_id' => $users[$row['to']],
                'amount' => $row['amount'],
                'status' => 'completed',
                'deleted_for_sender' => 0,
                'deleted_for_receiver' => 0,
                'updated_at' => now(),
            ]);
            $this->bump('transactions');
        }
    }

    /**
     * @param array<string, int> $users
     * @param array<string, int> $groups
     */
    private function seedFeed(int $tenantId, array $users, array $groups): void
    {
        $posts = [
            ['user' => 'admin', 'group' => null, 'content' => 'Willkommen in der Agoris Caring Community: Hier sieht man Zeitbank, Caring Community, Organisationen und kommunale Koordination als zusammenhaengendes System.'],
            ['user' => 'anna', 'group' => 'kreis4', 'content' => 'Drei neue Besuchstandems sind diese Woche gestartet. Bitte meldet freie Nachmittage direkt in der Zeitbank an.'],
            ['user' => 'luca', 'group' => 'digital', 'content' => 'Die Smartphone-Sprechstunde braucht am Donnerstag noch zwei Helferinnen fuer die 60+ Gruppe.'],
            ['user' => 'samira', 'group' => 'zug', 'content' => 'Pilotidee: Jede verifizierte Unterstuetzungsstunde soll zugleich im kommunalen Wirkungsbericht sichtbar werden.'],
        ];

        foreach ($posts as $post) {
            $this->upsert('feed_posts', ['tenant_id' => $tenantId, 'content' => $post['content']], [
                'user_id' => $users[$post['user']],
                'type' => 'text',
                'visibility' => 'public',
                'group_id' => $post['group'] ? ($groups[$post['group']] ?? null) : null,
                'emoji' => 'heart',
                'updated_at' => now(),
            ]);
            $this->bump('feed posts');
        }
    }

    /**
     * @param array<string, int> $users
     */
    private function seedPollsAndGoals(int $tenantId, array $users): void
    {
        $pollId = $this->upsertAndGetId('polls', ['tenant_id' => $tenantId, 'question' => 'Welche Unterstuetzung soll im Pilotquartier zuerst ausgebaut werden?'], [
            'user_id' => $users['admin'],
            'description' => 'Umfrage fuer kommunale Priorisierung.',
            'end_date' => now()->addWeeks(2),
            'is_active' => 1,
            'category' => 'caring-community',
            'poll_type' => 'single',
            'updated_at' => now(),
        ]);

        foreach (['Besuchsdienste', 'Digitale Hilfe', 'Fahrdienste', 'Formularhilfe'] as $idx => $label) {
            $this->upsert('poll_options', ['tenant_id' => $tenantId, 'poll_id' => $pollId, 'option_text' => $label], [
                'sort_order' => $idx,
                'votes_count' => 3 + $idx,
                'updated_at' => now(),
            ]);
        }
        $this->bump('polls');

        $goals = [
            ['user' => 'admin', 'title' => '250 verifizierte Unterstuetzungsstunden im Pilotquartier', 'description' => 'Kommunales Wirkungsziel fuer die erste Pilotperiode.'],
            ['user' => 'anna', 'title' => 'Zehn regelmaessige Besuchstandems aufbauen', 'description' => 'Soziale Isolation reduzieren und verlaessliche Beziehungen schaffen.'],
            ['user' => 'luca', 'title' => 'Monatliche Smartphone-Sprechstunde etablieren', 'description' => 'Digitale Teilhabe fuer aeltere Menschen erhoehen.'],
        ];

        foreach ($goals as $goal) {
            $this->upsert('goals', ['tenant_id' => $tenantId, 'title' => $goal['title']], [
                'user_id' => $users[$goal['user']],
                'description' => $goal['description'],
                'deadline' => now()->addMonths(3),
                'is_public' => 1,
                'status' => 'active',
                'updated_at' => now(),
            ]);
            $this->bump('goals');
        }
    }

    /**
     * @param array<string, int> $users
     * @param array<string, int> $categories
     */
    private function seedResources(int $tenantId, array $users, array $categories): void
    {
        $table = 'resource_items';
        if (
            ! Schema::hasTable($table)
            || ! $this->hasColumn($table, 'title')
            || ! $this->hasColumn($table, 'user_id')
        ) {
            $table = 'resources';
        }

        if (! Schema::hasTable($table) || ! $this->hasColumn($table, 'title')) {
            $this->warn('Skipping resources: no compatible resources table exists in this schema.');
            return;
        }

        $resources = [
            ['title' => 'Leitfaden Zeitvorsorge und Caring Communities', 'cat' => 'Gesundheit & Wohlbefinden'],
            ['title' => 'Checkliste Freiwilligenkoordination fuer Gemeinden', 'cat' => 'Verwaltung & Formulare'],
            ['title' => 'Merkblatt Datenschutz und Einwilligung im Besuchsdienst', 'cat' => 'Begleitung & Besuche'],
            ['title' => 'Vorlage Wirkungsbericht: Stunden, Teilhabe, Entlastung', 'cat' => 'Lokale Wirtschaft'],
        ];

        foreach ($resources as $resource) {
            $this->upsert($table, ['tenant_id' => $tenantId, 'title' => $resource['title']], [
                'user_id' => $users['admin'],
                'description' => 'Ressource fuer Agoris/KISS-Evaluatorinnen, Kommunen und Koordinatoren.',
                'file_path' => 'uploads/resources/agoris-demo/' . Str::slug($resource['title']) . '.pdf',
                'file_type' => 'pdf',
                'file_size' => 240000,
                'category_id' => $categories[$resource['cat']] ?? null,
                'content_type' => 'markdown',
                'content_body' => 'Praxisinhalt fuer Wirkungsberichte, Koordination und Datenschutz in einer Caring Community.',
                'downloads' => random_int(4, 35),
                'updated_at' => now(),
            ]);
            $this->bump('resources');
        }
    }

    /**
     * @param array<string, mixed> $identity
     * @param array<string, mixed> $values
     */
    private function upsertAndGetId(string $table, array $identity, array $values): int
    {
        $this->upsert($table, $identity, $values);
        $row = DB::table($table);
        foreach ($identity as $key => $value) {
            $row->where($key, $value);
        }

        return (int) $row->value('id');
    }

    /**
     * @param array<string, mixed> $identity
     * @param array<string, mixed> $values
     */
    private function upsert(string $table, array $identity, array $values): void
    {
        if (! Schema::hasTable($table)) {
            return;
        }

        $filteredIdentity = $this->filterColumns($table, $identity);
        if (empty($filteredIdentity)) {
            return;
        }

        $payload = $this->filterColumns($table, array_merge($identity, $values));
        if ($this->hasColumn($table, 'created_at') && ! array_key_exists('created_at', $payload)) {
            $payload['created_at'] = now();
        }
        if ($this->hasColumn($table, 'updated_at') && ! array_key_exists('updated_at', $payload)) {
            $payload['updated_at'] = now();
        }

        DB::table($table)->updateOrInsert($filteredIdentity, $payload);
    }

    /**
     * @param array<string, mixed> $values
     */
    private function updateById(string $table, int $id, array $values): void
    {
        if (! Schema::hasTable($table)) {
            return;
        }

        DB::table($table)->where('id', $id)->update($this->filterColumns($table, $values));
    }

    private function upsertSetting(int $tenantId, string $key, string $value): void
    {
        if (! Schema::hasTable('tenant_settings')) {
            return;
        }

        $keyColumn = $this->hasColumn('tenant_settings', 'setting_key') ? 'setting_key' : 'key';
        $valueColumn = $this->hasColumn('tenant_settings', 'setting_value') ? 'setting_value' : 'value';
        $typeColumn = $this->hasColumn('tenant_settings', 'setting_type') ? 'setting_type' : 'type';
        $this->upsert('tenant_settings', ['tenant_id' => $tenantId, $keyColumn => $key], [
            $valueColumn => $value,
            $typeColumn => $value === 'false' || $value === 'true' ? 'boolean' : 'string',
            'category' => str_contains($key, '.') ? Str::before($key, '.') : 'general',
            'updated_at' => now(),
        ]);
        $this->bump('settings');
    }

    /**
     * @param array<string, mixed> $values
     * @return array<string, mixed>
     */
    private function filterColumns(string $table, array $values): array
    {
        $columns = $this->columns[$table] ??= Schema::getColumnListing($table);

        return array_filter(
            $values,
            static fn (string $key): bool => in_array($key, $columns, true),
            ARRAY_FILTER_USE_KEY
        );
    }

    private function hasColumn(string $table, string $column): bool
    {
        $columns = $this->columns[$table] ??= Schema::getColumnListing($table);

        return in_array($column, $columns, true);
    }

    private function bump(string $label): void
    {
        $this->counts[$label] = ($this->counts[$label] ?? 0) + 1;
    }
}
