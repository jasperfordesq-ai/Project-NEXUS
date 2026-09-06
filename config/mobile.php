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
| 🔴 There are TWO different native clients and they are NOT interchangeable:
|
|   'expo'      — the Expo / React Native client in mobile/. Sends
|                 `X-Nexus-Mobile-Version` on every request, so the server can
|                 refuse an out-of-date copy without the app having to remember
|                 to ask (see EnforceMobileMinimumVersion). This is the client
|                 that has never been distributed.
|
|   'capacitor' — the older Capacitor wrapper around the React web app. It POLLS
|                 /api/app/check-version from react-frontend/src/hooks/useAppUpdate.ts
|                 and does NOT send the version header. Its numbers used to be
|                 hardcoded constants in AppController with a comment pointing at
|                 `capacitor/android/app/build.gradle` — a directory that is not in
|                 this repository (removed in df8bf84d6, gitignored). The values are
|                 preserved here unchanged; only their home has moved.
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
        'current_version' => env('MOBILE_EXPO_CURRENT_VERSION', '1.4.0'),

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

    /*
     * The Capacitor wrapper's pull-model values, moved out of AppController
     * unchanged. Do not "tidy" these to match the Expo numbers: they describe a
     * different artefact with a different version line.
     */
    'capacitor' => [
        'current_version' => env('MOBILE_CAPACITOR_CURRENT_VERSION', '1.1'),
        'minimum_version' => env('MOBILE_CAPACITOR_MINIMUM_VERSION', '1.0'),
        'update_url' => env(
            'MOBILE_CAPACITOR_UPDATE_URL',
            'https://api.project-nexus.ie/downloads/nexus-latest.apk'
        ),
    ],

    /*
     * Paths the version gate must never block, as regex fragments matched against
     * the request path.
     *
     * 🔴 Load-bearing. Without the /api/app/* exemption a locked-out copy could not
     * even ask what version it needs, which turns a recoverable "please update"
     * into a dead end — the exact class of defect this lever exists to prevent.
     */
    'version_gate_exempt_paths' => [
        'api/app/*',
    ],

];
