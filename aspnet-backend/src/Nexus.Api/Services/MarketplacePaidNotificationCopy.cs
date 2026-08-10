// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Services;

internal sealed record MarketplacePaidNotificationText(
    string BuyerBell,
    string SellerBell,
    string BuyerSubject,
    string BuyerTitle,
    string BuyerBody,
    string SellerSubject,
    string SellerTitle,
    string SellerBody);

internal static class MarketplacePaidNotificationCopy
{
    private static readonly IReadOnlyDictionary<string, MarketplacePaidNotificationText> Copy =
        new Dictionary<string, MarketplacePaidNotificationText>(StringComparer.OrdinalIgnoreCase)
        {
            ["ar"] = new(
                "تم استلام الدفعة للطلب #{{order_number}}: {{amount}}",
                "تم دفع الطلب #{{order_number}}: {{amount}}",
                "تم استلام الدفعة — {{order_number}}", "تم استلام الدفع",
                "لقد تم استلام دفعتك بقيمة <strong>{{amount}}</strong> للطلب <strong>{{order_number}}</strong> (<strong>{{title}}</strong>).",
                "الطلب مدفوع — {{order_number}}", "الطلب مدفوع",
                "تم استلام مبلغ <strong>{{amount}}</strong> للطلب <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). يمكنك الآن تحضير الطلب."),
            ["de"] = new(
                "Zahlungseingang für Bestellung #{{order_number}}: {{amount}}",
                "Bestellung Nr. {{order_number}} wurde bezahlt: {{amount}}",
                "Zahlung erhalten – {{order_number}}", "Zahlung erhalten",
                "Ihre Zahlung von <strong>{{amount}}</strong> für die Bestellung <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) ist eingegangen.",
                "Bestellung bezahlt – {{order_number}}", "Bestellung bezahlt",
                "Die Zahlung von <strong>{{amount}}</strong> für die Bestellung <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) ist eingegangen. Sie können nun die Bestellung vorbereiten."),
            ["en"] = new(
                "Payment received for order #{{order_number}}: {{amount}}",
                "Order #{{order_number}} has been paid: {{amount}}",
                "Payment received — {{order_number}}", "Payment Received",
                "Your payment of <strong>{{amount}}</strong> for order <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) has been received.",
                "Order paid — {{order_number}}", "Order Paid",
                "Payment of <strong>{{amount}}</strong> has been received for order <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). You can now prepare the order."),
            ["es"] = new(
                "Pago recibido por el pedido #{{order_number}}: {{amount}}",
                "Se ha pagado el pedido #{{order_number}}: {{amount}}",
                "Pago recibido — {{order_number}}", "Pago recibido",
                "Se ha recibido su pago de <strong>{{amount}}</strong> para el pedido <strong>{{order_number}}</strong> (<strong>{{title}}</strong>).",
                "Orden pagada — {{order_number}}", "Orden Pagada",
                "Se ha recibido el pago de <strong>{{amount}}</strong> para el pedido <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). Ya puedes preparar el pedido."),
            ["fr"] = new(
                "Paiement reçu pour la commande #{{order_number}} : {{amount}}",
                "La commande #{{order_number}} a été payée : {{amount}}",
                "Paiement reçu — {{order_number}}", "Paiement reçu",
                "Votre paiement de <strong>{{amount}}</strong> pour la commande <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) a été reçu.",
                "Commande payée — {{order_number}}", "Commande payée",
                "Le paiement de <strong>{{amount}}</strong> a été reçu pour la commande <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). Vous pouvez maintenant préparer la commande."),
            ["ga"] = new(
                "Íocaíocht faighte le haghaidh ordú #{{order_number}}: {{amount}}",
                "Tá ordú #{{order_number}} íoctha: {{amount}}",
                "Íocaíocht faighte — {{order_number}}", "Íocaíocht Faighte",
                "Fuarthas d'íocaíocht <strong>{{amount}}</strong> le haghaidh ordú <strong>{{order_number}}</strong> (<strong>{{title}}</strong>).",
                "Ordú íoctha — {{order_number}}", "Ordú Íoctha",
                "Tá íocaíocht <strong>{{amount}}</strong> faighte ar ordú <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). Is féidir leat an t-ordú a ullmhú anois."),
            ["it"] = new(
                "Pagamento ricevuto per l'ordine n. {{order_number}}: {{amount}}",
                "L'ordine n.{{order_number}} è stato pagato: {{amount}}",
                "Pagamento ricevuto — {{order_number}}", "Pagamento ricevuto",
                "Il pagamento di <strong>{{amount}}</strong> per l'ordine <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) è stato ricevuto.",
                "Ordine pagato — {{order_number}}", "Ordine pagato",
                "Il pagamento di <strong>{{amount}}</strong> è stato ricevuto per l'ordine <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). Ora puoi preparare l'ordine."),
            ["ja"] = new(
                "注文 #{{order_number}} に対する支払いを受け取りました: {{amount}}",
                "注文 #{{order_number}} が支払われました: {{amount}}",
                "支払いを受領しました — {{order_number}}", "支払いを受領しました",
                "注文 <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) に対する <strong>{{amount}}</strong> の支払いが受領されました。",
                "注文が支払われました — {{order_number}}", "支払い済みの注文",
                "注文 <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) に対する <strong>{{amount}}</strong> の支払いを受領しました。これで注文の準備ができます。"),
            ["nl"] = new(
                "Betaling ontvangen voor bestelling #{{order_number}}: {{amount}}",
                "Bestelling #{{order_number}} is betaald: {{amount}}",
                "Betaling ontvangen — {{order_number}}", "Betaling ontvangen",
                "Uw betaling van <strong>{{amount}}</strong> voor bestelling <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) is ontvangen.",
                "Bestelling betaald — {{order_number}}", "Bestelling betaald",
                "De betaling van <strong>{{amount}}</strong> is ontvangen voor bestelling <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). U kunt nu de bestelling klaarmaken."),
            ["pl"] = new(
                "Otrzymano płatność za zamówienie #{{order_number}}: {{amount}}",
                "Zamówienie #{{order_number}} zostało opłacone: {{amount}}",
                "Płatność otrzymana — {{order_number}}", "Otrzymano płatność",
                "Twoja płatność w wysokości <strong>{{amount}}</strong> za zamówienie <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) została otrzymana.",
                "Zamówienie opłacone — {{order_number}}", "Zamówienie opłacone",
                "Otrzymano płatność w wysokości <strong>{{amount}}</strong> za zamówienie <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). Możesz już przygotować zamówienie."),
            ["pt"] = new(
                "Pagamento recebido pelo pedido #{{order_number}}: {{amount}}",
                "O pedido #{{order_number}} foi pago: {{amount}}",
                "Pagamento recebido — {{order_number}}", "Pagamento recebido",
                "Seu pagamento de <strong>{{amount}}</strong> pelo pedido <strong>{{order_number}}</strong> (<strong>{{title}}</strong>) foi recebido.",
                "Pedido pago — {{order_number}}", "Pedido pago",
                "O pagamento de <strong>{{amount}}</strong> foi recebido para o pedido <strong>{{order_number}}</strong> (<strong>{{title}}</strong>). Agora você pode preparar o pedido.")
        };

    public static MarketplacePaidNotificationText For(string? locale)
    {
        var normalized = string.IsNullOrWhiteSpace(locale)
            ? "en"
            : locale.Trim().Split('-', '_')[0].ToLowerInvariant();
        return Copy.TryGetValue(normalized, out var text) ? text : Copy["en"];
    }
}
