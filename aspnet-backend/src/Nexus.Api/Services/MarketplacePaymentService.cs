// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public sealed record MarketplacePaymentError(string Code, string Message, int Status, string? Field = null);
public sealed record MarketplacePaymentResult(object? Data, MarketplacePaymentError? Error = null, int Status = 200)
{
    public bool Succeeded => Error is null;
}

public sealed record MarketplaceSellerPayout(
    long Id,
    int OrderId,
    decimal Amount,
    decimal PlatformFee,
    decimal SellerPayout,
    string Currency,
    string Status,
    string PayoutStatus,
    string? PayoutId,
    string? PaidOutAt,
    string? CreatedAt);

public sealed record MarketplaceSellerPayoutPage(
    IReadOnlyList<MarketplaceSellerPayout> Items,
    int Total,
    int Page,
    int Limit)
{
    public int TotalPages => Total > 0 ? (int)Math.Ceiling((double)Total / Limit) : 0;
}

public sealed record MarketplaceCurrencyBalance(
    string Currency,
    decimal Pending,
    decimal Available,
    decimal TotalEarned);

public sealed record MarketplaceSellerBalance(
    decimal? Pending,
    decimal? Available,
    string? Currency,
    decimal? TotalEarned,
    IReadOnlyList<MarketplaceCurrencyBalance> BalancesByCurrency);

public sealed record MarketplaceStripeIntent(
    string Id,
    string? ClientSecret,
    string Status,
    long AmountMinor,
    long AmountReceivedMinor,
    string Currency,
    string? LatestChargeId,
    string PaymentMethod,
    IReadOnlyDictionary<string, string> Metadata,
    long? ApplicationFeeMinor = null,
    string? DestinationAccountId = null);

public sealed record MarketplaceStripeAccount(
    string Id,
    bool DetailsSubmitted,
    bool ChargesEnabled,
    bool PayoutsEnabled);

public sealed record MarketplaceStripeTransfer(
    string Id,
    long AmountMinor,
    string Currency,
    string DestinationAccountId,
    string? SourceTransactionId);

public sealed record MarketplaceStripeRefund(
    string Id,
    long AmountMinor,
    string Currency,
    string Status,
    bool TransferReversed = false,
    bool ApplicationFeeRefunded = false);

public interface IMarketplaceStripeGateway
{
    bool IsConfigured { get; }
    Task<MarketplaceStripeIntent> CreateIntentAsync(
        long amountMinor,
        string currency,
        string connectedAccountId,
        long platformFeeMinor,
        string fundsFlow,
        IReadOnlyDictionary<string, string> metadata,
        string idempotencyKey,
        CancellationToken ct);
    Task<MarketplaceStripeIntent> RetrieveIntentAsync(string paymentIntentId, CancellationToken ct);
    Task CancelIntentAsync(string paymentIntentId, string idempotencyKey, CancellationToken ct);
    Task<MarketplaceStripeTransfer> CreateTransferAsync(
        long amountMinor,
        string currency,
        string connectedAccountId,
        string sourceTransactionId,
        string transferGroup,
        IReadOnlyDictionary<string, string> metadata,
        string idempotencyKey,
        CancellationToken ct);
    Task<MarketplaceStripeRefund> CreateRefundAsync(
        string paymentIntentId,
        long amountMinor,
        bool reverseTransfer,
        bool refundApplicationFee,
        IReadOnlyDictionary<string, string> metadata,
        string idempotencyKey,
        CancellationToken ct);
    Task ReverseTransferAsync(string transferId, long amountMinor, string idempotencyKey, CancellationToken ct);
    Task<string?> RetrieveChargeTransferIdAsync(string chargeId, CancellationToken ct);
    Task<MarketplaceStripeAccount> CreateExpressAccountAsync(
        string email,
        int tenantId,
        int userId,
        string idempotencyKey,
        CancellationToken ct);
    Task<MarketplaceStripeAccount> RetrieveAccountAsync(string accountId, CancellationToken ct);
    Task<string> CreateAccountLinkAsync(
        string accountId,
        string refreshUrl,
        string returnUrl,
        CancellationToken ct);
}

