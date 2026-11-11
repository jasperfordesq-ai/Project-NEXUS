<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * A SHOW COMMUNITY — "Riverside Timebank" — filled with realistic, entirely
 * synthetic content, so the member website can be seen the way a lively
 * community sees it.
 *
 * Why it exists: the visual work on the member site (covers, colours, charts,
 * milestones, faces) was being judged against test communities holding one or
 * two rows each, where most of it never renders at all. This community has two
 * dozen made-up neighbours, offers and requests in every theme, upcoming
 * events with people going, groups, a year of exchanges with thank-you
 * reviews, feed posts, skills, endorsements and badges.
 *
 * Everything is fictional. No row is copied from any real community.
 *
 * Deterministic and idempotent: no randomness; every row is keyed on a natural
 * key (tenant + email, tenant + title, …) and updated in place on a re-run.
 * Dates are relative to "now", so the community always looks current.
 *
 * Accounts (all @showcase.project-nexus.local, one shared known password,
 * overridable with SHOWCASE_PASSWORD): every member, e.g. maeve@…, plus
 * admin@… (role admin; admin 2FA applies as usual).
 *
 * 🔴 Refuses to run outside local/development/testing — it creates
 * known-password accounts.
 *
 * Run: php artisan db:seed --class=Database\\Seeders\\ShowcaseCommunitySeeder
 *      (on the disposable e2e stack: bash scripts/webuk-e2e-env.sh showcase)
 */
class ShowcaseCommunitySeeder extends Seeder
{
    /** Only environments in which known-credential fixtures may be created. Fail closed (F-398). */
    private const SAFE_SEEDING_ENVIRONMENTS = ['local', 'development', 'testing'];

    public const TENANT_SLUG = 'riverside';
    public const TENANT_NAME = 'Riverside Timebank';
    public const EMAIL_DOMAIN = 'showcase.project-nexus.local';

    /** Town centre for map pins (synthetic; spreads members a few streets apart). */
    private const CENTRE_LAT = 53.2740;
    private const CENTRE_LON = -9.0490;

    private int $tenantId = 0;
    private Carbon $now;

    /** @var array<string,int> email local part → user id */
    private array $users = [];

    /** @var array<string,int> slug → category id */
    private array $listingCategories = [];

    /** @var array<string,int> slug → category id */
    private array $eventCategories = [];

    public function run(): void
    {
        $environment = trim((string) app()->environment());
        if (! in_array($environment, self::SAFE_SEEDING_ENVIRONMENTS, true)) {
            $this->command?->warn(sprintf(
                '%s refuses to run in environment "%s" (creates known-credential accounts). It runs only in %s. Aborting.',
                class_basename($this),
                $environment === '' ? '(empty)' : $environment,
                implode(', ', self::SAFE_SEEDING_ENVIRONMENTS)
            ));
            return;
        }

        $this->now = now();
        $this->tenantId = $this->ensureTenant();

        $this->seedCategories();
        $this->seedMembers();
        $this->seedSkills();
        $listingIds = $this->seedListings();
        $this->seedEvents();
        $this->seedGroups();
        $this->seedExchanges($listingIds);
        $this->seedConnections();
        $this->seedFeedPosts();
        $this->seedMessages();
        $this->seedNotifications();
        $this->seedBlog();
        $this->seedBadges();

        $this->command?->info(sprintf(
            'Showcase community "%s" (tenant %d, /%s): %d members, %d offers and requests.',
            self::TENANT_NAME,
            $this->tenantId,
            self::TENANT_SLUG,
            count($this->users),
            count($listingIds)
        ));
    }

    // ------------------------------------------------------------------ tenant

