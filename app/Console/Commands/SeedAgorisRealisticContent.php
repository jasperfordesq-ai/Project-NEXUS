<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\CaringCommunityRolePresetService;
use App\Support\Console\RefusesUnsafeSeeding;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Seed realistic Cham/Zug content for the Agoris demo tenant.
 *
 * Built specifically for Roland Greber and Christopher Mueller's evaluation.
 * Goal: when they open the platform it should feel like Cham at noon on a
 * Tuesday — real Swiss caring community, German content, real municipality
 * names, KISS branding, believable activity. Not test data.
 *
 * Idempotent: stable email addresses / titles / slugs are used as identity
 * columns, so re-running the command updates rather than duplicates rows.
 *
 * Coexists with `tenant:seed-agoris-demo`. That earlier seeder still owns the
 * "agoris.admin@example.test" admin account; this seeder layers on Cham
 * residents, Zug Vereine, German feed posts, etc.
 */
class SeedAgorisRealisticContent extends Command
{
    use RefusesUnsafeSeeding;

    protected $signature = 'tenant:seed-agoris-realistic
        {tenant_slug=agoris : Tenant slug to seed}
        {--dry-run : Show what would be seeded without writing}';

    protected $description = 'Seed realistic Cham/Zug Caring Community demo content for the Agoris tenant';

    /** @var array<string, list<string>> */
    private array $columns = [];

    /** @var array<string, int> */
    private array $counts = [];

    /** Cham, Zug, Switzerland — used as the spatial centre of all content. */
    private const CHAM_LAT = 47.1758;
    private const CHAM_LNG = 8.4622;

    public function handle(): int
    {
        if (($refusal = $this->refuseUnlessSafeSeedingEnvironment()) !== null) {
            return $refusal;
        }

        $slug = ltrim((string) $this->argument('tenant_slug'), '/');
        $dryRun = (bool) $this->option('dry-run');

        $tenant = DB::table('tenants')->where('slug', $slug)->first(['id', 'name', 'slug']);
        if (! $tenant) {
            $this->error("No tenant found for slug '{$slug}'. Create the tenant first, then rerun this command.");
            return self::FAILURE;
        }

        $tenantId = (int) $tenant->id;
        $this->info("Tenant: {$tenant->name} (id={$tenantId}, slug={$tenant->slug})");

        if ($dryRun) {
            $this->line('DRY RUN: would set Cham location, install KISS roles, and add 15 members, 10 organisations, 8 feed posts, 12 listings, ~70 vol logs, 5 tandem relationships, 5 events, 3 groups, 3 goals, 4 resources.');
            return self::SUCCESS;
        }

        // Make sure caring-community feature pack is on; harmless to re-run.
        $this->call('tenant:apply-caring-community-preset', ['slug' => $slug]);

        $this->configureTenantLocation($tenantId);
        $this->installKissRoles($tenantId);
        $categoryIds = $this->ensureCategories($tenantId);
        $userIds = $this->seedUsers($tenantId);
        $this->assignRoles($tenantId, $userIds);
        $orgIds = $this->seedOrganisations($tenantId, $userIds);
        $groupIds = $this->seedGroups($tenantId, $userIds);
        $this->seedFeedPosts($tenantId, $userIds, $groupIds);
        $this->seedListings($tenantId, $userIds, $categoryIds);
        $relIds = $this->seedSupportRelationships($tenantId, $userIds, $orgIds, $categoryIds);
        $this->seedVolLogs($tenantId, $userIds, $orgIds, $relIds);
        $this->seedEvents($tenantId, $userIds, $groupIds, $categoryIds);
        $this->seedGoals($tenantId, $userIds);
        $this->seedResources($tenantId, $userIds, $categoryIds);

        $this->newLine();
        $this->info('Agoris realistic Cham/Zug content seed complete.');
        foreach ($this->counts as $label => $count) {
            $this->line(sprintf('  %-32s %d', $label, $count));
        }

        return self::SUCCESS;
    }

    private function configureTenantLocation(int $tenantId): void
    {
        $values = [
            'country_code' => 'CH',
            'location_name' => 'Cham, Zug, Schweiz',
            'latitude' => self::CHAM_LAT,
            'longitude' => self::CHAM_LNG,
            'address' => 'Obermühlestrasse 8, 6330 Cham, Zug, Schweiz',
            'updated_at' => now(),
        ];
        $this->updateById('tenants', $tenantId, $values);

        // Confirm German default in tenant_settings — kept idempotent.
        if (Schema::hasTable('tenant_settings')) {
            $this->upsertSetting($tenantId, 'onboarding.country_preset', 'switzerland');
            $this->upsertSetting($tenantId, 'site_name', 'Agoris Caring Community');
            $this->upsertSetting($tenantId, 'currency_name', 'Stunden');
            $this->upsertSetting($tenantId, 'currency_symbol', 'h');
        }
    }

    private function installKissRoles(int $tenantId): void
    {
        try {
            (new CaringCommunityRolePresetService())->install($tenantId);
            $this->bump('kiss role pack installed');
        } catch (\Throwable $e) {
            $this->warn('Could not install KISS role pack: ' . $e->getMessage());
        }
    }

