// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

public static class MarketplacePayoutNotificationCopy
{
    private static readonly IReadOnlyDictionary<string, string> Messages =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ar"] = "تم تحرير دفعتك البالغة {{amount}} عن الطلب رقم {{order}} إليك.",
            ["de"] = "Deine Auszahlung von {{amount}} für Bestellung #{{order}} wurde freigegeben.",
            ["en"] = "Your payout of {{amount}} for order #{{order}} has been released to you.",
            ["es"] = "Tu pago de {{amount}} por el pedido #{{order}} ha sido liberado.",
            ["fr"] = "Votre versement de {{amount}} pour la commande #{{order}} a été débloqué.",
            ["ga"] = "Scaoileadh d'íocaíocht {{amount}} don ordú #{{order}} chugat.",
            ["it"] = "Il tuo pagamento di {{amount}} per l'ordine #{{order}} è stato rilasciato.",
            ["ja"] = "注文 #{{order}} のあなたへの支払い {{amount}} がリリースされました。",
            ["nl"] = "Je uitbetaling van {{amount}} voor bestelling #{{order}} is vrijgegeven.",
            ["pl"] = "Twoja wypłata {{amount}} za zamówienie #{{order}} została zwolniona.",
            ["pt"] = "O teu pagamento de {{amount}} pela encomenda #{{order}} foi libertado."
        };

    public static string For(string? locale) =>
        Messages.TryGetValue(Normalize(locale), out var message) ? message : Messages["en"];

    private static string Normalize(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale)) return "en";
        var normalized = locale.Trim().Replace('_', '-').ToLowerInvariant();
        var separator = normalized.IndexOf('-');
        return separator > 0 ? normalized[..separator] : normalized;
    }
}
