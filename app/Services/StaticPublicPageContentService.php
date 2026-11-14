<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;

class StaticPublicPageContentService
{
    /** A person's name and the years he lived: neither is wording to translate. */
    private const GUIDE_FOUNDER = 'Edgar S. Cahn (1935–2022)';

    /**
     * One year for each line of `govuk_alpha.guide.timeline`, in order. A year is
     * a number, so it is not wording.
     *
     * @var list<string>
     */
    private const GUIDE_TIMELINE_YEARS = ['1973', '1980', '1992', '1995', '2000'];

    /**
     * @var array<string, array{route_key: string, path: string, translation_namespace: string, title: string, lead: string}>
     */
    private const PAGE_DEFINITIONS = [
        'about' => [
            'route_key' => 'about',
            'path' => '/about',
            'translation_namespace' => 'govuk_alpha.about',
            'title' => 'govuk_alpha.about.title',
            'lead' => 'govuk_alpha.about.description',
        ],
        'features' => [
            'route_key' => 'features',
            'path' => '/features',
            'translation_namespace' => 'govuk_alpha.features',
            'title' => 'govuk_alpha.features.title',
            'lead' => 'govuk_alpha.features.intro',
        ],
        'contact' => [
            'route_key' => 'contact',
            'path' => '/contact',
            'translation_namespace' => 'govuk_alpha.contact',
            'title' => 'govuk_alpha.contact.title',
            'lead' => 'govuk_alpha.contact.subtitle',
        ],
        'trust-safety' => [
            'route_key' => 'trustSafety',
            'path' => '/trust-and-safety',
            'translation_namespace' => 'govuk_alpha.trust_safety',
            'title' => 'govuk_alpha.trust_safety.title',
            'lead' => 'govuk_alpha.trust_safety.subtitle',
        ],
        'timebanking-guide' => [
            'route_key' => 'timebankingGuide',
            'path' => '/timebanking-guide',
            'translation_namespace' => 'govuk_alpha.guide',
            'title' => 'govuk_alpha.guide.title',
            'lead' => 'govuk_alpha.guide.intro',
        ],
        'legal' => [
            'route_key' => 'legal',
            'path' => '/legal',
            'translation_namespace' => 'govuk_alpha.legal',
            'title' => 'govuk_alpha.legal.hub_title',
            'lead' => 'govuk_alpha.legal.hub_intro',
        ],
    ];

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $pageKey): ?array
    {
        $normalizedPageKey = strtolower(trim($pageKey));
        $definition = self::PAGE_DEFINITIONS[$normalizedPageKey] ?? null;

        if ($definition === null) {
            return null;
        }

        $tenant = $this->tenantPayload();
        $translationParams = [
            'community' => $tenant['name'],
            'name' => $tenant['name'],
        ];

        return [
            'route_key' => $definition['route_key'],
            'page_key' => $normalizedPageKey,
            'path' => $definition['path'],
            'content_source' => 'laravel_public_translations',
            'translation_namespace' => $definition['translation_namespace'],
            'tenant' => $tenant,
            'title' => $this->translatedString($definition['title'], $translationParams),
            'lead' => $this->translatedString($definition['lead'], $translationParams),
            'sections' => $this->sectionsFor($normalizedPageKey, $translationParams),
        ];
    }

    /**
     * @return array{id: int, slug: string, name: string}
     */
    private function tenantPayload(): array
    {
        $tenant = TenantContext::get();

        return [
            'id' => (int) ($tenant['id'] ?? TenantContext::getId()),
            'slug' => (string) ($tenant['slug'] ?? ''),
            'name' => TenantContext::getName('Project NEXUS'),
        ];
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function sectionsFor(string $pageKey, array $params): array
    {
        return match ($pageKey) {
            'about' => $this->aboutSections($params),
            'features' => $this->featuresSections($params),
            'contact' => $this->contactSections($params),
            'trust-safety' => $this->trustSafetySections($params),
            'timebanking-guide' => $this->timebankingGuideSections($params),
            'legal' => $this->legalSections($params),
            default => [],
        };
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function aboutSections(array $params): array
    {
        return [
            [
                'key' => 'how_it_works',
                'title' => $this->translatedString('govuk_alpha.about.how_it_works.title', $params),
                'body' => $this->translatedString('govuk_alpha.about.how_it_works.subtitle', $params),
                'items' => $this->translatedArray('govuk_alpha.about.how_it_works.steps', $params),
            ],
            [
                'key' => 'values',
                'title' => $this->translatedString('govuk_alpha.about.values.title', $params),
                'body' => $this->translatedString('govuk_alpha.about.values.subtitle', $params),
                'items' => $this->translatedArray('govuk_alpha.about.values.items', $params),
            ],
            [
                'key' => 'credits',
                'title' => $this->translatedString('govuk_alpha.about.credits.title', $params),
                'body' => $this->translatedString('govuk_alpha.about.credits.subtitle', $params),
                'items' => [
                    [
                        'key' => 'license',
                        'title' => $this->translatedString('govuk_alpha.about.credits.open_source', $params),
                        'description' => $this->translatedString('govuk_alpha.about.credits.license_text', $params),
                    ],
                ],
            ],
        ];
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function featuresSections(array $params): array
    {
        return [
            [
                'key' => 'features',
                'title' => $this->translatedString('govuk_alpha.features.title', $params),
                'body' => $this->translatedString('govuk_alpha.features.intro', $params),
                'items' => $this->keyedStringItems($this->translatedArray('govuk_alpha.features.items', $params)),
            ],
        ];
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function contactSections(array $params): array
    {
        return [
            [
                'key' => 'contact_form',
                'title' => $this->translatedString('govuk_alpha.contact.form.fieldset_legend', $params),
                'body' => $this->translatedString('govuk_alpha.contact.subtitle', $params),
                'items' => $this->keyedStringItems($this->translatedArray('govuk_alpha.contact.form.subjects', $params)),
            ],
        ];
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function trustSafetySections(array $params): array
    {
        $sectionKeys = [
            'how_exchanges',
            'what_we_do',
            'what_we_dont',
            'precautions',
            'vetting',
            'insurance',
            'disputes',
            'responsibilities',
            'rights',
        ];
        $sections = [];

        foreach ($sectionKeys as $sectionKey) {
            $baseKey = 'govuk_alpha.trust_safety.sections.' . $sectionKey;
            $sections[] = [
                'key' => $sectionKey,
                'title' => $this->translatedString($baseKey . '.heading', $params),
                'body' => $this->translatedString($baseKey . '.intro', $params),
                'items' => $this->keyedStringItems($this->translatedArray($baseKey . '.items', $params)),
            ];
        }

        return $sections;
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function timebankingGuideSections(array $params): array
    {
        return [
            [
                'key' => 'equal_time',
                'title' => $this->translatedString('govuk_alpha.guide.equal_title', $params),
                'body' => $this->translatedString('govuk_alpha.guide.equal_body', $params),
                'items' => [],
            ],
            [
                'key' => 'steps',
                'title' => $this->translatedString('govuk_alpha.guide.steps_title', $params),
                'body' => '',
                'items' => [
                    [
                        'key' => 'give_time',
                        'title' => $this->translatedString('govuk_alpha.guide.step1_title', $params),
                        'description' => $this->translatedString('govuk_alpha.guide.step1_body', $params),
                    ],
                    [
                        'key' => 'earn_credits',
                        'title' => $this->translatedString('govuk_alpha.guide.step2_title', $params),
                        'description' => $this->translatedString('govuk_alpha.guide.step2_body', $params),
                    ],
                    [
                        'key' => 'spend_credits',
                        'title' => $this->translatedString('govuk_alpha.guide.step3_title', $params),
                        'description' => $this->translatedString('govuk_alpha.guide.step3_body', $params),
                    ],
                ],
            ],
            $this->guideOriginsSection($params),
            $this->guideTimelineSection($params),
            [
                'key' => 'values',
                'title' => $this->translatedString('govuk_alpha.guide.values_title', $params),
                'body' => $this->translatedString('govuk_alpha.guide.values_lead', $params),
                'items' => $this->translatedArray('govuk_alpha.guide.values', $params),
            ],
            [
                'key' => 'getting_started',
                'title' => $this->translatedString('govuk_alpha.guide.getting_started_title', $params),
                'body' => $this->translatedString('govuk_alpha.guide.getting_started_body', $params),
                'items' => [],
            ],
        ];
    }

    /**
     * Where timebanking comes from: Edgar Cahn, and Teruko Mizushima before him.
     *
     * The same history as the React guide and the accessible site's guide. It is
     * checked fact (sources are listed at the top of
     * react-frontend/src/pages/about/TimebankingGuidePage.tsx): do not add a date,
     * a quotation or a "first" that has not been checked the same way.
     *
     * @param array<string, string> $params
     * @return array<string, mixed>
     */
    private function guideOriginsSection(array $params): array
    {
        $paragraphs = array_values(array_filter(
            $this->translatedArray('govuk_alpha.guide.origins_body', $params),
            'is_string'
        ));
        $items = [];

        foreach ($paragraphs as $index => $paragraph) {
            $item = ['key' => 'story_' . $index, 'description' => $paragraph];

            // The first paragraph introduces him, so it carries his name and years.
            if ($index === 0) {
                $item = ['key' => 'founder', 'title' => self::GUIDE_FOUNDER, 'description' => $paragraph];
            }

            $items[] = $item;
        }

        $items[] = [
            'key' => 'earlier',
            'description' => $this->translatedString('govuk_alpha.guide.origins_note', $params),
        ];

        return [
            'key' => 'origins',
            'title' => $this->translatedString('govuk_alpha.guide.origins_title', $params),
            'body' => $this->translatedString('govuk_alpha.guide.origins_lead', $params),
            'items' => $items,
        ];
    }

    /**
     * How the idea grew: one dated line per year, then "Today" with the
     * community's own name.
     *
     * @param array<string, string> $params
     * @return array<string, mixed>
     */
    private function guideTimelineSection(array $params): array
    {
        $lines = array_values(array_filter(
            $this->translatedArray('govuk_alpha.guide.timeline', $params),
            'is_string'
        ));
        $items = [];

        foreach (self::GUIDE_TIMELINE_YEARS as $index => $year) {
            if (!isset($lines[$index])) {
                break;
            }

            $items[] = ['key' => $year, 'title' => $year, 'description' => $lines[$index]];
        }

        $items[] = [
            'key' => 'today',
            'title' => $this->translatedString('govuk_alpha.guide.timeline_today', $params),
            'description' => $this->translatedString('govuk_alpha.guide.timeline_today_text', $params),
        ];

        return [
            'key' => 'timeline',
            'title' => $this->translatedString('govuk_alpha.guide.timeline_title', $params),
            'body' => '',
            'items' => $items,
        ];
    }

    /**
     * @param array<string, string> $params
     * @return array<int, array<string, mixed>>
     */
    private function legalSections(array $params): array
    {
        $documentPaths = [
            'terms' => '/terms',
            'privacy' => '/privacy',
            'cookies' => '/cookies',
            'community_guidelines' => '/community-guidelines',
            'acceptable_use' => '/acceptable-use',
            'accessibility' => '/accessibility',
        ];
        $documents = $this->translatedArray('govuk_alpha.legal.documents', $params);
        $items = [];

        foreach ($documentPaths as $documentKey => $path) {
            $document = $documents[$documentKey] ?? null;

            if (!is_array($document)) {
                continue;
            }

            $items[] = [
                'key' => $documentKey,
                'title' => is_string($document['title'] ?? null) ? $document['title'] : '',
                'description' => is_string($document['summary'] ?? null) ? $document['summary'] : '',
                'path' => $path,
            ];
        }

        return [
            [
                'key' => 'documents',
                'title' => $this->translatedString('govuk_alpha.legal.hub_title', $params),
                'body' => $this->translatedString('govuk_alpha.legal.hub_intro', $params),
                'items' => $items,
            ],
        ];
    }

    /**
     * @param array<string, string> $params
     */
    private function translatedString(string $key, array $params = []): string
    {
        $value = __($key, $params);

        return is_string($value) ? $this->replaceParams($value, $params) : $key;
    }

    /**
     * @param array<string, string> $params
     * @return array<int|string, mixed>
     */
    private function translatedArray(string $key, array $params = []): array
    {
        $value = __($key, $params);

        return is_array($value) ? $this->replaceParamsInArray($value, $params) : [];
    }

    /**
     * @param array<int|string, mixed> $items
     * @return array<int, array{key: string, description: string}>
     */
    private function keyedStringItems(array $items): array
    {
        $normalized = [];

        foreach ($items as $key => $value) {
            if (!is_string($value)) {
                continue;
            }

            $normalized[] = [
                'key' => is_string($key) ? $key : (string) count($normalized),
                'description' => $value,
            ];
        }

        return $normalized;
    }

    /**
     * @param array<int|string, mixed> $value
     * @param array<string, string> $params
     * @return array<int|string, mixed>
     */
    private function replaceParamsInArray(array $value, array $params): array
    {
        $replaced = [];

        foreach ($value as $key => $item) {
            $replaced[$key] = is_array($item)
                ? $this->replaceParamsInArray($item, $params)
                : (is_string($item) ? $this->replaceParams($item, $params) : $item);
        }

        return $replaced;
    }

    /**
     * @param array<string, string> $params
     */
    private function replaceParams(string $value, array $params): string
    {
        $replacements = [];

        foreach ($params as $key => $replacement) {
            $replacements[':' . $key] = $replacement;
        }

        return strtr($value, $replacements);
    }
}
