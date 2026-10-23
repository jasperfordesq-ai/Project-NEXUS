<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Observers;

use Illuminate\Database\Eloquent\Model;

class PagePrerenderObserver extends PrerenderInvalidationObserver
{
    protected function routesFor(Model $model): array
    {
        $routes = [];
        $slug = $model->slug ?? null;
        if (is_string($slug) && $slug !== '') {
            $routes[] = '/page/' . $slug;
        }
        return $routes;
    }

    protected function liveRoutesFor(Model $model, string $event): array
    {
        return $event === 'saved' && (bool) ($model->is_published ?? false) ? $this->routesFor($model) : [];
    }

    protected function goneRoutesFor(Model $model, string $event): array
    {
        $gone = $event === 'deleted' || !(bool) ($model->is_published ?? false) ? $this->routesFor($model) : [];
        if ($model->wasChanged('slug')) {
            $old = $model->getPrevious()['slug'] ?? null;
            if (is_string($old) && $old !== '' && $old !== $model->slug) {
                $gone[] = '/page/' . $old;
            }
        }
        return $gone;
    }
}
