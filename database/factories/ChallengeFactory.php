<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Database\Factories;

use App\Models\Challenge;
use App\Services\ChallengeService;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * 🔴 Matches the REAL `challenges` schema. The previous definition invented
 * `category`, `status`, `starts_at`/`ends_at` columns and drew
 * `challenge_type`/`action_type` from vocabularies that exist nowhere in the
 * database or the code — it predated the schema settling and had zero users,
 * so it misled without ever failing. Values now come from the same constants
 * the service validates against.
 */
class ChallengeFactory extends Factory
{
    protected $model = Challenge::class;

    public function definition(): array
    {
        $start = $this->faker->dateTimeBetween('-1 week', 'now');

        return [
            'tenant_id'      => 2,
            'title'          => $this->faker->sentence(4),
            'description'    => $this->faker->paragraph(),
            'challenge_type' => $this->faker->randomElement(ChallengeService::CHALLENGE_TYPES),
            'action_type'    => $this->faker->randomElement(ChallengeService::SUPPORTED_ACTION_TYPES),
            'target_count'   => $this->faker->numberBetween(1, 10),
            'xp_reward'      => $this->faker->numberBetween(10, 500),
            'badge_reward'   => $this->faker->optional()->slug(2),
            'start_date'     => $start->format('Y-m-d'),
            'end_date'       => $this->faker->dateTimeBetween('+1 week', '+2 months')->format('Y-m-d'),
            'is_active'      => true,
        ];
    }

    public function forTenant(int $id): static
    {
        return $this->state(fn (array $attributes) => [
            'tenant_id' => $id,
        ]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }
}
