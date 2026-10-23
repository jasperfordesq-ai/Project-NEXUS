<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Observers;

use Illuminate\Database\Eloquent\Model;

class PostPrerenderObserver extends PrerenderInvalidationObserver
{
    protected function routesFor(Model $model): array
    {
        $routes = ['/blog'];
        $slug = $model->slug ?? null;
        if (is_string($slug) && $slug !== '') {
            $routes[] = '/blog/' . $slug;
        }
        return $routes;
    }

    private function isPublished(Model $model): bool
    {
        return ($model->status ?? null) === 'published';
    }

    protected function liveRoutesFor(Model $model, string $event): array
    {
        $slug = $model->slug ?? null;
        return $event === 'saved' && $this->isPublished($model) && is_string($slug) && $slug !== ''
            ? ['/blog/' . $slug] : [];
    }

    protected function goneRoutesFor(Model $model, string $event): array
    {
        $gone = $this->retiredRoutesFor($model);
        $slug = $model->slug ?? null;
        if (is_string($slug) && $slug !== '' && ($event === 'deleted' || !$this->isPublished($model))) {
            $gone[] = '/blog/' . $slug;
        }
        return $gone;
    }

    protected function retiredRoutesFor(Model $model): array
    {
        if (!$model->wasChanged('slug')) {
            return [];
        }
        $old = $model->getPrevious()['slug'] ?? null;
        return is_string($old) && $old !== '' && $old !== $model->slug ? ['/blog/' . $old] : [];
    }
}
