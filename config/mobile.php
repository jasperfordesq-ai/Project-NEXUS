<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
|--------------------------------------------------------------------------
| Mobile client version policy
|--------------------------------------------------------------------------
|
| The server half of the force-update lever.
|
| The sole native client is Expo / React Native in mobile/. It sends
| X-Nexus-Mobile-Version on every request for server-side version enforcement.
|
| Why the minimum is env-overridable: the whole point of a force-update lever is
| that it can be raised in an emergency without a code deploy. Raising it is a
| deliberate, disruptive act — it locks every copy below the new floor out of the
| API — so it is a server setting, not a release constant.
|
| 🔴 Raising 'minimum_version' bricks older copies ON PURPOSE. Do it only when a
| version is genuinely unsafe to keep talking to the API, and remember that the
| update it demands must actually be available for download first.
*/

return [

    'expo' => [
        /*
         * The newest Expo build that exists. Keep in step with
         * mobile/app.json → expo.version. `npm run check:version` does not cover
         * this yet; the contract test pins the pair instead.
         */
        'current_version' => env('MOBILE_EXPO_CURRENT_VERSION', '1.5.0'),

        /*
         * Copies BELOW this are refused with 426 Upgrade Required.
         *
         * Deliberately equal to the first release: nothing has ever been
         * distributed, so there is no older copy in the wild to lock out, and a
         * floor above the only existing build would refuse every request from it.
         */
        'minimum_version' => env('MOBILE_EXPO_MINIMUM_VERSION', '1.2.0'),

        /*
         * Where a locked-out member is sent. The app shows this; it does not
         * invent a URL of its own, so the destination can be changed here without
         * shipping a new binary — which matters, because the copies that need it
         * most are the ones that cannot be updated any other way.
         */
        'update_url' => env('MOBILE_EXPO_UPDATE_URL', 'https://mobile.project-nexus.ie'),
    ],

    'version_gate_exempt_paths' => [
        'api/app/log',
    ],

];
