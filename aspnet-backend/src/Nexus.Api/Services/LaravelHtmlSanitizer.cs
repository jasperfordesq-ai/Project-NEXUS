// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.RegularExpressions;
using Ganss.Xss;

namespace Nexus.Api.Services;

/// <summary>
/// Sanitizes user-authored HTML with the allow-list used by Laravel's
/// App\Helpers\HtmlSanitizer::sanitize contract.
/// </summary>
public static partial class LaravelHtmlSanitizer
{
    private static readonly string[] AllowedTags =
    [
        "p", "br", "strong", "b", "em", "i", "u", "s", "strike",
        "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
        "blockquote", "pre", "code", "a", "img", "table", "thead",
        "tbody", "tr", "th", "td", "div", "span", "hr", "figure",
        "figcaption"
    ];

    private static readonly string[] AllowedAttributes =
    [
        "href", "title", "target", "rel", "src", "alt", "width", "height",
        "loading", "colspan", "rowspan", "scope", "class", "cite"
    ];

    private static readonly HtmlSanitizer Sanitizer = CreateSanitizer();

    public static string Sanitize(string html, bool allowImages = true)
    {
        if (string.IsNullOrEmpty(html))
        {
            return string.Empty;
        }

        // Laravel removes script/style blocks including their text before its
        // DOM allow-list pass. Keep this distinct from ordinary unknown tags,
        // whose harmless text content is retained.
        var withoutExecutableBlocks = ScriptOrStyleBlockRegex().Replace(html, string.Empty);
        var sanitized = Sanitizer.Sanitize(withoutExecutableBlocks);

        if (!allowImages)
        {
            sanitized = ImageTagRegex().Replace(sanitized, string.Empty);
        }

        // Laravel always overwrites rel on anchors, including anchors without
        // target=_blank.
        return AnchorTagRegex().Replace(sanitized, static match =>
        {
            var tag = RelAttributeRegex().Replace(match.Value, string.Empty).TrimEnd('>');
            return $"{tag} rel=\"noopener noreferrer\">";
        });
    }

    private static HtmlSanitizer CreateSanitizer()
    {
        var sanitizer = new HtmlSanitizer();
        sanitizer.AllowedTags.Clear();
        sanitizer.AllowedTags.UnionWith(AllowedTags);
        sanitizer.AllowedAttributes.Clear();
        sanitizer.AllowedAttributes.UnionWith(AllowedAttributes);
        sanitizer.AllowedCssProperties.Clear();
        sanitizer.AllowedAtRules.Clear();
        sanitizer.AllowedSchemes.Clear();
        sanitizer.AllowedSchemes.UnionWith(["http", "https", "mailto", "tel", "data"]);
        sanitizer.KeepChildNodes = true;
        return sanitizer;
    }

    [GeneratedRegex(@"<(script|style)\b[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex ScriptOrStyleBlockRegex();

    [GeneratedRegex(@"<img\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex ImageTagRegex();

    [GeneratedRegex(@"<a\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex AnchorTagRegex();

    [GeneratedRegex(@"\s+rel\s*=\s*(?:""[^""]*""|'[^']*'|[^\s>]+)", RegexOptions.IgnoreCase)]
    private static partial Regex RelAttributeRegex();
}