    /**
     * @return array<string, int>
     */
    private function ensureCategories(int $tenantId): array
    {
        $names = [
            'Begleitung & Besuche',
            'Transport & Fahrdienst',
            'Einkaufen & Botengänge',
            'Garten & Haushalt',
            'Reparaturen',
            'Digitale Hilfe',
            'Mahlzeiten & Kochen',
            'Sprache & Integration',
            'Kinderbetreuung',
            'Verwaltung & Formulare',
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
     * 15 realistic Swiss residents, mostly German-speaking, mix of generations.
     *
     * @return array<string, int>
     */
    private function seedUsers(int $tenantId): array
    {
        $rows = [
            ['key' => 'andrea',    'first' => 'Andrea',    'last' => 'Müller',     'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1758, 'lng' => 8.4622,  'skills' => 'Begleitung,Einkaufen,Garten',     'bio' => 'Pensionierte Lehrerin, freue mich auf gute Gespräche und neue Begegnungen im Quartier.'],
            ['key' => 'hans',      'first' => 'Hans',      'last' => 'Bachmann',   'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1771, 'lng' => 8.4595,  'skills' => 'Reparaturen,Velo,Garten',         'bio' => 'Ehemaliger Schreiner, helfe gerne im Quartier mit kleineren Reparaturen.'],
            ['key' => 'sabine',    'first' => 'Sabine',    'last' => 'Keller',     'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1812, 'lng' => 8.4634,  'skills' => 'Mahlzeiten,Kinderbetreuung,IT',   'bio' => 'Mutter zweier Kinder, bei IT-Fragen jederzeit ansprechbar.'],
            ['key' => 'roland',    'first' => 'Roland',    'last' => 'Schmid',     'role' => 'member',                'lang' => 'de',       'location' => 'Hünenberg',    'lat' => 47.1722, 'lng' => 8.4214,  'skills' => 'Fahrdienst,Begleitung',           'bio' => 'Selbstständig, flexible Zeiten — biete Fahrdienste in der Region Zug.'],
            ['key' => 'marlies',   'first' => 'Marlies',   'last' => 'Iten',       'role' => 'cooperative_coordinator','lang' => 'de',      'location' => 'Cham',         'lat' => 47.1748, 'lng' => 8.4609,  'skills' => 'Koordination,Organisation',       'bio' => 'KISS Cham Koordinatorin, vermittle Tandems und begleite neue Mitglieder.'],
            ['key' => 'werner',    'first' => 'Werner',    'last' => 'Hausmann',   'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1761, 'lng' => 8.4589,  'skills' => '',                                'bio' => 'Lebe allein in Cham, freue mich über Besuch und Hilfe beim Einkaufen.'],
            ['key' => 'theres',    'first' => 'Theres',    'last' => 'Studer',     'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1789, 'lng' => 8.4641,  'skills' => 'Begleitung,Gespräche',            'bio' => 'Aktive Pensionierte, gerne unterwegs — biete Begleitung und Gespräche.'],
            ['key' => 'markus',    'first' => 'Markus',    'last' => 'Felder',     'role' => 'member',                'lang' => 'de',       'location' => 'Hünenberg',    'lat' => 47.1718, 'lng' => 8.4221,  'skills' => 'Garten,Reparaturen',              'bio' => 'Gärtner aus Hünenberg, helfe bei Garten- und kleineren Hausarbeiten.'],
            ['key' => 'anna',      'first' => 'Anna',      'last' => 'Bucher',     'role' => 'member',                'lang' => 'de',       'location' => 'Steinhausen',  'lat' => 47.1947, 'lng' => 8.4858,  'skills' => 'Mahlzeiten,Sprache',              'bio' => 'Lehrerin in Steinhausen, biete Italienisch-Konversation und Mittagessen.'],
            ['key' => 'beat',      'first' => 'Beat',      'last' => 'Zürcher',    'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1755, 'lng' => 8.4651,  'skills' => 'Fahrdienst,Spaziergang',          'bio' => 'Pensionierter Pöstler aus Cham, kenne jede Strasse — gerne als Fahrer dabei.'],
            ['key' => 'erika',     'first' => 'Erika',     'last' => 'Wyss',       'role' => 'member',                'lang' => 'de',       'location' => 'Baar',         'lat' => 47.1955, 'lng' => 8.5278,  'skills' => '',                                'bio' => 'Brauche Unterstützung beim Einkaufen und bei Behördengängen.'],
            ['key' => 'stefan',    'first' => 'Stefan',    'last' => 'Birrer',     'role' => 'trusted_reviewer',      'lang' => 'de',       'location' => 'Zug',          'lat' => 47.1662, 'lng' => 8.5155,  'skills' => 'Verwaltung,Recht',                'bio' => 'Anwalt in Zug, ehrenamtliche KISS Vertrauensperson für Stundenprüfung.'],
            ['key' => 'karin',     'first' => 'Karin',     'last' => 'Lüscher',    'role' => 'member',                'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1742, 'lng' => 8.4628,  'skills' => 'Begleitung,Kochen',               'bio' => 'Pensionierte Krankenschwester, biete Begleitung und gemeinsames Kochen.'],
            ['key' => 'thomas',    'first' => 'Thomas',    'last' => 'Risi',       'role' => 'municipality_admin',    'lang' => 'de',       'location' => 'Cham',         'lat' => 47.1751, 'lng' => 8.4617,  'skills' => '',                                'bio' => 'Mitarbeiter Gemeindekanzlei Cham — Ansprechperson für offizielle Mitteilungen.'],
            ['key' => 'christine', 'first' => 'Christine', 'last' => 'Gut',        'role' => 'member',                'lang' => 'en',       'location' => 'Zug',          'lat' => 47.1671, 'lng' => 8.5169,  'skills' => 'IT,Sprachen,Mahlzeiten',          'bio' => 'ETH-Studentin, sprachlich vielseitig — DE/EN/FR — biete IT-Hilfe und Sprachtandem.'],
        ];

        $ids = [];
        foreach ($rows as $row) {
            $email = "{$row['key']}.{$row['key']}@demo-agoris.ch";
            // Use a stable demo email based on first.last, lower-cased and ASCII-safe.
            $email = strtolower(Str::ascii($row['first']) . '.' . Str::ascii($row['last']) . '@demo-agoris.ch');
            $values = [
                'first_name' => $row['first'],
                'last_name' => $row['last'],
                'name' => "{$row['first']} {$row['last']}",
                'password_hash' => Hash::make(self::resolveSeedPassword()),
                'role' => 'member',
                'status' => 'active',
                'bio' => $row['bio'],
                'location' => $row['location'] . ', Zug',
                'latitude' => $row['lat'],
                'longitude' => $row['lng'],
                'phone' => '+41 41 ' . random_int(700, 799) . ' ' . random_int(10, 99) . ' ' . random_int(10, 99),
                'is_verified' => 1,
                'is_approved' => 1,
                'balance' => random_int(8, 60),
                'profile_type' => 'individual',
                'onboarding_completed' => 1,
                'preferred_language' => $row['lang'],
                'skills' => $row['skills'],
                'email_verified_at' => now(),
                'last_active_at' => now()->subHours(random_int(1, 96)),
                'updated_at' => now(),
            ];
            $ids[$row['key']] = $this->upsertAndGetId('users', ['tenant_id' => $tenantId, 'email' => $email], $values);
            $this->bump('users');
        }

        return $ids;
    }

    /**
     * Assign KISS role-pack roles to specific users where it makes sense.
     *
     * @param array<string, int> $userIds
     */
    private function assignRoles(int $tenantId, array $userIds): void
    {
        if (! Schema::hasTable('roles') || ! Schema::hasTable('user_roles')) {
            return;
        }

        $assignments = [
            'marlies' => 'cooperative_coordinator',
            'stefan' => 'trusted_reviewer',
            'thomas' => 'municipality_admin',
        ];

        foreach ($assignments as $userKey => $presetKey) {
            if (! isset($userIds[$userKey])) {
                continue;
            }
            $roleName = 'kiss_' . $presetKey . '_t' . $tenantId;
            $role = DB::table('roles')->where('name', $roleName)->where('tenant_id', $tenantId)->first(['id']);
            if (! $role) {
                continue;
            }
            DB::table('user_roles')->updateOrInsert(
                ['user_id' => $userIds[$userKey], 'role_id' => $role->id],
                ['tenant_id' => $tenantId, 'assigned_at' => now()]
            );
            $this->bump('role assignments');
        }
    }

    /**
     * @param array<string, int> $userIds
     * @return array<string, int>
     */
    private function seedOrganisations(int $tenantId, array $userIds): array
    {
        $ownerKey = $userIds['marlies'] ?? array_values($userIds)[0];
        $rows = [
            ['key' => 'kiss_cham',      'name' => 'KISS Genossenschaft Cham',      'owner' => $userIds['marlies'] ?? $ownerKey, 'email' => 'kontakt@kiss-cham.ch',                'desc' => 'Genossenschaft Zeit-Tausch-Hilfe Cham. Sitz Obermühlestrasse 8, 6330 Cham. Hauptpartner der Caring Community.', 'auto_pay' => 1,  'balance' => 240],
            ['key' => 'spitex_zug',     'name' => 'Spitex Zug',                    'owner' => $userIds['karin'] ?? $ownerKey,   'email' => 'info@spitex-zug.ch',                  'desc' => 'Professionelle Pflege und Hauswirtschaft im Kanton Zug. Partner für nicht-medizinische Nachbarschaftshilfe.', 'auto_pay' => 0, 'balance' => 80],
            ['key' => 'pro_senectute', 'name' => 'Pro Senectute Zug',             'owner' => $userIds['theres'] ?? $ownerKey,  'email' => 'info@zg.pro-senectute.ch',            'desc' => 'Beratung und Begleitung für Menschen im Alter im Kanton Zug.', 'auto_pay' => 0, 'balance' => 60],
            ['key' => 'mtv_cham',       'name' => 'Männerturnverein Cham',         'owner' => $userIds['hans'] ?? $ownerKey,    'email' => 'praesident@mtv-cham.ch',              'desc' => 'Gegründet 1898. Wöchentliches Training Donnerstagabend in der Röhrliberg-Halle.',          'auto_pay' => 0, 'balance' => 30],
            ['key' => 'frauenchor',     'name' => 'Frauenchor Cham-Hagendorn',     'owner' => $userIds['theres'] ?? $ownerKey,  'email' => 'info@frauenchor-cham.ch',             'desc' => 'Wöchentliche Probe Dienstagabend im Pfarreizentrum St. Jakob, Cham.',                       'auto_pay' => 0, 'balance' => 18],
            ['key' => 'familientreff',  'name' => 'Familientreff Steinhausen',     'owner' => $userIds['anna'] ?? $ownerKey,    'email' => 'info@familientreff-steinhausen.ch',   'desc' => 'Treffpunkt für Familien mit Kleinkindern. Spielgruppe, Elternaustausch, Kafi und Kuchen.', 'auto_pay' => 0, 'balance' => 22],
            ['key' => 'qv_lorzenhof',   'name' => 'Quartierverein Lorzenhof',      'owner' => $userIds['andrea'] ?? $ownerKey,  'email' => 'kontakt@qv-lorzenhof.ch',             'desc' => 'Quartierverein Lorzenhof, Cham. Frühlingsfest, Quartierznacht, gemeinsame Putzaktionen.',  'auto_pay' => 0, 'balance' => 14],
            ['key' => 'velo_club',      'name' => 'Velo-Club Cham',                'owner' => $userIds['beat'] ?? $ownerKey,    'email' => 'praesident@vc-cham.ch',               'desc' => 'Sonntags-Touren rund um den Zugersee, Saison von April bis Oktober. Treffpunkt 9 Uhr Bahnhof Cham.', 'auto_pay' => 0, 'balance' => 10],
            ['key' => 'tafel_zug',      'name' => 'Tafel Zug',                     'owner' => $userIds['stefan'] ?? $ownerKey,  'email' => 'info@tafel-zug.ch',                   'desc' => 'Lebensmittel-Abgabestelle für Menschen mit kleinem Budget. Standort Industriestrasse, Zug.', 'auto_pay' => 0, 'balance' => 45],
            ['key' => 'bibliothek',     'name' => 'Bibliothek Cham',               'owner' => $userIds['thomas'] ?? $ownerKey,  'email' => 'bibliothek@cham.ch',                  'desc' => 'Bibliothek der Gemeinde Cham, Mandelhof. Lesungen, Vorträge und Veranstaltungen für die Caring Community.', 'auto_pay' => 0, 'balance' => 25],
        ];

        $ids = [];
        foreach ($rows as $row) {
            $values = [
                'user_id' => $row['owner'],
                'name' => $row['name'],
                'description' => $row['desc'],
                'contact_email' => $row['email'],
                'website' => 'https://demo-agoris.ch',
                'status' => 'active',
                'auto_pay_enabled' => $row['auto_pay'],
                'balance' => $row['balance'],
                'updated_at' => now(),
            ];
            $ids[$row['key']] = $this->upsertAndGetId(
                'vol_organizations',
                ['tenant_id' => $tenantId, 'slug' => Str::slug($row['name'])],
                $values
            );
            $this->bump('organisations');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $userIds
     * @return array<string, int>
     */
    private function seedGroups(int $tenantId, array $userIds): array
    {
        $rows = [
            ['key' => 'caring_cham',   'name' => 'Caring Community Cham',     'owner' => $userIds['marlies'] ?? array_values($userIds)[0], 'desc' => 'Sorgende Gemeinschaft in Cham — Menschen, die sich gegenseitig im Alltag unterstützen.',                  'location' => 'Cham, Zug'],
            ['key' => 'pensionierte',  'name' => 'Pensionierte Cham',         'owner' => $userIds['theres']  ?? array_values($userIds)[0], 'desc' => 'Treffpunkt für Pensionierte aus Cham und Umgebung — Spaziergänge, Kaffee, Gesellschaftsspiele.',           'location' => 'Cham, Zug'],
            ['key' => 'familien',      'name' => 'Junge Familien Steinhausen','owner' => $userIds['anna']    ?? array_values($userIds)[0], 'desc' => 'Eltern und Familien aus Steinhausen — Spielgruppen, gemeinsame Ausflüge, Kinderbetreuungs-Tausch.',        'location' => 'Steinhausen, Zug'],
        ];

        $ids = [];
        foreach ($rows as $row) {
            $values = [
                'owner_id' => $row['owner'],
                'creator_id' => $row['owner'],
                'description' => $row['desc'],
                'visibility' => 'public',
                'location' => $row['location'],
                'is_featured' => 1,
                'is_active' => 1,
                'status' => 'active',
                'cached_member_count' => max(3, count($userIds) - 2),
                'slug' => Str::slug($row['name']),
                'updated_at' => now(),
            ];
            $ids[$row['key']] = $this->upsertAndGetId(
                'groups',
                ['tenant_id' => $tenantId, 'name' => $row['name']],
                $values
            );

            // Add all users as members (idempotent).
            if (Schema::hasTable('group_members')) {
                foreach ($userIds as $userId) {
                    $memberValues = [
                        'role' => $userId === $row['owner'] ? 'admin' : 'member',
                        'status' => 'active',
                        'updated_at' => now(),
                    ];
                    $this->upsert('group_members', [
                        'tenant_id' => $tenantId,
                        'group_id' => $ids[$row['key']],
                        'user_id' => $userId,
                    ], $memberValues);
                }
            }

            $this->bump('groups');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $groupIds
     */
    private function seedFeedPosts(int $tenantId, array $userIds, array $groupIds): void
    {
        $rows = [
            ['user' => 'thomas',  'group' => null,             'days_ago' => 3,  'content' => 'Hinweis Gemeindekanzlei Cham: Ab 1. Mai gelten neue Öffnungszeiten — Montag bis Freitag 8.00–12.00 und 13.30–17.00 Uhr, Donnerstag bis 18.30 Uhr. Bei Fragen meldet euch direkt unter 041 723 87 11.'],
            ['user' => 'marlies', 'group' => 'caring_cham',    'days_ago' => 1,  'content' => 'Diese Woche wurden in der Caring Community Cham 12 neue Stunden geleistet — herzlichen Dank an alle Helferinnen und Helfer. Besonders schön: drei neue Tandems sind diese Woche gestartet.'],
            ['user' => 'marlies', 'group' => 'caring_cham',    'days_ago' => 2,  'content' => 'Wir suchen noch jemanden für eine Begleitung von Herrn Hausmann zum Augenarzt am Donnerstag, 10.30 Uhr (Cham → Zug, mit dem Bus). Wer könnte? Bitte direkt bei mir melden.'],
            ['user' => 'hans',    'group' => null,             'days_ago' => 5,  'content' => 'Ich kann diese Woche zwei Stunden im Garten helfen — am liebsten Mittwoch- oder Freitagnachmittag. Meldet euch einfach!'],
            ['user' => 'anna',    'group' => 'caring_cham',    'days_ago' => 4,  'content' => 'Biete Italienisch-Konversation für Anfänger und Fortgeschrittene. Gerne in kleiner Runde im Familientreff Steinhausen — eine Stunde pro Woche.'],
            ['user' => 'sabine',  'group' => null,             'days_ago' => 6,  'content' => 'Suche jemanden für eine kleine Velo-Reparatur (hinterer Bremszug). Biete dafür IT-Hilfe oder eine Mahlzeit zurück. Vielen Dank!'],
            ['user' => 'andrea',  'group' => 'pensionierte',   'days_ago' => 8,  'content' => 'Hat jemand Lust auf gemeinsames Mittagessen am Sonntag? Ich koche eine grosse Lasagne, in meiner Wohnung in Cham — wer kommt mit?'],
            ['user' => 'hans',    'group' => null,             'days_ago' => 10, 'content' => 'Männerturnverein Cham: Jahresversammlung am Freitag, 19.30 Uhr im Restaurant Bahnhöfli. Alle Mitglieder sind herzlich eingeladen.'],
        ];

        foreach ($rows as $row) {
            $userId = $userIds[$row['user']] ?? null;
            if ($userId === null) {
                continue;
            }
            $created = now()->subDays($row['days_ago'])->subHours(random_int(0, 23));
            $values = [
                'user_id' => $userId,
                'group_id' => $row['group'] ? ($groupIds[$row['group']] ?? null) : null,
                'type' => 'post',
                'visibility' => 'public',
                'publish_status' => 'published',
                'likes_count' => random_int(2, 14),
                'views_count' => random_int(20, 90),
                'created_at' => $created,
                'updated_at' => $created,
            ];
            $this->upsert(
                'feed_posts',
                ['tenant_id' => $tenantId, 'user_id' => $userId, 'content' => $row['content']],
                $values
            );
            $this->bump('feed posts');
        }
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $categoryIds
     */
    private function seedListings(int $tenantId, array $userIds, array $categoryIds): void
    {
        $rows = [
            ['user' => 'hans',     'cat' => 'Reparaturen',           'type' => 'offer',   'hours' => 1, 'title' => 'Velo-Reparatur — kleinere Defekte',          'desc' => 'Ich repariere Velos in meiner kleinen Werkstatt in Cham. Bremsen, Reifen, Kette, Schaltung — alles was ohne grössere Spezialwerkzeuge geht.', 'location' => 'Cham'],
            ['user' => 'theres',   'cat' => 'Begleitung & Besuche',  'type' => 'offer',   'hours' => 1, 'title' => 'Begleitung zum Arzt oder Spital',           'desc' => 'Begleite gerne zu Arztterminen oder ins Spital — auch zum Warten und für den Heimweg.', 'location' => 'Cham und Zug'],
            ['user' => 'sabine',   'cat' => 'Digitale Hilfe',        'type' => 'offer',   'hours' => 1, 'title' => 'IT-Hilfe für Senioren',                     'desc' => 'Smartphone, Tablet, E-Mail, Online-Banking — wir gehen die Themen ruhig durch, ohne Stress.', 'location' => 'Cham'],
            ['user' => 'andrea',   'cat' => 'Einkaufen & Botengänge','type' => 'offer',   'hours' => 1, 'title' => 'Hilfe beim Einkaufen',                       'desc' => 'Ich nehme den wöchentlichen Einkauf gerne mit — Migros, Coop oder Volg. Auch nur zum Tragen.', 'location' => 'Cham'],
            ['user' => 'markus',   'cat' => 'Garten & Haushalt',     'type' => 'offer',   'hours' => 2, 'title' => 'Garten-Pflege Frühling',                    'desc' => 'Frühlingsschnitt, Beete vorbereiten, Rasen vertikutieren. Bringe eigenes Werkzeug mit.', 'location' => 'Hünenberg'],
            ['user' => 'anna',     'cat' => 'Sprache & Integration', 'type' => 'offer',   'hours' => 1, 'title' => 'Sprachpartner Italienisch',                  'desc' => 'Italienische Konversation für Alltag und Reisen — auch für Fortgeschrittene.', 'location' => 'Steinhausen'],
            ['user' => 'beat',     'cat' => 'Transport & Fahrdienst','type' => 'offer',   'hours' => 1, 'title' => 'Fahrdienst Region Zug',                      'desc' => 'Fahre gerne in der Region Cham, Zug, Baar, Steinhausen. Auch zu Terminen ausserhalb des Kantons möglich.', 'location' => 'Cham'],
            ['user' => 'karin',    'cat' => 'Begleitung & Besuche',  'type' => 'offer',   'hours' => 1, 'title' => 'Spaziergang und Gespräch',                   'desc' => 'Spaziergänge entlang der Lorze oder am Zugersee — gerne auch nur für ein gutes Gespräch.', 'location' => 'Cham'],
            ['user' => 'werner',   'cat' => 'Transport & Fahrdienst','type' => 'request','hours' => 2, 'title' => 'Brauche Fahrdienst nach Zürich',             'desc' => 'Suche jemanden, der mich am 14. Mai zu einem Termin im Universitätsspital Zürich begleitet — Hin- und Rückfahrt.', 'location' => 'Cham → Zürich'],
            ['user' => 'erika',    'cat' => 'Einkaufen & Botengänge','type' => 'request','hours' => 1, 'title' => 'Hilfe beim wöchentlichen Einkauf',           'desc' => 'Ich brauche jemanden, der mit mir einmal pro Woche einkaufen geht — gerne Donnerstagvormittag.', 'location' => 'Baar'],
            ['user' => 'sabine',   'cat' => 'Reparaturen',           'type' => 'request','hours' => 1, 'title' => 'Suche Hilfe bei Velo-Reparatur',             'desc' => 'Mein Velo hat ein Problem mit dem Bremszug — biete IT-Hilfe oder eine Mahlzeit als Gegenleistung.', 'location' => 'Cham'],
            ['user' => 'andrea',   'cat' => 'Mahlzeiten & Kochen',   'type' => 'offer',   'hours' => 2, 'title' => 'Gemeinsames Mittagessen',                   'desc' => 'Lade gerne 1–3 Personen zum Mittagessen ein — wir kochen zusammen oder ich koche, wenn ihr lieber redet.', 'location' => 'Cham'],
        ];

        foreach ($rows as $idx => $row) {
            $userId = $userIds[$row['user']] ?? null;
            if ($userId === null) {
                continue;
            }
            $values = [
                'user_id' => $userId,
                'category_id' => $categoryIds[$row['cat']] ?? null,
                'description' => $row['desc'],
                'type' => $row['type'],
                'status' => 'active',
                'location' => $row['location'],
                'price' => $row['hours'],
                'hours_estimate' => $row['hours'],
                'service_type' => 'physical_only',
                'exchange_workflow_required' => 1,
                'view_count' => random_int(15, 80),
                'contact_count' => random_int(0, 6),
                'is_featured' => $idx < 3 ? 1 : 0,
                'featured_until' => $idx < 3 ? now()->addWeeks(3) : null,
                'updated_at' => now(),
            ];
            $this->upsert(
                'listings',
                ['tenant_id' => $tenantId, 'user_id' => $userId, 'title' => $row['title']],
                $values
            );
            $this->bump('listings');
        }
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $orgIds
     * @param array<string, int> $categoryIds
     * @return list<int>
     */
    private function seedSupportRelationships(int $tenantId, array $userIds, array $orgIds, array $categoryIds): array
    {
        if (! Schema::hasTable('caring_support_relationships')) {
            return [];
        }

        $rows = [
            [
                'supporter' => 'andrea', 'recipient' => 'werner',
                'title' => 'Begleitung und Einkaufen für Werner',
                'desc'  => 'Wöchentlicher Besuch und Einkauf bei Herrn Hausmann — bewährtes Tandem seit acht Wochen.',
                'frequency' => 'weekly', 'expected_hours' => 2.0,
                'start_days_ago' => 56, 'status' => 'active',
                'org' => 'kiss_cham', 'cat' => 'Begleitung & Besuche',
            ],
            [
                'supporter' => 'beat', 'recipient' => 'erika',
                'title' => 'Fahrdienst für Erika Wyss',
                'desc'  => 'Fahrt zu Arztterminen und gelegentlich zum Einkaufen in Baar.',
                'frequency' => 'fortnightly', 'expected_hours' => 1.5,
                'start_days_ago' => 84, 'status' => 'active',
                'org' => 'kiss_cham', 'cat' => 'Transport & Fahrdienst',
            ],
            [
                'supporter' => 'anna', 'recipient' => 'theres',
                'title' => 'Italienisch-Gespräche mit Theres',
                'desc'  => 'Monatliches Treffen mit italienischer Konversation. Aktuell pausiert wegen Reise.',
                'frequency' => 'monthly', 'expected_hours' => 1.0,
                'start_days_ago' => 120, 'status' => 'paused',
                'org' => null, 'cat' => 'Sprache & Integration',
            ],
            [
                'supporter' => 'hans', 'recipient' => 'markus',
                'title' => 'Werkstatt-Tag mit Hans',
                'desc'  => 'Ad-hoc Reparaturen — Hans hilft Markus bei kleineren Werkstatt-Arbeiten.',
                'frequency' => 'ad_hoc', 'expected_hours' => 2.0,
                'start_days_ago' => 30, 'status' => 'active',
                'org' => null, 'cat' => 'Reparaturen',
            ],
            [
                'supporter' => 'sabine', 'recipient' => 'christine',
                'title' => 'IT-Hilfe für Christine',
                'desc'  => 'Ad-hoc Unterstützung bei IT-Problemen und Tools für die Uni.',
                'frequency' => 'ad_hoc', 'expected_hours' => 1.0,
                'start_days_ago' => 14, 'status' => 'active',
                'org' => null, 'cat' => 'Digitale Hilfe',
            ],
        ];

        $ids = [];
        $coordinatorId = $userIds['marlies'] ?? null;
        foreach ($rows as $row) {
            $supporterId = $userIds[$row['supporter']] ?? null;
            $recipientId = $userIds[$row['recipient']] ?? null;
            if ($supporterId === null || $recipientId === null) {
                continue;
            }
            $values = [
                'coordinator_id' => $coordinatorId,
                'organization_id' => $row['org'] ? ($orgIds[$row['org']] ?? null) : null,
                'category_id' => $categoryIds[$row['cat']] ?? null,
                'description' => $row['desc'],
                'frequency' => $row['frequency'],
                'expected_hours' => $row['expected_hours'],
                'start_date' => now()->subDays($row['start_days_ago'])->toDateString(),
                'status' => $row['status'],
                'last_logged_at' => $row['status'] === 'paused' ? null : now()->subDays(random_int(2, 10)),
                'updated_at' => now(),
            ];
            $id = $this->upsertAndGetId(
                'caring_support_relationships',
                [
                    'tenant_id' => $tenantId,
                    'supporter_id' => $supporterId,
                    'recipient_id' => $recipientId,
                    'title' => $row['title'],
                ],
                $values
            );
            if ($id > 0) {
                $ids[] = $id;
            }
            $this->bump('support relationships');
        }

        return $ids;
    }

    /**
     * 50–80 vol_logs spread across the past 30 days, mix of statuses.
     *
     * @param array<string, int> $userIds
     * @param array<string, int> $orgIds
     * @param list<int> $relIds
     */
    private function seedVolLogs(int $tenantId, array $userIds, array $orgIds, array $relIds): void
    {
        $supporters = ['andrea', 'hans', 'sabine', 'roland', 'theres', 'markus', 'anna', 'beat', 'karin', 'christine'];
        $recipients = ['werner', 'erika', 'theres', 'markus', 'christine'];
        $descriptions = [
            'Einkaufshilfe und kurzer Schwatz',
            'Begleitung zum Arzttermin',
            'Velo-Reparatur — Bremszug ersetzt',
            'Italienisch-Konversation',
            'Spaziergang an der Lorze',
            'IT-Hilfe — neues Smartphone eingerichtet',
            'Garten-Pflege',
            'Mittagessen gemeinsam vorbereitet',
            'Fahrdienst nach Zug',
            'Hilfe beim Ausfüllen von Formularen',
        ];

        $orgList = [
            $orgIds['kiss_cham'] ?? null,
            $orgIds['spitex_zug'] ?? null,
            null, null, null, // mostly direct person-to-person
        ];

        $count = 65; // landing in the 50–80 range
        $reviewerId = $userIds['marlies'] ?? null;
        $trustedReviewerId = $userIds['stefan'] ?? null;

        // Deterministic seed so that re-runs hit the SAME (user, recipient, date,
        // description) identity tuples, which keeps the upsert idempotent.
        for ($i = 0; $i < $count; $i++) {
            $supporterKey = $supporters[$i % count($supporters)];
            $recipientKey = $recipients[$i % count($recipients)];
            $supporterId = $userIds[$supporterKey] ?? null;
            $recipientId = $userIds[$recipientKey] ?? null;
            if ($supporterId === null || $supporterId === $recipientId) {
                continue;
            }

            // Use $i to derive deterministic per-iteration values. Include the
            // iteration index in the description so each (user, recipient,
            // date, description) tuple is unique enough to land 50+ rows.
            $daysAgo = $i % 30;
            $hoursOptions = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0];
            $hours = $hoursOptions[$i % count($hoursOptions)];
            $description = $descriptions[$i % count($descriptions)]
                . ' (#' . str_pad((string) ($i + 1), 2, '0', STR_PAD_LEFT) . ')';

            // Deterministic distribution: 60% approved, 25% pending,
            // 10% trusted-auto-approved, 5% recently-logged pending.
            $bucket = $i % 20; // 0..19
            if ($bucket < 12) {
                $status = 'approved';
                $verifiedBy = $reviewerId;
                $verifiedAt = now()->subDays(max(0, $daysAgo - 1));
            } elseif ($bucket < 17) {
                $status = 'pending';
                $verifiedBy = null;
                $verifiedAt = null;
            } elseif ($bucket < 19) {
                $status = 'approved';
                $verifiedBy = $trustedReviewerId;
                $verifiedAt = now()->subDays(max(0, $daysAgo));
            } else {
                $status = 'pending';
                $daysAgo = 0;
                $verifiedBy = null;
                $verifiedAt = null;
            }

            $orgId = $orgList[$i % count($orgList)];
            $relationshipId = ! empty($relIds) ? $relIds[$i % count($relIds)] : null;

            $values = [
                'organization_id' => $orgId,
                'caring_support_relationship_id' => $relationshipId,
                'support_recipient_id' => $recipientId,
                'hours' => $hours,
                'description' => $description,
                'status' => $status,
                'date_logged' => now()->subDays($daysAgo)->toDateString(),
                'updated_at' => now()->subDays($daysAgo),
            ];

            // We use a stable identity based on user/date/description so re-runs don't multiply.
            $this->upsert(
                'vol_logs',
                [
                    'tenant_id' => $tenantId,
                    'user_id' => $supporterId,
                    'support_recipient_id' => $recipientId,
                    'date_logged' => now()->subDays($daysAgo)->toDateString(),
                    'description' => $description,
                ],
                $values
            );
            $this->bump('vol logs');
        }
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $groupIds
     * @param array<string, int> $categoryIds
     */
    private function seedEvents(int $tenantId, array $userIds, array $groupIds, array $categoryIds): void
    {
        $events = [
            [
                'title' => 'KISS Cham Mitgliederversammlung',
                'organizer' => 'marlies', 'group' => 'caring_cham', 'cat' => 'Verwaltung & Formulare',
                'days' => 14, 'location' => 'Bibliothek Cham, Mandelhof',
                'desc' => 'Jährliche Mitgliederversammlung der KISS Genossenschaft Cham. Jahresbericht, Wahlen, Ausblick.',
            ],
            [
                'title' => 'Frauenchor Probe',
                'organizer' => 'theres', 'group' => null, 'cat' => 'Begleitung & Besuche',
                'days' => 5, 'location' => 'Pfarreizentrum St. Jakob, Cham',
                'desc' => 'Wöchentliche Probe des Frauenchor Cham-Hagendorn — Dienstagabend, 19.30 bis 21.30 Uhr.',
            ],
            [
                'title' => 'Quartiertreff Lorzenhof — Frühlingsfest',
                'organizer' => 'andrea', 'group' => null, 'cat' => 'Mahlzeiten & Kochen',
                'days' => 21, 'location' => 'Quartierhof Lorzenhof, Cham',
                'desc' => 'Frühlingsfest des Quartiervereins Lorzenhof — gemeinsames Grillieren, Spiele für Kinder, Musik vom Männerturnverein.',
            ],
            [
                'title' => 'Velo-Club Sonntagstour Zugersee',
                'organizer' => 'beat', 'group' => null, 'cat' => 'Transport & Fahrdienst',
                'days' => 4, 'location' => 'Bahnhof Cham, Treffpunkt 9 Uhr',
                'desc' => 'Sonntagstour rund um den Zugersee — gemütliches Tempo, Mittagessen in einem Restaurant am See, ca. 50 km.',
            ],
            [
                'title' => 'Caring Community Stamm — Austausch für Helfer:innen',
                'organizer' => 'marlies', 'group' => 'caring_cham', 'cat' => 'Begleitung & Besuche',
                'days' => 7, 'location' => 'Restaurant Bahnhöfli, Cham',
                'desc' => 'Monatlicher Austausch für aktive Mitglieder der Caring Community — Erfahrungen teilen, Fragen klären, neue Tandems anbahnen.',
            ],
        ];

        foreach ($events as $event) {
            $userId = $userIds[$event['organizer']] ?? null;
            if ($userId === null) {
                continue;
            }
            $start = now()->addDays($event['days'])->setTime(18, 30);
            $values = [
                'user_id' => $userId,
                'group_id' => $event['group'] ? ($groupIds[$event['group']] ?? null) : null,
                'category_id' => $categoryIds[$event['cat']] ?? null,
                'description' => $event['desc'],
                'location' => $event['location'],
                'start_time' => $start,
                'start_date' => $start,
                'end_time' => (clone $start)->addHours(2),
                'max_attendees' => 60,
                'is_online' => 0,
                'allow_remote_attendance' => 0,
                'status' => 'active',
                'updated_at' => now(),
            ];
            $this->upsert(
                'events',
                ['tenant_id' => $tenantId, 'title' => $event['title']],
                $values
            );
            $this->bump('events');
        }
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedGoals(int $tenantId, array $userIds): void
    {
        $rows = [
            ['owner' => 'marlies', 'title' => '1000 Stunden in Cham 2026',                'desc' => 'Gemeinschaftsziel: insgesamt 1000 verifizierte Unterstützungsstunden in der Caring Community Cham im Jahr 2026.', 'current' => 350, 'target' => 1000],
            ['owner' => 'marlies', 'title' => 'Jeden Monat 10 neue Helfer:innen',         'desc' => 'Wir möchten die Caring Community Cham wachsen lassen — Ziel: durchschnittlich 10 neue aktive Helfer:innen pro Monat.', 'current' => 6,   'target' => 10],
            ['owner' => 'marlies', 'title' => '20 aktive Tandem-Beziehungen bis Ende Q2','desc' => 'Stabilität durch regelmässige Tandems — Ziel: 20 aktive Support-Beziehungen bis Ende Q2 2026.',                                  'current' => 12,  'target' => 20],
        ];

        foreach ($rows as $row) {
            $userId = $userIds[$row['owner']] ?? null;
            if ($userId === null) {
                continue;
            }
            $values = [
                'user_id' => $userId,
                'description' => $row['desc'],
                'deadline' => now()->endOfYear()->toDateString(),
                'is_public' => 1,
                'status' => 'active',
                'current_value' => $row['current'],
                'target_value' => $row['target'],
                'updated_at' => now(),
            ];
            $this->upsert(
                'goals',
                ['tenant_id' => $tenantId, 'title' => $row['title']],
                $values
            );
            $this->bump('goals');
        }
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $categoryIds
     */
    private function seedResources(int $tenantId, array $userIds, array $categoryIds): void
    {
        $table = 'resources';
        if (! Schema::hasTable($table) || ! $this->hasColumn($table, 'title')) {
            $this->warn('Skipping resources: no compatible resources table.');
            return;
        }

        $rows = [
            ['title' => 'Was ist die Caring Community Cham?',         'cat' => 'Begleitung & Besuche', 'body' => 'Die Caring Community Cham ist ein Netzwerk von Menschen, die sich gegenseitig im Alltag unterstützen. Hier findest du eine Übersicht: Werte, Funktionsweise, Stundenerfassung.'],
            ['title' => 'Erste Schritte für neue Mitglieder',         'cat' => 'Verwaltung & Formulare','body' => 'Willkommen! Diese Anleitung zeigt dir Schritt für Schritt: Profil ergänzen, erste Unterstützung anbieten oder anfragen, Stunden erfassen.'],
            ['title' => 'Wie funktioniert die Stundenerfassung?',     'cat' => 'Verwaltung & Formulare','body' => 'Jede Stunde Unterstützung wird erfasst — von dir oder von der Person, die du unterstützt hast. Eine Vertrauensperson prüft die Einträge und gibt sie frei.'],
            ['title' => 'Kontakt KISS Genossenschaft Cham',           'cat' => 'Verwaltung & Formulare','body' => 'KISS Genossenschaft Cham, Obermühlestrasse 8, 6330 Cham. Kontakt: kontakt@kiss-cham.ch. Sprechstunden: Dienstag 14–17 Uhr und nach Vereinbarung.'],
        ];

        foreach ($rows as $row) {
            $values = [
                'user_id' => $userIds['marlies'] ?? array_values($userIds)[0],
                'description' => mb_substr($row['body'], 0, 240),
                'file_path' => 'uploads/resources/agoris-cham/' . Str::slug($row['title']) . '.md',
                'file_type' => 'md',
                'file_size' => mb_strlen($row['body']),
                'category_id' => $categoryIds[$row['cat']] ?? null,
                'content_type' => 'markdown',
                'content_body' => $row['body'],
                'downloads' => random_int(8, 60),
                'updated_at' => now(),
            ];
            $this->upsert(
                $table,
                ['tenant_id' => $tenantId, 'title' => $row['title']],
                $values
            );
            $this->bump('resources');
        }
    }

    // ----- helpers (mirroring SeedAgorisDemoData) ---------------------------------

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
        $filtered = $this->filterColumns($table, $values);
        if (! empty($filtered)) {
            DB::table($table)->where('id', $id)->update($filtered);
        }
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
            $typeColumn => 'string',
            'category' => str_contains($key, '.') ? Str::before($key, '.') : 'general',
            'updated_at' => now(),
        ]);
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