public sealed class MarketplaceStripeGateway(
    IHttpClientFactory httpClientFactory,
    IConfiguration configuration,
    ILogger<MarketplaceStripeGateway> logger) : IMarketplaceStripeGateway
{
    private const string DefaultApiBase = "https://api.stripe.com";
    private string? SecretKey => configuration["Stripe:SecretKey"];
    public bool IsConfigured => !string.IsNullOrWhiteSpace(SecretKey);

    public Task<MarketplaceStripeIntent> CreateIntentAsync(
        long amountMinor,
        string currency,
        string connectedAccountId,
        long platformFeeMinor,
        string fundsFlow,
        IReadOnlyDictionary<string, string> metadata,
        string idempotencyKey,
        CancellationToken ct)
    {
        var values = new List<KeyValuePair<string, string>>
        {
            new("amount", amountMinor.ToString(CultureInfo.InvariantCulture)),
            new("currency", currency.ToLowerInvariant()),
            new("description", $"NEXUS marketplace order {metadata["nexus_order_id"]}")
        };
        if (string.Equals(fundsFlow, "separate_charge_transfer", StringComparison.Ordinal))
        {
            values.Add(new("transfer_group", $"marketplace_order_{metadata["nexus_order_id"]}"));
        }
        else
        {
            values.Add(new("application_fee_amount", platformFeeMinor.ToString(CultureInfo.InvariantCulture)));
            values.Add(new("transfer_data[destination]", connectedAccountId));
        }
        values.AddRange(metadata.Select(pair => new KeyValuePair<string, string>($"metadata[{pair.Key}]", pair.Value)));
        return SendAsync(HttpMethod.Post, "/v1/payment_intents", values, idempotencyKey, ct);
    }

    public Task<MarketplaceStripeIntent> RetrieveIntentAsync(string paymentIntentId, CancellationToken ct) =>
        SendAsync(HttpMethod.Get, $"/v1/payment_intents/{Uri.EscapeDataString(paymentIntentId)}", null, null, ct);

    public async Task CancelIntentAsync(string paymentIntentId, string idempotencyKey, CancellationToken ct) =>
        _ = await SendAsync(HttpMethod.Post, $"/v1/payment_intents/{Uri.EscapeDataString(paymentIntentId)}/cancel",
            Array.Empty<KeyValuePair<string, string>>(), idempotencyKey, ct);

    public async Task<MarketplaceStripeTransfer> CreateTransferAsync(
        long amountMinor,
        string currency,
        string connectedAccountId,
        string sourceTransactionId,
        string transferGroup,
        IReadOnlyDictionary<string, string> metadata,
        string idempotencyKey,
        CancellationToken ct)
    {
        var values = new List<KeyValuePair<string, string>>
        {
            new("amount", amountMinor.ToString(CultureInfo.InvariantCulture)),
            new("currency", currency.ToLowerInvariant()),
            new("destination", connectedAccountId),
            new("source_transaction", sourceTransactionId),
            new("transfer_group", transferGroup)
        };
        values.AddRange(metadata.Select(pair => new KeyValuePair<string, string>($"metadata[{pair.Key}]", pair.Value)));
        using var document = await SendDocumentAsync(HttpMethod.Post, "/v1/transfers", values, idempotencyKey, ct);
        var root = document.RootElement;
        var id = Text(root, "id");
        var returnedCurrency = Text(root, "currency");
        var destination = Text(root, "destination");
        var sourceTransaction = Text(root, "source_transaction");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(returnedCurrency) ||
            string.IsNullOrWhiteSpace(destination))
            throw new InvalidOperationException("Stripe returned an incomplete Transfer.");
        return new(id, Integer(root, "amount"), returnedCurrency.ToUpperInvariant(), destination, sourceTransaction);
    }

    public async Task<MarketplaceStripeRefund> CreateRefundAsync(
        string paymentIntentId,
        long amountMinor,
        bool reverseTransfer,
        bool refundApplicationFee,
        IReadOnlyDictionary<string, string> metadata,
        string idempotencyKey,
        CancellationToken ct)
    {
        var values = new List<KeyValuePair<string, string>>
        {
            new("payment_intent", paymentIntentId),
            new("amount", amountMinor.ToString(CultureInfo.InvariantCulture)),
            new("reason", "requested_by_customer")
        };
        if (reverseTransfer) values.Add(new("reverse_transfer", "true"));
        if (refundApplicationFee) values.Add(new("refund_application_fee", "true"));
        values.AddRange(metadata.Select(pair => new KeyValuePair<string, string>($"metadata[{pair.Key}]", pair.Value)));
        using var document = await SendDocumentAsync(HttpMethod.Post, "/v1/refunds", values, idempotencyKey, ct);
        var root = document.RootElement;
        var id = Text(root, "id");
        var currency = Text(root, "currency");
        var status = Text(root, "status");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(currency) || string.IsNullOrWhiteSpace(status))
            throw new InvalidOperationException("Stripe returned an incomplete Refund.");
        return new(id, Integer(root, "amount"), currency.ToUpperInvariant(), status);
    }

    public async Task ReverseTransferAsync(
        string transferId,
        long amountMinor,
        string idempotencyKey,
        CancellationToken ct)
    {
        using var document = await SendDocumentAsync(
            HttpMethod.Post,
            $"/v1/transfers/{Uri.EscapeDataString(transferId)}/reversals",
            [new("amount", amountMinor.ToString(CultureInfo.InvariantCulture))],
            idempotencyKey,
            ct);
        if (string.IsNullOrWhiteSpace(Text(document.RootElement, "id")))
            throw new InvalidOperationException("Stripe returned an incomplete Transfer Reversal.");
    }

    public async Task<string?> RetrieveChargeTransferIdAsync(string chargeId, CancellationToken ct)
    {
        using var document = await SendDocumentAsync(
            HttpMethod.Get, $"/v1/charges/{Uri.EscapeDataString(chargeId)}", null, null, ct);
        if (!document.RootElement.TryGetProperty("transfer", out var transfer) || transfer.ValueKind == JsonValueKind.Null)
            return null;
        if (transfer.ValueKind == JsonValueKind.String) return transfer.GetString();
        if (transfer.ValueKind == JsonValueKind.Object && transfer.TryGetProperty("id", out var id) &&
            id.ValueKind == JsonValueKind.String) return id.GetString();
        return null;
    }

    public async Task<MarketplaceStripeAccount> CreateExpressAccountAsync(
        string email,
        int tenantId,
        int userId,
        string idempotencyKey,
        CancellationToken ct)
    {
        var form = new[]
        {
            new KeyValuePair<string, string>("type", "express"),
            new("email", email),
            new("metadata[nexus_user_id]", userId.ToString(CultureInfo.InvariantCulture)),
            new("metadata[nexus_tenant_id]", tenantId.ToString(CultureInfo.InvariantCulture)),
            new("capabilities[card_payments][requested]", "true"),
            new("capabilities[transfers][requested]", "true")
        };
        using var document = await SendDocumentAsync(HttpMethod.Post, "/v1/accounts", form, idempotencyKey, ct);
        return ParseAccount(document.RootElement);
    }

    public async Task<MarketplaceStripeAccount> RetrieveAccountAsync(string accountId, CancellationToken ct)
    {
        using var document = await SendDocumentAsync(
            HttpMethod.Get, $"/v1/accounts/{Uri.EscapeDataString(accountId)}", null, null, ct);
        return ParseAccount(document.RootElement);
    }

    public async Task<string> CreateAccountLinkAsync(
        string accountId,
        string refreshUrl,
        string returnUrl,
        CancellationToken ct)
    {
        var form = new[]
        {
            new KeyValuePair<string, string>("account", accountId),
            new("refresh_url", refreshUrl),
            new("return_url", returnUrl),
            new("type", "account_onboarding")
        };
        using var document = await SendDocumentAsync(HttpMethod.Post, "/v1/account_links", form, null, ct);
        var url = Text(document.RootElement, "url");
        if (string.IsNullOrWhiteSpace(url)) throw new InvalidOperationException("Stripe returned an incomplete Account Link.");
        return url;
    }

    private async Task<MarketplaceStripeIntent> SendAsync(
        HttpMethod method,
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>>? form,
        string? idempotencyKey,
        CancellationToken ct)
    {
        using var document = await SendDocumentAsync(method, path, form, idempotencyKey, ct);
        var root = document.RootElement;
        var id = Text(root, "id");
        var status = Text(root, "status");
        var currency = Text(root, "currency");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(status) || string.IsNullOrWhiteSpace(currency))
            throw new InvalidOperationException("Stripe returned an incomplete PaymentIntent.");
        var metadata = new Dictionary<string, string>(StringComparer.Ordinal);
        if (root.TryGetProperty("metadata", out var metadataElement) && metadataElement.ValueKind == JsonValueKind.Object)
            foreach (var property in metadataElement.EnumerateObject()) metadata[property.Name] = property.Value.ToString();
        var latestCharge = root.TryGetProperty("latest_charge", out var charge) && charge.ValueKind == JsonValueKind.String
            ? charge.GetString()
            : null;
        var paymentMethod = "card";
        if (root.TryGetProperty("payment_method_types", out var methods) && methods.ValueKind == JsonValueKind.Array && methods.GetArrayLength() > 0)
            paymentMethod = methods[0].GetString() ?? "card";
        long? applicationFee = root.TryGetProperty("application_fee_amount", out var applicationFeeElement) &&
                               applicationFeeElement.TryGetInt64(out var parsedApplicationFee)
            ? parsedApplicationFee
            : null;
        string? destination = null;
        if (root.TryGetProperty("transfer_data", out var transferData) && transferData.ValueKind == JsonValueKind.Object &&
            transferData.TryGetProperty("destination", out var destinationElement) && destinationElement.ValueKind == JsonValueKind.String)
            destination = destinationElement.GetString();
        return new(
            id!,
            Text(root, "client_secret"),
            status!,
            Integer(root, "amount"),
            Integer(root, "amount_received"),
            currency!.ToUpperInvariant(),
            latestCharge,
            paymentMethod,
            metadata,
            applicationFee,
            destination);
    }

    private async Task<JsonDocument> SendDocumentAsync(
        HttpMethod method,
        string path,
        IReadOnlyCollection<KeyValuePair<string, string>>? form,
        string? idempotencyKey,
        CancellationToken ct)
    {
        if (!IsConfigured) throw new InvalidOperationException("Stripe is not configured.");
        var client = httpClientFactory.CreateClient("NexusStripe");
        var apiBase = configuration["Stripe:ApiBaseUrl"]?.TrimEnd('/') ?? DefaultApiBase;
        using var request = new HttpRequestMessage(method, apiBase + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", SecretKey);
        if (!string.IsNullOrWhiteSpace(idempotencyKey)) request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        if (form is not null) request.Content = new FormUrlEncodedContent(form);
        using var response = await client.SendAsync(request, ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Stripe marketplace request failed with HTTP {StatusCode}.", (int)response.StatusCode);
            throw new InvalidOperationException("Stripe rejected the marketplace payment request.");
        }

        return JsonDocument.Parse(body);
    }

    private static MarketplaceStripeAccount ParseAccount(JsonElement root)
    {
        var id = Text(root, "id");
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Stripe returned an incomplete Connect account.");
        return new(
            id,
            Boolean(root, "details_submitted"),
            Boolean(root, "charges_enabled"),
            Boolean(root, "payouts_enabled"));
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static long Integer(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.TryGetInt64(out var parsed) ? parsed : 0;
    private static bool Boolean(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind is JsonValueKind.True;
}

public sealed class MarketplacePaymentService(
    NexusDbContext db,
    IMarketplaceStripeGateway stripe,
    IConfiguration configuration,
    ILogger<MarketplacePaymentService> logger,
    PushNotificationService? pushNotifications = null,
    IEmailService? emailService = null)
{
    private static readonly HashSet<string> SupportedCurrencies = new(StringComparer.Ordinal)
    {
        "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
        "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
        "BSD", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP",
        "CRC", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ETB", "EUR",
        "FJD", "FKP", "GBP", "GEL", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD",
        "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "ISK", "JMD", "JOD", "JPY",
        "KES", "KGS", "KHR", "KMF", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP",
        "LKR", "LRD", "LSL", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP",
        "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK",
        "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
        "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SEK", "SGD",
        "SHP", "SLE", "SOS", "SRD", "STD", "SZL", "THB", "TJS", "TND", "TOP",
        "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VND",
        "VUV", "WST", "XAF", "XCD", "XCG", "XOF", "XPF", "YER", "ZAR", "ZMW"
    };

    private static readonly HashSet<string> ZeroDecimalCurrencies = new(StringComparer.Ordinal)
    {
        "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG",
        "RWF", "VND", "VUV", "XAF", "XOF", "XPF"
    };

    private static readonly IReadOnlyDictionary<string, string> OnboardingCompleteMessages =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ar"] = "تم إعداد حساب البائع بالكامل — يمكنك الآن استلام مدفوعات السوق.",
            ["de"] = "Dein Verkäuferkonto ist vollständig eingerichtet — du kannst jetzt Marktplatz-Auszahlungen erhalten.",
            ["en"] = "Your seller account is fully set up — you can now receive marketplace payouts.",
            ["es"] = "Tu cuenta de vendedor está totalmente configurada: ya puedes recibir pagos del mercado.",
            ["fr"] = "Votre compte vendeur est entièrement configuré — vous pouvez désormais recevoir les versements de la place de marché.",
            ["ga"] = "Tá do chuntas díoltóra socraithe go hiomlán — is féidir leat íocaíochtaí margaidh a fháil anois.",
            ["it"] = "Il tuo account venditore è completamente configurato: ora puoi ricevere i pagamenti del marketplace.",
            ["ja"] = "出品者アカウントの設定が完了しました。マーケットプレイスの支払いを受け取れます。",
            ["nl"] = "Je verkopersaccount is volledig ingesteld — je kunt nu marktplaatsuitbetalingen ontvangen.",
            ["pl"] = "Twoje konto sprzedawcy jest w pełni skonfigurowane — możesz teraz otrzymywać wypłaty z targowiska.",
            ["pt"] = "A tua conta de vendedor está totalmente configurada — já podes receber pagamentos do mercado."
        };

    public async Task<MarketplacePaymentResult> StartConnectOnboardingAsync(int tenantId, int userId, CancellationToken ct)
    {
        if (!stripe.IsConfigured) return Error("FEATURE_DISABLED", "Stripe marketplace payments are disabled.", 403);

        MarketplaceSellerProfile? profile;
        User? user;
        Tenant? tenant;
        await using (var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null)
        {
            if (transaction is not null)
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {userId})", ct);

            profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == userId, ct);
            user = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == userId, ct);
            tenant = await db.Tenants.AsNoTracking().SingleOrDefaultAsync(x => x.Id == tenantId, ct);
            if (profile is null) return Error("ONBOARDING_ERROR", "A marketplace seller profile is required.", 400);
            if (user is null || tenant is null) return Error("ONBOARDING_ERROR", "Marketplace seller account was not found.", 400);

            if (string.IsNullOrWhiteSpace(profile.StripeAccountId))
            {
                MarketplaceStripeAccount account;
                try
                {
                    account = await stripe.CreateExpressAccountAsync(
                        user.Email,
                        tenantId,
                        userId,
                        $"marketplace-connect-account-{tenantId}-{userId}",
                        ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    logger.LogWarning(exception, "Stripe Connect account creation failed for tenant {TenantId}, user {UserId}.", tenantId, userId);
                    return Error("ONBOARDING_ERROR", "Unable to create the Stripe Connect account.", 400);
                }

                if (string.IsNullOrWhiteSpace(account.Id) || account.Id.Length > 100)
                    return Error("ONBOARDING_ERROR", "Stripe returned an invalid Connect account.", 400);
                profile.StripeAccountId = account.Id;
                profile.StripeOnboardingComplete = account.DetailsSubmitted && account.ChargesEnabled && account.PayoutsEnabled;
                profile.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);
            }

            if (transaction is not null) await transaction.CommitAsync(ct);
        }

        string? onboardingUrl = null;
        if (!profile.StripeOnboardingComplete)
        {
            var frontendBase = BuildTenantFrontendBase(tenant);
            try
            {
                onboardingUrl = await stripe.CreateAccountLinkAsync(
                    profile.StripeAccountId!,
                    $"{frontendBase}/marketplace/seller/onboard?refresh=1",
                    $"{frontendBase}/marketplace/seller/onboard?complete=1",
                    ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Stripe Connect account-link creation failed for account {AccountId}.", profile.StripeAccountId);
                return Error("ONBOARDING_ERROR", "Unable to create the Stripe onboarding link.", 400);
            }
        }

        return new(new
        {
            account_id = profile.StripeAccountId,
            onboarding_url = onboardingUrl,
            url = onboardingUrl
        });
    }

    public async Task<MarketplacePaymentResult> ConnectOnboardingStatusAsync(int tenantId, int userId, CancellationToken ct)
    {
        var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == userId, ct);
        if (profile is null || string.IsNullOrWhiteSpace(profile.StripeAccountId))
            return ConnectStatus(null, false, false, false, false);

        if (!stripe.IsConfigured)
            return ConnectStatus(profile.StripeAccountId, profile.StripeOnboardingComplete, false, false, false);

        MarketplaceStripeAccount account;
        try
        {
            account = await stripe.RetrieveAccountAsync(profile.StripeAccountId, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Stripe Connect status retrieval failed for account {AccountId}.", profile.StripeAccountId);
            return ConnectStatus(profile.StripeAccountId, profile.StripeOnboardingComplete, false, false, false);
        }
        if (!string.Equals(account.Id, profile.StripeAccountId, StringComparison.Ordinal))
            return Error("ONBOARDING_ERROR", "Stripe returned a different Connect account.", 400);
        await ApplyConnectStatusAsync(account, externalEventId: null, ct);
        return ConnectStatus(
            profile.StripeAccountId,
            account.DetailsSubmitted && account.ChargesEnabled && account.PayoutsEnabled,
            account.DetailsSubmitted,
            account.ChargesEnabled,
            account.PayoutsEnabled);
    }

    public async Task<MarketplacePaymentResult> ReconcileConnectAccountAsync(
        MarketplaceStripeAccount account,
        string? externalEventId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(account.Id) || account.Id.Length > 100)
            return Error("VALIDATION_ERROR", "Stripe Connect account id is required.", 422, "account_id");
        if (string.IsNullOrWhiteSpace(externalEventId) || externalEventId.Length > 200)
            return Error("VALIDATION_ERROR", "Stripe event id is required.", 422, "event_id");
        return await ApplyConnectStatusAsync(account, externalEventId, ct);
    }

    public async Task<MarketplacePaymentResult> CreateIntentAsync(int tenantId, int buyerId, int orderId, CancellationToken ct)
    {
        if (!stripe.IsConfigured) return Error("FEATURE_DISABLED", "Stripe marketplace payments are disabled.", 403);
        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == orderId, ct);
        if (order is null) return Error("NOT_FOUND", "Marketplace order not found.", 404, "order_id");
        if (order.BuyerUserId != buyerId) return Error("FORBIDDEN", "Only the buyer can initiate payment.", 403);
        if (order.Status != "pending_payment") return Error("VALIDATION_ERROR", "Order is not awaiting payment.", 422, "order_id");
        if (order.PaymentExpiresAt is not null && order.PaymentExpiresAt <= DateTime.UtcNow)
            return Error("VALIDATION_ERROR", "Marketplace checkout has expired.", 422, "order_id");
        if (!string.IsNullOrWhiteSpace(order.StripeCheckoutMode) && order.StripeCheckoutMode != "payment_intent")
            return Error("VALIDATION_ERROR", "Order is already bound to a different Stripe checkout mode.", 422, "order_id");
        if ((order.TotalAmount ?? 0) <= 0 || (order.TimeCreditTotal ?? 0) > 0)
            return Error("VALIDATION_ERROR", "Card payment is not required for this order.", 422, "order_id");
        var fundsFlow = configuration.GetValue("Marketplace:EscrowEnabled", false)
            ? "separate_charge_transfer"
            : "destination_charge";

        var seller = await db.MarketplaceSellerProfiles.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == order.SellerUserId, ct);
        if (seller is null || string.IsNullOrWhiteSpace(seller.StripeAccountId))
            return Error("PAYMENT_ERROR", "Seller Stripe onboarding is required.", 400);
        if (!seller.StripeOnboardingComplete)
            return Error("PAYMENT_ERROR", "Seller Stripe onboarding is incomplete.", 400);

        var currency = NormalizeCurrency(order.Currency);
        if (currency is null) return Error("VALIDATION_ERROR", "Unsupported payment currency.", 422, "currency");
        if (!TryToMinor(order.TotalAmount!.Value, currency, out var amountMinor))
            return Error("VALIDATION_ERROR", "Payment amount has invalid currency precision.", 422, "order_id");
        var feePercent = Math.Clamp(configuration.GetValue("Marketplace:PlatformFeePercent", 5m), 0m, 100m);
        var normalizedAmount = FromMinor(amountMinor, currency);
        var feeMajor = RoundMajor(normalizedAmount * feePercent / 100m, currency);
        if (!TryToMinor(feeMajor, currency, out var feeMinor, allowZero: true))
            return Error("VALIDATION_ERROR", "Platform fee has invalid currency precision.", 422, "order_id");
        var metadata = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["nexus_tenant_id"] = tenantId.ToString(CultureInfo.InvariantCulture),
            ["nexus_order_id"] = order.Id.ToString(CultureInfo.InvariantCulture),
            ["nexus_buyer_id"] = order.BuyerUserId.ToString(CultureInfo.InvariantCulture),
            ["nexus_seller_id"] = order.SellerUserId.ToString(CultureInfo.InvariantCulture),
            ["nexus_type"] = "marketplace",
            ["nexus_funds_flow"] = fundsFlow,
            ["nexus_currency"] = currency,
            ["nexus_amount_minor"] = amountMinor.ToString(CultureInfo.InvariantCulture),
            ["nexus_platform_fee_minor"] = feeMinor.ToString(CultureInfo.InvariantCulture),
            ["nexus_seller_payout_minor"] = (amountMinor - feeMinor).ToString(CultureInfo.InvariantCulture)
        };

        await using (var claimTransaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null)
        {
            if (claimTransaction is not null)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {order.Id})", ct);
                await db.Entry(order).ReloadAsync(ct);
            }
            if (order.Status != "pending_payment" ||
                (order.PaymentExpiresAt is not null && order.PaymentExpiresAt <= DateTime.UtcNow) ||
                (!string.IsNullOrWhiteSpace(order.StripeCheckoutMode) && order.StripeCheckoutMode != "payment_intent"))
                return Error("VALIDATION_ERROR", "Order is no longer available for card payment.", 422, "order_id");
            order.StripeCheckoutMode = "payment_intent";
            order.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            if (claimTransaction is not null) await claimTransaction.CommitAsync(ct);
        }

        if (!string.IsNullOrWhiteSpace(order.PaymentIntentId))
        {
            try
            {
                var existingIntent = await stripe.RetrieveIntentAsync(order.PaymentIntentId, ct);
                if (!string.Equals(existingIntent.Id, order.PaymentIntentId, StringComparison.Ordinal) ||
                    string.IsNullOrWhiteSpace(existingIntent.ClientSecret) || existingIntent.AmountMinor != amountMinor ||
                    !string.Equals(existingIntent.Currency, currency, StringComparison.Ordinal) ||
                    !SameEconomics(existingIntent, metadata) ||
                    !ProviderFlowMatches(existingIntent, fundsFlow, feeMinor, seller.StripeAccountId!))
                    return Error("PAYMENT_ERROR", "Stripe PaymentIntent economics do not match the order.", 400);
                return new(new { client_secret = existingIntent.ClientSecret, payment_intent_id = existingIntent.Id });
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Stripe marketplace PaymentIntent resume failed for tenant {TenantId}, order {OrderId}.", tenantId, order.Id);
                return Error("PAYMENT_ERROR", "Unable to resume marketplace payment.", 400);
            }
        }

        MarketplaceStripeIntent intent;
        try
        {
            intent = await stripe.CreateIntentAsync(amountMinor, currency, seller.StripeAccountId!, feeMinor, fundsFlow, metadata,
                $"market-order-{tenantId}-{order.Id}", ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Stripe marketplace PaymentIntent creation failed for tenant {TenantId}, order {OrderId}.", tenantId, order.Id);
            return Error("PAYMENT_ERROR", "Unable to create marketplace payment.", 400);
        }
        if (string.IsNullOrWhiteSpace(intent.ClientSecret) || intent.AmountMinor != amountMinor ||
            !string.Equals(intent.Currency, currency, StringComparison.Ordinal) || !SameEconomics(intent, metadata) ||
            !ProviderFlowMatches(intent, fundsFlow, feeMinor, seller.StripeAccountId!))
        {
            await TryCancelUnboundIntentAsync(intent.Id, tenantId, order.Id, ct);
            return Error("PAYMENT_ERROR", "Stripe PaymentIntent economics do not match the order.", 400);
        }

        MarketplacePaymentResult? bindFailure = null;
        await using (var bindTransaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null)
        {
            if (bindTransaction is not null)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {order.Id})", ct);
                await db.Entry(order).ReloadAsync(ct);
            }
            if (order.Status != "pending_payment" ||
                (order.PaymentExpiresAt is not null && order.PaymentExpiresAt <= DateTime.UtcNow) ||
                order.StripeCheckoutMode != "payment_intent")
                bindFailure = Error("VALIDATION_ERROR", "Order is no longer available for card payment.", 422, "order_id");
            else if (!string.IsNullOrWhiteSpace(order.PaymentIntentId) && order.PaymentIntentId != intent.Id)
                bindFailure = Error("PAYMENT_ERROR", "The order is already bound to a different payment intent.", 409);
            else
            {
                order.PaymentIntentId = intent.Id;
                order.UpdatedAt = DateTime.UtcNow;
                try { await db.SaveChangesAsync(ct); }
                catch (DbUpdateException)
                {
                    bindFailure = Error("PAYMENT_ERROR", "The order already has a different payment intent.", 409);
                }
            }
            if (bindTransaction is not null && bindFailure is null) await bindTransaction.CommitAsync(ct);
        }
        if (bindFailure is not null)
        {
            await TryCancelUnboundIntentAsync(intent.Id, tenantId, order.Id, ct);
            return bindFailure;
        }
        return new(new { client_secret = intent.ClientSecret, payment_intent_id = intent.Id });
    }

    public async Task<MarketplacePaymentResult> ConfirmAsync(int tenantId, int buyerId, string? paymentIntentId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(paymentIntentId) || paymentIntentId.Length > 255)
            return Error("VALIDATION_ERROR", "Payment intent is required.", 422, "payment_intent_id");
        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.PaymentIntentId == paymentIntentId, ct);
        if (order is null) return Error("NOT_FOUND", "Local marketplace order not found.", 404);
        if (order.BuyerUserId != buyerId) return Error("FORBIDDEN", "Only the buyer can confirm payment.", 403);
        if (!stripe.IsConfigured) return Error("FEATURE_DISABLED", "Stripe marketplace payments are disabled.", 403);
        return await ConfirmBoundOrderAsync(order, paymentIntentId, ct);
    }

    public async Task<MarketplacePaymentResult> ReconcileSucceededIntentAsync(
        string paymentIntentId,
        string? externalEventId,
        CancellationToken ct)
    {
        if (!stripe.IsConfigured) return Error("FEATURE_DISABLED", "Stripe marketplace payments are disabled.", 503);
        if (string.IsNullOrWhiteSpace(paymentIntentId) || paymentIntentId.Length > 255)
            return Error("VALIDATION_ERROR", "Payment intent is required.", 422, "payment_intent_id");
        if (string.IsNullOrWhiteSpace(externalEventId) || externalEventId.Length > 200)
            return Error("VALIDATION_ERROR", "Stripe event id is required.", 422, "event_id");

        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.PaymentIntentId == paymentIntentId, ct);
        if (order is null) return Error("NOT_FOUND", "Local marketplace order not found.", 404);
        var existingEvent = await db.WebhookEvents.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == order.TenantId && x.Provider == "stripe-marketplace" &&
                                       x.ExternalEventId == externalEventId, ct);
        if (existingEvent is not null)
        {
            var existingPayment = await db.MarketplacePayments.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == order.TenantId &&
                                           x.StripePaymentIntentId == paymentIntentId, ct);
            if (existingPayment is not null)
            {
                try { await DeliverPaidNotificationsAsync(order, existingPayment, ct); }
                catch (Exception exception) when (exception is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    logger.LogWarning(exception,
                        "Marketplace paid notification healing failed for replayed event {EventId}.", externalEventId);
                }
            }
            return new(new { received = true, applied = existingEvent.Status == "processed" });
        }

        var result = await ConfirmBoundOrderAsync(order, paymentIntentId, ct);
        if (!result.Succeeded) return result;

        db.WebhookEvents.Add(new WebhookEvent
        {
            TenantId = order.TenantId,
            EventType = "payment_intent.succeeded",
            Source = "stripe",
            Provider = "stripe-marketplace",
            ExternalEventId = externalEventId,
            PayloadJson = JsonSerializer.Serialize(new { payment_intent_id = paymentIntentId }),
            Status = "processed",
            ReceivedAt = DateTime.UtcNow
        });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
        }
        return new(new { received = true, applied = true });
    }

    private async Task<MarketplacePaymentResult> ConfirmBoundOrderAsync(
        MarketplaceOrder order,
        string paymentIntentId,
        CancellationToken ct)
    {
        var tenantId = order.TenantId;
        MarketplaceStripeIntent intent;
        try { intent = await stripe.RetrieveIntentAsync(paymentIntentId, ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Stripe marketplace PaymentIntent verification failed for tenant {TenantId}, order {OrderId}.", tenantId, order.Id);
            return Error("PAYMENT_ERROR", "Unable to verify marketplace payment.", 400);
        }
        if (!string.Equals(intent.Status, "succeeded", StringComparison.Ordinal))
            return Error("PAYMENT_ERROR", $"Marketplace payment has not succeeded ({intent.Status}).", 400);
        if (!string.Equals(intent.Id, paymentIntentId, StringComparison.Ordinal))
            return Error("PAYMENT_ERROR", "Stripe returned a different PaymentIntent.", 400);
        var metadata = intent.Metadata;
        if (!IdentityMetadataMatches(metadata, order))
            return Error("PAYMENT_ERROR", "Stripe PaymentIntent is not bound to this order.", 400);
        var currency = NormalizeCurrency(order.Currency);
        if (currency is null || !TryToMinor(order.TotalAmount ?? 0, currency, out var amountMinor))
            return Error("PAYMENT_ERROR", "Local marketplace order currency is invalid.", 400);
        if (intent.AmountReceivedMinor != amountMinor || intent.AmountMinor != amountMinor ||
            !string.Equals(intent.Currency, currency, StringComparison.Ordinal) ||
            ParseMinor(metadata, "nexus_amount_minor") != amountMinor ||
            !metadata.TryGetValue("nexus_currency", out var metadataCurrency) || metadataCurrency != currency)
            return Error("PAYMENT_ERROR", "Stripe payment amount does not match the order.", 400);
        var feeMinor = ParseMinor(metadata, "nexus_platform_fee_minor");
        var payoutMinor = ParseMinor(metadata, "nexus_seller_payout_minor");
        var seller = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == order.SellerUserId, ct);
        if (seller is null || string.IsNullOrWhiteSpace(seller.StripeAccountId))
            return Error("PAYMENT_ERROR", "Stripe seller account is unavailable.", 400);
        if (feeMinor < 0 || payoutMinor < 0 || feeMinor + payoutMinor != amountMinor ||
            !metadata.TryGetValue("nexus_funds_flow", out var fundsFlow) ||
            fundsFlow is not ("destination_charge" or "separate_charge_transfer") ||
            !ProviderFlowMatches(intent, fundsFlow, feeMinor, seller.StripeAccountId))
            return Error("PAYMENT_ERROR", "Stripe settlement economics are invalid.", 400);

        MarketplacePayment payment;
        await using (var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null)
        {
            if (transaction is not null)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {order.Id})", ct);
                await db.Entry(order).ReloadAsync(ct);
            }
            var existing = await db.MarketplacePayments.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.StripePaymentIntentId == paymentIntentId, ct);
            if (existing is not null)
            {
                payment = existing;
                if (existing.FundsFlow == "separate_charge_transfer" &&
                    !await db.MarketplaceEscrows.IgnoreQueryFilters().AnyAsync(x =>
                        x.TenantId == tenantId && x.MarketplaceOrderId == order.Id, ct))
                {
                    db.MarketplaceEscrows.Add(NewEscrow(order, existing));
                    await db.SaveChangesAsync(ct);
                }
            }
            else
            {
                if (order.Status != "pending_payment") return Error("PAYMENT_ERROR", "Order is not awaiting payment.", 400);
                payment = new MarketplacePayment
                {
                    TenantId = tenantId,
                    MarketplaceOrderId = order.Id,
                    StripePaymentIntentId = intent.Id,
                    StripeChargeId = intent.LatestChargeId,
                    FundsFlow = fundsFlow,
                    Amount = FromMinor(amountMinor, currency),
                    Currency = currency,
                    PlatformFee = FromMinor(feeMinor, currency),
                    SellerPayout = FromMinor(payoutMinor, currency),
                    PaymentMethod = intent.PaymentMethod,
                    Status = "succeeded",
                    PayoutStatus = fundsFlow == "destination_charge" ? "paid" : "pending",
                    PaidOutAt = fundsFlow == "destination_charge" ? DateTime.UtcNow : null
                };
                db.MarketplacePayments.Add(payment);
                order.Status = "paid";
                order.PaymentExpiresAt = null;
                order.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync(ct);
                if (fundsFlow == "separate_charge_transfer")
                {
                    db.MarketplaceEscrows.Add(NewEscrow(order, payment));
                    await db.SaveChangesAsync(ct);
                }
            }
            if (transaction is not null) await transaction.CommitAsync(ct);
        }

        try
        {
            await DeliverPaidNotificationsAsync(order, payment, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception,
                "Marketplace paid notification dispatch failed after settlement for tenant {TenantId}, order {OrderId}.",
                tenantId, order.Id);
        }
        return new(Projection(payment));
    }

    private async Task DeliverPaidNotificationsAsync(
        MarketplaceOrder order,
        MarketplacePayment payment,
        CancellationToken ct)
    {
        var listingTitle = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == order.TenantId && row.Id == order.MarketplaceListingId)
            .Select(row => row.Title)
            .SingleOrDefaultAsync(ct) ?? string.Empty;
        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(row => row.Id == order.TenantId, ct);
        var link = $"/marketplace/orders/{order.Id}";
        var amount = FormatPaidAmount(payment.Amount, payment.Currency);

        await DeliverPaidBellAsync(order, order.BuyerUserId, buyer: true, amount, link, ct);
        await DeliverPaidBellAsync(order, order.SellerUserId, buyer: false, amount, link, ct);
        await DeliverPaidEmailAsync(order, order.BuyerUserId, buyer: true, amount, listingTitle, tenant, link, ct);
        await DeliverPaidEmailAsync(order, order.SellerUserId, buyer: false, amount, listingTitle, tenant, link, ct);
    }

    private async Task DeliverPaidBellAsync(
        MarketplaceOrder order,
        int userId,
        bool buyer,
        string amount,
        string link,
        CancellationToken ct)
    {
        try
        {
            await using var transaction = db.Database.IsRelational()
                ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
                : null;
            if (transaction is not null)
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({order.TenantId}, {order.Id})", ct);

            var delivery = await ClaimNotificationDeliveryAsync(order, "paid", userId, "bell", ct);
            if (delivery is null) return;

            var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(row => row.TenantId == order.TenantId && row.Id == userId, ct);
            if (user is null)
            {
                MarkDeliverySkipped(delivery);
                await db.SaveChangesAsync(ct);
                if (transaction is not null) await transaction.CommitAsync(ct);
                return;
            }

            var copy = MarketplacePaidNotificationCopy.For(user.PreferredLanguage);
            var message = RenderPaidText(buyer ? copy.BuyerBell : copy.SellerBell,
                order.OrderNumber, amount, string.Empty);
            var notification = new Notification
            {
                TenantId = order.TenantId,
                UserId = userId,
                Type = "marketplace_order",
                Title = "Marketplace order",
                Body = message,
                Link = link,
                CreatedAt = DateTime.UtcNow
            };
            db.Notifications.Add(notification);
            await db.SaveChangesAsync(ct);
            MarkDeliveryDelivered(delivery, notification.Id.ToString(CultureInfo.InvariantCulture));
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception,
                "Marketplace paid bell failed for tenant {TenantId}, order {OrderId}, user {UserId}.",
                order.TenantId, order.Id, userId);
            await TryMarkPaidDeliveryFailedAsync(order, userId, "bell", exception.Message, ct);
        }
    }

    private async Task DeliverPaidEmailAsync(
        MarketplaceOrder order,
        int userId,
        bool buyer,
        string amount,
        string listingTitle,
        Tenant? tenant,
        string link,
        CancellationToken ct)
    {
        MarketplaceOrderNotificationDelivery? delivery;
        try
        {
            await using var transaction = db.Database.IsRelational()
                ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
                : null;
            if (transaction is not null)
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({order.TenantId}, {order.Id})", ct);
            delivery = await ClaimNotificationDeliveryAsync(order, "paid", userId, "email", ct);
            if (delivery is null) return;
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception,
                "Marketplace paid email claim failed for tenant {TenantId}, order {OrderId}, user {UserId}.",
                order.TenantId, order.Id, userId);
            return;
        }

        var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(row => row.TenantId == order.TenantId && row.Id == userId, ct);
        if (user is null || string.IsNullOrWhiteSpace(user.Email))
        {
            await SetPaidDeliveryOutcomeAsync(delivery.Id, "skipped", null, null, ct);
            return;
        }
        if (emailService is null)
        {
            await SetPaidDeliveryOutcomeAsync(delivery.Id, "failed", null, "email_service_unavailable", ct);
            return;
        }

        var copy = MarketplacePaidNotificationCopy.For(user.PreferredLanguage);
        var orderNumber = WebUtility.HtmlEncode(order.OrderNumber);
        var encodedAmount = WebUtility.HtmlEncode(amount);
        var encodedTitle = WebUtility.HtmlEncode(listingTitle);
        var subject = RenderPaidText(buyer ? copy.BuyerSubject : copy.SellerSubject,
            order.OrderNumber, amount, listingTitle);
        var heading = buyer ? copy.BuyerTitle : copy.SellerTitle;
        var body = RenderPaidText(buyer ? copy.BuyerBody : copy.SellerBody,
            orderNumber, encodedAmount, encodedTitle);
        var fullUrl = (tenant is null ? (configuration["App:FrontendUrl"] ?? "https://app.project-nexus.ie").TrimEnd('/')
            : BuildTenantFrontendBase(tenant)) + link;
        var safeUrl = WebUtility.HtmlEncode(fullUrl);
        var safeName = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(user.FirstName) ? "Member" : user.FirstName);
        var html = $"<h1>{WebUtility.HtmlEncode(heading)}</h1><p>Hello {safeName},</p><p>{body}</p><p><a href=\"{safeUrl}\">View Order</a></p>";
        var text = $"{heading}\n{WebUtility.HtmlDecode(body.Replace("<strong>", string.Empty).Replace("</strong>", string.Empty))}\nView Order: {fullUrl}";
        EmailDeliveryResult result;
        try
        {
            result = await emailService.SendEmailWithEvidenceAsync(
                user.Email,
                subject,
                html,
                text,
                $"marketplace-order:{order.TenantId}:{order.Id}:paid:{userId}:email",
                ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception,
                "Marketplace paid email transport failed for tenant {TenantId}, order {OrderId}, user {UserId}.",
                order.TenantId, order.Id, userId);
            await SetPaidDeliveryOutcomeAsync(delivery.Id, "failed", null, exception.Message, CancellationToken.None);
            return;
        }

        await SetPaidDeliveryOutcomeAsync(
            delivery.Id,
            result.Accepted ? "delivered" : "failed",
            result.Accepted ? result.ProviderMessageId ?? result.Provider : null,
            result.Accepted ? null : result.FailureReason ?? "email_provider_rejected",
            ct);
    }

    private async Task<MarketplaceOrderNotificationDelivery?> ClaimNotificationDeliveryAsync(
        MarketplaceOrder order,
        string eventName,
        int userId,
        string channel,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var delivery = await db.MarketplaceOrderNotificationDeliveries.IgnoreQueryFilters()
            .SingleOrDefaultAsync(row => row.TenantId == order.TenantId &&
                                         row.MarketplaceOrderId == order.Id &&
                                         row.Event == eventName &&
                                         row.UserId == userId &&
                                         row.Channel == channel, ct);
        if (delivery is not null)
        {
            if (delivery.Status is "delivered" or "skipped") return null;
            if (delivery.Status == "claimed" && delivery.ClaimedAt > now.AddMinutes(-10)) return null;
            delivery.Status = "claimed";
            delivery.Attempts++;
            delivery.ClaimedAt = now;
            delivery.DeliveredAt = null;
            delivery.FailedAt = null;
            delivery.EvidenceId = null;
            delivery.LastError = null;
            delivery.UpdatedAt = now;
            return delivery;
        }

        delivery = new MarketplaceOrderNotificationDelivery
        {
            TenantId = order.TenantId,
            MarketplaceOrderId = order.Id,
            Event = eventName,
            UserId = userId,
            Channel = channel,
            Status = "claimed",
            Attempts = 1,
            ClaimedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.MarketplaceOrderNotificationDeliveries.Add(delivery);
        return delivery;
    }

    private async Task SetPaidDeliveryOutcomeAsync(
        long deliveryId,
        string status,
        string? evidenceId,
        string? error,
        CancellationToken ct)
    {
        var delivery = await db.MarketplaceOrderNotificationDeliveries.IgnoreQueryFilters()
            .SingleAsync(row => row.Id == deliveryId, ct);
        if (status == "delivered") MarkDeliveryDelivered(delivery, evidenceId);
        else if (status == "skipped") MarkDeliverySkipped(delivery);
        else MarkDeliveryFailed(delivery, error ?? "delivery_failed");
        await db.SaveChangesAsync(ct);
    }

    private async Task TryMarkPaidDeliveryFailedAsync(
        MarketplaceOrder order,
        int userId,
        string channel,
        string error,
        CancellationToken ct)
    {
        try
        {
            var delivery = await db.MarketplaceOrderNotificationDeliveries.IgnoreQueryFilters()
                .SingleOrDefaultAsync(row => row.TenantId == order.TenantId &&
                                             row.MarketplaceOrderId == order.Id &&
                                             row.Event == "paid" && row.UserId == userId &&
                                             row.Channel == channel, ct);
            if (delivery is null || delivery.Status is "delivered" or "skipped") return;
            MarkDeliveryFailed(delivery, error);
            await db.SaveChangesAsync(ct);
        }
        catch (Exception markException)
        {
            logger.LogWarning(markException,
                "Marketplace paid delivery failure evidence could not be persisted for order {OrderId}.", order.Id);
        }
    }

    private static void MarkDeliveryDelivered(MarketplaceOrderNotificationDelivery delivery, string? evidenceId)
    {
        delivery.Status = "delivered";
        delivery.DeliveredAt = DateTime.UtcNow;
        delivery.FailedAt = null;
        delivery.EvidenceId = evidenceId;
        delivery.LastError = null;
        delivery.UpdatedAt = DateTime.UtcNow;
    }

    private static void MarkDeliverySkipped(MarketplaceOrderNotificationDelivery delivery)
    {
        delivery.Status = "skipped";
        delivery.DeliveredAt = null;
        delivery.FailedAt = null;
        delivery.EvidenceId = null;
        delivery.LastError = null;
        delivery.UpdatedAt = DateTime.UtcNow;
    }

    private static void MarkDeliveryFailed(MarketplaceOrderNotificationDelivery delivery, string error)
    {
        delivery.Status = "failed";
        delivery.DeliveredAt = null;
        delivery.FailedAt = DateTime.UtcNow;
        delivery.EvidenceId = null;
        delivery.LastError = error.Length <= 2000 ? error : error[..2000];
        delivery.UpdatedAt = DateTime.UtcNow;
    }

    private static string RenderPaidText(string template, string orderNumber, string amount, string title) =>
        template.Replace("{{order_number}}", orderNumber, StringComparison.Ordinal)
            .Replace("{{amount}}", amount, StringComparison.Ordinal)
            .Replace("{{title}}", title, StringComparison.Ordinal);

    private static string FormatPaidAmount(decimal amount, string currency)
    {
        var normalized = NormalizeCurrency(currency) ?? "EUR";
        return amount.ToString(CurrencyExponent(normalized) == 0 ? "0" : "0.00", CultureInfo.InvariantCulture) +
               " " + normalized;
    }

    private async Task DeliverRefundNotificationsAsync(
        MarketplaceOrder order,
        MarketplacePayment payment,
        decimal refundAmount,
        CancellationToken ct)
    {
        var listingTitle = await db.MarketplaceListings.IgnoreQueryFilters().AsNoTracking()
            .Where(row => row.TenantId == order.TenantId && row.Id == order.MarketplaceListingId)
            .Select(row => row.Title)
            .SingleOrDefaultAsync(ct) ?? string.Empty;
        var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(row => row.Id == order.TenantId, ct);
        var full = payment.Status == "refunded";
        var currency = NormalizeCurrency(payment.Currency) ?? "EUR";
        var amountFormatted = refundAmount.ToString(CurrencyExponent(currency) == 0 ? "0" : "0.00",
            CultureInfo.InvariantCulture);
        var amountWithCurrency = $"{amountFormatted} {currency}";
        var link = $"/marketplace/orders/{order.Id}";
        var bellEvent = $"refund_bell_{StableHash($"{full}:{amountWithCurrency}")}";

        await DeliverRefundBellAsync(order, bellEvent, order.BuyerUserId, full, amountWithCurrency, link, ct);
        await DeliverRefundBellAsync(order, bellEvent, order.SellerUserId, full, amountWithCurrency, link, ct);
        await DeliverRefundEmailAsync(order, "refund", order.BuyerUserId, buyer: true, full,
            amountFormatted, currency, listingTitle, tenant, link, ct);
        await DeliverRefundEmailAsync(order, "refund", order.SellerUserId, buyer: false, full,
            amountFormatted, currency, listingTitle, tenant, link, ct);
    }

    private async Task DeliverRefundBellAsync(
        MarketplaceOrder order, string eventName, int userId, bool full, string amount,
        string link, CancellationToken ct)
    {
        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        if (transaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({order.TenantId}, {order.Id})", ct);
        var delivery = await ClaimNotificationDeliveryAsync(order, eventName, userId, "bell", ct);
        if (delivery is null) return;
        var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(row => row.TenantId == order.TenantId && row.Id == userId, ct);
        if (user is null)
        {
            MarkDeliverySkipped(delivery);
        }
        else
        {
            var message = (full
                    ? "Refund of {{amount}} processed for order #{{order_number}}"
                    : "Partial refund of {{amount}} processed for order #{{order_number}}")
                .Replace("{{amount}}", amount, StringComparison.Ordinal)
                .Replace("{{order_number}}", order.OrderNumber, StringComparison.Ordinal);
            var notification = new Notification
            {
                TenantId = order.TenantId,
                UserId = userId,
                Type = "marketplace_order",
                Title = "Marketplace order",
                Body = message,
                Link = link,
                CreatedAt = DateTime.UtcNow
            };
            db.Notifications.Add(notification);
            await db.SaveChangesAsync(ct);
            MarkDeliveryDelivered(delivery, notification.Id.ToString(CultureInfo.InvariantCulture));
        }
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
    }

    private async Task DeliverRefundEmailAsync(
        MarketplaceOrder order, string eventName, int userId, bool buyer, bool full,
        string amount, string currency, string listingTitle, Tenant? tenant, string link,
        CancellationToken ct)
    {
        MarketplaceOrderNotificationDelivery? delivery;
        await using (var transaction = db.Database.IsRelational()
                         ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
                         : null)
        {
            if (transaction is not null)
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({order.TenantId}, {order.Id})", ct);
            delivery = await ClaimNotificationDeliveryAsync(order, eventName, userId, "email", ct);
            if (delivery is null) return;
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
        }

        var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(row => row.TenantId == order.TenantId && row.Id == userId, ct);
        if (user is null || string.IsNullOrWhiteSpace(user.Email))
        {
            await SetPaidDeliveryOutcomeAsync(delivery.Id, "skipped", null, null, ct);
            return;
        }
        if (emailService is null)
        {
            await SetPaidDeliveryOutcomeAsync(delivery.Id, "failed", null, "email_service_unavailable", ct);
            return;
        }

        var copy = MarketplaceRefundNotificationCopy.For(user.PreferredLanguage, buyer, full);
        var emailAmount = buyer && !full ? amount : $"{amount} {currency}";
        var subject = RenderRefundText(copy.Subject, order.OrderNumber, emailAmount, currency, listingTitle, copy.Reason);
        var body = RenderRefundText(copy.Body, WebUtility.HtmlEncode(order.OrderNumber),
            WebUtility.HtmlEncode(emailAmount), WebUtility.HtmlEncode(currency),
            WebUtility.HtmlEncode(listingTitle), WebUtility.HtmlEncode(copy.Reason));
        var fullUrl = (tenant is null
            ? (configuration["App:FrontendUrl"] ?? "https://app.project-nexus.ie").TrimEnd('/')
            : BuildTenantFrontendBase(tenant)) + link;
        var safeUrl = WebUtility.HtmlEncode(fullUrl);
        var safeName = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(user.FirstName) ? "Member" : user.FirstName);
        var html = $"<h1>{WebUtility.HtmlEncode(copy.Title)}</h1><p>Hello {safeName},</p><p>{body}</p><p><a href=\"{safeUrl}\">View Order</a></p>";
        var text = $"{copy.Title}\n{WebUtility.HtmlDecode(body.Replace("<strong>", string.Empty).Replace("</strong>", string.Empty))}\nView Order: {fullUrl}";
        EmailDeliveryResult result;
        try
        {
            result = await emailService.SendEmailWithEvidenceAsync(user.Email, subject, html, text,
                $"marketplace-order:{order.TenantId}:{order.Id}:{eventName}:{userId}:email", ct);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            await SetPaidDeliveryOutcomeAsync(delivery.Id, "failed", null, exception.Message, CancellationToken.None);
            return;
        }
        await SetPaidDeliveryOutcomeAsync(delivery.Id, result.Accepted ? "delivered" : "failed",
            result.Accepted ? result.ProviderMessageId ?? result.Provider : null,
            result.Accepted ? null : result.FailureReason ?? "email_provider_rejected", ct);
    }

    private static string RenderRefundText(
        string template, string orderNumber, string amount, string currency, string title, string reason) =>
        template.Replace("{{order_number}}", orderNumber, StringComparison.Ordinal)
            .Replace("{{amount}}", amount, StringComparison.Ordinal)
            .Replace("{{currency}}", currency, StringComparison.Ordinal)
            .Replace("{{title}}", title, StringComparison.Ordinal)
            .Replace("{{reason}}", reason, StringComparison.Ordinal);

    private async Task TryDeliverRefundNotificationsAsync(
        MarketplaceOrder order, MarketplacePayment payment, decimal amount, CancellationToken ct)
    {
        try
        {
            await DeliverRefundNotificationsAsync(order, payment, amount, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception,
                "Marketplace refund notification dispatch failed for tenant {TenantId}, order {OrderId}.",
                order.TenantId, order.Id);
        }
    }

    public async Task<MarketplacePaymentResult> ProcessRefundAsync(
        int tenantId,
        int orderId,
        decimal? requestedAmount,
        string? reason,
        CancellationToken ct)
    {
        reason = string.IsNullOrWhiteSpace(reason) ? "requested_by_customer" : reason.Trim();
        if (reason.Length > 500) return Error("VALIDATION_ERROR", "Refund reason is too long.", 422, "reason");
        if (!stripe.IsConfigured) return Error("FEATURE_DISABLED", "Stripe marketplace payments are disabled.", 403);

        await using var transaction = db.Database.IsRelational() && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct)
            : null;
        if (transaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {orderId})", ct);

        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == orderId, ct);
        if (order is null) return Error("NOT_FOUND", "Marketplace order not found.", 404);
        var payment = await db.MarketplacePayments.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.MarketplaceOrderId == orderId &&
                                       (x.Status == "succeeded" || x.Status == "partially_refunded" || x.Status == "refunded"), ct);
        if (payment is null) return Error("RESOLUTION_FAILED", "Successful marketplace payment not found.", 409);

        var currency = NormalizeCurrency(payment.Currency);
        if (currency is null) return Error("RESOLUTION_FAILED", "Marketplace payment currency is invalid.", 409);
        var alreadyRefunded = RoundMajor(payment.RefundAmount ?? 0, currency);
        var remaining = RoundMajor(payment.Amount - alreadyRefunded, currency);
        if (payment.Status == "refunded")
        {
            if (requestedAmount is null || Math.Abs(requestedAmount.Value - payment.Amount) <= 0.005m)
            {
                var latestRefund = await db.MarketplacePaymentRefunds.IgnoreQueryFilters().AsNoTracking()
                    .Where(x => x.TenantId == tenantId && x.MarketplacePaymentId == payment.Id)
                    .OrderByDescending(x => x.Id)
                    .Select(x => new { x.Amount })
                    .FirstOrDefaultAsync(ct);
                if (transaction is not null) await transaction.CommitAsync(ct);
                if (latestRefund is not null)
                    await TryDeliverRefundNotificationsAsync(order, payment, latestRefund.Amount, ct);
                return new(Projection(payment, detailed: true));
            }
            return Error("VALIDATION_ERROR", "Refund amount is invalid.", 422, "refund_amount");
        }
        var refundAmount = RoundMajor(requestedAmount ?? remaining, currency);
        if (refundAmount <= 0 || refundAmount > remaining)
            return Error("VALIDATION_ERROR", "Refund amount is invalid.", 422, "refund_amount");
        if (payment.PayoutStatus == "scheduled")
            return Error("RESOLUTION_FAILED", "Marketplace payout is still processing.", 409);
        if (string.IsNullOrWhiteSpace(payment.StripePaymentIntentId))
            return Error("RESOLUTION_FAILED", "Marketplace payment intent is unavailable.", 409);

        var feeReversal = remaining > 0
            ? RoundMajor(payment.PlatformFee * (refundAmount / remaining), currency)
            : 0;
        feeReversal = Math.Min(payment.PlatformFee, feeReversal);
        var payoutReversal = Math.Min(payment.SellerPayout,
            Math.Max(0, RoundMajor(refundAmount - feeReversal, currency)));
        var cumulative = RoundMajor(alreadyRefunded + refundAmount, currency);
        if (!TryToMinor(refundAmount, currency, out var refundMinor) ||
            !TryToMinor(cumulative, currency, out var cumulativeMinor))
            return Error("VALIDATION_ERROR", "Refund amount is invalid.", 422, "refund_amount");

        MarketplaceStripeRefund providerRefund;
        try
        {
            providerRefund = await stripe.CreateRefundAsync(
                payment.StripePaymentIntentId,
                refundMinor,
                payment.FundsFlow != "separate_charge_transfer",
                payment.FundsFlow != "separate_charge_transfer",
                new Dictionary<string, string>
                {
                    ["nexus_order_id"] = order.Id.ToString(CultureInfo.InvariantCulture),
                    ["nexus_tenant_id"] = tenantId.ToString(CultureInfo.InvariantCulture),
                    ["nexus_reason"] = reason
                },
                $"marketplace-refund-{tenantId}-{payment.Id}-{cumulativeMinor}",
                ct);
            if (providerRefund.AmountMinor != refundMinor ||
                !string.Equals(providerRefund.Currency, currency, StringComparison.Ordinal))
                throw new InvalidOperationException("Stripe refund economics did not match the request.");

            if (payment.FundsFlow == "separate_charge_transfer" && payment.PayoutStatus == "paid" && payoutReversal > 0)
            {
                if (string.IsNullOrWhiteSpace(payment.PayoutId))
                    throw new InvalidOperationException("Paid marketplace transfer identity is unavailable.");
                if (!TryToMinor(payoutReversal, currency, out var payoutReversalMinor))
                    throw new InvalidOperationException("Marketplace transfer reversal amount is invalid.");
                await stripe.ReverseTransferAsync(
                    payment.PayoutId,
                    payoutReversalMinor,
                    $"marketplace-external-transfer-reversal-{StableHash(providerRefund.Id)}",
                    ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogError(exception,
                "Marketplace refund failed for tenant {TenantId}, order {OrderId}, payment {PaymentId}.",
                tenantId, orderId, payment.Id);
            return Error("RESOLUTION_FAILED", "Marketplace refund failed.", 409);
        }

        await ApplyRefundLedgerAsync(payment, order, providerRefund.Id, refundAmount,
            feeReversal, payoutReversal, reason, currency, ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        await TryDeliverRefundNotificationsAsync(order, payment, refundAmount, ct);
        return new(Projection(payment, detailed: true));
    }

    public async Task<MarketplacePaymentResult> ReconcileChargeRefundedAsync(
        string paymentIntentId,
        string chargeId,
        long amountRefundedMinor,
        IReadOnlyCollection<MarketplaceStripeRefund> refunds,
        string? externalEventId,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(externalEventId) || externalEventId.Length > 200)
            return Error("VALIDATION_ERROR", "Stripe event id is required.", 422, "event_id");
        var payment = await db.MarketplacePayments.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.StripePaymentIntentId == paymentIntentId, ct);
        if (payment is null) return new(new { received = true, applied = false });
        if (!string.Equals(payment.StripeChargeId, chargeId, StringComparison.Ordinal))
            return Error("PAYMENT_ERROR", "Stripe refund charge does not match the marketplace payment.", 409);
        if (await db.WebhookEvents.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
                x.TenantId == payment.TenantId && x.Provider == "stripe-marketplace" &&
                x.ExternalEventId == externalEventId, ct))
        {
            var replayOrder = await db.MarketplaceOrders.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == payment.TenantId && x.Id == payment.MarketplaceOrderId, ct);
            if (replayOrder is not null)
                await TryDeliverRefundNotificationsAsync(replayOrder, payment, payment.RefundAmount ?? 0, ct);
            return new(new { received = true, applied = true });
        }

        await using var transaction = db.Database.IsRelational() && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct)
            : null;
        if (transaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({payment.TenantId}, {payment.MarketplaceOrderId})", ct);
        await db.Entry(payment).ReloadAsync(ct);
        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == payment.TenantId && x.Id == payment.MarketplaceOrderId, ct);
        if (order is null) return Error("RESOLUTION_FAILED", "Marketplace order not found.", 409);
        var currency = NormalizeCurrency(payment.Currency);
        if (currency is null) return Error("RESOLUTION_FAILED", "Marketplace payment currency is invalid.", 409);

        var refundApplied = false;
        foreach (var refund in refunds.OrderBy(x => x.Id, StringComparer.Ordinal))
        {
            if (string.IsNullOrWhiteSpace(refund.Id) || refund.AmountMinor <= 0 ||
                await db.MarketplacePaymentRefunds.IgnoreQueryFilters().AnyAsync(x => x.StripeRefundId == refund.Id, ct))
                continue;
            if (!string.Equals(refund.Currency, currency, StringComparison.Ordinal))
                return Error("PAYMENT_ERROR", "Stripe refund currency does not match the marketplace payment.", 409);
            var remaining = RoundMajor(payment.Amount - (payment.RefundAmount ?? 0), currency);
            var refundAmount = Math.Min(remaining, FromMinor(refund.AmountMinor, currency));
            if (refundAmount <= 0) continue;
            var feeReversal = remaining > 0
                ? Math.Min(payment.PlatformFee, RoundMajor(payment.PlatformFee * (refundAmount / remaining), currency))
                : 0;
            var payoutReversal = Math.Min(payment.SellerPayout,
                Math.Max(0, RoundMajor(refundAmount - feeReversal, currency)));

            if (payment.FundsFlow == "destination_charge" &&
                ((payoutReversal > 0 && !refund.TransferReversed) ||
                 (feeReversal > 0 && !refund.ApplicationFeeRefunded)))
                return Error("RESOLUTION_FAILED", "Stripe refund reversal evidence is incomplete.", 409);
            if (payment.FundsFlow == "separate_charge_transfer" && payment.PayoutStatus == "paid" && payoutReversal > 0)
            {
                if (string.IsNullOrWhiteSpace(payment.PayoutId) ||
                    !TryToMinor(payoutReversal, currency, out var reversalMinor))
                    return Error("RESOLUTION_FAILED", "Marketplace payout reversal evidence is unavailable.", 409);
                try
                {
                    await stripe.ReverseTransferAsync(payment.PayoutId, reversalMinor,
                        $"marketplace-external-transfer-reversal-{StableHash(refund.Id)}", ct);
                }
                catch (Exception exception) when (exception is not OperationCanceledException || !ct.IsCancellationRequested)
                {
                    logger.LogCritical(exception,
                        "External marketplace refund {RefundId} awaits transfer reversal recovery.", refund.Id);
                    return Error("RESOLUTION_FAILED", "Marketplace payout reversal failed.", 409);
                }
            }
            await ApplyRefundLedgerAsync(payment, order, refund.Id, refundAmount,
                feeReversal, payoutReversal, "external_stripe_refund", currency, ct);
            refundApplied = true;
        }

        var providerTotal = FromMinor(amountRefundedMinor, currency);
        if (providerTotal > (payment.RefundAmount ?? 0) + 0.005m)
            return Error("RESOLUTION_FAILED", "Stripe refund detail is incomplete.", 409);
        db.WebhookEvents.Add(new WebhookEvent
        {
            TenantId = payment.TenantId,
            EventType = "charge.refunded",
            Source = "stripe",
            Provider = "stripe-marketplace",
            ExternalEventId = externalEventId,
            PayloadJson = JsonSerializer.Serialize(new
            {
                payment_intent_id = paymentIntentId,
                charge_id = chargeId,
                amount_refunded = amountRefundedMinor,
                refund_ids = refunds.Select(x => x.Id).ToArray()
            }),
            Status = "processed",
            ReceivedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        if (refundApplied)
            await TryDeliverRefundNotificationsAsync(order, payment, payment.RefundAmount ?? 0, ct);
        return new(new { received = true, applied = true });
    }

    public async Task<MarketplacePaymentResult> ReconcileChargeDisputeAsync(
        string eventType,
        string disputeId,
        string chargeId,
        string status,
        long amountMinor,
        string? externalEventId,
        CancellationToken ct)
    {
        if (eventType is not ("charge.dispute.created" or "charge.dispute.updated" or "charge.dispute.closed") ||
            string.IsNullOrWhiteSpace(disputeId) || string.IsNullOrWhiteSpace(chargeId) ||
            string.IsNullOrWhiteSpace(externalEventId) || externalEventId.Length > 200)
            return Error("VALIDATION_ERROR", "Stripe dispute evidence is incomplete.", 422);
        var payment = await db.MarketplacePayments.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.StripeChargeId == chargeId, ct);
        if (payment is null) return new(new { received = true, applied = false });
        if (await db.WebhookEvents.IgnoreQueryFilters().AsNoTracking().AnyAsync(x =>
                x.TenantId == payment.TenantId && x.Provider == "stripe-marketplace" &&
                x.ExternalEventId == externalEventId, ct))
            return new(new { received = true, applied = true });

        await using var transaction = db.Database.IsRelational() && db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct)
            : null;
        if (transaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({payment.TenantId}, {payment.MarketplaceOrderId})", ct);
        await db.Entry(payment).ReloadAsync(ct);
        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == payment.TenantId && x.Id == payment.MarketplaceOrderId, ct);
        if (order is null) return Error("RESOLUTION_FAILED", "Marketplace order not found.", 409);
        var escrow = await db.MarketplaceEscrows.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == payment.TenantId && x.MarketplaceOrderId == order.Id, ct);
        var currency = NormalizeCurrency(payment.Currency);
        if (currency is null) return Error("RESOLUTION_FAILED", "Marketplace payment currency is invalid.", 409);
        if (payment.PayoutStatus == "scheduled")
            return Error("RESOLUTION_FAILED", "Marketplace payout is still processing.", 409);

        payment.StripeDisputeId = disputeId;
        payment.StripeDisputeStatus = status;
        if (payment.DisputePreviousOrderStatus is null && order.Status != "disputed")
            payment.DisputePreviousOrderStatus = order.Status;
        var isWon = status == "won";
        var isLost = status == "lost";
        var remaining = RoundMajor(payment.Amount - (payment.RefundAmount ?? 0), currency);
        var disputedAmount = Math.Min(remaining, Math.Max(0, FromMinor(amountMinor, currency)));
        if (disputedAmount <= 0)
            return Error("RESOLUTION_FAILED", "Stripe dispute amount is invalid.", 409);
        var feeExposure = remaining > 0
            ? Math.Min(payment.PlatformFee, RoundMajor(payment.PlatformFee * (disputedAmount / remaining), currency))
            : 0;
        var calculatedSellerExposure = Math.Min(payment.SellerPayout,
            Math.Max(0, RoundMajor(disputedAmount - feeExposure, currency)));
        var ledgerId = $"dispute:{disputeId}";
        var disputeLedger = await db.MarketplacePaymentRefunds.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.StripeRefundId == ledgerId, ct);
        var recordedSellerReversal = disputeLedger?.SellerPayoutReversal ?? 0;

        if (isWon && disputeLedger is { Reason: "stripe_dispute_hold", SellerPayoutReversal: > 0 })
        {
            var seller = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == payment.TenantId && x.UserId == order.SellerUserId, ct);
            if (seller is null || string.IsNullOrWhiteSpace(seller.StripeAccountId) ||
                string.IsNullOrWhiteSpace(payment.StripeChargeId) ||
                !TryToMinor(disputeLedger.SellerPayoutReversal, currency, out var reimbursementMinor))
                return Error("RESOLUTION_FAILED", "Marketplace dispute reimbursement evidence is unavailable.", 409);
            try
            {
                await stripe.CreateTransferAsync(
                    reimbursementMinor,
                    currency,
                    seller.StripeAccountId,
                    payment.StripeChargeId,
                    $"marketplace_order_{order.Id}",
                    new Dictionary<string, string>
                    {
                        ["nexus_tenant_id"] = payment.TenantId.ToString(CultureInfo.InvariantCulture),
                        ["nexus_order_id"] = order.Id.ToString(CultureInfo.InvariantCulture),
                        ["nexus_payment_id"] = payment.Id.ToString(CultureInfo.InvariantCulture),
                        ["nexus_type"] = "marketplace_dispute_reimbursement"
                    },
                    $"marketplace-dispute-transfer-reimbursement-{StableHash(disputeId)}",
                    ct);
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                logger.LogCritical(exception, "Marketplace dispute {DisputeId} reimbursement failed.", disputeId);
                return Error("RESOLUTION_FAILED", "Marketplace dispute reimbursement failed.", 409);
            }
            payment.SellerPayout = RoundMajor(payment.SellerPayout + disputeLedger.SellerPayoutReversal, currency);
            payment.PayoutStatus = "paid";
            disputeLedger.Reason = "stripe_dispute_won";
            disputeLedger.UpdatedAt = DateTime.UtcNow;
        }
        else if (!isWon && payment.PayoutStatus == "paid" && recordedSellerReversal <= 0 &&
                 (payment.FundsFlow == "separate_charge_transfer" || isLost))
        {
            var transferId = payment.PayoutId;
            try
            {
                if (string.IsNullOrWhiteSpace(transferId))
                    transferId = await stripe.RetrieveChargeTransferIdAsync(chargeId, ct);
                if (string.IsNullOrWhiteSpace(transferId) ||
                    !TryToMinor(calculatedSellerExposure, currency, out var reversalMinor))
                    return Error("RESOLUTION_FAILED", "Marketplace dispute transfer evidence is unavailable.", 409);
                await stripe.ReverseTransferAsync(transferId, reversalMinor,
                    $"marketplace-dispute-transfer-reversal-{StableHash(disputeId)}", ct);
            }
            catch (Exception exception) when (exception is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                logger.LogCritical(exception, "Marketplace dispute {DisputeId} transfer reversal failed.", disputeId);
                return Error("RESOLUTION_FAILED", "Marketplace dispute transfer reversal failed.", 409);
            }
            recordedSellerReversal = calculatedSellerExposure;
            payment.SellerPayout = Math.Max(0, RoundMajor(payment.SellerPayout - recordedSellerReversal, currency));
            payment.PayoutStatus = payment.SellerPayout > 0 ? "paid" : "failed";
            if (disputeLedger is null)
            {
                disputeLedger = new MarketplacePaymentRefund
                {
                    TenantId = payment.TenantId,
                    MarketplacePaymentId = payment.Id,
                    StripeRefundId = ledgerId,
                    Amount = disputedAmount,
                    PlatformFeeReversal = 0,
                    SellerPayoutReversal = recordedSellerReversal,
                    Reason = "stripe_dispute_hold"
                };
                db.MarketplacePaymentRefunds.Add(disputeLedger);
            }
            else
            {
                disputeLedger.SellerPayoutReversal = recordedSellerReversal;
                disputeLedger.UpdatedAt = DateTime.UtcNow;
            }
        }
        else if (!isWon && disputeLedger is null && payment.PayoutStatus == "paid")
        {
            disputeLedger = new MarketplacePaymentRefund
            {
                TenantId = payment.TenantId,
                MarketplacePaymentId = payment.Id,
                StripeRefundId = ledgerId,
                Amount = disputedAmount,
                PlatformFeeReversal = 0,
                SellerPayoutReversal = 0,
                Reason = "stripe_dispute_hold"
            };
            db.MarketplacePaymentRefunds.Add(disputeLedger);
        }

        if (isWon)
        {
            if (order.Status == "disputed")
                order.Status = payment.DisputePreviousOrderStatus ?? "paid";
            if (escrow is { Status: "disputed" })
            {
                escrow.Status = "held";
                escrow.ReleaseAfter = DateTime.UtcNow;
                escrow.UpdatedAt = DateTime.UtcNow;
            }
        }
        else if (isLost)
        {
            if (disputeLedger is { Reason: "stripe_dispute_hold" })
            {
                disputeLedger.Amount = disputedAmount;
                disputeLedger.PlatformFeeReversal = feeExposure;
                disputeLedger.Reason = "stripe_dispute_lost";
                disputeLedger.UpdatedAt = DateTime.UtcNow;
                var cumulative = Math.Min(payment.Amount,
                    RoundMajor((payment.RefundAmount ?? 0) + disputedAmount, currency));
                var full = cumulative >= payment.Amount - 0.005m;
                payment.RefundAmount = cumulative;
                payment.PlatformFee = Math.Max(0, RoundMajor(payment.PlatformFee - feeExposure, currency));
                if (recordedSellerReversal <= 0)
                    payment.SellerPayout = Math.Max(0, RoundMajor(payment.SellerPayout - calculatedSellerExposure, currency));
                payment.RefundReason = "stripe_dispute_lost";
                payment.RefundedAt = DateTime.UtcNow;
                payment.Status = full ? "refunded" : "partially_refunded";
                payment.PayoutStatus = full ? "failed" : (payment.PaidOutAt is not null ? "paid" : "pending");
                if (escrow is not null)
                {
                    escrow.Amount = payment.SellerPayout;
                    if (full)
                    {
                        escrow.Status = "refunded";
                        escrow.ReleasedAt = DateTime.UtcNow;
                        escrow.ReleaseTrigger = null;
                    }
                }
                if (full && order.Status != "refunded")
                {
                    order.Status = "refunded";
                    await RestoreInventoryForRefundAsync(order, ct);
                }
            }
            else
            {
                await ApplyRefundLedgerAsync(payment, order, ledgerId, disputedAmount,
                    feeExposure, calculatedSellerExposure, "stripe_dispute_lost", currency, ct);
            }
            if (payment.Status != "refunded" && order.Status == "disputed")
                order.Status = payment.DisputePreviousOrderStatus ?? "paid";
            if (payment.Status != "refunded" && escrow is { Status: "disputed" })
            {
                escrow.Status = "held";
                escrow.ReleaseAfter = DateTime.UtcNow;
                escrow.UpdatedAt = DateTime.UtcNow;
            }
        }
        else
        {
            if (order.Status is not ("cancelled" or "refunded")) order.Status = "disputed";
            if (escrow is { Status: "held" })
            {
                escrow.Status = "disputed";
                escrow.UpdatedAt = DateTime.UtcNow;
            }
        }
        payment.UpdatedAt = DateTime.UtcNow;
        order.UpdatedAt = DateTime.UtcNow;
        db.WebhookEvents.Add(new WebhookEvent
        {
            TenantId = payment.TenantId,
            EventType = eventType,
            Source = "stripe",
            Provider = "stripe-marketplace",
            ExternalEventId = externalEventId,
            PayloadJson = JsonSerializer.Serialize(new
            {
                dispute_id = disputeId,
                charge_id = chargeId,
                status,
                amount = amountMinor
            }),
            Status = "processed",
            ReceivedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return new(new { received = true, applied = true });
    }

    public async Task<MarketplacePaymentResult> ConfirmDeliveryAsync(
        int tenantId,
        int buyerId,
        int orderId,
        CancellationToken ct)
    {
        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        if (transaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {orderId})", ct);

        var order = await db.MarketplaceOrders.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == orderId, ct);
        if (order is null) return Error("NOT_FOUND", "Marketplace order not found.", 404);
        if (order.BuyerUserId != buyerId)
            return Error("FORBIDDEN", "Only the buyer can confirm delivery.", 403);
        if (order.Status is not ("shipped" or "paid" or "delivered"))
            return Error("VALIDATION_ERROR", "Order is not eligible for delivery confirmation.", 422, "status");

        if (order.Status != "delivered")
        {
            var now = DateTime.UtcNow;
            order.Status = "delivered";
            order.DeliveredAt = now;
            order.BuyerConfirmedAt = now;
            order.AutoCompleteAt = now.AddDays(Math.Clamp(
                configuration.GetValue("Marketplace:EscrowDisputeWindowDays", 14), 1, 90));
            order.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
        }
        if (transaction is not null) await transaction.CommitAsync(ct);
        return new(new
        {
            order_id = order.Id,
            status = order.Status,
            buyer_confirmed_at = Iso(order.BuyerConfirmedAt),
            auto_complete_at = Iso(order.AutoCompleteAt)
        });
    }

    public async Task<MarketplacePaymentResult> ReleaseEscrowAsync(
        int tenantId,
        long escrowId,
        string trigger,
        CancellationToken ct)
    {
        if (trigger is not ("buyer_confirmed" or "auto_timeout" or "admin_override" or "dispute_resolved"))
            return Error("VALIDATION_ERROR", "Invalid escrow release trigger.", 422, "trigger");

        MarketplaceEscrow escrow;
        MarketplacePayment payment;
        MarketplaceOrder order;
        MarketplaceSellerProfile seller;
        await using (var claim = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null)
        {
            if (claim is not null)
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({tenantId}, {unchecked((int)(escrowId % int.MaxValue))})", ct);
            var escrowRow = await db.MarketplaceEscrows.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == escrowId, ct);
            if (escrowRow is null) return Error("NOT_FOUND", "Marketplace escrow was not found.", 404);
            escrow = escrowRow;
            payment = await db.MarketplacePayments.IgnoreQueryFilters()
                .SingleAsync(x => x.TenantId == tenantId && x.Id == escrow.MarketplacePaymentId, ct);
            order = await db.MarketplaceOrders.IgnoreQueryFilters()
                .SingleAsync(x => x.TenantId == tenantId && x.Id == escrow.MarketplaceOrderId, ct);
            var sellerRow = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == order.SellerUserId, ct);
            if (sellerRow is null) return Error("PAYOUT_ERROR", "Seller payout account is unavailable.", 409);
            seller = sellerRow;

            if (escrow.Status == "released" && payment.PayoutStatus == "paid" && !string.IsNullOrWhiteSpace(payment.PayoutId))
            {
                await DeliverPayoutReleasedAsync(order, escrow, ct);
                if (claim is not null) await claim.CommitAsync(ct);
                return new(Projection(payment, detailed: true));
            }
            if (escrow.Status != "held")
                return Error("VALIDATION_ERROR", $"Escrow is not held ({escrow.Status}).", 422, "status");
            if (payment.PayoutStatus == "scheduled")
                return Error("PAYOUT_PROCESSING", "Marketplace payout is already processing.", 409);
            if (payment.FundsFlow != "separate_charge_transfer" ||
                payment.Status is not ("succeeded" or "partially_refunded") ||
                string.IsNullOrWhiteSpace(payment.StripeChargeId))
                return Error("PAYOUT_ERROR", "Marketplace escrow is not backed by a captured separate charge.", 409);
            if (string.IsNullOrWhiteSpace(seller.StripeAccountId) || !seller.StripeOnboardingComplete)
                return Error("PAYOUT_ERROR", "Seller payout account is unavailable.", 409);
            if (await db.MarketplaceDisputes.IgnoreQueryFilters().AnyAsync(x =>
                    x.TenantId == tenantId && x.MarketplaceOrderId == order.Id &&
                    (x.Status == "open" || x.Status == "under_review" || x.Status == "escalated"), ct))
                return Error("VALIDATION_ERROR", "An active dispute blocks escrow release.", 422, "status");
            if (trigger == "auto_timeout" &&
                (order.Status != "delivered" || order.AutoCompleteAt is null || order.AutoCompleteAt > DateTime.UtcNow ||
                 escrow.ReleaseAfter is null || escrow.ReleaseAfter > DateTime.UtcNow))
                return Error("VALIDATION_ERROR", "Escrow is not eligible for automatic release.", 422, "status");

            if (payment.PayoutStatus == "paid" && !string.IsNullOrWhiteSpace(payment.PayoutId))
            {
                CompleteEscrowRelease(escrow, payment, order, trigger);
                await db.SaveChangesAsync(ct);
                if (claim is not null) await claim.CommitAsync(ct);
                await DeliverPayoutReleasedAsync(order, escrow, ct);
                return new(Projection(payment, detailed: true));
            }

            payment.PayoutStatus = "scheduled";
            payment.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            if (claim is not null) await claim.CommitAsync(ct);
        }

        MarketplaceStripeTransfer transfer;
        try
        {
            if (!TryToMinor(escrow.Amount, escrow.Currency, out var amountMinor, allowZero: false))
                return Error("PAYOUT_ERROR", "Escrow payout amount is invalid.", 409);
            var metadata = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["nexus_tenant_id"] = tenantId.ToString(CultureInfo.InvariantCulture),
                ["nexus_order_id"] = order.Id.ToString(CultureInfo.InvariantCulture),
                ["nexus_payment_id"] = payment.Id.ToString(CultureInfo.InvariantCulture),
                ["nexus_type"] = "marketplace_payout"
            };
            transfer = await stripe.CreateTransferAsync(
                amountMinor,
                escrow.Currency,
                seller.StripeAccountId!,
                payment.StripeChargeId!,
                $"marketplace_order_{order.Id}",
                metadata,
                $"marketplace-payout-{tenantId}-{payment.Id}",
                ct);
            if (transfer.AmountMinor != amountMinor ||
                !string.Equals(transfer.Currency, escrow.Currency, StringComparison.Ordinal) ||
                !string.Equals(transfer.DestinationAccountId, seller.StripeAccountId, StringComparison.Ordinal) ||
                !string.Equals(transfer.SourceTransactionId, payment.StripeChargeId, StringComparison.Ordinal))
                throw new InvalidOperationException("Stripe transfer economics do not match escrow.");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Marketplace escrow payout failed for payment {PaymentId}.", payment.Id);
            await db.MarketplacePayments.IgnoreQueryFilters()
                .Where(x => x.TenantId == tenantId && x.Id == payment.Id && x.PayoutStatus == "scheduled")
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(x => x.PayoutStatus, "failed")
                    .SetProperty(x => x.UpdatedAt, DateTime.UtcNow), CancellationToken.None);
            return Error("PAYOUT_ERROR", "Marketplace payout failed.", 409);
        }

        await using (var complete = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null)
        {
            if (complete is not null)
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock({tenantId}, {unchecked((int)(escrowId % int.MaxValue))})", ct);
            escrow = await db.MarketplaceEscrows.IgnoreQueryFilters()
                .SingleAsync(x => x.TenantId == tenantId && x.Id == escrowId, ct);
            payment = await db.MarketplacePayments.IgnoreQueryFilters()
                .SingleAsync(x => x.TenantId == tenantId && x.Id == escrow.MarketplacePaymentId, ct);
            order = await db.MarketplaceOrders.IgnoreQueryFilters()
                .SingleAsync(x => x.TenantId == tenantId && x.Id == escrow.MarketplaceOrderId, ct);
            payment.PayoutStatus = "paid";
            payment.PayoutId = transfer.Id;
            payment.PaidOutAt = DateTime.UtcNow;
            payment.UpdatedAt = DateTime.UtcNow;
            if (escrow.Status != "held")
            {
                await db.SaveChangesAsync(ct);
                if (complete is not null) await complete.CommitAsync(ct);
                return Error("PAYOUT_RECONCILIATION_REQUIRED", "Escrow state changed after provider transfer.", 409);
            }
            CompleteEscrowRelease(escrow, payment, order, trigger);
            await db.SaveChangesAsync(ct);
            if (complete is not null) await complete.CommitAsync(ct);
        }
        await DeliverPayoutReleasedAsync(order, escrow, ct);
        return new(Projection(payment, detailed: true));
    }

    public async Task<int> ProcessEligibleEscrowReleasesAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var candidates = await db.MarketplaceEscrows.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.Status == "held" && x.ReleaseAfter != null && x.ReleaseAfter <= now)
            .OrderBy(x => x.ReleaseAfter).ThenBy(x => x.Id)
            .Take(100)
            .Select(x => new { x.TenantId, x.Id })
            .ToListAsync(ct);
        var released = 0;
        foreach (var candidate in candidates)
        {
            var result = await ReleaseEscrowAsync(candidate.TenantId, candidate.Id, "auto_timeout", ct);
            if (result.Succeeded) released++;
        }
        return released;
    }

    private static void CompleteEscrowRelease(
        MarketplaceEscrow escrow,
        MarketplacePayment payment,
        MarketplaceOrder order,
        string trigger)
    {
        var now = DateTime.UtcNow;
        escrow.Status = "released";
        escrow.ReleasedAt = now;
        escrow.ReleaseTrigger = trigger;
        escrow.UpdatedAt = now;
        payment.PayoutStatus = "paid";
        payment.PaidOutAt ??= now;
        payment.UpdatedAt = now;
        order.Status = "completed";
        order.EscrowReleasedAt = now;
        order.UpdatedAt = now;
    }

    private async Task DeliverPayoutReleasedAsync(
        MarketplaceOrder order,
        MarketplaceEscrow escrow,
        CancellationToken ct)
    {
        try
        {
            var delivery = await db.MarketplaceOrderNotificationDeliveries.IgnoreQueryFilters()
                .SingleOrDefaultAsync(x => x.TenantId == order.TenantId &&
                                           x.MarketplaceOrderId == order.Id &&
                                           x.Event == "payout_released" &&
                                           x.UserId == order.SellerUserId &&
                                           x.Channel == "bell", ct);
            if (delivery is { Status: "delivered" or "skipped" }) return;

            var now = DateTime.UtcNow;
            if (delivery is null)
            {
                delivery = new MarketplaceOrderNotificationDelivery
                {
                    TenantId = order.TenantId,
                    MarketplaceOrderId = order.Id,
                    Event = "payout_released",
                    UserId = order.SellerUserId,
                    Channel = "bell",
                    Status = "claimed",
                    Attempts = 1,
                    ClaimedAt = now,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                db.MarketplaceOrderNotificationDeliveries.Add(delivery);
            }
            else
            {
                delivery.Status = "claimed";
                delivery.Attempts++;
                delivery.ClaimedAt = now;
                delivery.UpdatedAt = now;
            }

            var seller = await db.Users.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == order.TenantId && x.Id == order.SellerUserId, ct);
            if (seller is null)
            {
                MarkDeliverySkipped(delivery);
                await db.SaveChangesAsync(ct);
                return;
            }

            var amount = escrow.Amount.ToString(
                CurrencyExponent(NormalizeCurrency(escrow.Currency) ?? "EUR") == 0 ? "0" : "0.00",
                CultureInfo.InvariantCulture);
            var message = MarketplacePayoutNotificationCopy.For(seller.PreferredLanguage)
                .Replace("{{amount}}", amount, StringComparison.Ordinal)
                .Replace("{{order}}", order.Id.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
            var notification = new Notification
            {
                TenantId = order.TenantId,
                UserId = order.SellerUserId,
                Type = "marketplace_payout",
                Title = "Marketplace payout",
                Body = message,
                Link = $"/marketplace/orders/{order.Id}",
                CreatedAt = now
            };
            db.Notifications.Add(notification);
            await db.SaveChangesAsync(ct);
            MarkDeliveryDelivered(delivery, notification.Id.ToString(CultureInfo.InvariantCulture));
            await db.SaveChangesAsync(ct);

            if (pushNotifications is not null)
            {
                try
                {
                    await pushNotifications.SendPushAsync(
                        order.SellerUserId,
                        "Marketplace payout",
                        message,
                        JsonSerializer.Serialize(new { link = notification.Link, type = notification.Type }),
                        order.TenantId);
                }
                catch (Exception pushException)
                {
                    logger.LogWarning(pushException,
                        "Marketplace payout push failed for tenant {TenantId}, order {OrderId}.",
                        order.TenantId, order.Id);
                }
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception,
                "Marketplace payout bell failed for tenant {TenantId}, order {OrderId}.",
                order.TenantId, order.Id);
        }
    }

    public async Task<MarketplacePaymentResult> StatusAsync(int tenantId, int userId, long paymentId, CancellationToken ct)
    {
        var payment = await db.MarketplacePayments.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == paymentId, ct);
        if (payment is null) return Error("NOT_FOUND", "Marketplace payment not found.", 404);
        var order = await db.MarketplaceOrders.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == payment.MarketplaceOrderId, ct);
        if (order is null) return Error("NOT_FOUND", "Marketplace payment not found.", 404);
        if (order.BuyerUserId != userId && order.SellerUserId != userId)
            return Error("FORBIDDEN", "Marketplace payment access denied.", 403);
        return new(Projection(payment, detailed: true));
    }

    public async Task<MarketplaceSellerPayoutPage> SellerPayoutsAsync(
        int tenantId,
        int sellerId,
        int page,
        int limit,
        CancellationToken ct)
    {
        var query =
            from payment in db.MarketplacePayments.IgnoreQueryFilters().AsNoTracking()
            join order in db.MarketplaceOrders.IgnoreQueryFilters().AsNoTracking()
                on new { payment.TenantId, Id = payment.MarketplaceOrderId }
                equals new { order.TenantId, order.Id }
            where payment.TenantId == tenantId && order.SellerUserId == sellerId &&
                  (payment.Status == "succeeded" || payment.Status == "partially_refunded")
            select payment;

        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(x => x.Id)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync(ct);
        return new(
            rows.Select(x => new MarketplaceSellerPayout(
                x.Id,
                x.MarketplaceOrderId,
                x.Amount,
                x.PlatformFee,
                x.SellerPayout,
                x.Currency,
                x.Status,
                x.PayoutStatus,
                x.PayoutId,
                Iso(x.PaidOutAt),
                Iso(x.CreatedAt))).ToList(),
            total,
            page,
            limit);
    }

    public async Task<MarketplaceSellerBalance> SellerBalanceAsync(
        int tenantId,
        int sellerId,
        CancellationToken ct)
    {
        var rows = await (
            from payment in db.MarketplacePayments.IgnoreQueryFilters().AsNoTracking()
            join order in db.MarketplaceOrders.IgnoreQueryFilters().AsNoTracking()
                on new { payment.TenantId, Id = payment.MarketplaceOrderId }
                equals new { order.TenantId, order.Id }
            where payment.TenantId == tenantId && order.SellerUserId == sellerId &&
                  (payment.Status == "succeeded" || payment.Status == "partially_refunded")
            select payment).ToListAsync(ct);

        var balances = rows
            .GroupBy(x => NormalizeCurrency(x.Currency) ?? x.Currency.ToUpperInvariant(), StringComparer.Ordinal)
            .OrderBy(x => x.Key, StringComparer.Ordinal)
            .Select(group => new MarketplaceCurrencyBalance(
                group.Key,
                RoundMajor(group.Where(x => x.PayoutStatus == "pending").Sum(x => x.SellerPayout), group.Key),
                RoundMajor(group.Where(x => x.PayoutStatus is "scheduled" or "paid").Sum(x => x.SellerPayout), group.Key),
                RoundMajor(group.Sum(x => x.SellerPayout), group.Key)))
            .ToList();
        var single = balances.Count <= 1 ? balances.SingleOrDefault() : null;
        return new(single?.Pending, single?.Available, single?.Currency, single?.TotalEarned, balances);
    }

    private async Task<MarketplacePaymentResult> ApplyConnectStatusAsync(
        MarketplaceStripeAccount account,
        string? externalEventId,
        CancellationToken ct)
    {
        var profileIdentity = await db.MarketplaceSellerProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(x => x.StripeAccountId == account.Id)
            .Select(x => new { x.TenantId, x.UserId })
            .SingleOrDefaultAsync(ct);
        if (profileIdentity is null) return new(new { received = true, applied = false });

        var completed = account.DetailsSubmitted && account.ChargesEnabled && account.PayoutsEnabled;
        var notify = false;
        string? notificationMessage = null;
        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.ReadCommitted, ct)
            : null;
        if (transaction is not null)
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({profileIdentity.TenantId}, {profileIdentity.UserId})", ct);

        var profile = await db.MarketplaceSellerProfiles.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == profileIdentity.TenantId &&
                                       x.UserId == profileIdentity.UserId &&
                                       x.StripeAccountId == account.Id, ct);
        if (profile is null) return new(new { received = true, applied = false });

        if (!string.IsNullOrWhiteSpace(externalEventId))
        {
            var replay = await db.WebhookEvents.IgnoreQueryFilters().AsNoTracking()
                .SingleOrDefaultAsync(x => x.TenantId == profile.TenantId &&
                                           x.Provider == "stripe-marketplace" &&
                                           x.ExternalEventId == externalEventId, ct);
            if (replay is not null) return new(new { received = true, applied = replay.Status == "processed" });
        }

        if (profile.StripeOnboardingComplete != completed)
        {
            var wasComplete = profile.StripeOnboardingComplete;
            profile.StripeOnboardingComplete = completed;
            profile.UpdatedAt = DateTime.UtcNow;
            if (completed && !wasComplete)
            {
                var user = await db.Users.IgnoreQueryFilters().AsNoTracking()
                    .SingleOrDefaultAsync(x => x.TenantId == profile.TenantId && x.Id == profile.UserId, ct);
                if (user is not null)
                {
                    notificationMessage = LocalizedOnboardingComplete(user.PreferredLanguage);
                    db.Notifications.Add(new Notification
                    {
                        TenantId = profile.TenantId,
                        UserId = profile.UserId,
                        Type = "marketplace_payout",
                        Title = notificationMessage,
                        Link = "/marketplace/seller/dashboard",
                        Data = JsonSerializer.Serialize(new { account_id = account.Id }),
                        CreatedAt = DateTime.UtcNow
                    });
                    notify = true;
                }
            }
        }

        if (!string.IsNullOrWhiteSpace(externalEventId))
        {
            db.WebhookEvents.Add(new WebhookEvent
            {
                TenantId = profile.TenantId,
                EventType = "account.updated",
                Source = "stripe",
                Provider = "stripe-marketplace",
                ExternalEventId = externalEventId,
                PayloadJson = JsonSerializer.Serialize(new
                {
                    account_id = account.Id,
                    details_submitted = account.DetailsSubmitted,
                    charges_enabled = account.ChargesEnabled,
                    payouts_enabled = account.PayoutsEnabled
                }),
                Status = "processed",
                ReceivedAt = DateTime.UtcNow
            });
        }

        try
        {
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
        }
        catch (DbUpdateException) when (!string.IsNullOrWhiteSpace(externalEventId))
        {
            if (transaction is not null) await transaction.RollbackAsync(CancellationToken.None);
            db.ChangeTracker.Clear();
            var replayWon = await db.WebhookEvents.IgnoreQueryFilters().AsNoTracking()
                .AnyAsync(x => x.TenantId == profile.TenantId &&
                               x.Provider == "stripe-marketplace" &&
                               x.ExternalEventId == externalEventId, CancellationToken.None);
            if (replayWon) return new(new { received = true, applied = true });
            throw;
        }

        if (notify && pushNotifications is not null && notificationMessage is not null)
        {
            try
            {
                await pushNotifications.SendPushAsync(
                    profile.UserId,
                    notificationMessage,
                    notificationMessage,
                    JsonSerializer.Serialize(new { link = "/marketplace/seller/dashboard", type = "marketplace_payout" }),
                    profile.TenantId);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Marketplace onboarding push notification failed for user {UserId}.", profile.UserId);
            }
        }

        return new(new { received = true, applied = true });
    }

    private string BuildTenantFrontendBase(Tenant tenant)
    {
        var customDomain = tenant.Id > 1 && !string.IsNullOrWhiteSpace(tenant.Domain);
        var origin = customDomain
            ? $"https://{tenant.Domain!.Trim().TrimEnd('/')}"
            : (configuration["App:FrontendUrl"] ?? "https://app.project-nexus.ie").Trim().TrimEnd('/');
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            origin = "https://app.project-nexus.ie";
        if (!customDomain && !string.IsNullOrWhiteSpace(tenant.Slug))
            origin += "/" + Uri.EscapeDataString(tenant.Slug.Trim('/'));
        return origin;
    }

    private static MarketplacePaymentResult ConnectStatus(
        string? accountId,
        bool onboarded,
        bool detailsSubmitted,
        bool chargesEnabled,
        bool payoutsEnabled) => new(new
        {
            stripe_account_id = accountId,
            stripe_onboarding_complete = onboarded,
            details_submitted = detailsSubmitted,
            charges_enabled = chargesEnabled,
            payouts_enabled = payoutsEnabled
        });

    private static string LocalizedOnboardingComplete(string? locale)
    {
        var normalized = string.IsNullOrWhiteSpace(locale)
            ? "en"
            : locale.Trim().Split('-', '_')[0].ToLowerInvariant();
        return OnboardingCompleteMessages.TryGetValue(normalized, out var message)
            ? message
            : OnboardingCompleteMessages["en"];
    }

    private static object Projection(MarketplacePayment payment, bool detailed = false) => detailed
        ? new
        {
            id = payment.Id, order_id = payment.MarketplaceOrderId, amount = payment.Amount,
            currency = payment.Currency, platform_fee = payment.PlatformFee, seller_payout = payment.SellerPayout,
            payment_method = payment.PaymentMethod, status = payment.Status, payout_status = payment.PayoutStatus,
            refund_amount = payment.RefundAmount, refunded_at = Iso(payment.RefundedAt), paid_out_at = Iso(payment.PaidOutAt),
            created_at = Iso(payment.CreatedAt)
        }
        : new
        {
            payment_id = payment.Id, status = payment.Status, amount = payment.Amount,
            currency = payment.Currency, order_id = payment.MarketplaceOrderId
        };

    private static bool SameEconomics(MarketplaceStripeIntent intent, IReadOnlyDictionary<string, string> expected) =>
        expected.All(pair => intent.Metadata.TryGetValue(pair.Key, out var actual) && actual == pair.Value);
    private static bool ProviderFlowMatches(
        MarketplaceStripeIntent intent,
        string fundsFlow,
        long platformFeeMinor,
        string connectedAccountId) =>
        fundsFlow == "separate_charge_transfer"
            ? intent.ApplicationFeeMinor is null && string.IsNullOrWhiteSpace(intent.DestinationAccountId)
            : intent.ApplicationFeeMinor == platformFeeMinor &&
              string.Equals(intent.DestinationAccountId, connectedAccountId, StringComparison.Ordinal);
    private MarketplaceEscrow NewEscrow(MarketplaceOrder order, MarketplacePayment payment)
    {
        var now = DateTime.UtcNow;
        return new MarketplaceEscrow
        {
            TenantId = order.TenantId,
            MarketplaceOrderId = order.Id,
            MarketplacePaymentId = payment.Id,
            Amount = payment.SellerPayout,
            Currency = payment.Currency,
            Status = "held",
            HeldAt = now,
            ReleaseAfter = now.AddDays(Math.Clamp(
                configuration.GetValue("Marketplace:EscrowAutoReleaseDays", 14), 1, 90))
        };
    }
    private async Task ApplyRefundLedgerAsync(
        MarketplacePayment payment,
        MarketplaceOrder order,
        string stripeRefundId,
        decimal refundAmount,
        decimal feeReversal,
        decimal payoutReversal,
        string reason,
        string currency,
        CancellationToken ct)
    {
        if (await db.MarketplacePaymentRefunds.IgnoreQueryFilters()
            .AnyAsync(x => x.StripeRefundId == stripeRefundId, ct)) return;
        db.MarketplacePaymentRefunds.Add(new MarketplacePaymentRefund
        {
            TenantId = payment.TenantId,
            MarketplacePaymentId = payment.Id,
            StripeRefundId = stripeRefundId,
            Amount = refundAmount,
            PlatformFeeReversal = feeReversal,
            SellerPayoutReversal = payoutReversal,
            Reason = reason[..Math.Min(reason.Length, 500)]
        });
        var cumulative = Math.Min(payment.Amount,
            RoundMajor((payment.RefundAmount ?? 0) + refundAmount, currency));
        var isFull = cumulative >= payment.Amount - 0.005m;
        payment.RefundAmount = cumulative;
        payment.RefundReason = reason;
        payment.RefundedAt = DateTime.UtcNow;
        payment.Status = isFull ? "refunded" : "partially_refunded";
        payment.PlatformFee = isFull ? 0 : Math.Max(0, RoundMajor(payment.PlatformFee - feeReversal, currency));
        payment.SellerPayout = isFull ? 0 : Math.Max(0, RoundMajor(payment.SellerPayout - payoutReversal, currency));
        if (isFull && payment.FundsFlow == "separate_charge_transfer") payment.PayoutStatus = "failed";
        payment.UpdatedAt = DateTime.UtcNow;

        var escrow = await db.MarketplaceEscrows.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == payment.TenantId && x.MarketplaceOrderId == order.Id, ct);
        if (escrow is not null)
        {
            escrow.Amount = payment.SellerPayout;
            if (isFull)
            {
                escrow.Status = "refunded";
                escrow.ReleasedAt = DateTime.UtcNow;
                escrow.ReleaseTrigger = null;
            }
            escrow.UpdatedAt = DateTime.UtcNow;
        }
        if (isFull && order.Status != "refunded")
        {
            order.Status = "refunded";
            await RestoreInventoryForRefundAsync(order, ct);
        }
        order.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }
    private static bool IdentityMetadataMatches(IReadOnlyDictionary<string, string> metadata, MarketplaceOrder order) =>
        metadata.TryGetValue("nexus_type", out var type) && type == "marketplace" &&
        metadata.TryGetValue("nexus_order_id", out var orderId) && orderId == order.Id.ToString(CultureInfo.InvariantCulture) &&
        metadata.TryGetValue("nexus_tenant_id", out var tenantId) && tenantId == order.TenantId.ToString(CultureInfo.InvariantCulture) &&
        metadata.TryGetValue("nexus_buyer_id", out var buyerId) && buyerId == order.BuyerUserId.ToString(CultureInfo.InvariantCulture) &&
        metadata.TryGetValue("nexus_seller_id", out var sellerId) && sellerId == order.SellerUserId.ToString(CultureInfo.InvariantCulture);
    private async Task TryCancelUnboundIntentAsync(string paymentIntentId, int tenantId, int orderId, CancellationToken ct)
    {
        try
        {
            await stripe.CancelIntentAsync(paymentIntentId, $"marketplace-unbound-intent-{tenantId}-{orderId}", ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogCritical(exception,
                "Unbound Stripe marketplace PaymentIntent {PaymentIntentId} could not be cancelled for tenant {TenantId}, order {OrderId}.",
                paymentIntentId, tenantId, orderId);
        }
    }
    private static long ParseMinor(IReadOnlyDictionary<string, string> metadata, string key) =>
        metadata.TryGetValue(key, out var value) && long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : -1;
    private async Task RestoreInventoryForRefundAsync(MarketplaceOrder order, CancellationToken ct)
    {
        var listing = await db.MarketplaceListings.IgnoreQueryFilters()
            .SingleOrDefaultAsync(x => x.TenantId == order.TenantId && x.Id == order.MarketplaceListingId, ct);
        if (listing is null) return;
        listing.Quantity = checked(listing.Quantity + Math.Max(1, order.Quantity));
        listing.Status = "active";
        listing.MarketplaceStatus = "available";
        listing.UpdatedAt = DateTime.UtcNow;
    }
    private static string StableHash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string? NormalizeCurrency(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var normalized = value.Trim().ToUpperInvariant();
        return SupportedCurrencies.Contains(normalized) ? normalized : null;
    }

    private static int CurrencyExponent(string currency) => ZeroDecimalCurrencies.Contains(currency) ? 0 : 2;

    private static bool TryToMinor(decimal value, string currency, out long minor, bool allowZero = false)
    {
        minor = 0;
        if ((allowZero ? value < 0 : value <= 0) || NormalizeCurrency(currency) is null) return false;
        if (currency is "ISK" or "UGX" && value != decimal.Round(value, 0, MidpointRounding.AwayFromZero)) return false;
        var factor = CurrencyExponent(currency) == 0 ? 1m : 100m;
        var scaled = value * factor;
        if (scaled != decimal.Round(scaled, 0, MidpointRounding.AwayFromZero)) return false;
        try { minor = checked((long)scaled); }
        catch (OverflowException) { return false; }
        return allowZero ? minor >= 0 : minor > 0;
    }

    private static decimal FromMinor(long value, string currency) =>
        CurrencyExponent(currency) == 0 ? value : value / 100m;
    private static decimal RoundMajor(decimal value, string currency) =>
        decimal.Round(value, CurrencyExponent(currency), MidpointRounding.AwayFromZero);
    private static string? Iso(DateTime? value) => value?.ToUniversalTime().ToString("O");
    private static string Iso(DateTime value) => value.ToUniversalTime().ToString("O");
    private static MarketplacePaymentResult Error(string code, string message, int status, string? field = null) =>
        new(null, new(code, message, status, field), status);
}
