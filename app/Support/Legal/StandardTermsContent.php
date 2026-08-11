<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support\Legal;

/**
 * The standard Terms of Service that ship with the product, as a document body.
 *
 * 🔴 Why this exists at all. Until 2026-08-11 the shipped terms existed ONLY as
 * display copy — React's `legal.terms.*` strings and the accessible frontend's
 * `legal.fallback.terms_*` bullets. They were never a row in `legal_documents`,
 * which is why nothing had ever required a member to agree to them: the
 * acceptance machinery works on documents, and there was no document. Enforcing
 * acceptance without this is enforcing against an empty set.
 *
 * 🔴 The WORDS here are not new. Every sentence is the same sentence React already
 * renders on `/terms`, taken from `react-frontend/public/locales/en/legal.json`.
 * `tests/Laravel/Unit/Support/StandardTermsContentTest.php` reads that file and
 * fails if the two drift, so this cannot quietly become a second, different set of
 * terms. If the shipped wording changes, that test tells you, and a NEW VERSION
 * must be published — never edit a version members have already accepted.
 *
 * 🔴 ENGLISH ONLY, and that is a schema limitation rather than a choice:
 * `legal_document_versions` has one `content` column and no locale, so a document
 * is single-language. A community that needs its terms in another language
 * publishes its own version, exactly as it would today. Do not paper over this by
 * machine-translating a legal document.
 */
final class StandardTermsContent
{
    /**
     * The version number this content represents.
     *
     * 🔴 Bump this when the wording changes. `LegalDocumentService::publishVersion`
     * keys acceptance to a version id, so members who accepted 1.0 must be asked
     * again for 1.1 — that is the entire point of the version number, and reusing
     * it would silently carry their old agreement onto new words.
     */
    public const VERSION = '1.0';

    /** Shown as the document title. */
    public static function title(): string
    {
        return 'Terms of Service';
    }

    /**
     * The document body as sanitiser-safe HTML.
     *
     * Only elements `HtmlSanitizer::sanitizeCms()` permits are used, so the stored
     * content survives the render boundary unchanged: h2, h3, p, ul, li, strong.
     *
     * @param string $communityName Substituted where React interpolates {{name}}.
     */
    public static function html(string $communityName): string
    {
        $name = htmlspecialchars(trim($communityName) !== '' ? $communityName : 'this community', ENT_QUOTES, 'UTF-8');

        $sections = [
            self::intro($name),
            self::timeCredits(),
            self::accountResponsibilities(),
            self::communityGuidelines(),
            self::prohibited(),
            self::safety(),
            self::liability($name),
            self::termination(),
            self::changes(),
        ];

        return implode('', $sections);
    }

    /** Plain-text rendering, for `content_plain` and the diff view. */
    public static function plainText(string $communityName): string
    {
        $text = strip_tags(str_replace(['</p>', '</li>', '</h2>'], ["\n\n", "\n", "\n\n"], self::html($communityName)));

        return trim((string) preg_replace('/\n{3,}/', "\n\n", html_entity_decode($text, ENT_QUOTES, 'UTF-8')));
    }

    private static function intro(string $name): string
    {
        return "<h2>Welcome to {$name}</h2>"
            . '<p>By accessing or using our platform, you agree to be bound by these Terms of Service.'
            . ' Please read them carefully before participating in our community.</p>'
            . '<p>These terms establish a framework for <strong>fair, respectful, and meaningful exchanges</strong>'
            . " between community members. Our goal is to create a trusted environment where everyone's time is valued equally.</p>";
    }

    private static function timeCredits(): string
    {
        return '<h2>1. Time Credit System</h2>'
            . "<p>Our platform operates on a simple but powerful principle: <strong>everyone's time is equal</strong>."
            . ' One hour of service is worth one time credit.</p>'
            . '<ul>'
            . '<li>One hour of service provided equals one Time Credit earned</li>'
            . '<li>Credits can be used to receive services from other members</li>'
            . '<li>The type of service does not affect the credit value</li>'
            . '<li>Credits are tracked automatically through the platform</li>'
            . '</ul>'
            . '<p><strong>Important:</strong> Time Credits have no monetary value and cannot be exchanged for cash.'
            . ' They exist solely to facilitate community exchanges.</p>';
    }

