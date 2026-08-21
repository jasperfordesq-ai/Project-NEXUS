// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Services;
using Nexus.Api.Tests.Fixtures;

namespace Nexus.Api.Tests;

/// <summary>
/// The three V1 registration guards ASP.NET had no equivalent of:
/// disposable-domain refusal, email deliverability, and the breached-password
/// check. Laravel refuses each with HTTP 422 and a specific error code in the
/// v2 envelope; web-uk maps those codes to the form field it highlights, so
/// the code and the status ARE the contract.
///
/// Lesson earned writing these: the accepted case matters as much as the
/// refused one. A guard that refuses everything also "passes" a refusal test,
/// and the sign-up journey is then dead in a way no red test reveals — which
/// is exactly how the smoke's own sign-up step came to register at a reserved
/// `.test` domain and get refused for real.
/// </summary>
public class RegistrationEmailGuardUnitTests
{
    private static DisposableEmailService Disposable()
        => new(NullLogger<DisposableEmailService>.Instance);

    private static EmailDeliverabilityValidator Deliverability(
        IEmailDomainResolver resolver, bool enabled = true)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["EmailDeliverability:Enabled"] = enabled ? "true" : "false",
            })
            .Build();

        return new EmailDeliverabilityValidator(
            resolver,
            new MemoryCache(new MemoryCacheOptions()),
            config,
            NullLogger<EmailDeliverabilityValidator>.Instance);
    }

    /// <summary>
    /// Scripted resolver. Counts calls so a test can prove the pre-DNS gates
    /// really are pre-DNS rather than accidentally relying on a lookup.
    /// </summary>
    private sealed class ScriptedResolver(DomainMailResolution result) : IEmailDomainResolver
    {
        public int Calls { get; private set; }

        public Task<DomainMailResolution> ResolveAsync(string domain, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(result);
        }
    }

    // ── Guard 2: disposable-domain blocklist ────────────────────────────────

    [Fact]
    public void Disposable_KnownThrowawayProvider_IsBlocked()
    {
        Disposable().IsDisposable("bot@mailinator.com").Should().BeTrue();
        Disposable().IsDisposable("bot@10minutemail.com").Should().BeTrue();
    }

    [Fact]
    public void Disposable_SubdomainOfKnownProvider_IsBlocked()
    {
        // Several throwaway services hand out per-user subdomains precisely to
        // dodge an exact-match blocklist.
        Disposable().IsDisposable("bot@inbox.mailinator.com").Should().BeTrue();
        Disposable().IsDisposable("bot@a.b.mailinator.com").Should().BeTrue();
    }

    [Fact]
    public void Disposable_OrdinaryProvider_IsAllowed()
    {
        Disposable().IsDisposable("member@gmail.com").Should().BeFalse();
        Disposable().IsDisposable("member@hour-timebank.ie").Should().BeFalse();
    }

    [Fact]
    public void Disposable_MalformedAddress_IsAllowed()
    {
        // The ordinary email validator owns these; refusing here would report
        // the wrong error to the member.
        var service = Disposable();
        service.IsDisposable("no-at-sign").Should().BeFalse();
        service.IsDisposable("trailing@").Should().BeFalse();
        service.IsDisposable("").Should().BeFalse();
        service.IsDisposable(null).Should().BeFalse();
    }

    [Fact]
    public void Disposable_BlocklistIsActuallyLoaded()
    {
        // Guards against the silent-empty-list failure: if the content file is
        // missing from the output directory, every check above still "passes"
        // for the allowed cases while blocking nothing at all.
        var path = Path.Combine(AppContext.BaseDirectory, DisposableEmailService.BlocklistRelativePath);
        File.Exists(path).Should().BeTrue($"the blocklist must be copied to the output directory; looked in {path}");
        File.ReadLines(path).Count(l => l.Trim().Length > 0 && !l.TrimStart().StartsWith('#'))
            .Should().BeGreaterThan(100, "a truncated blocklist would quietly stop blocking most providers");
    }

    // ── Guard 1: email deliverability ───────────────────────────────────────

    [Fact]
    public async Task Deliverability_ReservedTld_IsRefusedWithoutAnyLookup()
    {
        var resolver = new ScriptedResolver(DomainMailResolution.HasRecords);
        var validator = Deliverability(resolver);

        foreach (var email in new[] { "x@foo.test", "x@bar.invalid", "x@baz.localhost", "x@qux.example" })
        {
            (await validator.IsResolvableAsync(email)).Should().BeFalse(email);
        }

        resolver.Calls.Should().Be(0,
            "reserved names must be refused before DNS — example.com publishes real MX records and would otherwise pass");
    }

    [Fact]
    public async Task Deliverability_ReservedDocumentationDomain_IsRefused()
    {
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.HasRecords));

        foreach (var email in new[] { "a@example.com", "b@example.net", "c@example.org", "d@localhost" })
        {
            (await validator.IsResolvableAsync(email)).Should().BeFalse(email);
        }
    }

    [Fact]
    public async Task Deliverability_DomainThatIsNotReserved_IsNotRefusedByTheReservedList()
    {
        // `.local` is deliberately absent from V1's list, and `test.com` is an
        // ordinary .com. Refusing either would refuse addresses Laravel accepts.
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.HasRecords));
        (await validator.IsResolvableAsync("x@test.com")).Should().BeTrue();
        (await validator.IsResolvableAsync("x@printer.local")).Should().BeTrue();
    }

    [Fact]
    public async Task Deliverability_DomainWithMailRecords_IsAllowed()
    {
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.HasRecords));
        (await validator.IsResolvableAsync("member@hour-timebank.ie")).Should().BeTrue();
    }

    [Fact]
    public async Task Deliverability_ResolverProvesNoMailRecords_IsRefused()
    {
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.NoRecords));
        (await validator.IsResolvableAsync("member@gmial-typo-example-domain.com")).Should().BeFalse();
    }

    [Fact]
    public async Task Deliverability_LookupDidNotComplete_FailsOpen()
    {
        // 🔴 THE CRUX. A resolver outage must not refuse legitimate members.
        // "The lookup failed" is not evidence the domain is undeliverable, so
        // the address is accepted — and the validator logs a WARNING saying it
        // accepted an unverified address, so this is never silent.
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.LookupFailed));
        (await validator.IsResolvableAsync("member@hour-timebank.ie")).Should().BeTrue(
            "a DNS outage must not lock every member out of sign-up");
    }

    [Fact]
    public async Task Deliverability_MalformedAddress_IsAllowed()
    {
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.NoRecords));
        (await validator.IsResolvableAsync("no-at-sign")).Should().BeTrue();
        (await validator.IsResolvableAsync("trailing@")).Should().BeTrue();
        (await validator.IsResolvableAsync(null)).Should().BeTrue();
    }

    [Fact]
    public async Task Deliverability_IllegalOrOverlongDomain_IsRefused()
    {
        var validator = Deliverability(new ScriptedResolver(DomainMailResolution.HasRecords));
        (await validator.IsResolvableAsync("x@not_valid!.com")).Should().BeFalse();
        (await validator.IsResolvableAsync("x@" + new string('a', 254) + ".com")).Should().BeFalse();
    }

    [Fact]
    public async Task Deliverability_SecondLookupForSameDomain_IsServedFromCache()
    {
        var resolver = new ScriptedResolver(DomainMailResolution.HasRecords);
        var validator = Deliverability(resolver);

        (await validator.IsResolvableAsync("a@cached-domain-example.ie")).Should().BeTrue();
        (await validator.IsResolvableAsync("b@cached-domain-example.ie")).Should().BeTrue();

        resolver.Calls.Should().Be(1, "results are cached per domain, not per address");
    }

    [Fact]
    public async Task Deliverability_WhenDisabledByConfiguration_AllowsEverything()
    {
        var resolver = new ScriptedResolver(DomainMailResolution.NoRecords);
        var validator = Deliverability(resolver, enabled: false);

        (await validator.IsResolvableAsync("x@foo.test")).Should().BeTrue();
        resolver.Calls.Should().Be(0);
    }
}

