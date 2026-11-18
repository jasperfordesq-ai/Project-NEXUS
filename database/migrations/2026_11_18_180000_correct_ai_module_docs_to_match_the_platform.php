<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use App\Services\AI\AiModuleDocsService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Brings every community's copy of the AI assistant's built-in guides up to
 * the corrected text in AiModuleDocsService::defaultSeed().
 *
 * Each community gets its own copy of the guides when it is created, so a fix
 * to the defaults only reaches new communities. The guides had told members
 * things that are not true (owner report, 18 Nov 2026: the assistant said
 * admins can only see messages reported for abuse, when coordinators review
 * first contacts, new members' messages and more, and an admin can choose to
 * review every message). Every claim was re-checked against the code.
 *
 * A row is replaced only when its title, body and keywords together are
 * exactly one of the versions ever shipped (fingerprints below, taken from
 * the file's git history). Anything an admin has changed is left alone.
 * Retired guides (Caring Community: unfinished, never to be referenced) are
 * switched off instead of rewritten.
 *
 * On production on 18 Nov 2026 all 570 rows (15 communities x 38 guides)
 * matched a shipped version.
 */
return new class extends Migration
{
    /** sha256(title . "\n" . body . "\n" . keywords JSON) of every shipped version, by slug. */
    private const SHIPPED = [
        'overview' => [
            'd2be0adef7345015852518d41f1c874a691fc064795882ae6139975e6de77327',
            '936b3bc1740b4f9941aacc30c5bf2c5bed3998771b1c7abcb4927597d214d798',
        ],
        'timebanking' => [
            '8174899bd159849e1a8b8dcdca8ee85cc44039f200ebef9204428e95e96a011e',
            'a4c867404e00bcdba7db77af9c0c147be24611444bfe416b5a4c6ed9505e3646',
        ],
        'getting_started' => [
            '6a8c551b900c327aa4bc58d25d2ddcd0b5cc9bf0c54a828e51676d5d99b47c06',
        ],
        'safety' => [
            '5c0a4bd3320c4d5aaea23872b69c6dee92f5f6530281fafd2ca7cd6720a3106a',
        ],
        'listings' => [
            '49c1dea7e5212ff6a619e9bcecf0321b8d9c115338f391b999144ca326d5756f',
            'c76b2421cde8b4f565f2ac6bc6652ce078c2c7d96fbf2eab2d139bdc9f16c193',
        ],
        'wallet' => [
            'c53e1a4080dc428860c7aa345f592e85883c4c20450604294d285d53b9260106',
            '8ad10dc092178c970a28f266fb0348975b7f89c5a6a7641d76c4d1dc3e8f9984',
        ],
        'messages' => [
            '4e4bf1fe6f85ef3ad345fb07df6f9781564695b013561b307a0b7c045c75cc92',
            '48e81bac323811b92a6d5bc4d4f25fcec32c673da911d919091ab825025368d7',
        ],
        'feed' => [
            'f5cd3a873cd285273bdc43731a53a14d0ffdc4f2f931a6c6b1841d9278c475e3',
        ],
        'dashboard' => [
            '2c0008f5b4b0ee9b844285de9eac857a607c340618a4d682aaeccd0b368796f6',
        ],
        'profile' => [
            '82361ac7c97f571f8a1859ab67caba57d1c26a38029cba37b23b9758d41e24d9',
            'a9abfe3b93a17d9b8afed73d7c7ae436874a8e800a119c31014e377049213fef',
        ],
        'notifications' => [
            '5acc2dc7c723ffb3333fa49cdad8d755427ddfc70bbcd28cf4d113132d265c19',
        ],
        'settings' => [
            'e1427139453b04c1fcc1999dd6ace5ee941800b6583406ed0fdc21c215ad3e45',
        ],
        'events' => [
            '942bdd966c06de3cc4a3e8fa1f2bd3d732d2dbfff3a135d0dfdc0e03940b8a32',
            '4653a1d73dcd8890cf180c2d884a62f5f69cc90ae17ad9f325d13c4c621a656c',
            'bd8f53499d384433f30dbd85109901ea0a61768f3857bb09b84ada16d3cbccda',
        ],
        'groups' => [
            'ec8f6d0c096c7ec35518b2754784e65ebe4515ba57c5d0ad38d48204cc166771',
            'e2cc24d2c3a6fabc8085ca2fcc6d78a75349c8a20fdbae65d380dad448570c76',
        ],
        'volunteering' => [
            '9aac44f91c747ef1d448faeb9fe8638f8255538b0316e78e603c37987a647836',
            'f9ae49f060ec2d27e5c8a17c9c3e5395c361764d8afd3aca5e0d5276fd218c1e',
            '33ad789ce946a59c17405689e51c7216392f4e6f179c8c03b4ad8973efa2385a',
        ],
        'jobs' => [
            '6c6de2f25659f07012d0d89f039fb884ce9700e322c1c0a792c7a989fc92af30',
            '9e18841293089b87aa18ca35bc8df6a8606f05aeb7ab627677c1ca18f5272f26',
        ],
        'marketplace' => [
            'c727a26ff321bae2f3be003bc13deb79b636fabff3f84df6161b5447a7841329',
            'b91a34a226d615f6ca39e678ff11ceee9b9f07bd9916f645aef615670c301088',
            '35cc11766a00d47a1a5877ac4a15e4c5854cfa3ccc452fac1f40b12a31ea6ee4',
        ],
        'blog' => [
            'd6cee553f817f65df651f2b97dc77f4547b9dd8b114f2ff6330b57eba254622e',
        ],
        'resources' => [
            'bc77a1839d6113892a4b152ca293147e7e56cea8a5679a894e600c024ecc4691',
        ],
        'polls' => [
            '103777932fbd73f7e35682de2c07908b0929f2cefb3aa7a0d19208d921d03179',
        ],
        'ideation' => [
            'd1ff87215a13f2a7601bc83244b6c667c8cc525785c5925c2ec331ab8ba8911d',
        ],
        'organisations' => [
            'a8d4e79a7a2c7833194c31bd4fcb3cb87cac56b1bd5f7ff8043543f317055d7f',
        ],
        'group_exchanges' => [
            '1f5875b864e558cf5ed17484a8645bb1a5685cc2119360648c78eab64d2136c4',
            'db7ed6e9d1dfb4d1022aa4049897ffc064a47412eff64b669fcf152ec55a19f7',
        ],
        'federation' => [
            'd2394470577aafda79dc4c8ea0680695dcff5a8d4afa7d6c41b555045e8d9f2b',
        ],
        'gamification' => [
            'e3651f0653b3029a8351e2bc88694e9e6cf633f1efe8cdce9dc22e999163af39',
            '286a42519a8b437118fe7e9522220a76c5b7d884385df4fca77d9953d68a729e',
        ],
        'goals' => [
            '46c779d3283c790feaec9ca8b7b5726c77e4c1f0d5f75c793040bc907c0463ac',
        ],
        'connections' => [
            'b5a6d95ffb1431f56dcf1cb19176d1a8f6a88154541349ff54ae46297d9fff2c',
        ],
        'reviews' => [
            '5d829f18c5d2ef13ec66d0d4e36add94df6d6a170c580ff2bb3d80f339eeb3c9',
        ],
        'ai_chat' => [
            'd28a0e34a5f745849914e034e65cf7f17794f6e521ce75d86528acc634c77d11',
        ],
        'search' => [
            '9708e778d23922633133ef82d8369efca438d9ec891e3256ecf69bd2530a5fd0',
        ],
        'caring_community' => [
            'f886769af5f570cde771f1fecf212595053a0f5fe158f475031cd5adbad66813',
            'a1ee297345b95e4aa0cb8f3dbcae23335b74cb3d1baa1b92cb7f88b560fdbd2d',
            'df97b9017a940d5984d281906a8bd5522ba5e473fa0a9acba5f2cb62fc2016db',
        ],
        'newsletter' => [
            'f254a8f9904def9888fdd2729bcd323238d500d29ba04f6b28078a938edfb02d',
        ],
        'account_security' => [
            '8aecae089d0d5e99b006df71dbe74f9eacc413a43591bd19d147ca6968f064cf',
        ],
        'privacy_data' => [
            '481620cbd53674677eb534b9835aef24696b507c4993af2a8d18f8c31de6eab7',
        ],
        'accessibility' => [
            '5a6a2ba17c3fcdb4a05ed8932a008ffb9aab9db8a56b7a08dbb0b7ead032fb60',
            '4d4751c0f3400137422efd6f1a70f8935f773688a08e33615b3ef35e76877ab0',
        ],
        'mobile_pwa' => [
            'df673bb852e82d8340f5b8351cdfda3261cb6a5aa2f6df371e07d59d2a7e2d5b',
            'd0b65c5a9b14efa2d567005bafc58a300f0d16746958959f18615d5d7d8fbc76',
        ],
        'troubleshooting' => [
            '9bde3bd6d8f118f02ca771d028a8c9c261479f194677f4b81b03c2ba5cb4ed07',
        ],
        'admin_overview' => [
            'd959946ed4a606d8c902f4b628398431327043d2f39339d3971ca4207f6eda6e',
        ],
    ];

    public function up(): void
    {
        if (! Schema::hasTable('ai_module_docs')) {
            return;
        }

        $defaults = AiModuleDocsService::defaultSeed();

        DB::table('ai_module_docs')
            ->select(['id', 'module_slug', 'title', 'body', 'keywords'])
            ->orderBy('id')
            ->chunkById(500, function ($rows) use ($defaults) {
                foreach ($rows as $row) {
                    $slug = (string) $row->module_slug;
                    $fingerprint = hash('sha256', $row->title . "\n" . $row->body . "\n" . $row->keywords);
                    if (! in_array($fingerprint, self::SHIPPED[$slug] ?? [], true)) {
                        continue; // changed by an admin, or not a built-in guide
                    }

                    if (in_array($slug, AiModuleDocsService::RETIRED_SLUGS, true)) {
                        DB::table('ai_module_docs')->where('id', $row->id)->update(['is_active' => 0]);
                        continue;
                    }

                    $new = $defaults[$slug] ?? null;
                    if ($new === null) {
                        continue;
                    }

                    DB::table('ai_module_docs')->where('id', $row->id)->update([
                        'title' => $new['title'],
                        'body' => $new['body'],
                        'keywords' => json_encode(array_values($new['keywords'])),
                    ]);
                }
            });
    }

    public function down(): void
    {
        // Deliberately irreversible: restoring text that told members untrue
        // things about the platform would reintroduce the defect.
    }
};