    private static function accountResponsibilities(): string
    {
        return '<h2>2. Account Responsibilities</h2>'
            . '<p>When you create an account, you agree to:</p>'
            . '<ul>'
            . '<li><strong>Provide accurate information</strong> — your profile must reflect your true identity and skills</li>'
            . '<li><strong>Maintain security</strong> — keep your login credentials confidential and secure</li>'
            . '<li><strong>Use one account</strong> — each person may only maintain one active account</li>'
            . '<li><strong>Stay current</strong> — update your profile when your skills or availability change</li>'
            . '<li><strong>Be reachable</strong> — respond to messages and requests in a timely manner</li>'
            . '</ul>';
    }

    private static function communityGuidelines(): string
    {
        return '<h2>3. Community Guidelines</h2>'
            . '<p>Our community is built on <strong>trust, respect, and mutual support</strong>. All members must:</p>'
            . '<ul>'
            . '<li><strong>Treat everyone with respect</strong> — be kind and courteous in all interactions</li>'
            . '<li><strong>Honour your commitments</strong> — if you agree to an exchange, follow through</li>'
            . '<li><strong>Communicate clearly</strong> — keep other members informed about your availability</li>'
            . '<li><strong>Be inclusive</strong> — welcome members of all backgrounds and abilities</li>'
            . '<li><strong>Give honest feedback</strong> — help the community by providing fair reviews</li>'
            . '</ul>';
    }

    private static function prohibited(): string
    {
        return '<h2>4. Prohibited Activities</h2>'
            . '<p>The following activities are strictly prohibited and may result in account termination:</p>'
            . '<ul>'
            . '<li>Harassment or discrimination</li>'
            . '<li>Fraudulent exchanges</li>'
            . '<li>Illegal services or activities</li>'
            . '<li>Spam or solicitation</li>'
            . '<li>Impersonation</li>'
            . "<li>Sharing others' private information</li>"
            . '</ul>';
    }

    private static function safety(): string
    {
        return '<h2>5. Safety and Meetings</h2>'
            . '<p>Your safety is important. We recommend following these guidelines:</p>'
            . '<ul>'
            . '<li><strong>First meetings</strong> — meet in public places for initial exchanges</li>'
            . "<li><strong>Verify identity</strong> — confirm the member's profile before meeting</li>"
            . '<li><strong>Trust your instincts</strong> — if something feels wrong, do not proceed</li>'
            . '<li><strong>Report concerns</strong> — let us know about any suspicious behaviour</li>'
            . '<li><strong>Keep records</strong> — document exchanges through the platform</li>'
            . '</ul>';
    }

    private static function liability(string $name): string
    {
        return '<h2>6. Limitation of Liability</h2>'
            . "<p>{$name} provides a platform for community members to connect and exchange services. However:</p>"
            . '<ul>'
            . '<li>We do not guarantee the quality or safety of any services exchanged</li>'
            . '<li>We are not responsible for disputes between members</li>'
            . '<li>Members exchange services at their own risk</li>'
            . '<li>We recommend obtaining appropriate insurance for professional services</li>'
            . '</ul>'
            . "<p>By using the platform, you agree to hold {$name} harmless from any claims arising from your"
            . ' participation in service exchanges.</p>';
    }

    private static function termination(): string
    {
        return '<h2>7. Account Termination</h2>'
            . '<p>We reserve the right to suspend or terminate accounts that violate these terms.'
            . ' Reasons for termination include:</p>'
            . '<ul>'
            . '<li>Repeated violation of community guidelines</li>'
            . '<li>Fraudulent or deceptive behaviour</li>'
            . '<li>Harassment of other members</li>'
            . '<li>Extended inactivity (over 12 months)</li>'
            . '<li>Providing false information</li>'
            . '</ul>'
            . '<p>You may also close your account at any time through your account settings.</p>';
    }

    private static function changes(): string
    {
        return '<h2>8. Changes to These Terms</h2>'
            . '<p>We may update these terms from time to time to reflect changes in our practices or for legal'
            . ' reasons. When we make significant changes:</p>'
            . '<ul>'
            . '<li>We will notify you via email or platform notification</li>'
            . '<li>The updated date will be shown at the top of this page</li>'
            . '<li>Continued use of the platform constitutes acceptance of the new terms</li>'
            . '</ul>';
    }
}