    private function ensureTenant(): int
    {
        $existing = DB::table('tenants')->where('slug', self::TENANT_SLUG)->value('id');

        $features = [
            'events' => true, 'groups' => true, 'gamification' => true, 'goals' => true,
            'blog' => true, 'resources' => true, 'volunteering' => true, 'exchange_workflow' => true,
            'organisations' => true, 'connections' => true, 'reviews' => true, 'polls' => true,
            'direct_messaging' => true, 'search' => true, 'explore' => true,
            'marketplace' => false, 'courses' => false, 'podcasts' => false,
            // 🔴 Never switch Caring Community on (unfinished alpha).
            'caring_community' => false, 'federation' => false, 'ai_chat' => false,
        ];

        $row = [
            'name' => self::TENANT_NAME,
            'tenant_category' => 'community',
            'tagline' => 'Neighbours sharing time and skills',
            'description' => 'A friendly timebank where every hour you give is an hour you can receive.',
            'is_active' => 1,
            'features' => json_encode($features),
            'location_name' => 'Riverside',
            'latitude' => self::CENTRE_LAT,
            'longitude' => self::CENTRE_LON,
            'updated_at' => $this->now,
        ];

        if ($existing) {
            DB::table('tenants')->where('id', $existing)->update($row);
            return (int) $existing;
        }

        $id = (int) DB::table('tenants')->insertGetId($row + [
            'slug' => self::TENANT_SLUG,
            'parent_id' => null,
            'depth' => 0,
            'allows_subtenants' => 0,
            'max_depth' => 0,
            'created_at' => $this->now->copy()->subMonths(26),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/{$id}/"]);

        return $id;
    }

    // -------------------------------------------------------------- categories

    private function seedCategories(): void
    {
        $listing = [
            ['garden', 'Home and garden', 'green', 'garden'],
            ['repairs', 'Repairs and DIY', 'orange', 'repairs'],
            ['food', 'Cooking and food', 'red', 'food'],
            ['learning', 'Learning and tutoring', 'blue', 'learning'],
            ['care', 'Care and company', 'pink', 'care'],
            ['technology', 'Computers and phones', 'cyan', 'technology'],
            ['transport', 'Lifts and errands', 'amber', 'transport'],
            ['arts', 'Arts and music', 'purple', 'arts'],
            ['pets', 'Pets', 'teal', 'pets'],
            ['languages', 'Languages', 'indigo', 'languages'],
        ];
        foreach ($listing as $i => [$slug, $name, $colour, $icon]) {
            $this->listingCategories[$slug] = $this->upsertCategory('listing', "riverside-{$slug}", $name, $colour, $icon, $i);
        }

        $event = [
            ['social', 'Socials', 'pink', 'company'],
            ['workshop', 'Workshops', 'blue', 'learning'],
            ['outdoors', 'Outdoors', 'green', 'outdoors'],
            ['repair-cafe', 'Repair café', 'orange', 'repairs'],
        ];
        foreach ($event as $i => [$slug, $name, $colour, $icon]) {
            $this->eventCategories[$slug] = $this->upsertCategory('event', "riverside-event-{$slug}", $name, $colour, $icon, $i);
        }
    }

    private function upsertCategory(string $type, string $slug, string $name, string $colour, string $icon, int $order): int
    {
        DB::table('categories')->updateOrInsert(
            ['tenant_id' => $this->tenantId, 'slug' => $slug, 'type' => $type],
            [
                'name' => $name,
                'color' => $colour,
                'icon' => $icon,
                'sort_order' => $order,
                'is_active' => 1,
                'substitution_coefficient' => 1.00,
                'created_at' => $this->now,
                'updated_at' => $this->now,
            ]
        );

        return (int) DB::table('categories')
            ->where('tenant_id', $this->tenantId)->where('slug', $slug)->where('type', $type)->value('id');
    }

    // ----------------------------------------------------------------- members

    /**
     * @return list<array{0:string,1:string,2:string,3:string,4:int,5:string}>
     *   [local part, first, last, bio, months since joining, skills]
     */
    private function memberData(): array
    {
        return [
            ['maeve', 'Maeve', 'Brennan', 'Retired teacher. I love gardening, baking and a good chat over tea.', 25, 'Gardening, Baking, Reading help'],
            ['tomas', 'Tomás', 'Okafor', 'Bike mechanic by day. Happy to fix anything with wheels.', 22, 'Bike repairs, DIY, Lifts'],
            ['priya', 'Priya', 'Nair', 'Software developer and mum of two. Can help with phones, laptops and maths homework.', 20, 'Computers, Maths tutoring'],
            ['sean', 'Seán', 'Kelly', 'Carpenter. Shelves, doors, flat-pack — bring it on.', 19, 'Carpentry, Furniture assembly'],
            ['amara', 'Amara', 'Diallo', 'Nurse and keen cook. I run the Thursday soup swap.', 18, 'Cooking, Befriending'],
            ['liam', 'Liam', 'Walsh', 'Student. Dog walker, errand runner, and very good at quiz nights.', 6, 'Dog walking, Errands'],
            ['sofia', 'Sofia', 'Rossi', 'Painter and art teacher. Italian conversation practice any time.', 16, 'Painting, Italian'],
            ['grace', 'Grace', 'Murphy', 'Grandmother of five. Knitting, mending and good advice.', 24, 'Knitting, Sewing, Mending'],
            ['kenji', 'Kenji', 'Sato', 'Photographer. I can take portraits for your profile or your group.', 12, 'Photography, Japanese'],
            ['fatima', 'Fatima', 'Hassan', 'Accountant. Happy to look over budgets and forms.', 14, 'Budgeting, Form filling'],
            ['ciara', 'Ciara', 'Doyle', 'Yoga teacher and walker. Join me on the river path.', 10, 'Yoga, Walking'],
            ['daniel', 'Daniel', 'Novak', 'Electrician (retired). Light fittings, plugs and advice.', 21, 'Electrical advice, DIY'],
            ['aoife', 'Aoife', 'Byrne', 'Musician. Guitar and piano lessons for beginners.', 9, 'Guitar, Piano'],
            ['mateo', 'Mateo', 'García', 'Chef. Spanish lessons in exchange for garden help!', 7, 'Cooking, Spanish'],
            ['hannah', 'Hannah', 'Schmidt', 'Dog lover and pet sitter. Cats welcome too.', 11, 'Pet sitting'],
            ['oisin', 'Oisín', 'Ryan', 'Drives a van — moving help and tip runs.', 15, 'Moving help, Lifts'],
            ['leila', 'Leila', 'Haddad', 'Seamstress. Hems, zips and alterations.', 13, 'Sewing, Alterations'],
            ['noah', 'Noah', 'Mensah', 'Gardener with a big allotment and too many courgettes.', 17, 'Gardening, Composting'],
            ['eva', 'Eva', 'Kowalska', 'Hairdresser. Haircuts at home for people who cannot get out.', 8, 'Haircuts, Polish'],
            ['ruairi', 'Ruairí', 'Quinn', 'IT support for older neighbours. Patient and plain-spoken.', 5, 'Computers, Smartphones'],
            ['zara', 'Zara', 'Ahmed', 'Baker and cake decorator.', 3, 'Baking, Cake decorating'],
            ['peter', 'Peter', 'Lynch', 'Retired. Reads to people and loves a game of chess.', 23, 'Reading aloud, Chess'],
            ['nina', 'Nina', 'Petrova', 'Just joined! Can help with Russian and cleaning.', 0, 'Russian, Cleaning'],
            ['jamal', 'Jamal', 'Brooks', 'New here. Fitness coach — gentle exercise for all ages.', 0, 'Fitness, Stretching'],
        ];
    }

    private function seedMembers(): void
    {
        $override = getenv('SHOWCASE_PASSWORD');
        $hash = bcrypt(is_string($override) && $override !== '' ? $override : 'ShowcasePassword123!');

        foreach ($this->memberData() as $i => [$local, $first, $last, $bio, $months, $skills]) {
            // Spread members a few streets apart (deterministic).
            $lat = self::CENTRE_LAT + (($i % 5) - 2) * 0.0042;
            $lon = self::CENTRE_LON + ((intdiv($i, 5) % 5) - 2) * 0.0061;
            $joined = $this->now->copy()->subMonths($months)->subDays(($i * 3) % 20);

            $this->upsertUser($local, $first, $last, 'member', [
                'bio' => $bio,
                'skills' => $skills,
                'location' => 'Riverside',
                'latitude' => $lat,
                'longitude' => $lon,
                'balance' => 3 + ($i * 7) % 18,
                'xp' => 120 + ($i * 137) % 900,
                'level' => 1 + ($i * 5) % 6,
                'created_at' => $joined,
                'last_active_at' => $this->now->copy()->subHours(($i * 5) % 70),
            ], $hash);
        }

        $this->upsertUser('admin', 'Róisín', 'Fitzgerald', 'admin', [
            'bio' => 'Coordinator of Riverside Timebank.',
            'location' => 'Riverside',
            'balance' => 10,
            'created_at' => $this->now->copy()->subMonths(26),
        ], $hash);
    }

    /** @param array<string,mixed> $extra */
    private function upsertUser(string $local, string $first, string $last, string $role, array $extra, string $hash): void
    {
        $email = "{$local}@" . self::EMAIL_DOMAIN;
        DB::table('users')->updateOrInsert(
            ['tenant_id' => $this->tenantId, 'email' => $email],
            $extra + [
                'first_name' => $first,
                'last_name' => $last,
                'name' => "{$first} {$last}",
                'password_hash' => $hash,
                'role' => $role,
                'status' => 'active',
                'is_verified' => 1,
                'email_verified_at' => $this->now,
                'is_approved' => 1,
                'profile_type' => 'individual',
                'onboarding_completed' => 1,
                'preferred_theme' => 'light',
                'preferred_language' => 'en',
                'updated_at' => $this->now,
            ]
        );
        $this->users[$local] = (int) DB::table('users')
            ->where('tenant_id', $this->tenantId)->where('email', $email)->value('id');
    }

    private function seedSkills(): void
    {
        foreach ($this->memberData() as [$local, , , , , $skills]) {
            foreach (array_map('trim', explode(',', $skills)) as $skill) {
                DB::table('user_skills')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'user_id' => $this->users[$local], 'skill_name' => $skill],
                    ['proficiency' => 'advanced', 'is_offering' => 1, 'is_requesting' => 0, 'created_at' => $this->now]
                );
            }
        }

        // Endorsements: friends vouching for each other's skills.
        $endorsements = [
            ['maeve', 'grace', 'Knitting', 'Grace taught me to knit socks. Endlessly patient!'],
            ['tomas', 'maeve', 'Gardening', 'Our front garden has never looked better.'],
            ['priya', 'ruairi', 'Computers', 'Sorted my mum\'s tablet in ten minutes.'],
            ['sean', 'daniel', 'Electrical advice', null],
            ['amara', 'zara', 'Baking', 'Best lemon cake in Riverside.'],
            ['sofia', 'kenji', 'Photography', null],
            ['liam', 'hannah', 'Pet sitting', 'Biscuit the dog adores her.'],
            ['ciara', 'aoife', 'Guitar', null],
            ['noah', 'maeve', 'Gardening', null],
            ['grace', 'leila', 'Sewing', 'Took up my curtains beautifully.'],
            ['peter', 'priya', 'Maths tutoring', null],
            ['fatima', 'tomas', 'Bike repairs', null],
        ];
        foreach ($endorsements as $i => [$from, $to, $skill, $comment]) {
            DB::table('skill_endorsements')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'endorser_id' => $this->users[$from], 'endorsed_id' => $this->users[$to], 'skill_name' => $skill],
                ['comment' => $comment, 'created_at' => $this->now->copy()->subDays(5 + $i * 9)]
            );
        }
    }

    // ---------------------------------------------------------------- listings

    /** @return list<int> */
    private function seedListings(): array
    {
        // [owner, type, category, title, description, hours, service type, days ago]
        $rows = [
            ['maeve', 'offer', 'garden', 'Help planting a vegetable bed', 'I will show you how to start a small vegetable bed — what to plant now, and how to keep slugs away. Bring gloves!', 2, 'physical_only', 1],
            ['tomas', 'offer', 'repairs', 'Bike tune-up and puncture repair', 'Brakes, gears and punctures sorted at my place or yours. Most jobs take about an hour.', 1, 'physical_only', 2],
            ['priya', 'offer', 'technology', 'Set up your new phone or laptop', 'Moving your photos, contacts and apps across, and showing you the basics. Plain English, no rush.', 1.5, 'hybrid', 3],
            ['amara', 'offer', 'food', 'Home-cooked meals for anyone recovering', 'I can cook a few portions of soup or stew for neighbours who are unwell or just home from hospital.', 2, 'physical_only', 4],
            ['liam', 'request', 'learning', 'Help with my CV before job interviews', 'Starting to apply for jobs and my CV needs a fresh pair of eyes. An hour over coffee would be brilliant.', 1, 'hybrid', 1],
            ['sofia', 'offer', 'languages', 'Italian conversation practice', 'Relaxed chats in Italian for beginners and improvers. Online or at the café.', 1, 'remote_only', 6],
            ['grace', 'offer', 'repairs', 'Mending and darning clothes', 'Holes in jumpers, loose buttons, fallen hems — bring them along on a Tuesday afternoon.', 1, 'physical_only', 7],
            ['kenji', 'offer', 'arts', 'Portrait photos for your profile', 'A friendly outdoor photo session, edited and sent to you the same week.', 1, 'physical_only', 5],
            ['fatima', 'offer', 'learning', 'Help with household budgets', 'Let\'s look at your bills together and make a simple plan. Completely confidential.', 1, 'hybrid', 9],
            ['ciara', 'offer', 'care', 'Gentle walk and chat along the river', 'A slow walk on the river path every Sunday morning. Good company guaranteed.', 1, 'physical_only', 3],
            ['daniel', 'offer', 'repairs', 'Change light fittings and fix plugs', 'Safe, careful help with lights and plugs. Advice on anything electrical.', 1, 'physical_only', 12],
            ['aoife', 'offer', 'arts', 'Beginner guitar lessons', 'Learn your first three chords and a song in one lesson. Guitars available to borrow.', 1, 'physical_only', 8],
            ['mateo', 'request', 'garden', 'Help clearing an overgrown garden', 'Our back garden has turned into a jungle. Two people for a morning would make a huge difference.', 3, 'physical_only', 2],
            ['hannah', 'offer', 'pets', 'Dog walking and pet sitting', 'Walks, feeding and cuddles while you are away. References from happy dogs available.', 1, 'physical_only', 4],
            ['oisin', 'offer', 'transport', 'Van for moving and tip runs', 'Got a van and strong arms. Furniture moves, recycling centre trips, collections.', 2, 'physical_only', 10],
            ['leila', 'offer', 'repairs', 'Alterations and new zips', 'Trousers taken up, dresses taken in, zips replaced. Usually ready within a week.', 1, 'physical_only', 6],
            ['noah', 'offer', 'garden', 'Fresh vegetables from the allotment', 'Courgettes, beans and salad in season. Come and pick, or I will drop them round.', 0.5, 'physical_only', 1],
            ['eva', 'offer', 'care', 'Haircuts at home', 'For neighbours who find it hard to get to a salon. Washing and drying too.', 1, 'physical_only', 11],
            ['ruairi', 'offer', 'technology', 'Video calls with family — I\'ll show you how', 'WhatsApp, Zoom or FaceTime set up and practised until it feels easy.', 1, 'hybrid', 2],
            ['zara', 'offer', 'food', 'Birthday cakes baked to order', 'Sponge, chocolate or lemon, decorated with the birthday person\'s name.', 2, 'physical_only', 3],
            ['peter', 'request', 'care', 'Someone to play chess with', 'Long-time player looking for a weekly game. Beginners very welcome — I will teach.', 1, 'physical_only', 5],
            ['nina', 'request', 'transport', 'Lift to the hospital on Thursday', 'Appointment at 10am, would be grateful for a lift there and back.', 2, 'physical_only', 0],
            ['jamal', 'offer', 'care', 'Gentle exercise for older neighbours', 'Chair exercises and stretching to keep you moving. In your living room or the community hall.', 1, 'physical_only', 0],
            ['sean', 'offer', 'repairs', 'Shelves put up and flat-pack built', 'Bring the box, I bring the drill. Level shelves guaranteed.', 1.5, 'physical_only', 13],
            ['maeve', 'request', 'technology', 'Help sending photos to my grandchildren', 'My new phone takes lovely photos but I cannot work out how to share them.', 1, 'physical_only', 6],
            ['grace', 'request', 'transport', 'Help carrying shopping home', 'The bags are heavy these days. Saturday mornings from the market.', 1, 'physical_only', 4],
            ['priya', 'request', 'garden', 'Advice on growing herbs on a balcony', 'Small balcony, lots of enthusiasm, no idea what I am doing.', 0.5, 'hybrid', 7],
            ['amara', 'request', 'languages', 'French practice before a trip', 'Holiday in Lyon next spring — would love to practise ordering and directions.', 1, 'remote_only', 8],
            ['tomas', 'request', 'arts', 'Someone to paint a sign for the bike shed', 'A cheerful hand-painted sign for the shared bike shed on Mill Lane.', 2, 'physical_only', 9],
            ['ciara', 'offer', 'learning', 'Beginners\' yoga in the park', 'Thursday evenings when the weather is kind. Mats provided.', 1, 'physical_only', 14],
        ];

        $ids = [];
        foreach ($rows as $i => [$owner, $type, $cat, $title, $desc, $hours, $service, $daysAgo]) {
            $created = $this->now->copy()->subDays($daysAgo)->subHours(($i * 7) % 20);
            DB::table('listings')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'user_id' => $this->users[$owner], 'title' => $title],
                [
                    'type' => $type,
                    'category_id' => $this->listingCategories[$cat],
                    'description' => $desc,
                    'location' => $service === 'remote_only' ? null : 'Riverside',
                    'latitude' => $service === 'remote_only' ? null : self::CENTRE_LAT + (($i % 7) - 3) * 0.003,
                    'longitude' => $service === 'remote_only' ? null : self::CENTRE_LON + ((intdiv($i, 7) % 5) - 2) * 0.005,
                    'status' => 'active',
                    'service_type' => $service,
                    'hours_estimate' => $hours,
                    'view_count' => 10 + ($i * 13) % 90,
                    'save_count' => ($i * 3) % 9,
                    'moderation_status' => 'approved',
                    'created_at' => $created,
                    'updated_at' => $created,
                ]
            );
            $id = (int) DB::table('listings')
                ->where('tenant_id', $this->tenantId)->where('user_id', $this->users[$owner])->where('title', $title)->value('id');
            $ids[] = $id;
            $this->upsertFeedActivity('listing', $id, $this->users[$owner], $title, $desc, $created, ['listing_type' => $type]);
        }

        return $ids;
    }

    // ------------------------------------------------------------------ events

    private function seedEvents(): void
    {
        // [organiser, category, title, description, days from now, hour, length h, place, going]
        $rows = [
            ['amara', 'social', 'Thursday soup swap', 'Bring a pot of soup, take home a different one. Bowls and bread provided.', 2, 18, 2, 'Community hall, Mill Lane', ['maeve', 'grace', 'zara', 'peter', 'nina', 'liam', 'eva']],
            ['tomas', 'repair-cafe', 'Riverside repair café', 'Bikes, toasters, torn jackets: our fixers will help you mend them. Free tea!', 5, 11, 3, 'The Old Library', ['sean', 'daniel', 'grace', 'leila', 'priya', 'oisin', 'ruairi', 'kenji']],
            ['ciara', 'outdoors', 'River path walk and picnic', 'An easy 5km walk at chatting pace, followed by a shared picnic.', 8, 10, 3, 'Meet at the footbridge', ['hannah', 'liam', 'jamal', 'sofia', 'maeve']],
            ['priya', 'workshop', 'Smartphone help morning', 'Bring your phone and your questions. One-to-one help with photos, messages and video calls.', 12, 10, 2, 'Riverside Library', ['maeve', 'peter', 'grace', 'ruairi']],
            ['noah', 'outdoors', 'Allotment harvest day', 'Help pick, wash and share the season\'s last vegetables. Children welcome with an adult.', 16, 14, 3, 'Riverside allotments', ['mateo', 'amara', 'zara', 'tomas', 'hannah', 'ciara']],
            ['aoife', 'social', 'Music and mince pies', 'An informal evening of songs. Bring an instrument or just your voice.', 22, 19, 2, 'Community hall, Mill Lane', ['sofia', 'kenji', 'eva', 'peter', 'grace', 'jamal', 'nina', 'liam', 'fatima']],
            ['sofia', 'workshop', 'Watercolour for beginners', 'All materials provided. Paint a winter tree in two hours.', 27, 14, 2, 'The Old Library', ['maeve', 'leila', 'zara']],
            ['fatima', 'workshop', 'Winter budgeting clinic', 'Short talk then one-to-one help with heating bills and budgets.', 33, 18, 2, 'Riverside Library', ['oisin', 'liam', 'nina']],
            // A past event, so the "past" tab is not empty.
            ['grace', 'social', 'Knit and natter', 'Our monthly knitting circle. Beginners taught by experts.', -9, 14, 2, 'Community hall, Mill Lane', ['maeve', 'leila', 'eva', 'amara']],
        ];

        foreach ($rows as $i => [$organiser, $cat, $title, $desc, $inDays, $hour, $length, $place, $going]) {
            $start = $this->now->copy()->startOfDay()->addDays($inDays)->setTime($hour, 0);
            $end = $start->copy()->addHours($length);
            DB::table('events')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'title' => $title],
                [
                    'user_id' => $this->users[$organiser],
                    'category_id' => $this->eventCategories[$cat],
                    'description' => $desc,
                    'location' => $place,
                    'latitude' => self::CENTRE_LAT + (($i % 3) - 1) * 0.004,
                    'longitude' => self::CENTRE_LON + (($i % 4) - 2) * 0.004,
                    'start_time' => $start,
                    'start_date' => $start,
                    'end_time' => $end,
                    'timezone' => 'Europe/Dublin',
                    'is_online' => 0,
                    'max_attendees' => 30,
                    'status' => 'active',
                    'publication_status' => 'published',
                    'operational_status' => $inDays < 0 ? 'completed' : 'scheduled',
                    'created_at' => $this->now->copy()->subDays(10 + $i),
                    'updated_at' => $this->now,
                ]
            );
            $eventId = (int) DB::table('events')->where('tenant_id', $this->tenantId)->where('title', $title)->value('id');
            // Raw inserts bypass EventService, which gives every concrete event an
            // occurrence key; without it registration refuses the event.
            DB::table('events')->where('tenant_id', $this->tenantId)->where('id', $eventId)
                ->where(fn ($q) => $q->whereNull('occurrence_key')->orWhere('occurrence_key', ''))
                ->update(['occurrence_key' => "event:{$this->tenantId}:{$eventId}"]);

            foreach (array_merge([$organiser], $going) as $j => $member) {
                $rsvpAt = $this->now->copy()->subDays(8 - min(7, $j));
                DB::table('event_rsvps')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'event_id' => $eventId, 'user_id' => $this->users[$member]],
                    [
                        'status' => $inDays < 0 ? 'attended' : 'going',
                        'is_federated' => 0,
                        'created_at' => $rsvpAt,
                        'updated_at' => $this->now,
                    ]
                );
                // The real "I'm going" flow also writes a confirmed registration
                // (EventRegistrationService); the check-in card looks for it.
                DB::table('event_registrations')->updateOrInsert(
                    [
                        'tenant_id' => $this->tenantId,
                        'event_id' => $eventId,
                        'user_id' => $this->users[$member],
                        'capacity_pool_key' => 'event',
                    ],
                    [
                        'registration_state' => 'confirmed',
                        'registration_version' => 1,
                        'party_size' => 1,
                        'state_changed_at' => $rsvpAt,
                        'state_changed_by' => $this->users[$member],
                        'confirmed_at' => $rsvpAt,
                        'created_at' => $rsvpAt,
                        'updated_at' => $rsvpAt,
                    ]
                );
            }

            $this->upsertFeedActivity('event', $eventId, $this->users[$organiser], $title, $desc,
                $this->now->copy()->subDays(10 + $i), ['start_date' => $start->toIso8601String(), 'location' => $place]);
        }
    }

    // ------------------------------------------------------------------ groups

    private function seedGroups(): void
    {
        // [owner, name, description, members]
        $rows = [
            ['noah', 'Riverside Growers', 'Allotment holders, balcony gardeners and anyone who likes getting their hands dirty.', ['maeve', 'mateo', 'priya', 'amara', 'ciara', 'tomas', 'grace']],
            ['tomas', 'Fixers\' Workshop', 'We mend things instead of throwing them away. Repair café volunteers meet here.', ['sean', 'daniel', 'grace', 'leila', 'oisin', 'ruairi']],
            ['aoife', 'Music Makers', 'Singers, strummers and listeners. Monthly sessions at the hall.', ['sofia', 'kenji', 'peter', 'eva', 'jamal']],
            ['ciara', 'Walking Group', 'Gentle walks every Sunday. All paces welcome, dogs too.', ['hannah', 'liam', 'maeve', 'jamal', 'nina', 'fatima', 'peter', 'grace']],
            ['amara', 'Soup and Supper Club', 'Cooking together, sharing recipes and making sure nobody eats alone.', ['zara', 'mateo', 'grace', 'peter', 'eva']],
            ['sofia', 'Language Café', 'Practise Italian, Spanish, Polish, Japanese, Russian and more over coffee.', ['mateo', 'kenji', 'eva', 'nina', 'amara', 'liam']],
        ];

        foreach ($rows as $i => [$owner, $name, $desc, $members]) {
            $slug = 'riverside-' . strtolower(preg_replace('/[^a-z0-9]+/i', '-', $name) ?? '');
            $slug = rtrim($slug, '-');
            DB::table('groups')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'slug' => $slug],
                [
                    'owner_id' => $this->users[$owner],
                    'creator_id' => $this->users[$owner],
                    'name' => $name,
                    'description' => $desc,
                    'visibility' => 'public',
                    'location' => 'Riverside',
                    'is_active' => 1,
                    'status' => 'active',
                    'cached_member_count' => count($members) + 1,
                    'created_at' => $this->now->copy()->subMonths(4 + $i * 2),
                    'updated_at' => $this->now,
                ]
            );
            $groupId = (int) DB::table('groups')->where('tenant_id', $this->tenantId)->where('slug', $slug)->value('id');

            foreach (array_merge([$owner], $members) as $j => $member) {
                DB::table('group_members')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'group_id' => $groupId, 'user_id' => $this->users[$member]],
                    [
                        'status' => 'active',
                        'role' => $j === 0 ? 'owner' : 'member',
                        'is_federated' => 0,
                        'joined_at' => $this->now->copy()->subDays(100 - $j * 9),
                        'created_at' => $this->now->copy()->subDays(100 - $j * 9),
                        'updated_at' => $this->now,
                    ]
                );
            }
        }
    }

    // --------------------------------------------------------------- exchanges

    /** @param list<int> $listingIds */
    private function seedExchanges(array $listingIds): void
    {
        $locals = array_column($this->memberData(), 0);
        // Exclude the two newcomers so the "New here" badge stays true.
        $active = array_values(array_diff($locals, ['nina', 'jamal']));
        $count = count($active);

        $thanks = [
            'Thank you so much — that made my week!',
            'Brilliant help, friendly and on time.',
            'So patient with me. I finally understand it.',
            'Lovely to meet a new neighbour. Highly recommend.',
            'Fantastic job, and great company too.',
            'Couldn\'t have done it without you.',
        ];

        // A year of exchanges, busier in recent months, so the monthly hours
        // chart has a shape and the community milestone has something to say.
        $n = 0;
        for ($month = 11; $month >= 0; $month--) {
            $perMonth = 4 + intdiv(11 - $month, 2);
            for ($k = 0; $k < $perMonth; $k++, $n++) {
                $giver = $active[($n * 5) % $count];
                $receiver = $active[($n * 7 + 3) % $count];
                if ($giver === $receiver) {
                    $receiver = $active[($n * 7 + 4) % $count];
                }
                $amount = [1, 1.5, 2, 1, 3, 0.5][$n % 6];
                $day = $month === 0 ? max(1, min((int) $this->now->day - 1, 1 + $k * 3)) : 1 + ($k * 4) % 26;
                $when = $month === 0
                    ? $this->now->copy()->startOfMonth()->addDays($day - 1)->setTime(10 + $k % 8, 0)
                    : $this->now->copy()->startOfMonth()->subMonths($month)->addDays($day - 1)->setTime(10 + $k % 8, 0);
                if ($when->greaterThan($this->now)) {
                    $when = $this->now->copy()->subHours(2 + $k);
                }
                $description = "Riverside exchange #{$n}";

                DB::table('transactions')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'description' => $description],
                    [
                        'sender_id' => $this->users[$receiver],
                        'receiver_id' => $this->users[$giver],
                        'giver_id' => $this->users[$giver],
                        'amount' => $amount,
                        'status' => 'completed',
                        'transaction_type' => 'exchange',
                        'listing_id' => $listingIds[$n % count($listingIds)],
                        'is_federated' => 0,
                        'created_at' => $when,
                        'updated_at' => $when,
                    ]
                );

                if ($n % 2 === 0) {
                    $txId = (int) DB::table('transactions')
                        ->where('tenant_id', $this->tenantId)->where('description', $description)->value('id');
                    DB::table('reviews')->updateOrInsert(
                        ['tenant_id' => $this->tenantId, 'transaction_id' => $txId, 'reviewer_id' => $this->users[$receiver]],
                        [
                            'receiver_id' => $this->users[$giver],
                            'rating' => $n % 7 === 0 ? 4 : 5,
                            'comment' => $thanks[$n % count($thanks)],
                            'review_type' => 'local',
                            'status' => 'approved',
                            'is_anonymous' => 0,
                            // Mark as already notified so no email or alert is ever queued.
                            'notification_sent_at' => $when,
                            'email_skipped_at' => $when,
                            'created_at' => $when->copy()->addHours(3),
                            'updated_at' => $when->copy()->addHours(3),
                        ]
                    );
                }
            }
        }
    }

    // ------------------------------------------------------------- connections

    private function seedConnections(): void
    {
        $pairs = [
            ['maeve', 'grace'], ['maeve', 'noah'], ['maeve', 'priya'], ['tomas', 'sean'], ['tomas', 'daniel'],
            ['priya', 'ruairi'], ['amara', 'zara'], ['amara', 'mateo'], ['sofia', 'kenji'], ['ciara', 'hannah'],
            ['liam', 'hannah'], ['grace', 'leila'], ['peter', 'maeve'], ['aoife', 'sofia'], ['oisin', 'tomas'],
        ];
        foreach ($pairs as $i => [$a, $b]) {
            DB::table('connections')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'requester_id' => $this->users[$a], 'receiver_id' => $this->users[$b]],
                ['status' => 'accepted', 'created_at' => $this->now->copy()->subDays(30 + $i * 6), 'updated_at' => $this->now]
            );
        }
    }

    // ------------------------------------------------------------------- feed

    private function seedFeedPosts(): void
    {
        $posts = [
            ['noah', 'The allotment is bursting with courgettes again 🥒 Anyone want some? Free to a good home.', 0],
            ['maeve', 'A huge thank you to Tomás who fixed my bike brakes this morning. Riverside is the best!', 1],
            ['priya', 'Phone help morning at the library is filling up — still a few spots left for next week.', 1],
            ['grace', 'Knit and natter was lovely yesterday. Eleven of us and three new knitters! 🧶', 2],
            ['liam', 'Walked Biscuit, Pepper and Rolo along the river today. Three very happy dogs.', 3],
            ['amara', 'Soup swap is on Thursday — I\'m making spiced lentil. What are you bringing?', 3],
            ['kenji', 'Golden hour by the footbridge last night. This town is beautiful.', 4],
            ['zara', 'First birthday cake order through the timebank delivered! Lemon with blueberries 🎂', 5],
            ['ciara', 'Sunday walk: 14 of us and four dogs, and the rain held off. See you next week.', 6],
            ['sean', 'Built six bookshelves for the Old Library this week. Come and fill them!', 8],
        ];
        foreach ($posts as $i => [$author, $content, $daysAgo]) {
            $created = $this->now->copy()->subDays($daysAgo)->subHours(1 + ($i * 3) % 9);
            DB::table('feed_posts')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'user_id' => $this->users[$author], 'content' => $content],
                [
                    'visibility' => 'public',
                    'publish_status' => 'published',
                    'type' => 'post',
                    'likes_count' => 2 + ($i * 5) % 14,
                    'created_at' => $created,
                    'updated_at' => $created,
                ]
            );
            $postId = (int) DB::table('feed_posts')
                ->where('tenant_id', $this->tenantId)->where('user_id', $this->users[$author])->where('content', $content)->value('id');
            $this->upsertFeedActivity('post', $postId, $this->users[$author], null, $content, $created, null);
        }
    }

    /**
     * A few friendly conversations across two days, so the messages list and the
     * conversation screen have something real to show (day markers, both sides,
     * one unread reply).
     */
    private function seedMessages(): void
    {
        // [from, to, text, minutes ago]
        $threads = [
            [
                ['maeve', 'tomas', 'Hi Tomás! My bike brakes are squeaking terribly. Could you have a look this week?', 1560],
                ['tomas', 'maeve', 'Of course! I could come by on Wednesday morning, would 10 suit you?', 1530],
                ['maeve', 'tomas', 'Perfect, I will put the kettle on ☕', 1500],
                ['tomas', 'maeve', 'All done — new brake pads and a bit of oil on the chain. She rides like new!', 95],
                ['maeve', 'tomas', 'Thank you so much, that made my week. I have sent you the hours.', 80],
                ['tomas', 'maeve', 'Any time. Enjoy the river path this weekend!', 12],
            ],
            [
                ['priya', 'maeve', 'Hello Maeve, I saw your request about sending photos to your grandchildren. I can help!', 2900],
                ['maeve', 'priya', 'Oh wonderful. I am free most afternoons.', 2880],
                ['priya', 'maeve', 'How about Thursday at 3? Bring your phone and its charger.', 2860],
                ['maeve', 'priya', 'Thursday at 3 it is. See you then!', 2850],
            ],
            [
                ['grace', 'maeve', 'Are you coming to knit and natter next month? I have spare wool for you.', 300],
                ['maeve', 'grace', "Wouldn't miss it! Save me a seat by the window.", 280],
            ],
            [
                ['amara', 'tomas', 'Could you bring a few spare bike lights to the repair café? People keep asking.', 400],
                ['tomas', 'amara', 'Good idea — I will bring a box of them.', 370],
            ],
        ];
        foreach ($threads as $thread) {
            $last = count($thread) - 1;
            foreach ($thread as $i => [$from, $to, $text, $minutesAgo]) {
                $at = $this->now->copy()->subMinutes($minutesAgo);
                DB::table('messages')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'sender_id' => $this->users[$from], 'receiver_id' => $this->users[$to], 'body' => $text],
                    [
                        'is_read' => $i === $last ? 0 : 1,
                        'read_at' => $i === $last ? null : $at->copy()->addMinutes(2),
                        'is_federated' => 0,
                        'created_at' => $at,
                    ]
                );
            }
        }
    }

    /**
     * A handful of notifications of different kinds for the members the picture
     * check signs in as, so the bell has something real to show. Keyed by
     * idempotency_key, so a re-run does not duplicate them.
     */
    private function seedNotifications(): void
    {
        // [type, text, link, minutes ago, read]
        $items = [
            ['message', 'Tomás sent you a message', '/messages', 12, false],
            ['transaction', 'You received 1 hour from Tomás', '/wallet', 80, false],
            ['event', 'Thursday soup swap is the day after tomorrow', '/events', 240, false],
            ['connection', 'Grace accepted your connection request', '/connections', 1500, true],
            ['achievement', 'You earned the Helpful neighbour badge', '/achievements', 2900, true],
            ['listing', 'Your offer "Help planting a vegetable bed" was saved 3 times', '/listings', 4300, true],
        ];
        foreach (['maeve', 'tomas', 'priya', 'amara'] as $local) {
            // Oldest first, as real notifications arrive (lists order by id).
            foreach (array_reverse($items, true) as $i => [$type, $text, $link, $minutesAgo, $read]) {
                $at = $this->now->copy()->subMinutes($minutesAgo);
                DB::table('notifications')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'user_id' => $this->users[$local], 'idempotency_key' => "showcase:{$local}:{$i}"],
                    [
                        'type' => $type,
                        'message' => $text,
                        'link' => $link,
                        'is_read' => $read ? 1 : 0,
                        'read_at' => $read ? $at : null,
                        'created_at' => $at,
                    ]
                );
            }
        }
    }

    private function seedBlog(): void
    {
        $articles = [
            ['riverside-repair-cafe-turns-one', 'Our repair café turns one', 'Over 300 items mended and saved from landfill in our first year.', 'In our first year the Riverside repair café mended more than 300 items — bikes, lamps, jackets and one very old accordion. Thank you to every fixer and every visitor.'],
            ['welcome-to-our-newest-neighbours', 'Welcome to our newest neighbours', 'Twelve people joined Riverside Timebank this autumn.', 'This autumn twelve new neighbours joined the timebank. Say hello at the soup swap or the Sunday walk — everyone is welcome.'],
            ['how-timebanking-works', 'How timebanking works', 'Give an hour, receive an hour. Everyone\'s time is equal.', 'When you help someone for an hour, you earn an hour you can spend on help from anyone else in the community. Everyone\'s time is worth the same.'],
        ];
        foreach ($articles as $i => [$slug, $title, $excerpt, $body]) {
            DB::table('posts')->updateOrInsert(
                ['tenant_id' => $this->tenantId, 'slug' => $slug],
                [
                    'author_id' => $this->users['admin'],
                    'title' => $title,
                    'excerpt' => $excerpt,
                    'content' => $body,
                    'html_render' => '<p>' . e($body) . '</p>',
                    'status' => 'published',
                    'created_at' => $this->now->copy()->subDays(4 + $i * 15),
                    'updated_at' => $this->now->copy()->subDays(4 + $i * 15),
                ]
            );
        }
    }

    private function seedBadges(): void
    {
        // Real badge keys (GamificationService definitions): the badge list
        // drops any key the platform does not define.
        $badges = [
            ['offer_1', 'First Offer', '🎁'],
            ['request_1', 'First Request', '🙋'],
            ['earn_1', 'First Earn', '🪙'],
            ['transaction_1', 'First Exchange', '🔄'],
            ['earn_10', 'Go Getter', '🚀'],
            ['vol_1h', 'First Steps', '👣'],
        ];
        foreach (array_slice(array_column($this->memberData(), 0), 0, 18) as $i => $local) {
            foreach ($badges as $j => [$key, $name, $icon]) {
                if (($i + $j) % 3 === 2) {
                    continue;
                }
                DB::table('user_badges')->updateOrInsert(
                    ['tenant_id' => $this->tenantId, 'user_id' => $this->users[$local], 'badge_key' => $key],
                    [
                        'name' => $name,
                        'title' => $name,
                        'icon' => $icon,
                        'awarded_at' => $this->now->copy()->subDays(10 + $i * 4 + $j),
                        'earned_at' => $this->now->copy()->subDays(10 + $i * 4 + $j),
                    ]
                );
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    /** @param array<string,mixed>|null $metadata */
    private function upsertFeedActivity(string $type, int $sourceId, int $userId, ?string $title, ?string $content, Carbon $created, ?array $metadata): void
    {
        DB::table('feed_activity')->updateOrInsert(
            ['tenant_id' => $this->tenantId, 'source_type' => $type, 'source_id' => $sourceId],
            [
                'user_id' => $userId,
                'title' => $title,
                'content' => $content,
                'metadata' => $metadata === null ? null : json_encode($metadata),
                'is_visible' => 1,
                'is_hidden' => 0,
                'created_at' => $created,
            ]
        );
    }
}
