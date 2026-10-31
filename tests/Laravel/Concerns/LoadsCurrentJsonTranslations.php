<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Concerns;

use App\Providers\AppServiceProvider;
use ReflectionMethod;

trait LoadsCurrentJsonTranslations
{
    protected function loadCurrentJsonTranslations(): void
    {
        // Normal test boot intentionally loads only en/ga/de and trusts an old
        // generated cache. Translation regressions need today's real catalogues
        // in every locale, through the production JSON/PHP merge and token rules.
        // Do not fabricate addLines fixtures that can hide missing translations.
        static $lines = null;
        if ($lines === null) {
            $builder = new ReflectionMethod(AppServiceProvider::class, 'buildJsonTranslationLines');
            $lines = $builder->invoke($this->app->getProvider(AppServiceProvider::class), lang_path());
        }
        foreach ($lines as $locale => $translations) {
            $this->app->make('translator')->addLines($translations, $locale);
        }
    }
}