/// <summary>
/// HTTP-level proof of the contract the clients consume: exact status, exact
/// error code, exact envelope shape, and the precedence between the guards.
/// </summary>
[Collection("Integration")]
public class RegistrationEmailGuardContractTests : IntegrationTestBase
{
    public RegistrationEmailGuardContractTests(NexusWebApplicationFactory factory) : base(factory) { }

    private const string CleanPassword = "correct-horse-battery-staple-42";

    /// <summary>Always reports the password as breached, with no network call.</summary>
    private sealed class AlwaysPwnedChecker : IPwnedPasswordChecker
    {
        public Task<bool> IsPwnedAsync(string password, CancellationToken ct = default) => Task.FromResult(true);
    }

    private sealed class FixedResolver(DomainMailResolution result) : IEmailDomainResolver
    {
        public Task<DomainMailResolution> ResolveAsync(string domain, CancellationToken ct = default)
            => Task.FromResult(result);
    }

    /// <summary>
    /// A client on a host where the guards are switched on. The factory's own
    /// configuration disables the DNS lookup so the other 300+ integration
    /// tests do not depend on the runner's resolver; these tests turn it back
    /// on and script the resolver instead.
    /// </summary>
    private HttpClient GuardedClient(
        bool deliverability = true,
        bool pwned = false,
        DomainMailResolution resolution = DomainMailResolution.HasRecords)
        => Factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(
                new Dictionary<string, string?>
                {
                    ["EmailDeliverability:Enabled"] = deliverability ? "true" : "false",
                    ["Hibp:Enabled"] = pwned ? "true" : "false",
                }));

            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailDomainResolver>();
                services.AddSingleton<IEmailDomainResolver>(new FixedResolver(resolution));

                if (pwned)
                {
                    services.RemoveAll<IPwnedPasswordChecker>();
                    services.AddSingleton<IPwnedPasswordChecker>(new AlwaysPwnedChecker());
                }
            });
        }).CreateClient();

    private static object Payload(string email, string password = CleanPassword, string? lastName = "Member") => new
    {
        email,
        password,
        first_name = "Guard",
        last_name = lastName,
        tenant_slug = "test-tenant",
    };

    /// <summary>
    /// Asserts the V1 refusal shape: 422 plus {"errors":[{"code","message"}]}
    /// with the expected code first, which is the element both clients read.
    /// </summary>
    private static async Task AssertRefusedAsync(HttpResponseMessage response, string expectedCode)
    {
        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.TryGetProperty("errors", out var errors).Should().BeTrue("clients read errors[0].code");
        errors.ValueKind.Should().Be(JsonValueKind.Array);
        errors.GetArrayLength().Should().BeGreaterThan(0);
        errors[0].GetProperty("code").GetString().Should().Be(expectedCode);
        errors[0].GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Register_DisposableEmail_Refused422WithEmailDisposable()
    {
        var response = await GuardedClient().PostAsJsonAsync(
            "/api/v2/auth/register", Payload("throwaway@mailinator.com"));

        await AssertRefusedAsync(response, "EMAIL_DISPOSABLE");
    }

    [Fact]
    public async Task Register_ReservedTldEmail_Refused422WithEmailDomainInvalid()
    {
        // A reserved name is refused before any lookup, so this holds whatever
        // the resolver would have said.
        var response = await GuardedClient(resolution: DomainMailResolution.HasRecords)
            .PostAsJsonAsync("/api/v2/auth/register", Payload("someone@example.test"));

        await AssertRefusedAsync(response, "EMAIL_DOMAIN_INVALID");
    }

    [Fact]
    public async Task Register_DomainWithNoMailRecords_Refused422WithEmailDomainInvalid()
    {
        var response = await GuardedClient(resolution: DomainMailResolution.NoRecords)
            .PostAsJsonAsync("/api/v2/auth/register", Payload("someone@no-mail-records-example.ie"));

        await AssertRefusedAsync(response, "EMAIL_DOMAIN_INVALID");
    }

    [Fact]
    public async Task Register_BreachedPassword_Refused422WithPasswordPwned()
    {
        var response = await GuardedClient(pwned: true)
            .PostAsJsonAsync("/api/v2/auth/register", Payload("breach-guard@nexus-guard-example.ie"));

        await AssertRefusedAsync(response, "PASSWORD_PWNED");
    }

    [Fact]
    public async Task Register_CleanSubmission_IsAcceptedWithAllGuardsOn()
    {
        // The control. Without this, a guard that refuses everything would
        // still pass every test above.
        var response = await GuardedClient()
            .PostAsJsonAsync("/api/v2/auth/register", Payload("clean-guard-member@nexus-guard-example.ie"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("success").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Register_WhenDnsLookupCannotComplete_StillAcceptsTheMember()
    {
        // The fail-open decision, proved at the boundary a client sees: a
        // resolver outage must not turn into a refused sign-up.
        var response = await GuardedClient(resolution: DomainMailResolution.LookupFailed)
            .PostAsJsonAsync("/api/v2/auth/register", Payload("outage-guard-member@nexus-guard-example.ie"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Register_DisposableEmailTakesPrecedenceOverDeliverability()
    {
        // V1 order is disposable → deliverability → breached. A throwaway
        // address on a domain with no records must report EMAIL_DISPOSABLE,
        // because that is the code web-uk turns into its message.
        var response = await GuardedClient(resolution: DomainMailResolution.NoRecords, pwned: true)
            .PostAsJsonAsync("/api/v2/auth/register", Payload("bot@mailinator.com"));

        await AssertRefusedAsync(response, "EMAIL_DISPOSABLE");
    }

    [Fact]
    public async Task Register_OrdinaryValidationTakesPrecedenceOverBreachedPassword()
    {
        // V1 runs its whole validator before the breach check, so a submission
        // missing a surname reports the missing surname. Regression guard for
        // the old ASP.NET behaviour, which folded the breach check into the
        // validation list and could therefore report either one.
        //
        // The surname is sent as "" rather than null on purpose: a null trips
        // MVC's implicit-required model binding and never reaches the
        // controller, which would test the framework instead of this change.
        var response = await GuardedClient(pwned: true).PostAsJsonAsync(
            "/api/v2/auth/register", Payload("missing-name@nexus-guard-example.ie", lastName: ""));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        body.GetProperty("details").EnumerateArray()
            .Select(e => e.GetString()).Should().Contain(s => s!.Contains("Last name"));
    }
}

/// <summary>
/// The ASP.NET disposable-domain blocklist is a copy of the Laravel one (the
/// container build context cannot reach up into the Laravel tree, so it cannot
/// be a link). A copy drifts unless something watches it, and a drifted
/// blocklist means the two backends refuse different addresses — a journey
/// difference that no response diff would catch, because the guard only fires
/// on inputs a corpus never contains.
/// </summary>
public class DisposableEmailBlocklistParityTests
{
    private const string LaravelRelativePath = "resources/security/disposable-email-domains.txt";

    [Fact]
    public void AspNetBlocklist_ContainsExactlyTheLaravelDomains()
    {
        var laravelPath = FindLaravelBlocklist();
        laravelPath.Should().NotBeNull(
            "the monorepo checkout must contain the Laravel blocklist; without it this drift guard cannot run, " +
            "and a guard that cannot run is not a passing guard");

        var laravel = ReadDomains(laravelPath!);
        var aspnet = ReadDomains(Path.Combine(AppContext.BaseDirectory, DisposableEmailService.BlocklistRelativePath));

        laravel.Should().NotBeEmpty();
        aspnet.Except(laravel).Should().BeEmpty("these domains are blocked by ASP.NET but not by Laravel");
        laravel.Except(aspnet).Should().BeEmpty("these domains are blocked by Laravel but not by ASP.NET");
    }

    private static string? FindLaravelBlocklist()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            // Anchor on composer.json so we identify the Laravel repository
            // root rather than any directory that happens to have a
            // resources/ folder.
            if (File.Exists(Path.Combine(dir.FullName, "composer.json")))
            {
                var candidate = Path.Combine(dir.FullName, LaravelRelativePath.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(candidate)) return candidate;
            }
            dir = dir.Parent;
        }
        return null;
    }

    private static HashSet<string> ReadDomains(string path)
        => File.ReadLines(path)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0 && !line.StartsWith('#'))
            .Select(line => line.ToLowerInvariant())
            .ToHashSet(StringComparer.Ordinal);
}
