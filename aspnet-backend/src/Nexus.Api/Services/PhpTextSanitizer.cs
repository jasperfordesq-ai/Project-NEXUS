// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;

namespace Nexus.Api.Services;

/// <summary>
/// Compatibility helpers for PHP text operations used by the Laravel source.
/// </summary>
public static class PhpTextSanitizer
{
    /// <summary>
    /// Removes tags with the observable behavior of PHP's strip_tags for
    /// message text, including malformed/unclosed tags while preserving a
    /// literal less-than sign followed by whitespace.
    /// </summary>
    public static string StripTags(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        var firstTag = value.IndexOf('<', StringComparison.Ordinal);
        if (firstTag < 0)
        {
            return value;
        }

        var output = new StringBuilder(value.Length);
        output.Append(value, 0, firstTag);

        for (var index = firstTag; index < value.Length;)
        {
            if (value[index] != '<'
                || (index + 1 < value.Length && char.IsWhiteSpace(value[index + 1])))
            {
                output.Append(value[index]);
                index++;
                continue;
            }

            index = SkipTag(value, index);
        }

        return output.ToString();
    }

    private static int SkipTag(string value, int start)
    {
        if (value.AsSpan(start).StartsWith("<!--", StringComparison.Ordinal))
        {
            var commentEnd = value.IndexOf("-->", start + 4, StringComparison.Ordinal);
            return commentEnd < 0 ? value.Length : commentEnd + 3;
        }

        var depth = 1;
        var quote = '\0';
        for (var index = start + 1; index < value.Length; index++)
        {
            var character = value[index];
            if (quote != '\0')
            {
                if (character == quote)
                {
                    quote = '\0';
                }

                continue;
            }

            if (character is '\'' or '"')
            {
                quote = character;
            }
            else if (character == '<')
            {
                depth++;
            }
            else if (character == '>' && --depth == 0)
            {
                return index + 1;
            }
        }

        return value.Length;
    }
}
