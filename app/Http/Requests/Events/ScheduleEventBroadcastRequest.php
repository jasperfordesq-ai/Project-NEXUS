<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Requests\Events;

final class ScheduleEventBroadcastRequest extends EventBroadcastMutationRequest
{
    /**
     * Browsers send `Date.prototype.toISOString()`, which ends in "Z"; the
     * `P` format below only reads a numeric offset. "Z" means UTC, so it is
     * read as "+00:00" (E-102: every website "send later" was refused).
     */
    protected function prepareForValidation(): void
    {
        parent::prepareForValidation();
        $scheduledAt = $this->input('scheduled_at');
        if (is_string($scheduledAt) && preg_match('/^(.+\d)[Zz]$/', trim($scheduledAt), $match) === 1) {
            $this->merge(['scheduled_at' => $match[1] . '+00:00']);
        }
    }

    /** @return array<string,mixed> */
    public function rules(): array
    {
        return [
            ...$this->idempotencyRules(),
            'expected_version' => ['required', 'integer', 'min:1'],
            'scheduled_at' => [
                'nullable',
                'date_format:Y-m-d\TH:i:sP,Y-m-d\TH:i:s.vP,Y-m-d\TH:i:s.uP',
            ],
        ];
    }
}
