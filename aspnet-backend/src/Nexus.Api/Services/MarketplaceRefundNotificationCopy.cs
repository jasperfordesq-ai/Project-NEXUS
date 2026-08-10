// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

internal sealed record MarketplaceRefundNotificationText(
    string Subject,
    string Title,
    string Body,
    string Reason);

internal static class MarketplaceRefundNotificationCopy
{
    private const string FullBuyerSubject = "Refund processed — Order {{order_number}}";
    private const string FullBuyerTitle = "Refund Processed";
    private const string FullBuyerBody = "Your refund of <strong>{{amount}}</strong> for order <strong>{{order_number}}</strong> ('{{title}}') has been processed. It may take 5–10 business days to appear on your statement.";
    private const string FullSellerSubject = "Refund issued — Order {{order_number}}";
    private const string FullSellerTitle = "Refund Issued";
    private const string FullSellerBody = "A refund of <strong>{{amount}}</strong> has been issued for order <strong>{{order_number}}</strong> ('{{title}}'). Reason: {{reason}}";
    private const string PartialBuyerSubject = "Partial refund processed — {{order_number}}";
    private const string PartialBuyerTitle = "Partial Refund Processed";
    private const string PartialBuyerBody = "A partial refund of <strong>{{amount}} {{currency}}</strong> has been processed for your order <strong>{{order_number}}</strong>. The funds will be returned to your original payment method within 5–10 business days.";

    private static readonly IReadOnlyDictionary<string, MarketplaceRefundNotificationText> PartialSeller =
        new Dictionary<string, MarketplaceRefundNotificationText>(StringComparer.OrdinalIgnoreCase)
        {
            ["ar"] = new("\u062a\u0645 \u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u062c\u0632\u0626\u064a - \u0627\u0637\u0644\u0628 {{order_number}}", "\u062a\u0645 \u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u062c\u0632\u0626\u064a", "\u062a\u0645 \u0625\u0635\u062f\u0627\u0631 \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u062c\u0632\u0626\u064a \u0628\u0642\u064a\u0645\u0629 <strong>{{amount}}</strong> \u0644\u0644\u0637\u0644\u0628 <strong>{{order_number}}</strong> ('{{title}}'). \u0627\u0644\u0633\u0628\u0628: {{reason}}", "\u062e\u0637\u0627\u0641 \u0648\u064a\u0628 \u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0623\u0645\u0648\u0627\u0644 Stripe"),
            ["en"] = new("Partial refund issued — Order {{order_number}}", "Partial Refund Issued", "A partial refund of <strong>{{amount}}</strong> has been issued for order <strong>{{order_number}}</strong> ('{{title}}'). Reason: {{reason}}", "Stripe refund webhook"),
            ["de"] = new("Teilweise Rückerstattung ausgestellt – {{order_number}} bestellen", "Teilweise Rückerstattung ausgestellt", "Für die Bestellung <strong>{{order_number}}</strong> („{{title}}“) wurde eine teilweise Rückerstattung von <strong>{{amount}}</strong> ausgestellt. Grund: {{reason}}", "Stripe-Rückerstattungs-Webhook"),
            ["es"] = new("Reembolso parcial emitido: pedido {{order_number}}", "Reembolso parcial emitido", "Se ha emitido un reembolso parcial de <strong>{{amount}}</strong> para el pedido <strong>{{order_number}}</strong> ('{{title}}'). Razón: {{reason}}", "Webhook de reembolso Stripe"),
            ["fr"] = new("Remboursement partiel émis — Commande {{order_number}}", "Remboursement partiel émis", "Un remboursement partiel de <strong>{{amount}}</strong> a été émis pour la commande <strong>{{order_number}}</strong> (« {{title}} »). Raison : {{reason}}", "Webhook de remboursement Stripe"),
            ["ga"] = new("Aisíocaíocht pháirteach eisithe — Ordú {{order_number}}", "Aisíocaíocht Pháirteach Eisithe", "Tá aisíocaíocht pháirteach de <strong>{{amount}}</strong> eisithe le haghaidh ordú <strong>{{order_number}}</strong> ('{{title}}'). Cúis: {{reason}}", "Aisíocán gréasáin aisíocaíocht Stripe"),
            ["it"] = new("Rimborso parziale emesso: ordine {{order_number}}", "Rimborso parziale emesso", "È stato emesso un rimborso parziale di <strong>{{amount}}</strong> per l'ordine <strong>{{order_number}}</strong> (\"{{title}}\"). Motivo: {{reason}}", "Webhook di rimborso Stripe"),
            ["ja"] = new("\u4e00\u90e8\u8fd4\u91d1\u304c\u884c\u308f\u308c\u307e\u3057\u305f \u2014 {{order_number}} \u3092\u6ce8\u6587", "\u4e00\u90e8\u8fd4\u91d1\u6e08\u307f", "\u6ce8\u6587 <strong>{{order_number}}</strong> ('{{title}}') \u306b\u5bfe\u3057\u3066\u3001<strong>{{amount}}</strong> \u306e\u4e00\u90e8\u8fd4\u91d1\u304c\u884c\u308f\u308c\u307e\u3057\u305f\u3002\u7406\u7531: {{reason}}", "Stripe \u8fd4\u91d1 Webhook"),
            ["nl"] = new("Gedeeltelijke terugbetaling uitgevoerd — Bestel {{order_number}}", "Gedeeltelijke terugbetaling verleend", "Er is een gedeeltelijke terugbetaling van <strong>{{amount}}</strong> uitgevoerd voor bestelling <strong>{{order_number}}</strong> ('{{title}}'). Reden: {{reason}}", "Stripe-webhook voor terugbetaling"),
            ["pl"] = new("Wydano częściowy zwrot pieniędzy — Zamówienie {{order_number}}", "Wydano częściowy zwrot pieniędzy", "Częściowy zwrot kwoty <strong>{{amount}}</strong> został przyznany za zamówienie <strong>{{order_number}}</strong> („{{title}}”). Powód: {{reason}}", "Webhook zwrotów Stripe"),
            ["pt"] = new("Reembolso parcial emitido — Pedido {{order_number}}", "Reembolso parcial emitido", "Um reembolso parcial de <strong>{{amount}}</strong> foi emitido para o pedido <strong>{{order_number}}</strong> ('{{title}}'). Razão: {{reason}}", "Webhook de reembolso Stripe")
        };

    public static MarketplaceRefundNotificationText For(string? language, bool buyer, bool full)
    {
        if (full)
            return buyer
                ? new(FullBuyerSubject, FullBuyerTitle, FullBuyerBody, "Stripe refund webhook")
                : new(FullSellerSubject, FullSellerTitle, FullSellerBody, "Stripe refund webhook");
        if (buyer)
            return new(PartialBuyerSubject, PartialBuyerTitle, PartialBuyerBody, "Stripe refund webhook");
        var locale = string.IsNullOrWhiteSpace(language) ? "en" : language.Split('-', '_')[0];
        return PartialSeller.TryGetValue(locale, out var copy) ? copy : PartialSeller["en"];
    }
}
