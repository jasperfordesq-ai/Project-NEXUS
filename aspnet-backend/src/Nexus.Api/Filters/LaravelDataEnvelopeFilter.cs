// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Collections;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Nexus.Api.Filters;

/// <summary>
/// Makes a successful <c>/api/v2</c> <c>data</c> response carry Laravel's v2
/// envelope: adds the <c>meta</c> block Laravel always attaches, and removes the
/// <c>success</c> flag Laravel never sends on one.
///
/// 🔴 Why a filter, when this file's sibling warns against rewriting responses.
/// Because in Laravel this IS one shared place. `meta` is not per-endpoint
/// behaviour there: `BaseApiController::respondWithData` seeds
/// <c>['base_url' =&gt; UrlHelper::getBaseUrl()]</c> on every call
/// (BaseApiController.php:92-105), and 277 controllers inherit it across 2,553
/// call sites. Reproducing that as 89 separate edits would copy the value while
/// losing the single owner, so the ninetieth endpoint would be written without
/// it and nothing would notice.
///
/// This is also not the <c>SurnamePrivacyMiddleware</c> pattern that renamed
/// groups. That guessed at the MEANING of member data using a heuristic. This
/// adds one fixed key to the envelope on a structural condition, and every
/// affected endpoint is verified against the running Laravel by
/// <c>scripts/compare-live-responses.mjs</c>.
///
/// 🔴 The measurement that justified it, taken across the 170 GET endpoints the
/// React frontend calls, signed in against a disposable Laravel:
///
/// <code>
/// Laravel HAS meta, ASP.NET does not : 89
/// ASP.NET HAS meta, Laravel does not :  0
/// </code>
///
/// Zero the other way. Adding it where it is absent was never wrong on any
/// measured endpoint — and where it IS wrong, the endpoint says so itself with
/// <see cref="LaravelOmitsMetaAttribute"/> rather than this filter trying to
/// infer it.
///
/// Scope, deliberately narrow — every bound below is where the evidence stops:
/// <list type="bullet">
/// <item><description><c>/api/v2</c> paths only. Laravel's v1 helpers emit a
/// different envelope (<c>{success, data}</c>, no meta), and v2 is what the
/// React frontend consumes.</description></item>
/// <item><description>GET and HEAD only. Those are what the harness measures.
/// Laravel's helper is used by writes too, but this backend's write responses
/// have NOT been compared yet, and a rule applied beyond its evidence is how
/// three earlier over-generalisations in this repo broke things.</description></item>
/// <item><description>2xx only. Error bodies are <c>errors</c> +
/// <c>success:false</c>, carry no meta, and are never touched here.</description></item>
/// <item><description>Only when the body has a <c>data</c> key. Never replaces
/// an existing <c>meta</c>, so an endpoint supplying <c>per_page</c>,
/// <c>has_more</c> or <c>cursor</c> keeps them exactly.</description></item>
/// </list>
/// </summary>
public sealed class LaravelDataEnvelopeFilter : IAlwaysRunResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        var method = context.HttpContext.Request.Method;
        if (!HttpMethods.IsGet(method) && !HttpMethods.IsHead(method))
        {
            return;
        }

        if (DeclaresLaravelOmitsMeta(context))
        {
            return;
        }

        if (context.Result is not ObjectResult result || result.Value is null)
        {
            return;
        }

        var status = result.StatusCode ?? StatusCodes.Status200OK;
        if (status < 200 || status >= 300)
        {
            return;
        }

        // 🔴 v2 only. Laravel's v1 helpers (`success()`, `error()`) emit a
        // DIFFERENT envelope — `{success, data}` with no meta — and the v2
        // helpers are what the React frontend consumes. Scoping here keeps this
        // filter inside the evidence: every measured endpoint is a /api/v2 path.
        var path = context.HttpContext.Request.Path.Value ?? string.Empty;
        if (!path.StartsWith("/api/v2/", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var body = ToMutableMap(result.Value);
        if (body is null || !body.ContainsKey("data"))
        {
            return;
        }

        var changed = false;

        if (!body.ContainsKey("meta"))
        {
            // 🔴 base_url ONLY. Do NOT also add per_page/has_more here.
            //
            // I tried that on 2026-08-17, reasoning that a list `data` means
            // Laravel used respondWithCollection. It does not. Laravel uses
            // respondWithData for plenty of list endpoints, and that helper
            // emits base_url alone — /api/v2/ads/active, /billing/plans and
            // /skills/search all return {"data":[…],"meta":{"base_url":…}} with
            // no per_page. Adding the pagination keys took the measured score
            // DOWN from 57/170 to 35/170 in one run by breaking 22 endpoints
            // that already matched.
            //
            // Which helper a Laravel endpoint used is NOT derivable from its
            // response. The ~11 endpoints that really do need per_page/has_more
            // must each be changed at the action, against a live Laravel read.
            body["meta"] = new Dictionary<string, object?>
            {
                ["base_url"] = BaseUrl(context.HttpContext),
            };
            changed = true;
        }
        else if (body["meta"] is { } existingMeta && ToMutableMap(existingMeta) is { } metaMap
                 && !metaMap.ContainsKey("base_url"))
        {
            // 🔴 An endpoint that builds its OWN meta — per_page, has_more,
            // cursor, total — still needs base_url in it. Laravel seeds base_url
            // FIRST and layers the rest on top (respondWithCollection,
            // BaseApiController.php:200-220), so it is present either way; here
            // it was absent on 16 endpoints that supplied their own meta.
            // Everything already in the block is preserved: this only fills the
            // gap, it never rebuilds or reorders what the endpoint decided.
            metaMap["base_url"] = BaseUrl(context.HttpContext);
            body["meta"] = metaMap;
            changed = true;
        }

        // 🔴 `success` is not part of Laravel's v2 success envelope. Its v2
        // helpers return `data` + `meta`; `success:false` appears only on ERROR
        // bodies, which this filter never touches (2xx only). Measured across
        // the same 170 endpoints, signed in:
        //
        //     ASP.NET sends success, Laravel does not : 41
        //     Laravel sends success, ASP.NET does not :  0
        //
        // A client that branches on `success` therefore behaves differently
        // against the two backends on 41 screens.
        if (body.Remove("success"))
        {
            changed = true;
        }

        if (changed)
        {
            result.Value = body;
        }
    }

    public void OnResultExecuted(ResultExecutedContext context)
    {
        // Nothing to do once the result has run.
    }

    /// <summary>
    /// Laravel's <c>UrlHelper::getBaseUrl()</c> equivalent: scheme and host of
    /// the request. Laravel prefers the tenant's own domain when it has one;
    /// this backend has no tenant-domain column feeding that yet, so the request
    /// host is the closest true answer rather than a guess.
    /// </summary>
    private static string BaseUrl(HttpContext http) =>
        $"{http.Request.Scheme}://{http.Request.Host}";

    /// <summary>
    /// Copies a response body into a dictionary that can take another key.
    ///
    /// Returns null for anything that is not a JSON object — a bare list, a
    /// string, a number — because those have nowhere to put `meta` and Laravel
    /// does not send one for them either.
    /// </summary>
    private static Dictionary<string, object?>? ToMutableMap(object value)
    {
        if (value is Dictionary<string, object?> already)
        {
            // Copy rather than mutate: the caller may still hold a reference,
            // and a filter quietly editing someone else's object is how action
            // results start behaving differently on a retry.
            return new Dictionary<string, object?>(already);
        }

        if (value is IDictionary dictionary)
        {
            var copied = new Dictionary<string, object?>();
            foreach (DictionaryEntry entry in dictionary)
            {
                if (entry.Key is string key) copied[key] = entry.Value;
                else return null;
            }
            return copied;
        }

        if (value is IEnumerable && value is not string)
        {
            return null;
        }

        var type = value.GetType();
        if (type.IsPrimitive || type == typeof(string) || type == typeof(decimal))
        {
            return null;
        }

        var properties = type.GetProperties();
        if (properties.Length == 0)
        {
            return null;
        }

        var map = new Dictionary<string, object?>(properties.Length);
        foreach (var property in properties)
        {
            if (!property.CanRead) continue;
            if (property.GetCustomAttribute<JsonIgnoreAttribute>() is not null) continue;
            map[JsonKeyFor(property)] = property.GetValue(value);
        }

        return map;
    }

    /// <summary>
    /// The key this property would have serialised under, had this filter not
    /// turned its object into a dictionary.
    ///
    /// 🔴 This existed as bare <c>property.Name</c> and that was a contract break
    /// caused BY the filter. Converting an object to a dictionary bypasses
    /// serialisation entirely: <c>[JsonPropertyName]</c> is never consulted, and a
    /// dictionary's keys are written verbatim because MVC's camelCase setting is a
    /// PROPERTY naming policy, not a dictionary-key one. So every endpoint whose
    /// body or meta is a typed record — rather than an anonymous object with
    /// lower-case members — had its keys renamed to PascalCase the moment this
    /// filter touched it.
    ///
    /// Measured on <c>/api/v2/caring-community/markt</c>: the meta record declares
    /// <c>[JsonPropertyName("total")]</c>, <c>("page")</c>, <c>("per_page")</c>,
    /// <c>("has_more")</c>, <c>("marketplace_available")</c> and the live response
    /// carried <c>Total</c>, <c>Page</c>, <c>PerPage</c>, <c>HasMore</c>,
    /// <c>MarketplaceAvailable</c>. The endpoint was correct; the filter renamed it.
    ///
    /// Honouring the attribute first, then falling back to the same camelCase
    /// policy MVC would have applied, makes the conversion faithful. It is a no-op
    /// for the anonymous objects that make up nearly every action here, because
    /// their members are already written in the wire spelling
    /// (<c>data</c>, <c>per_page</c>, <c>base_url</c>).
    /// </summary>
    private static string JsonKeyFor(PropertyInfo property) =>
        property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
        ?? JsonNamingPolicy.CamelCase.ConvertName(property.Name);

    private static bool DeclaresLaravelOmitsMeta(FilterContext context) =>
        context.ActionDescriptor.EndpointMetadata.OfType<LaravelOmitsMetaAttribute>().Any();
}

/// <summary>
/// Marks an endpoint whose Laravel counterpart sends NO <c>meta</c> block, so
/// <see cref="LaravelDataEnvelopeFilter"/> must leave it alone.
///
/// 🔴 Declared, never inferred — the same rule as
/// <see cref="OwnErrorContractAttribute"/>, and for the same reason. Laravel's
/// `meta` comes from a base-controller helper, so an endpoint lacks it when its
/// Laravel route was written with a raw <c>response()-&gt;json()</c> instead.
/// Nothing about the response body reveals that; only reading the Laravel route
/// does. <c>/api/v2/categories</c> is the known case (routes/api.php:116-136).
///
/// Before applying this, CHECK: request the path from a running Laravel and
/// confirm the body really has no `meta`. Do not apply it to silence a diff.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class LaravelOmitsMetaAttribute : Attribute
{
}
