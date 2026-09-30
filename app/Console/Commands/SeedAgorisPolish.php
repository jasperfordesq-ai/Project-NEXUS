<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\CaringCommunity\CivicDigestService;
use App\Support\Console\RefusesUnsafeSeeding;
use App\Services\CaringCommunity\LeadNurtureService;
use App\Services\CaringCommunity\MunicipalCommunicationCopilotService;
use App\Services\CaringCommunity\SuccessStoryService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Polish layer over the Agoris demo seed.
 *
 * Built to make the Agoris pilot tenant look like a living KISS regional
 * cooperative when a municipal evaluator (Martin Villiger / Roland Greber /
 * Christopher Mueller) lands on it for a 20-minute walkthrough.
 *
 * Adds, on top of `tenant:seed-agoris-demo` and `tenant:seed-agoris-realistic`:
 *   - Strong demo password rotation (idempotent — sets every Agoris user to the
 *     shared `self::resolveSeedPassword()` so the platform's password
 *     policy is satisfied AND a demo viewer can sign in as anyone)
 *   - Local merchant marketplace — Hofladen, Bäckerei, Schreinerei, Imker,
 *     Bibliothek, Reparatur-Café — opted into time-credit + regional-points
 *     loyalty (this is the "caring community version" of the marketplace)
 *   - Marketplace orders, ratings, pickup slots — buyers and sellers both leave
 *     reviews, slots show click-and-collect availability for the next 14 days
 *   - Member peer signals — connections, peer reviews, public appreciations,
 *     showcase badges (gamification visible on profile cards)
 *   - AG91 success-story proof cards (built-in seed)
 *   - AG89 municipal copilot — six sample announcement proposals across
 *     proposed/accepted/published/rejected statuses with realistic Cham
 *     announcement themes
 *   - AG92 municipality feedback inbox — twelve feedback items spanning
 *     question/idea/issue_report/sentiment with varied triage states
 *   - AG94 lead-nurture contacts — fifteen pilot-region leads across all five
 *     segments with realistic stage progression
 *   - Civic-digest preferences pinned on a few personas (so AG90 surfaces show
 *     a real filtered feed, not an empty state)
 *
 * Idempotent — every insert keys on a stable identity tuple so re-running just
 * updates the matching row. Safe to run on production after a content refresh.
 *
 *   php artisan tenant:seed-agoris-polish agoris
 *   php artisan tenant:seed-agoris-polish agoris --dry-run
 *   php artisan tenant:seed-agoris-polish agoris --skip-passwords  (don't touch user passwords)
 */
class SeedAgorisPolish extends Command
{
    use RefusesUnsafeSeeding;

    protected $signature = 'tenant:seed-agoris-polish
        {tenant_slug=agoris : Tenant slug to polish}
        {--dry-run : Show what would be seeded without writing}
        {--skip-passwords : Do not rotate seeded user passwords to the strong demo password}';

    protected $description = 'Layer marketplace, AG89-94 surfaces, and social-proof polish on the Agoris demo tenant';

    /** @var array<string, list<string>> */
    private array $columns = [];

    /** @var array<string, int> */
    private array $counts = [];

    public function handle(): int
    {
        if (($refusal = $this->refuseUnlessSafeSeedingEnvironment()) !== null) {
            return $refusal;
        }

        $slug = ltrim((string) $this->argument('tenant_slug'), '/');
        $dryRun = (bool) $this->option('dry-run');
        $skipPasswords = (bool) $this->option('skip-passwords');

        $tenant = DB::table('tenants')->where('slug', $slug)->first(['id', 'name', 'slug', 'features']);
        if (! $tenant) {
            $this->error("No tenant found for slug '{$slug}'. Create the tenant + run tenant:seed-agoris-demo first.");
            return self::FAILURE;
        }

        $tenantId = (int) $tenant->id;
        $this->info("Tenant: {$tenant->name} (id={$tenantId}, slug={$tenant->slug})");

        if ($dryRun) {
            $this->line('DRY RUN: would rotate user passwords, enable marketplace flag, seed 6 sellers + 24 listings + 8 orders + 6 ratings + 12 pickup slots, 18 connections, 10 peer reviews, 14 appreciations, 22 badges, 3 success stories, 6 copilot proposals, 12 feedback items, 15 leads, civic-digest prefs.');
            return self::SUCCESS;
        }

        $userIds = $this->loadAgorisUserIds($tenantId);
        if (count($userIds) < 6) {
            $this->error('Found fewer than 6 Agoris users. Run tenant:seed-agoris-demo and tenant:seed-agoris-realistic first.');
            return self::FAILURE;
        }

        if (! $skipPasswords) {
            $this->rotatePasswords($tenantId, $userIds);
        }

        $this->enableMarketplaceFeature($tenantId, $tenant->features);
        $sellerIds = $this->seedMarketplaceSellers($tenantId, $userIds);
        $catIds = $this->seedMarketplaceCategories($tenantId);
        $listingIds = $this->seedMarketplaceListings($tenantId, $userIds, $sellerIds, $catIds);
        $this->seedMarketplaceLoyaltyAndRegionalPoints($tenantId, $userIds);
        $orderIds = $this->seedMarketplaceOrders($tenantId, $userIds, $sellerIds, $listingIds);
        $this->seedMarketplaceRatings($tenantId, $userIds, $orderIds);
        $this->seedMarketplacePickupSlots($tenantId, $sellerIds);

        $this->seedConnections($tenantId, $userIds);
        $this->seedPeerReviews($tenantId, $userIds);
        $this->seedAppreciations($tenantId, $userIds);
        $this->seedShowcaseBadges($tenantId, $userIds);

        $this->seedSuccessStories($tenantId);
        $this->seedCopilotProposals($tenantId, $userIds);
        $this->seedMunicipalityFeedback($tenantId, $userIds);
        $this->seedLeadNurtureContacts($tenantId);
        $this->seedCivicDigestPrefs($tenantId, $userIds);

        $this->newLine();
        $this->info('Agoris polish seed complete.');
        foreach ($this->counts as $label => $count) {
            $this->line(sprintf('  %-32s %d', $label, $count));
        }
        $this->newLine();
        $this->line('Demo password for ALL Agoris users: ' . self::resolveSeedPassword());
        $this->line('Sign in as: agoris.admin@example.test  (admin)');
        $this->line('Sign in as: marlies.iten@demo-agoris.ch  (KISS coordinator)');
        $this->line('Sign in as: thomas.risi@demo-agoris.ch  (Gemeinde Cham)');
        $this->newLine();

        return self::SUCCESS;
    }

    // -----------------------------------------------------------------------
    // User lookup + password rotation
    // -----------------------------------------------------------------------

    /**
     * @return array<string, int>  e.g. ['marlies' => 12, 'andrea' => 13, …, 'admin' => 11]
     */
    private function loadAgorisUserIds(int $tenantId): array
    {
        $rows = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('email', [
                'agoris.admin@example.test',
                'anna.baumann@example.test',
                'luca.meier@example.test',
                'maria.rossi@example.test',
                'samira.keller@example.test',
                'peter.huber@example.test',
                'elena.widmer@example.test',
                'thomas.schmid@example.test',
                'andrea.muller@demo-agoris.ch',
                'hans.bachmann@demo-agoris.ch',
                'sabine.keller@demo-agoris.ch',
                'roland.schmid@demo-agoris.ch',
                'marlies.iten@demo-agoris.ch',
                'werner.hausmann@demo-agoris.ch',
                'theres.studer@demo-agoris.ch',
                'markus.felder@demo-agoris.ch',
                'anna.bucher@demo-agoris.ch',
                'beat.zurcher@demo-agoris.ch',
                'erika.wyss@demo-agoris.ch',
                'stefan.birrer@demo-agoris.ch',
                'karin.luscher@demo-agoris.ch',
                'thomas.risi@demo-agoris.ch',
                'christine.gut@demo-agoris.ch',
            ])
            ->pluck('id', 'email');

        $byKey = [];
        $emailToKey = [
            'agoris.admin@example.test'          => 'admin',
            'anna.baumann@example.test'           => 'anna_b',
            'luca.meier@example.test'             => 'luca',
            'maria.rossi@example.test'            => 'maria',
            'samira.keller@example.test'          => 'samira',
            'peter.huber@example.test'            => 'peter',
            'elena.widmer@example.test'           => 'elena',
            'thomas.schmid@example.test'          => 'thomas_s',
            'andrea.muller@demo-agoris.ch'        => 'andrea',
            'hans.bachmann@demo-agoris.ch'        => 'hans',
            'sabine.keller@demo-agoris.ch'        => 'sabine',
            'roland.schmid@demo-agoris.ch'        => 'roland',
            'marlies.iten@demo-agoris.ch'         => 'marlies',
            'werner.hausmann@demo-agoris.ch'      => 'werner',
            'theres.studer@demo-agoris.ch'        => 'theres',
            'markus.felder@demo-agoris.ch'        => 'markus',
            'anna.bucher@demo-agoris.ch'          => 'anna',
            'beat.zurcher@demo-agoris.ch'         => 'beat',
            'erika.wyss@demo-agoris.ch'           => 'erika',
            'stefan.birrer@demo-agoris.ch'        => 'stefan',
            'karin.luscher@demo-agoris.ch'        => 'karin',
            'thomas.risi@demo-agoris.ch'          => 'thomas',
            'christine.gut@demo-agoris.ch'        => 'christine',
        ];
        foreach ($rows as $email => $id) {
            if (isset($emailToKey[$email])) {
                $byKey[$emailToKey[$email]] = (int) $id;
            }
        }

        return $byKey;
    }

    /**
     * @param array<string, int> $userIds
     */
    private function rotatePasswords(int $tenantId, array $userIds): void
    {
        $hash = Hash::make(self::resolveSeedPassword());
        $ids = array_values($userIds);
        if ($ids === []) {
            return;
        }
        DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $ids)
            ->update([
                'password_hash' => $hash,
                'updated_at' => now(),
            ]);
        $this->counts['passwords rotated'] = count($ids);
    }

    private function enableMarketplaceFeature(int $tenantId, ?string $featuresJson): void
    {
        $features = is_string($featuresJson) ? (json_decode($featuresJson, true) ?: []) : [];
        $features['marketplace'] = true;
        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode($features),
            'updated_at' => now(),
        ]);
        $this->bump('marketplace flag enabled');
    }

    // -----------------------------------------------------------------------
    // Marketplace — Swiss merchant network
    // -----------------------------------------------------------------------

    /**
     * @param array<string, int> $userIds
     * @return array<string, int>  seller_profile.id keyed by sellerKey
     */
    private function seedMarketplaceSellers(int $tenantId, array $userIds): array
    {
        if (! Schema::hasTable('marketplace_seller_profiles')) {
            return [];
        }

        $rows = [
            [
                'key' => 'hofladen',  'user' => 'markus',
                'display_name' => 'Hofladen Felder Hünenberg',
                'business_name' => 'Hofladen Felder',
                'bio' => 'Direktverkauf vom Bauernhof in Hünenberg — saisonales Gemüse, Eier vom eigenen Hof, hausgemachte Konfitüren. Wir akzeptieren Zeitstunden und regionale Punkte.',
                'seller_type' => 'business', 'business_verified' => 1, 'community_endorsed' => 1,
                'avg_rating' => 4.85, 'total_ratings' => 32, 'total_sales' => 47, 'total_revenue' => 1480.50, 'trust' => 96,
            ],
            [
                'key' => 'baeckerei', 'user' => 'thomas_s',
                'display_name' => 'Bäckerei Schmid Cham',
                'business_name' => 'Bäckerei Schmid GmbH',
                'bio' => 'Familien-Bäckerei in Cham seit 1962. Brot aus regionalem Mehl, Caring-Community-Mitgliederrabatt mit Zeitstunden.',
                'seller_type' => 'business', 'business_verified' => 1, 'community_endorsed' => 1,
                'avg_rating' => 4.92, 'total_ratings' => 58, 'total_sales' => 124, 'total_revenue' => 4210.80, 'trust' => 98,
            ],
            [
                'key' => 'schreinerei', 'user' => 'hans',
                'display_name' => 'Werkstatt Bachmann',
                'business_name' => null,
                'bio' => 'Schreiner-Werkstatt im Cham — kleine Reparaturen, Massanfertigungen aus regionalem Holz. Stundenbank-Mitglied.',
                'seller_type' => 'private', 'business_verified' => 0, 'community_endorsed' => 1,
                'avg_rating' => 4.95, 'total_ratings' => 21, 'total_sales' => 24, 'total_revenue' => 980.00, 'trust' => 94,
            ],
            [
                'key' => 'imker',      'user' => 'beat',
                'display_name' => 'Imkerei Zugerland',
                'business_name' => 'Imkerei Zürcher',
                'bio' => 'Honig aus dem Kanton Zug, Bienenwachs-Kerzen, Propolis-Tinktur. Direkt vom Imker, regionale Punkte willkommen.',
                'seller_type' => 'business', 'business_verified' => 1, 'community_endorsed' => 0,
                'avg_rating' => 4.78, 'total_ratings' => 18, 'total_sales' => 33, 'total_revenue' => 720.50, 'trust' => 89,
            ],
            [
                'key' => 'bibliothek', 'user' => 'thomas',
                'display_name' => 'Bibliothek Cham — Tauschecke',
                'business_name' => 'Bibliothek Cham',
                'bio' => 'Bücher- und Spiele-Tauschecke der Bibliothek Cham. Symbolische Stundenpreise — alle Erlöse fliessen in den Lesefonds.',
                'seller_type' => 'business', 'business_verified' => 1, 'community_endorsed' => 1,
                'avg_rating' => 5.00, 'total_ratings' => 9, 'total_sales' => 16, 'total_revenue' => 0.00, 'trust' => 100,
            ],
            [
                'key' => 'reparatur',  'user' => 'sabine',
                'display_name' => 'Reparatur-Café Steinhausen',
                'business_name' => 'Familientreff Steinhausen',
                'bio' => 'Monatliches Reparatur-Café im Familientreff Steinhausen. Velo, Kleingeräte, Kleider — Teile gegen CHF, Arbeit gegen Stunden.',
                'seller_type' => 'business', 'business_verified' => 1, 'community_endorsed' => 1,
                'avg_rating' => 4.88, 'total_ratings' => 14, 'total_sales' => 19, 'total_revenue' => 285.00, 'trust' => 95,
            ],
        ];

        $ids = [];
        foreach ($rows as $row) {
            $userId = $userIds[$row['user']] ?? null;
            if ($userId === null) {
                continue;
            }
            $values = [
                'display_name' => $row['display_name'],
                'business_name' => $row['business_name'],
                'bio' => $row['bio'],
                'seller_type' => $row['seller_type'],
                'business_verified' => $row['business_verified'],
                'is_community_endorsed' => $row['community_endorsed'],
                'avg_rating' => $row['avg_rating'],
                'total_ratings' => $row['total_ratings'],
                'total_sales' => $row['total_sales'],
                'total_revenue' => $row['total_revenue'],
                'community_trust_score' => $row['trust'],
                'response_time_avg' => random_int(15, 240),
                'response_rate' => random_int(85, 100),
                'joined_marketplace_at' => now()->subMonths(random_int(2, 14)),
                'updated_at' => now(),
            ];
            $ids[$row['key']] = $this->upsertAndGetId(
                'marketplace_seller_profiles',
                ['tenant_id' => $tenantId, 'user_id' => $userId],
                $values
            );
            $this->bump('marketplace sellers');
        }

        return $ids;
    }

    /**
     * @return array<string, int>
     */
    private function seedMarketplaceCategories(int $tenantId): array
    {
        if (! Schema::hasTable('marketplace_categories')) {
            return [];
        }

        $rows = [
            ['name' => 'Lokal & Saisonal',  'icon' => 'apple',     'desc' => 'Frische Produkte aus regionaler Landwirtschaft.'],
            ['name' => 'Backwaren',          'icon' => 'bread',     'desc' => 'Brot, Gebäck und Gebackenes aus der Region.'],
            ['name' => 'Handwerk',           'icon' => 'hammer',    'desc' => 'Massanfertigungen, kleine Reparaturen, Holzwaren.'],
            ['name' => 'Honig & Bienenwachs','icon' => 'honey',     'desc' => 'Imkerei-Produkte aus dem Kanton Zug.'],
            ['name' => 'Bücher & Spiele',    'icon' => 'book',      'desc' => 'Bücher- und Spiele-Tausch, kuratiert von der Bibliothek.'],
            ['name' => 'Pflegehilfen',       'icon' => 'heart',     'desc' => 'Hilfsmittel und Begleitprodukte für Pflege zu Hause.'],
            ['name' => 'Garten & Hof',       'icon' => 'sprout',    'desc' => 'Saatgut, Setzlinge, Gartengeräte zum Tauschen.'],
            ['name' => 'Mobilität',          'icon' => 'bike',      'desc' => 'Velos, Anhänger, E-Bike-Akkus.'],
            ['name' => 'Reparatur-Service',  'icon' => 'wrench',    'desc' => 'Reparatur-Café-Sessions und mobile Reparaturen.'],
        ];

        $ids = [];
        foreach ($rows as $sort => $row) {
            $ids[$row['name']] = $this->upsertAndGetId(
                'marketplace_categories',
                ['tenant_id' => $tenantId, 'slug' => Str::slug($row['name'])],
                [
                    'name' => $row['name'],
                    'icon' => $row['icon'],
                    'description' => $row['desc'],
                    'sort_order' => $sort,
                    'is_active' => 1,
                    'updated_at' => now(),
                ]
            );
            $this->bump('marketplace categories');
        }

        return $ids;
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $sellerIds
     * @param array<string, int> $catIds
     * @return list<int>
     */
    private function seedMarketplaceListings(int $tenantId, array $userIds, array $sellerIds, array $catIds): array
    {
        if (! Schema::hasTable('marketplace_listings')) {
            return [];
        }

        $listings = [
            // Hofladen Felder
            ['key' => 'hofladen', 'cat' => 'Lokal & Saisonal', 'title' => 'Saisonbox: Frühlingsgemüse Hünenberg', 'tagline' => 'Spargel, Bärlauch, Radieschen, Salat — wöchentlich frisch vom Hof', 'desc' => 'Wöchentliche Saisonbox aus dem Hofladen Felder. Inhalt variiert nach Saison: aktuell Spargel aus dem eigenen Beet, Bärlauch, junger Salat, Radieschen, Kräuterbund, Rüebli.', 'price' => 28.00, 'tc' => 1.0, 'qty' => 30, 'condition' => null, 'location' => 'Hünenberg, Zug', 'lat' => 47.1722, 'lng' => 8.4214, 'delivery' => 'pickup', 'inventory' => 30, 'low_stock' => 5],
            ['key' => 'hofladen', 'cat' => 'Lokal & Saisonal', 'title' => 'Eier vom eigenen Hof — 6er Schachtel', 'tagline' => 'Glückliche Hühner aus Freilandhaltung', 'desc' => '6 frische Eier aus Freilandhaltung. Hennen leben am Hofrand und werden mit Bio-Futter ergänzt. Schalenfarbe variiert.', 'price' => 5.50, 'tc' => 0.5, 'qty' => 80, 'condition' => null, 'location' => 'Hünenberg, Zug', 'lat' => 47.1722, 'lng' => 8.4214, 'delivery' => 'pickup', 'inventory' => 80, 'low_stock' => 12],
            ['key' => 'hofladen', 'cat' => 'Lokal & Saisonal', 'title' => 'Hausgemachte Konfitüre — Aprikose', 'tagline' => 'Aus Aprikosen vom Hof', 'desc' => 'Aprikose-Konfitüre aus Früchten vom eigenen Hof, traditionell ohne Zusätze gekocht. 350g Glas.', 'price' => 9.50, 'tc' => 0.5, 'qty' => 40, 'condition' => null, 'location' => 'Hünenberg, Zug', 'lat' => 47.1722, 'lng' => 8.4214, 'delivery' => 'both', 'inventory' => 40, 'low_stock' => 8],
            ['key' => 'hofladen', 'cat' => 'Garten & Hof', 'title' => 'Setzlinge — Tomaten, Salat, Kräuter', 'tagline' => '8 Setzlinge zur Auswahl', 'desc' => 'Selbst gezogene Jungpflanzen für den Mai-Setzling. Tomaten, Pflück-Salat, Basilikum, Petersilie, Schnittlauch — Sie wählen 8 Stück aus.', 'price' => 12.00, 'tc' => 1.0, 'qty' => 60, 'condition' => null, 'location' => 'Hünenberg, Zug', 'lat' => 47.1722, 'lng' => 8.4214, 'delivery' => 'pickup', 'inventory' => 60, 'low_stock' => 10],

            // Bäckerei Schmid
            ['key' => 'baeckerei', 'cat' => 'Backwaren', 'title' => 'Zuger Halbweiss-Brot 750g', 'tagline' => 'Aus regionalem Mehl der Mühle Cham', 'desc' => 'Klassisches Halbweiss-Brot, 750g Laib. Unser meistverkauftes Brot — auch die KISS-Treffen werden damit versorgt.', 'price' => 6.50, 'tc' => 0.5, 'qty' => 200, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1758, 'lng' => 8.4622, 'delivery' => 'pickup', 'inventory' => null, 'low_stock' => null],
            ['key' => 'baeckerei', 'cat' => 'Backwaren', 'title' => 'Zopf für den Sonntag — 500g', 'tagline' => 'Klassischer Sonntagszopf', 'desc' => 'Goldbraun gebacken, mit Butter und Eiern. 500g Zopf. Vorbestellung bis Samstag 16:00.', 'price' => 8.50, 'tc' => 0.5, 'qty' => 50, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1758, 'lng' => 8.4622, 'delivery' => 'pickup', 'inventory' => 50, 'low_stock' => 8],
            ['key' => 'baeckerei', 'cat' => 'Backwaren', 'title' => 'Caring-Community-Box: Brot & Gipfeli', 'tagline' => 'Nachbarschaftshilfe-Sonderbox', 'desc' => 'Halbweiss-Brot + 6 Butter-Gipfeli + 4 Mandel-Gipfeli. Diese Box ist nur mit Caring-Community-Mitgliedschaft erhältlich, mit Stunden-Rabatt.', 'price' => 19.50, 'tc' => 1.5, 'qty' => 20, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1758, 'lng' => 8.4622, 'delivery' => 'pickup', 'inventory' => 20, 'low_stock' => 3],

            // Schreinerei Bachmann
            ['key' => 'schreinerei', 'cat' => 'Handwerk', 'title' => 'Hocker aus regionalem Eichenholz', 'tagline' => 'Klassischer Werkstatt-Hocker, 45cm', 'desc' => 'Massiv gebauter Hocker aus Cham-Eiche, 45cm hoch. Eine Woche Vorlauf für die Lieferung. Reparaturen und Nachschliff lebenslang gratis (gegen Stunden).', 'price' => 145.00, 'tc' => 4.0, 'qty' => 5, 'condition' => 'new', 'location' => 'Cham, Zug', 'lat' => 47.1771, 'lng' => 8.4595, 'delivery' => 'pickup', 'inventory' => 5, 'low_stock' => 2],
            ['key' => 'schreinerei', 'cat' => 'Reparatur-Service', 'title' => 'Reparatur-Stunde Werkstatt', 'tagline' => 'Holz-, Velo- und Kleinmöbel-Reparatur', 'desc' => 'Eine Stunde Werkstatt-Zeit für die Reparatur deiner Möbel oder Kleinwerkzeuge. Du hilfst mit, lernst dabei. Material wird separat verrechnet.', 'price' => 35.00, 'tc' => 1.0, 'qty' => 50, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1771, 'lng' => 8.4595, 'delivery' => 'pickup', 'inventory' => null, 'low_stock' => null],
            ['key' => 'schreinerei', 'cat' => 'Garten & Hof', 'title' => 'Hochbeet aus Lärchenholz', 'tagline' => '120 × 80 × 80cm — Selbstmontage', 'desc' => 'Vorgefertigtes Hochbeet aus heimischem Lärchenholz. Selbstmontage in 30 Minuten — Anleitung dabei. Perfekt für Mietergärten oder Balkonkanten.', 'price' => 220.00, 'tc' => 3.0, 'qty' => 4, 'condition' => 'new', 'location' => 'Cham, Zug', 'lat' => 47.1771, 'lng' => 8.4595, 'delivery' => 'both', 'inventory' => 4, 'low_stock' => 2],

            // Imker Zürcher
            ['key' => 'imker', 'cat' => 'Honig & Bienenwachs', 'title' => 'Frühlingstracht-Honig 500g', 'tagline' => 'Aus Cham und Hünenberg', 'desc' => 'Frühlingstracht von unseren Bienen — vor allem Löwenzahn, Kirsche, Apfelblüte. 500g Glas. Perfekt zum Frühstück oder für Müesli.', 'price' => 18.00, 'tc' => 1.0, 'qty' => 60, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1755, 'lng' => 8.4651, 'delivery' => 'both', 'inventory' => 60, 'low_stock' => 10],
            ['key' => 'imker', 'cat' => 'Honig & Bienenwachs', 'title' => 'Bienenwachs-Kerzen — 6er Set', 'tagline' => 'Handgegossen, naturbelassen', 'desc' => '6 Bienenwachs-Stumpenkerzen, je ca. 15cm hoch. Reines Bienenwachs aus eigener Imkerei, ohne Zusätze.', 'price' => 24.00, 'tc' => 1.5, 'qty' => 20, 'condition' => 'new', 'location' => 'Cham, Zug', 'lat' => 47.1755, 'lng' => 8.4651, 'delivery' => 'both', 'inventory' => 20, 'low_stock' => 4],

            // Bibliothek
            ['key' => 'bibliothek', 'cat' => 'Bücher & Spiele', 'title' => 'Tausch-Roman: "Stiller" von Max Frisch', 'tagline' => 'Gut erhalten, einmal gelesen', 'desc' => 'Tauschexemplar aus der Bibliothek Cham. Bring ein Buch zurück oder gib eine Stunde Vorlesedienst — die Erlöse fliessen in den Lesefonds.', 'price' => 0.00, 'tc' => 0.5, 'qty' => 1, 'condition' => 'good', 'location' => 'Cham, Zug', 'lat' => 47.1751, 'lng' => 8.4617, 'delivery' => 'pickup', 'inventory' => 1, 'low_stock' => null],
            ['key' => 'bibliothek', 'cat' => 'Bücher & Spiele', 'title' => 'Brettspiel "Carcassonne" — komplett', 'tagline' => 'Spielenachmittag in der Bibliothek', 'desc' => 'Vollständiges Brettspiel für Spielenachmittage in der Bibliothek. Kann ausgeliehen werden — nicht gekauft. Stundenpreis als Sicherheit.', 'price' => 0.00, 'tc' => 1.0, 'qty' => 1, 'condition' => 'good', 'location' => 'Cham, Zug', 'lat' => 47.1751, 'lng' => 8.4617, 'delivery' => 'pickup', 'inventory' => 1, 'low_stock' => null],
            ['key' => 'bibliothek', 'cat' => 'Bücher & Spiele', 'title' => 'Kinderbuch-Sammelpaket', 'tagline' => '10 Bücher fürs Lesealter 4–8', 'desc' => 'Sammelpaket aus der Bibliothek-Tauschecke — 10 erprobte Kinderbücher. Wenn die Familie sie ausgelesen hat, bringt ihr sie zurück.', 'price' => 0.00, 'tc' => 1.0, 'qty' => 5, 'condition' => 'good', 'location' => 'Cham, Zug', 'lat' => 47.1751, 'lng' => 8.4617, 'delivery' => 'pickup', 'inventory' => 5, 'low_stock' => 1],

            // Reparatur-Café
            ['key' => 'reparatur', 'cat' => 'Reparatur-Service', 'title' => 'Velo-Reparatur Reparatur-Café', 'tagline' => 'Der nächste Sonntag, 14–17 Uhr', 'desc' => 'Slot im Reparatur-Café Steinhausen — nächster Sonntag, 14:00–17:00 Uhr. Bring dein Velo, wir helfen dir es zu richten. Material gegen CHF, Arbeit gegen Stunden.', 'price' => 0.00, 'tc' => 2.0, 'qty' => 8, 'condition' => null, 'location' => 'Steinhausen, Zug', 'lat' => 47.1947, 'lng' => 8.4858, 'delivery' => 'pickup', 'inventory' => 8, 'low_stock' => 2],
            ['key' => 'reparatur', 'cat' => 'Reparatur-Service', 'title' => 'Kleidungsreparatur — Nähservice', 'tagline' => 'Hosenkürzung, Rissreparaturen, Knöpfe', 'desc' => 'Reparatur-Stunde mit unseren Näherinnen im Familientreff. Hosenkürzungen, kleine Risse, Knöpfe. Nähmaterial inkludiert.', 'price' => 0.00, 'tc' => 1.0, 'qty' => 12, 'condition' => null, 'location' => 'Steinhausen, Zug', 'lat' => 47.1947, 'lng' => 8.4858, 'delivery' => 'pickup', 'inventory' => 12, 'low_stock' => 3],
            ['key' => 'reparatur', 'cat' => 'Reparatur-Service', 'title' => 'Kleingeräte-Diagnose', 'tagline' => 'Toaster, Wasserkocher, Mixer …', 'desc' => 'Diagnose-Slot für Kleingeräte. Wir schauen das Gerät an und sagen, ob es noch zu retten ist. Wenn ja: machen wir es zusammen.', 'price' => 0.00, 'tc' => 1.0, 'qty' => 10, 'condition' => null, 'location' => 'Steinhausen, Zug', 'lat' => 47.1947, 'lng' => 8.4858, 'delivery' => 'pickup', 'inventory' => 10, 'low_stock' => 3],

            // Cross-seller community items
            ['key' => 'hofladen', 'cat' => 'Pflegehilfen', 'title' => 'Wärmekissen mit Dinkel', 'tagline' => 'Selbst genäht, mit Dinkel vom Hof', 'desc' => 'Wärmekissen mit Dinkelfüllung aus eigener Ernte, Bezug aus Bio-Baumwolle. In der Mikrowelle erwärmbar. Hilft bei Verspannungen.', 'price' => 22.00, 'tc' => 1.0, 'qty' => 18, 'condition' => 'new', 'location' => 'Hünenberg, Zug', 'lat' => 47.1722, 'lng' => 8.4214, 'delivery' => 'both', 'inventory' => 18, 'low_stock' => 4],
            ['key' => 'imker', 'cat' => 'Pflegehilfen', 'title' => 'Propolis-Tinktur 30ml', 'tagline' => 'Aus eigener Imkerei', 'desc' => 'Propolis-Tinktur 20% in Alkohol gelöst. Tradtionelles Mittel bei Erkältung und kleinen Wunden. 30ml Pipettenflasche.', 'price' => 16.00, 'tc' => 1.0, 'qty' => 15, 'condition' => 'new', 'location' => 'Cham, Zug', 'lat' => 47.1755, 'lng' => 8.4651, 'delivery' => 'both', 'inventory' => 15, 'low_stock' => 3],
            ['key' => 'baeckerei', 'cat' => 'Backwaren', 'title' => 'Glutenfreies Brot — 600g', 'tagline' => 'Aus Reisstärke, Hirse, Buchweizen', 'desc' => 'Glutenfreies Spezialbrot, einmal pro Woche frisch (Mittwoch). Bitte bis Dienstag bestellen. Aus Reisstärke, Hirse, Buchweizen.', 'price' => 9.50, 'tc' => 0.5, 'qty' => 25, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1758, 'lng' => 8.4622, 'delivery' => 'pickup', 'inventory' => 25, 'low_stock' => 5],
            ['key' => 'schreinerei', 'cat' => 'Mobilität', 'title' => 'Velo-Anhänger — Leihgabe', 'tagline' => 'Für Einkäufe und Brockistuben-Fahrten', 'desc' => 'Robuster Velo-Anhänger zum Ausleihen über die Caring Community. Gegen Stundenpfand, eine Reservation pro Woche.', 'price' => 0.00, 'tc' => 1.0, 'qty' => 1, 'condition' => 'good', 'location' => 'Cham, Zug', 'lat' => 47.1771, 'lng' => 8.4595, 'delivery' => 'pickup', 'inventory' => 1, 'low_stock' => null],
            ['key' => 'hofladen', 'cat' => 'Lokal & Saisonal', 'title' => 'Direktverkauf-Karte 10 × Saisonbox', 'tagline' => 'Treuekarte mit 10% Rabatt', 'desc' => 'Treuekarte für 10 Saisonboxen. Spart 10% gegenüber Einzelkauf. Mit gespeicherten Stunden zusätzlich Caring-Community-Rabatt.', 'price' => 252.00, 'tc' => 5.0, 'qty' => 8, 'condition' => null, 'location' => 'Hünenberg, Zug', 'lat' => 47.1722, 'lng' => 8.4214, 'delivery' => 'pickup', 'inventory' => 8, 'low_stock' => 2],
            ['key' => 'baeckerei', 'cat' => 'Backwaren', 'title' => 'Sonntagspaket — Brot, Zopf, Gipfeli', 'tagline' => 'Vorbestellung Samstag bis 16:00', 'desc' => 'Brot 500g + Zopf 500g + 4 Gipfeli + 2 Buttergipfeli. Ideal für Sonntagsfrühstück mit Familie. Vorbestellung notwendig.', 'price' => 24.50, 'tc' => 1.5, 'qty' => 30, 'condition' => null, 'location' => 'Cham, Zug', 'lat' => 47.1758, 'lng' => 8.4622, 'delivery' => 'pickup', 'inventory' => 30, 'low_stock' => 6],
        ];

        $sellerOwners = [
            'hofladen'    => 'markus',
            'baeckerei'   => 'thomas_s',
            'schreinerei' => 'hans',
            'imker'       => 'beat',
            'bibliothek'  => 'thomas',
            'reparatur'   => 'sabine',
        ];

        $listingIds = [];
        foreach ($listings as $idx => $row) {
            $sellerKey = $row['key'];
            $userKey = $sellerOwners[$sellerKey] ?? null;
            $userId = $userKey ? ($userIds[$userKey] ?? null) : null;
            if ($userId === null) {
                continue;
            }
            $values = [
                'user_id' => $userId,
                'title' => $row['title'],
                'tagline' => $row['tagline'],
                'description' => $row['desc'],
                'price' => $row['price'],
                'price_currency' => 'CHF',
                'price_type' => $row['price'] > 0 ? 'fixed' : 'free',
                'time_credit_price' => $row['tc'],
                'category_id' => $catIds[$row['cat']] ?? null,
                'condition' => $row['condition'],
                'quantity' => $row['qty'],
                'location' => $row['location'],
                'latitude' => $row['lat'],
                'longitude' => $row['lng'],
                'shipping_available' => in_array($row['delivery'], ['shipping', 'both'], true) ? 1 : 0,
                'local_pickup' => in_array($row['delivery'], ['pickup', 'both'], true) ? 1 : 0,
                'delivery_method' => $row['delivery'],
                'seller_type' => isset($sellerIds[$sellerKey]) ? 'business' : 'private',
                'status' => 'active',
                'moderation_status' => 'approved',
                'inventory_count' => $row['inventory'],
                'low_stock_threshold' => $row['low_stock'],
                'is_oversold_protected' => 1,
                'views_count' => random_int(35, 380),
                'saves_count' => random_int(2, 28),
                'contacts_count' => random_int(0, 12),
                'promoted_until' => $idx < 4 ? now()->addWeeks(2) : null,
                'promotion_type' => $idx < 4 ? 'featured' : null,
                'expires_at' => now()->addMonths(3),
                'updated_at' => now(),
            ];
            $id = $this->upsertAndGetId(
                'marketplace_listings',
                ['tenant_id' => $tenantId, 'user_id' => $userId, 'title' => $row['title']],
                $values
            );
            if ($id > 0) {
                $listingIds[] = $id;
            }
            $this->bump('marketplace listings');
        }

        return $listingIds;
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedMarketplaceLoyaltyAndRegionalPoints(int $tenantId, array $userIds): void
    {
        $loyaltyKeys = ['markus', 'thomas_s', 'hans', 'beat', 'sabine'];
        if (Schema::hasTable('marketplace_seller_loyalty_settings')) {
            foreach ($loyaltyKeys as $key) {
                $userId = $userIds[$key] ?? null;
                if ($userId === null) {
                    continue;
                }
                $this->upsert(
                    'marketplace_seller_loyalty_settings',
                    ['tenant_id' => $tenantId, 'seller_user_id' => $userId],
                    [
                        'accepts_time_credits' => 1,
                        'loyalty_chf_per_hour' => 25.00,
                        'loyalty_max_discount_pct' => 50,
                        'updated_at' => now(),
                    ]
                );
                $this->bump('seller loyalty (time credits)');
            }
        }

        if (Schema::hasTable('marketplace_seller_regional_point_settings')) {
            foreach (['markus', 'thomas_s', 'beat'] as $key) {
                $userId = $userIds[$key] ?? null;
                if ($userId === null) {
                    continue;
                }
                $this->upsert(
                    'marketplace_seller_regional_point_settings',
                    ['tenant_id' => $tenantId, 'seller_user_id' => $userId],
                    [
                        'accepts_regional_points' => 1,
                        'regional_points_per_chf' => 10.00,
                        'regional_points_max_discount_pct' => 25,
                        'updated_at' => now(),
                    ]
                );
                $this->bump('seller regional points');
            }
        }
    }

    /**
     * @param array<string, int> $userIds
     * @param array<string, int> $sellerIds
     * @param list<int> $listingIds
     * @return list<int>
     */
    private function seedMarketplaceOrders(int $tenantId, array $userIds, array $sellerIds, array $listingIds): array
    {
        if (! Schema::hasTable('marketplace_orders') || $listingIds === []) {
            return [];
        }

        $orders = [
            ['buyer' => 'andrea', 'listing_idx' => 0,  'qty' => 1, 'unit' => 28.00, 'tc' => 0,   'status' => 'completed', 'days_ago' => 18],
            ['buyer' => 'theres', 'listing_idx' => 4,  'qty' => 2, 'unit' => 6.50,  'tc' => 0,   'status' => 'completed', 'days_ago' => 14],
            ['buyer' => 'samira', 'listing_idx' => 6,  'qty' => 1, 'unit' => 19.50, 'tc' => 1.5, 'status' => 'completed', 'days_ago' => 11],
            ['buyer' => 'erika',  'listing_idx' => 10, 'qty' => 1, 'unit' => 18.00, 'tc' => 0,   'status' => 'completed', 'days_ago' => 9],
            ['buyer' => 'karin',  'listing_idx' => 13, 'qty' => 1, 'unit' => 0.00,  'tc' => 1.0, 'status' => 'completed', 'days_ago' => 7],
            ['buyer' => 'beat',   'listing_idx' => 2,  'qty' => 1, 'unit' => 9.50,  'tc' => 0,   'status' => 'completed', 'days_ago' => 5],
            ['buyer' => 'maria',  'listing_idx' => 16, 'qty' => 1, 'unit' => 0.00,  'tc' => 2.0, 'status' => 'paid',      'days_ago' => 2],
            ['buyer' => 'hans',   'listing_idx' => 11, 'qty' => 1, 'unit' => 24.00, 'tc' => 0,   'status' => 'shipped',   'days_ago' => 1],
        ];

        $sellerByListing = function (int $listingId) use ($tenantId): ?array {
            $r = DB::table('marketplace_listings')
                ->where('id', $listingId)
                ->where('tenant_id', $tenantId)
                ->first(['user_id']);
            if (! $r) {
                return null;
            }
            return ['user_id' => (int) $r->user_id];
        };

        $orderIds = [];
        foreach ($orders as $i => $row) {
            $buyerId = $userIds[$row['buyer']] ?? null;
            $listingId = $listingIds[$row['listing_idx']] ?? null;
            if ($buyerId === null || $listingId === null) {
                continue;
            }
            $sellerInfo = $sellerByListing($listingId);
            if ($sellerInfo === null) {
                continue;
            }
            if ($sellerInfo['user_id'] === $buyerId) {
                continue;
            }

            $orderNumber = 'AGORIS-' . now()->subDays($row['days_ago'])->format('Ymd') . '-' . str_pad((string) ($i + 1), 4, '0', STR_PAD_LEFT);
            $created = now()->subDays($row['days_ago']);
            $values = [
                'order_number' => $orderNumber,
                'buyer_id' => $buyerId,
                'seller_id' => $sellerInfo['user_id'],
                'marketplace_listing_id' => $listingId,
                'quantity' => $row['qty'],
                'unit_price' => $row['unit'],
                'total_price' => $row['unit'] * $row['qty'],
                'currency' => 'CHF',
                'time_credits_used' => $row['tc'] > 0 ? $row['tc'] : null,
                'status' => $row['status'],
                'shipping_method' => 'local_pickup',
                'buyer_confirmed_at' => $row['status'] === 'completed' ? $created->copy()->addDays(2) : null,
                'seller_confirmed_at' => in_array($row['status'], ['paid', 'shipped', 'completed'], true) ? $created->copy()->addHours(6) : null,
                'escrow_released_at' => $row['status'] === 'completed' ? $created->copy()->addDays(3) : null,
                'auto_complete_at' => $row['status'] === 'paid' ? $created->copy()->addDays(7) : null,
                'created_at' => $created,
                'updated_at' => $created->copy()->addHours(8),
            ];
            $id = $this->upsertAndGetId(
                'marketplace_orders',
                ['tenant_id' => $tenantId, 'order_number' => $orderNumber],
                $values
            );
            if ($id > 0) {
                $orderIds[] = $id;
            }
            $this->bump('marketplace orders');
        }

        return $orderIds;
    }

    /**
     * @param array<string, int> $userIds
     * @param list<int> $orderIds
     */
    private function seedMarketplaceRatings(int $tenantId, array $userIds, array $orderIds): void
    {
        if (! Schema::hasTable('marketplace_seller_ratings') || $orderIds === []) {
            return;
        }

        $comments = [
            'Sehr freundlich und unkompliziert — gerne wieder!',
            'Top Qualität, immer pünktlich. Beste Empfehlung.',
            'Sympathischer Kontakt, faire Verrechnung mit Stunden.',
            'Schnelle Antwort, gut organisiert. Volle Punkte.',
            'Kommunikation perfekt. Zeitstunden-Abrechnung sauber.',
            'Klasse — direkt und vertrauenswürdig.',
        ];

        // Each completed order gets one buyer-side rating; first 3 also a seller-side rating.
        foreach ($orderIds as $idx => $orderId) {
            $order = DB::table('marketplace_orders')
                ->where('id', $orderId)
                ->where('tenant_id', $tenantId)
                ->first(['buyer_id', 'seller_id', 'status']);
            if (! $order || $order->status !== 'completed') {
                continue;
            }

            $this->upsert(
                'marketplace_seller_ratings',
                ['tenant_id' => $tenantId, 'order_id' => $orderId, 'rater_role' => 'buyer'],
                [
                    'rater_id' => (int) $order->buyer_id,
                    'ratee_id' => (int) $order->seller_id,
                    'rating' => $idx === 0 ? 4 : 5,
                    'comment' => $comments[$idx % count($comments)],
                    'is_anonymous' => 0,
                    'updated_at' => now(),
                ]
            );
            $this->bump('marketplace ratings');

            if ($idx < 3) {
                $this->upsert(
                    'marketplace_seller_ratings',
                    ['tenant_id' => $tenantId, 'order_id' => $orderId, 'rater_role' => 'seller'],
                    [
                        'rater_id' => (int) $order->seller_id,
                        'ratee_id' => (int) $order->buyer_id,
                        'rating' => 5,
                        'comment' => 'Pünktliche Abholung, freundlicher Austausch.',
                        'is_anonymous' => 0,
                        'updated_at' => now(),
                    ]
                );
                $this->bump('marketplace ratings');
            }
        }
    }

    /**
     * @param array<string, int> $sellerIds
     */
    private function seedMarketplacePickupSlots(int $tenantId, array $sellerIds): void
    {
        if (! Schema::hasTable('marketplace_pickup_slots') || $sellerIds === []) {
            return;
        }

        // 2 slots per seller across the next 14 days, weekday-only, late afternoon.
        $offsets = [2, 5, 9, 12];
        foreach ($sellerIds as $sellerKey => $sellerId) {
            foreach ($offsets as $idx => $days) {
                $start = now()->addDays($days)->setTime(16, 0, 0);
                if ($start->dayOfWeek === Carbon::SATURDAY || $start->dayOfWeek === Carbon::SUNDAY) {
                    $start = $start->addDays(1);
                }
                $end = $start->copy()->addHours(2);
                $this->upsert(
                    'marketplace_pickup_slots',
                    [
                        'tenant_id' => $tenantId,
                        'seller_id' => $sellerId,
                        'slot_start' => $start,
                    ],
                    [
                        'slot_end' => $end,
                        'capacity' => $idx === 0 ? 6 : 4,
                        'booked_count' => $idx === 0 ? 3 : random_int(0, 2),
                        'is_recurring' => 0,
                        'is_active' => 1,
                        'updated_at' => now(),
                    ]
                );
                $this->bump('pickup slots');
            }
        }
    }

    // -----------------------------------------------------------------------
    // Member peer signals — connections, reviews, appreciations, badges
    // -----------------------------------------------------------------------

    /**
     * @param array<string, int> $userIds
     */
    private function seedConnections(int $tenantId, array $userIds): void
    {
        if (! Schema::hasTable('connections')) {
            return;
        }

        $pairs = [
            ['marlies', 'andrea',    'accepted'],
            ['marlies', 'hans',      'accepted'],
            ['marlies', 'theres',    'accepted'],
            ['marlies', 'sabine',    'accepted'],
            ['marlies', 'beat',      'accepted'],
            ['marlies', 'karin',     'accepted'],
            ['marlies', 'thomas',    'accepted'],
            ['andrea',  'theres',    'accepted'],
            ['andrea',  'werner',    'accepted'],
            ['hans',    'markus',    'accepted'],
            ['sabine',  'samira',    'accepted'],
            ['sabine',  'christine', 'accepted'],
            ['beat',    'erika',     'accepted'],
            ['anna',    'theres',    'accepted'],
            ['anna',    'maria',     'accepted'],
            ['stefan',  'marlies',   'accepted'],
            ['luca',    'sabine',    'pending'],
            ['peter',   'hans',      'pending'],
        ];

        foreach ($pairs as $pair) {
            [$reqKey, $recKey, $status] = $pair;
            $reqId = $userIds[$reqKey] ?? null;
            $recId = $userIds[$recKey] ?? null;
            if ($reqId === null || $recId === null || $reqId === $recId) {
                continue;
            }
            $this->upsert(
                'connections',
                ['tenant_id' => $tenantId, 'requester_id' => $reqId, 'receiver_id' => $recId],
                [
                    'status' => $status,
                    'updated_at' => now(),
                ]
            );
            $this->bump('connections');
        }
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedPeerReviews(int $tenantId, array $userIds): void
    {
        if (! Schema::hasTable('reviews')) {
            return;
        }

        $reviews = [
            ['from' => 'werner',  'to' => 'andrea',  'rating' => 5, 'comment' => 'Andrea ist seit acht Wochen wöchentlich bei mir — pünktlich, geduldig und immer mit einem Lächeln. Ohne sie wäre der Alltag viel schwerer.'],
            ['from' => 'erika',   'to' => 'beat',    'rating' => 5, 'comment' => 'Beat fährt mich zuverlässig zum Arzt nach Zug. Wir haben gute Gespräche unterwegs — der Fahrdienst ist viel mehr als nur eine Fahrt.'],
            ['from' => 'theres',  'to' => 'anna',    'rating' => 5, 'comment' => 'Annas Italienischstunden sind das Highlight meines Monats. Sehr geduldig mit meinem rostigen Italienisch.'],
            ['from' => 'markus',  'to' => 'hans',    'rating' => 5, 'comment' => 'Hans hat mir bei der Werkbank-Reparatur geholfen — sauberes Handwerk und immer eine ruhige Hand.'],
            ['from' => 'christine','to' => 'sabine', 'rating' => 5, 'comment' => 'Sabine hat mir das neue Smartphone eingerichtet, sehr geduldig erklärt. Hat mir einige Stunden Frust erspart.'],
            ['from' => 'andrea',  'to' => 'marlies', 'rating' => 5, 'comment' => 'Marlies ist die ruhige Kraft hinter der KISS Cham. Vermittelt mit Bedacht, ist immer erreichbar.'],
            ['from' => 'samira',  'to' => 'sabine',  'rating' => 5, 'comment' => 'Tolle Nachbarin, hilft bei IT-Problemen wirklich Schritt für Schritt — auch über mehrere Telefonate.'],
            ['from' => 'beat',    'to' => 'theres',  'rating' => 5, 'comment' => 'Mit Theres unterwegs ist immer schön — sie kennt jede Geschichte rund um Cham.'],
            ['from' => 'hans',    'to' => 'beat',    'rating' => 5, 'comment' => 'Beat ist ein verlässlicher Velo-Kollege. Wenn er sagt 9 Uhr Bahnhof, ist er auch dort.'],
            ['from' => 'thomas',  'to' => 'marlies', 'rating' => 5, 'comment' => 'Aus Sicht der Gemeinde: KISS und Marlies sind ein zuverlässiger Partner. Klare Kommunikation, saubere Stundenführung.'],
        ];

        foreach ($reviews as $r) {
            $fromId = $userIds[$r['from']] ?? null;
            $toId = $userIds[$r['to']] ?? null;
            if ($fromId === null || $toId === null) {
                continue;
            }
            $this->upsert(
                'reviews',
                ['tenant_id' => $tenantId, 'reviewer_id' => $fromId, 'receiver_id' => $toId, 'comment' => $r['comment']],
                [
                    'rating' => $r['rating'],
                    'review_type' => 'local',
                    'status' => 'approved',
                    'is_anonymous' => 0,
                    'show_cross_tenant' => 1,
                    'updated_at' => now(),
                ]
            );
            $this->bump('peer reviews');
        }
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedAppreciations(int $tenantId, array $userIds): void
    {
        if (! Schema::hasTable('appreciations')) {
            return;
        }

        $rows = [
            ['from' => 'werner',  'to' => 'andrea',  'msg' => 'Vielen Dank für die wöchentlichen Besuche — das macht meinen Alltag bunter.'],
            ['from' => 'erika',   'to' => 'beat',    'msg' => 'Danke Beat, der Fahrdienst nach Baar war top. Du hast mir den Tag gerettet.'],
            ['from' => 'theres',  'to' => 'anna',    'msg' => 'Italienisch-Lektion war wieder so schön — grazie mille!'],
            ['from' => 'sabine',  'to' => 'hans',    'msg' => 'Velo-Reparatur hat eine Stunde gedauert, läuft wieder wie neu. Merci!'],
            ['from' => 'andrea',  'to' => 'marlies', 'msg' => 'Marlies, du hast die Caring Community Cham wirklich am Laufen — danke für deine ruhige Art.'],
            ['from' => 'markus',  'to' => 'hans',    'msg' => 'Werkbank steht wieder gerade — ohne dein scharfes Auge hätte ich es nie gemerkt.'],
            ['from' => 'christine','to' => 'sabine', 'msg' => 'Smartphone funktioniert. Du hast mir ehrlich Stress gespart, Sabine.'],
            ['from' => 'maria',   'to' => 'samira',  'msg' => 'Danke für die Familienfahrgemeinschaft am Mittwoch — hat mir den Tag perfekt gemacht.'],
            ['from' => 'theres',  'to' => 'beat',    'msg' => 'Spaziergang am Zugersee war wunderbar. Bis nächste Woche.'],
            ['from' => 'thomas',  'to' => 'marlies', 'msg' => 'Im Namen der Gemeindekanzlei: danke für die zuverlässige Stundenführung. Macht unsere Arbeit einfach.'],
            ['from' => 'andrea',  'to' => 'theres',  'msg' => 'Lasagne war himmlisch. Schon Vorfreude auf den nächsten Sonntag.'],
            ['from' => 'beat',    'to' => 'erika',   'msg' => 'Hat mich gefreut, dich kennenzulernen, Erika. Bis zum nächsten Termin.'],
        ];

        foreach ($rows as $r) {
            $fromId = $userIds[$r['from']] ?? null;
            $toId = $userIds[$r['to']] ?? null;
            if ($fromId === null || $toId === null) {
                continue;
            }
            $this->upsert(
                'appreciations',
                ['tenant_id' => $tenantId, 'sender_id' => $fromId, 'receiver_id' => $toId, 'message' => $r['msg']],
                [
                    'context_type' => 'caring_community',
                    'context_id' => null,
                    'is_public' => 1,
                    'reactions_count' => random_int(2, 18),
                    'updated_at' => now(),
                ]
            );
            $this->bump('appreciations');
        }
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedShowcaseBadges(int $tenantId, array $userIds): void
    {
        if (! Schema::hasTable('user_badges')) {
            return;
        }

        $badges = [
            ['key' => 'andrea',  'badge' => 'caring_anchor',     'name' => 'Verlässlicher Anker', 'icon' => 'heart-handshake'],
            ['key' => 'andrea',  'badge' => 'cham_8_weeks',      'name' => '8 Wochen Tandem',     'icon' => 'calendar-check'],
            ['key' => 'beat',    'badge' => 'driving_buddy',     'name' => 'Fahrdienst-Held',      'icon' => 'car'],
            ['key' => 'beat',    'badge' => 'cham_8_weeks',      'name' => '8 Wochen Tandem',     'icon' => 'calendar-check'],
            ['key' => 'hans',    'badge' => 'maker_master',      'name' => 'Werkstatt-Meister',   'icon' => 'wrench'],
            ['key' => 'hans',    'badge' => 'first_repair',      'name' => 'Erste Reparatur',     'icon' => 'tool'],
            ['key' => 'sabine',  'badge' => 'digital_helper',    'name' => 'Digitale Helferin',   'icon' => 'smartphone'],
            ['key' => 'sabine',  'badge' => 'first_repair',      'name' => 'Erste Reparatur',     'icon' => 'tool'],
            ['key' => 'marlies', 'badge' => 'kiss_coordinator',  'name' => 'KISS Koordinatorin',  'icon' => 'users'],
            ['key' => 'marlies', 'badge' => 'tandem_creator',    'name' => 'Tandem-Stifterin',    'icon' => 'link'],
            ['key' => 'theres',  'badge' => 'language_partner',  'name' => 'Sprachtandem',         'icon' => 'languages'],
            ['key' => 'anna',    'badge' => 'language_partner',  'name' => 'Sprachtandem',         'icon' => 'languages'],
            ['key' => 'anna',    'badge' => 'cooking_circle',    'name' => 'Kochkreis',           'icon' => 'utensils'],
            ['key' => 'thomas',  'badge' => 'municipality_link', 'name' => 'Gemeinde-Brücke',     'icon' => 'building-2'],
            ['key' => 'stefan',  'badge' => 'trust_anchor',      'name' => 'Vertrauensperson',    'icon' => 'shield-check'],
            ['key' => 'markus',  'badge' => 'gardener',          'name' => 'Garten-Profi',         'icon' => 'sprout'],
            ['key' => 'samira',  'badge' => 'family_anchor',     'name' => 'Familien-Anker',      'icon' => 'home'],
            ['key' => 'karin',   'badge' => 'caring_anchor',     'name' => 'Verlässlicher Anker', 'icon' => 'heart-handshake'],
            ['key' => 'christine','badge' => 'eth_volunteer',    'name' => 'ETH-Freiwillige',     'icon' => 'graduation-cap'],
            ['key' => 'admin',   'badge' => 'pilot_steward',     'name' => 'Pilot-Steward',       'icon' => 'star'],
            ['key' => 'roland',  'badge' => 'driving_buddy',     'name' => 'Fahrdienst-Held',      'icon' => 'car'],
            ['key' => 'maria',   'badge' => 'language_partner',  'name' => 'Sprachtandem',         'icon' => 'languages'],
        ];

        $awardedAt = now()->subDays(random_int(20, 90));
        foreach ($badges as $idx => $b) {
            $userId = $userIds[$b['key']] ?? null;
            if ($userId === null) {
                continue;
            }
            $this->upsert(
                'user_badges',
                ['tenant_id' => $tenantId, 'user_id' => $userId, 'badge_key' => $b['badge']],
                [
                    'name' => $b['badge'],
                    'title' => $b['name'],
                    'icon' => $b['icon'],
                    'is_showcased' => 1,
                    'showcase_order' => $idx % 3,
                    'awarded_at' => $awardedAt,
                    'earned_at' => $awardedAt,
                    'claimed_at' => $awardedAt,
                ]
            );
            $this->bump('showcase badges');
        }
    }

    // -----------------------------------------------------------------------
    // AG89 / AG91 / AG92 / AG94 — pilot evaluation surfaces
    // -----------------------------------------------------------------------

    private function seedSuccessStories(int $tenantId): void
    {
        $service = app(SuccessStoryService::class);
        $result = $service->seedDemoStories($tenantId);
        if (isset($result['items'])) {
            $this->counts['success stories (AG91)'] = count($result['items']);
        } else {
            $this->counts['success stories (AG91)'] = 0; // already-seeded — leave admin curation alone
        }
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedCopilotProposals(int $tenantId, array $userIds): void
    {
        $adminId = $userIds['admin'] ?? null;
        $municipalityId = $userIds['thomas'] ?? null;
        $coordinatorId = $userIds['marlies'] ?? null;
        if ($adminId === null) {
            return;
        }

        // AG89 stores proposals as a JSON envelope under tenant_settings — we
        // bypass the service constructor and write the envelope ourselves so we
        // can pin status/timestamps for a polished demo. Idempotent: the seed
        // only writes when no proposals currently exist.

        if (! Schema::hasTable('tenant_settings')) {
            return;
        }
        $existing = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', MunicipalCommunicationCopilotService::SETTING_KEY)
            ->first();
        if ($existing && $existing->setting_value && trim((string) $existing->setting_value) !== '') {
            $decoded = json_decode((string) $existing->setting_value, true);
            if (is_array($decoded) && ! empty($decoded['items'])) {
                return; // respect prior admin curation
            }
        }

        $now = now()->toIso8601String();
        $proposals = [
            [
                'draft' => 'Liebe Bewohnerinnen und Bewohner, ab 1. Mai gelten neue Öffnungszeiten der Gemeindekanzlei. Bitte beachten Sie die geänderten Schalterzeiten.',
                'polished' => 'Liebe Cham-Bewohnerinnen und -Bewohner, ab dem 1. Mai 2026 ändern sich die Öffnungszeiten der Gemeindekanzlei: Montag bis Freitag 8:00–12:00 und 13:30–17:00 Uhr, donnerstags zusätzlich bis 18:30 Uhr. Bei Fragen erreichen Sie uns weiterhin unter 041 723 87 11 oder per E-Mail an gemeindekanzlei@cham.ch.',
                'tone' => 'ok', 'audience' => 'all_members', 'status' => 'published', 'days' => 4, 'by' => $municipalityId ?? $adminId,
                'warnings' => [], 'flags' => [],
            ],
            [
                'draft' => 'Achtung: am 14. Mai gibt es einen Stromunterbruch im Lorzenhof-Quartier von 9 bis 11 Uhr.',
                'polished' => 'Geplanter Stromunterbruch im Lorzenhof-Quartier: am Mittwoch, 14. Mai 2026, von 9:00 bis 11:00 Uhr. Wir empfehlen, batteriebetriebene Geräte vorzubereiten und Aufzüge erst nach 11:30 Uhr wieder voll zu beanspruchen. KISS-Mitglieder, die spezielle Pflegegeräte verwenden, sollten sich vorab bei Marlies (Koordination) melden.',
                'tone' => 'ok', 'audience' => 'sub_region', 'status' => 'accepted', 'days' => 2, 'by' => $municipalityId ?? $adminId,
                'warnings' => ['konkretes Datum, präziser Zeitraum, betroffenes Quartier — gut'],
                'flags' => [],
            ],
            [
                'draft' => 'Hilfe! Wir suchen DRINGEND Freiwillige für das Frühlingsfest, sonst fällt es aus!',
                'polished' => 'Liebe Caring-Community, das Frühlingsfest des Quartiervereins Lorzenhof am 18. Mai braucht noch Unterstützung. Wir freuen uns über Helferinnen und Helfer für Auf- und Abbau, Grill und Kuchenbüffet. Auch zwei Stunden helfen schon enorm. Meldet euch direkt bei Andrea oder über die Caring Community App.',
                'tone' => 'too_informal', 'audience' => 'all_members', 'status' => 'proposed', 'days' => 1, 'by' => $coordinatorId ?? $adminId,
                'warnings' => ['Original klingt etwas alarmierend — überarbeitete Version informiert ohne Druck'],
                'flags' => ['urgency_softened'],
            ],
            [
                'draft' => 'Wir machen jetzt eine Kampagne weil zu wenig Leute Stunden buchen.',
                'polished' => 'Eine kurze Erinnerung an unsere KISS-Mitglieder: Stunden zu erfassen ist Teil dessen, was die Caring Community trägt. Wenn ihr unsicher seid, wie das geht, schaut in die Hilfe-Sektion oder fragt Marlies direkt. Wir sind hier, um euch zu unterstützen.',
                'tone' => 'too_informal', 'audience' => 'verified_only', 'status' => 'rejected', 'days' => 6, 'by' => $coordinatorId ?? $adminId,
                'warnings' => ['Original wirkt vorwurfsvoll — überarbeitet als sanfter Reminder'],
                'flags' => ['tone_softened'],
            ],
            [
                'draft' => 'Pflegerinnen ohne Ausbildung dürfen NICHT mehr ohne Aufsicht alleine zu Klienten gehen.',
                'polished' => 'Wichtig für unsere Care-Provider und Spitex-Partner: Ab dem 1. Juni gilt die neue Richtlinie zur Begleitung von ungeschulten Pflegekräften. Schulungen werden im Mai angeboten — Termine in der Veranstaltungsübersicht. Bei Fragen wenden Sie sich an Stefan (Vertrauensperson) oder Spitex Zug.',
                'tone' => 'condescending', 'audience' => 'caregivers', 'status' => 'accepted', 'days' => 9, 'by' => $coordinatorId ?? $adminId,
                'warnings' => ['Original könnte abwertend wirken — überarbeitet als Information mit Schulungsangebot'],
                'flags' => ['tone_neutralised'],
            ],
            [
                'draft' => 'Sommerferien: Die Caring Community Cham macht Pause vom 22. Juli bis 11. August.',
                'polished' => 'Sommerpause der Caring Community Cham: Vom 22. Juli bis 11. August reduziert sich unsere Vermittlungs-Tätigkeit. Tandems laufen wie gewohnt weiter. Akute Anfragen erreichen Marlies über 079 555 33 22. Gemeinsame Treffen pausieren — wir sehen uns am 12. August zum Sommer-Stamm.',
                'tone' => 'ok', 'audience' => 'all_members', 'status' => 'proposed', 'days' => 0, 'by' => $coordinatorId ?? $adminId,
                'warnings' => [],
                'flags' => [],
            ],
        ];

        $items = [];
        foreach ($proposals as $i => $p) {
            $createdAt = now()->subDays($p['days'])->subHours(random_int(2, 18))->toIso8601String();
            $items[] = [
                'id'                     => 'cop_' . substr(bin2hex(random_bytes(6)), 0, 12),
                'draft_text'             => $p['draft'],
                'polished_text'          => $p['polished'],
                'tone_assessment'        => $p['tone'],
                'clarity_warnings'       => $p['warnings'],
                'audience_suggestion'    => $p['audience'],
                'audience_hint'          => $p['audience'],
                'sub_region_id'          => null,
                'moderation_flags'       => $p['flags'],
                'model_used'             => 'gpt-4o-mini',
                'created_by'             => $p['by'],
                'created_at'             => $createdAt,
                'status'                 => $p['status'],
                'accepted_at'            => $p['status'] === 'accepted' || $p['status'] === 'published' ? $createdAt : null,
                'rejected_at'            => $p['status'] === 'rejected' ? $createdAt : null,
                'rejection_reason'       => $p['status'] === 'rejected' ? 'Tonfall zu vorwurfsvoll für Mitgliederrunde' : null,
                'source_announcement_id' => null,
            ];
        }

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => MunicipalCommunicationCopilotService::SETTING_KEY],
            [
                'setting_value' => json_encode([
                    'items' => $items,
                    'updated_at' => $now,
                ]),
                'setting_type' => 'json',
                'category' => 'caring',
                'updated_at' => now(),
            ]
        );
        $this->counts['copilot proposals (AG89)'] = count($items);
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedMunicipalityFeedback(int $tenantId, array $userIds): void
    {
        if (! Schema::hasTable('caring_municipality_feedback')) {
            return;
        }

        $items = [
            ['from' => 'andrea',  'cat' => 'idea',          'subj' => 'Bänke entlang der Lorze',                    'body' => 'Wäre es möglich, alle 200m eine Bank entlang des Lorze-Wegs anzubringen? Viele ältere Bewohner wünschen sich eine Pause auf dem Spaziergang.', 'status' => 'in_progress', 'sentiment' => 'positive',  'days' => 12],
            ['from' => 'theres',  'cat' => 'question',      'subj' => 'Buslinie 47 — Fahrplanänderung?',           'body' => 'Stimmt es, dass die Buslinie 47 ab Juli weniger oft fährt? Viele Senioren in Cham nutzen diese Linie für Arzttermine in Zug.', 'status' => 'resolved',    'sentiment' => 'concerned', 'days' => 18],
            ['from' => 'werner',  'cat' => 'issue_report',  'subj' => 'Stolperstelle Trottoir Steinhauserstrasse',  'body' => 'Auf der Höhe Steinhauserstrasse 14 ist eine Trottoirplatte gelockert. Mit dem Rollator gefährlich.', 'status' => 'in_progress', 'sentiment' => 'negative',  'days' => 5],
            ['from' => 'samira',  'cat' => 'idea',          'subj' => 'Familienraum für Wickelmöglichkeit',        'body' => 'Im Bibliothek-Foyer fehlt ein Wickelraum. Familien mit Babies müssen sonst nach Hause zurück. Wäre eine kleine Investition.', 'status' => 'triaging',     'sentiment' => 'positive',  'days' => 8],
            ['from' => 'beat',    'cat' => 'sentiment',     'subj' => 'Frühlingsfest — danke!',                    'body' => 'Wollte einfach DANKE sagen für das Frühlingsfest letzten Sonntag — toll organisiert. Mehr davon bitte.', 'status' => 'closed',       'sentiment' => 'positive',  'days' => 22],
            ['from' => 'erika',   'cat' => 'question',      'subj' => 'Wie funktioniert die Stundenerfassung?',     'body' => 'Bin neu in der KISS Cham. Die Stundenerfassung ist mir noch unklar — gibt es eine Sprechstunde?', 'status' => 'resolved',    'sentiment' => 'neutral',   'days' => 4],
            ['from' => 'hans',    'cat' => 'issue_report',  'subj' => 'Beleuchtung Bahnhofstrasse defekt',          'body' => 'Strassenlaternen Bahnhofstrasse 22–28 sind seit drei Tagen aus. Abends sehr dunkel.', 'status' => 'resolved',    'sentiment' => 'concerned', 'days' => 14],
            ['from' => 'sabine',  'cat' => 'idea',          'subj' => 'Open-Data-Portal für KISS-Daten',           'body' => 'Es wäre spannend, anonymisierte KPI-Daten der KISS Cham als Open Data zu publizieren — gut für Forschung, gut für Transparenz.', 'status' => 'new',          'sentiment' => 'positive',  'days' => 1],
            ['from' => 'andrea',  'cat' => 'sentiment',     'subj' => 'KISS Cham — beste Entscheidung',           'body' => 'Möchte loswerden: KISS Cham hat mein Leben als Pensionierte verändert. Verbinde mich mit dem Quartier, fühle mich gebraucht. Danke an alle.', 'status' => 'closed',       'sentiment' => 'positive',  'days' => 28],
            ['from' => 'markus',  'cat' => 'idea',          'subj' => 'Werkstatt-Tag offen für Lehrlinge?',        'body' => 'Wäre es möglich, einen offenen Werkstatt-Tag mit Lehrlingen aus dem Bauhof zu machen? Kombiniert Ausbildung und Caring Community.', 'status' => 'new',          'sentiment' => 'positive',  'days' => 2],
            ['from' => 'karin',   'cat' => 'question',      'subj' => 'Spitex-Partnerschaft — Auswirkungen?',     'body' => 'Was bedeutet die neue Partnerschaft mit Spitex Zug für die Stunden-Aktivität in der Caring Community?', 'status' => 'triaging',     'sentiment' => 'neutral',   'days' => 6],
            ['from' => null,      'cat' => 'sentiment',     'subj' => 'Anonymes Feedback — Sprechstunden',         'body' => 'Sprechstunden Dienstag 14–17 funktioniert für Berufstätige nicht. Wäre Mittwochabend möglich?', 'status' => 'new',          'sentiment' => 'concerned', 'days' => 3],
        ];

        foreach ($items as $row) {
            $submitterId = $row['from'] ? ($userIds[$row['from']] ?? null) : null;
            $created = now()->subDays($row['days']);
            $values = [
                'submitter_user_id' => $submitterId,
                'category' => $row['cat'],
                'subject' => $row['subj'],
                'body' => $row['body'],
                'sentiment_tag' => $row['sentiment'],
                'status' => $row['status'],
                'is_anonymous' => $submitterId === null ? 1 : 0,
                'is_public' => $row['cat'] === 'sentiment' ? 1 : 0,
                'assigned_user_id' => $userIds['admin'] ?? null,
                'assigned_role' => 'municipality_admin',
                'triage_notes' => in_array($row['status'], ['triaging', 'in_progress', 'resolved', 'closed'], true)
                    ? 'Eingang bestätigt. Weiterleitung an zuständige Fachstelle Cham.'
                    : null,
                'resolution_notes' => in_array($row['status'], ['resolved', 'closed'], true)
                    ? 'Mit dem Bewohner abgestimmt — Massnahme eingeleitet bzw. erledigt.'
                    : null,
                'created_at' => $created,
                'updated_at' => $created->copy()->addHours(random_int(2, 48)),
            ];
            $this->upsert(
                'caring_municipality_feedback',
                ['tenant_id' => $tenantId, 'subject' => $row['subj']],
                $values
            );
            $this->bump('municipality feedback (AG92)');
        }
    }

    private function seedLeadNurtureContacts(int $tenantId): void
    {
        if (! Schema::hasTable('tenant_settings')) {
            return;
        }
        // Respect prior admin curation if there are already contacts.
        $existing = DB::table('tenant_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', LeadNurtureService::SETTING_KEY)
            ->first();
        if ($existing && $existing->setting_value) {
            $decoded = json_decode((string) $existing->setting_value, true);
            if (is_array($decoded) && ! empty($decoded['items'])) {
                return;
            }
        }

        $now = now()->toIso8601String();
        $rows = [
            ['name' => 'Roland Greber',          'email' => 'r.greber@kiss-zug.example',           'org' => 'KISS Genossenschaft Zug',     'segment' => 'partner',      'source' => 'pilot_inquiry_form',     'stage' => 'qualified', 'days' => 14, 'locale' => 'de'],
            ['name' => 'Christopher Mueller',    'email' => 'c.mueller@stadtbern.example',         'org' => 'Stadt Bern, Sozialdept.',     'segment' => 'municipality', 'source' => 'agoris_landing',          'stage' => 'engaged',   'days' => 11, 'locale' => 'de'],
            ['name' => 'Martin Villiger',        'email' => 'm.villiger@agoris.example',           'org' => 'AGORIS / KISS',                'segment' => 'partner',      'source' => 'direct_intro',            'stage' => 'qualified', 'days' => 18, 'locale' => 'de'],
            ['name' => 'Sandra Künzli',          'email' => 's.kuenzli@hofladen-felder.example',   'org' => 'Hofladen Felder',              'segment' => 'business',     'source' => 'agoris_landing',          'stage' => 'captured',  'days' => 1,  'locale' => 'de'],
            ['name' => 'Dr. Marc Bühlmann',      'email' => 'marc.buehlmann@univ.example',         'org' => 'Universität Zürich',           'segment' => 'partner',      'source' => 'research_partnership',    'stage' => 'engaged',   'days' => 8,  'locale' => 'de'],
            ['name' => 'Yvonne Bühler',          'email' => 'yvonne.b@familientreff.example',      'org' => 'Familientreff Steinhausen',    'segment' => 'partner',      'source' => 'agoris_landing',          'stage' => 'qualified', 'days' => 6,  'locale' => 'de'],
            ['name' => 'Stefan Reichlin',        'email' => 's.reichlin@gemeinde-baar.example',    'org' => 'Gemeinde Baar',                'segment' => 'municipality', 'source' => 'newsletter_signup',       'stage' => 'contacted', 'days' => 4,  'locale' => 'de'],
            ['name' => 'Andrea Burkard',         'email' => 'a.burkard@kanton-luzern.example',     'org' => 'Kanton Luzern, GSD',           'segment' => 'municipality', 'source' => 'agoris_landing',          'stage' => 'captured',  'days' => 2,  'locale' => 'de'],
            ['name' => 'Lorenz Kühne',           'email' => 'lorenz.k@beneficius.example',         'org' => 'Beneficius Stiftung',          'segment' => 'investor',     'source' => 'agoris_landing',          'stage' => 'contacted', 'days' => 9,  'locale' => 'de'],
            ['name' => 'Carmen Diaz',            'email' => 'cdiaz@brido-ventures.example',        'org' => 'Brido Ventures',                'segment' => 'investor',     'source' => 'agoris_landing',          'stage' => 'engaged',   'days' => 12, 'locale' => 'en'],
            ['name' => 'Reto Bachmann',          'email' => 'reto@stadtbergcoop.example',          'org' => 'Stadtberg Coop',                'segment' => 'business',     'source' => 'agoris_landing',          'stage' => 'captured',  'days' => 0,  'locale' => 'de'],
            ['name' => 'Petra Holzer',           'email' => 'p.holzer@example.com',                'org' => null,                            'segment' => 'resident',     'source' => 'newsletter_signup',       'stage' => 'captured',  'days' => 3,  'locale' => 'de'],
            ['name' => 'Jürg Strebel',           'email' => 'j.strebel@example.com',               'org' => null,                            'segment' => 'resident',     'source' => 'newsletter_signup',       'stage' => 'captured',  'days' => 1,  'locale' => 'de'],
            ['name' => 'Olivia Pfister',         'email' => 'o.pfister@example.com',               'org' => null,                            'segment' => 'resident',     'source' => 'agoris_landing',          'stage' => 'contacted', 'days' => 7,  'locale' => 'de'],
            ['name' => 'Hans Niederberger',      'email' => 'h.niederberger@srf.example',          'org' => 'SRF Wirtschaft',                'segment' => 'partner',      'source' => 'press_outreach',           'stage' => 'engaged',   'days' => 5,  'locale' => 'de'],
        ];

        $items = [];
        foreach ($rows as $i => $r) {
            $createdAt = now()->subDays($r['days'])->subHours(random_int(0, 18))->toIso8601String();
            $items[] = [
                'id'                  => 'lead_' . substr(md5($r['email']), 0, 16),
                'name'                => $r['name'],
                'email'               => $r['email'],
                'phone'               => null,
                'organisation'        => $r['org'],
                'segment'             => $r['segment'],
                'source'              => $r['source'],
                'locale'              => $r['locale'],
                'interests'           => match ($r['segment']) {
                    'municipality' => ['pilot', 'kpi_dashboard', 'compliance'],
                    'investor'     => ['kpi_dashboard', 'success_stories'],
                    'business'     => ['merchant_onboarding', 'time_credits'],
                    'partner'      => ['integration', 'federation'],
                    default        => ['caring_community'],
                },
                'stage'               => $r['stage'],
                'consent'             => true,
                'consent_at'          => $createdAt,
                'consent_ip'          => '0.0.0.0',
                'follow_up_at'        => in_array($r['stage'], ['captured', 'contacted'], true) ? now()->addDays(2 + ($i % 5))->toDateString() : null,
                'last_contacted_at'   => in_array($r['stage'], ['contacted', 'engaged', 'qualified'], true) ? now()->subDays(max(0, $r['days'] - 1))->toIso8601String() : null,
                'notes'               => null,
                'created_at'          => $createdAt,
                'updated_at'          => $createdAt,
            ];
        }

        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $tenantId, 'setting_key' => LeadNurtureService::SETTING_KEY],
            [
                'setting_value' => json_encode([
                    'items' => $items,
                    'updated_at' => $now,
                ]),
                'setting_type' => 'json',
                'category' => 'caring',
                'updated_at' => now(),
            ]
        );
        $this->counts['lead nurture contacts (AG94)'] = count($items);
    }

    /**
     * @param array<string, int> $userIds
     */
    private function seedCivicDigestPrefs(int $tenantId, array $userIds): void
    {
        // AG90 stores prefs as JSON envelopes in `tenant_settings`:
        //   caring.civic_digest.tenant_default_cadence    (tenant default)
        //   caring.civic_digest.user_prefs.{userId}       (per-user override)
        // Per-user envelope shape (CivicDigestService::getUserPrefs):
        //   { enabled, cadence (off|daily|monthly), preferred_sub_region_id, opt_out_sources[] }
        // ALLOWED_SOURCES: announcement, project, event, vol_org, care_provider,
        // marketplace, safety_alert, help_request, feed_post.
        if (! Schema::hasTable('tenant_settings')) {
            return;
        }

        // Tenant default cadence — monthly digest by default for residents.
        $this->upsert(
            'tenant_settings',
            ['tenant_id' => $tenantId, 'setting_key' => CivicDigestService::SETTING_TENANT_DEFAULT],
            [
                'setting_value' => 'monthly',
                'setting_type' => 'string',
                'category' => 'caring',
                'updated_at' => now(),
            ]
        );
        $this->bump('civic-digest tenant default (AG90)');

        $prefs = [
            'andrea'  => ['cadence' => 'monthly', 'opt_out_sources' => ['safety_alert']], // active resident, opted out of alarms
            'thomas'  => ['cadence' => 'daily',  'opt_out_sources' => []],                // municipality admin — wants everything
            'sabine'  => ['cadence' => 'monthly', 'opt_out_sources' => ['vol_org']],
            'marlies' => ['cadence' => 'daily',  'opt_out_sources' => []],                // KISS coordinator — wants everything
            'theres'  => ['cadence' => 'monthly', 'opt_out_sources' => ['marketplace']],
        ];

        $now = now()->getTimestamp();
        foreach ($prefs as $key => $pref) {
            $userId = $userIds[$key] ?? null;
            if ($userId === null) {
                continue;
            }
            $envelope = [
                'enabled' => $pref['cadence'] !== 'off',
                'cadence' => $pref['cadence'],
                'preferred_sub_region_id' => null,
                'opt_out_sources' => $pref['opt_out_sources'],
                'updated_at' => $now,
            ];
            $this->upsert(
                'tenant_settings',
                [
                    'tenant_id' => $tenantId,
                    'setting_key' => CivicDigestService::SETTING_USER_PREFIX . $userId,
                ],
                [
                    'setting_value' => json_encode($envelope),
                    'setting_type' => 'json',
                    'category' => 'caring',
                    'updated_at' => now(),
                ]
            );
            $this->bump('civic-digest user prefs (AG90)');
        }
    }

    // -----------------------------------------------------------------------
    // Generic upsert helpers (mirror SeedAgorisRealisticContent so this command
    // is independently runnable and column-safe across MariaDB schema drift).
    // -----------------------------------------------------------------------

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
