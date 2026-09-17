<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\EmailService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class SalesOrderController extends BaseApiController
{
    protected bool $isV2Api = true;

    private const RECIPIENT_EMAIL = 'jasper.ford.esq@gmail.com';

    public function submit(Request $request, EmailService $emailService): JsonResponse
    {
        if (trim((string) $request->input('website', '')) !== '') {
            return $this->receivedResponse($this->generateReference());
        }

        $validator = Validator::make($request->all(), [
            'contact_name' => ['required', 'string', 'min:2', 'max:160'],
            'organisation' => ['nullable', 'string', 'max:180'],
            'email' => ['required', 'email:rfc', 'max:255'],
            'region' => ['nullable', 'string', 'max:160'],
            'note' => ['nullable', 'string', 'max:5000'],
            'page_url' => ['nullable', 'string', 'max:2048'],
            // Optional, so the sales site's public pages can send a plain "tell us about your
            // community" enquiry with no quote builder involved. When a quote IS sent it must be
            // complete: a half-filled quote would put a half-priced estimate in the enquiry email.
            'quote' => ['nullable', 'array'],
            'quote.product_line_label' => ['required_with:quote', 'string', 'max:120'],
            'quote.plan_name' => ['required_with:quote', 'string', 'max:120'],
            'quote.active_member_label' => ['required_with:quote', 'string', 'max:160'],
            'quote.billing_cycle' => ['required_with:quote', 'string', 'in:monthly,annual'],
            'quote.pricing_mode' => ['required_with:quote', 'string', 'in:published,custom'],
            'quote.monthly_recurring_label' => ['required_with:quote', 'string', 'max:80'],
            'quote.annual_recurring_label' => ['required_with:quote', 'string', 'max:80'],
            'quote.annual_savings_label' => ['required_with:quote', 'string', 'max:80'],
            'quote.one_off_label' => ['required_with:quote', 'string', 'max:80'],
            'quote.first_year_label' => ['required_with:quote', 'string', 'max:80'],
            'quote.line_items' => ['nullable', 'array', 'max:60'],
            'quote.line_items.*.label' => ['required_with:quote.line_items', 'string', 'max:180'],
            'quote.line_items.*.amount_label' => ['required_with:quote.line_items', 'string', 'max:80'],
            'quote.line_items.*.quantity' => ['nullable', 'integer', 'min:1', 'max:999'],
            'quote.line_items.*.cadence' => ['required_with:quote.line_items', 'string', 'in:monthly,one-off'],
        ]);

        if ($validator->fails()) {
            $errors = [];
            foreach ($validator->errors()->messages() as $field => $messages) {
                $errors[] = [
                    'code' => 'VALIDATION_FAILED',
                    'message' => (string) ($messages[0] ?? 'The order enquiry could not be sent.'),
                    'field' => $field,
                ];
            }

            return $this->respondWithErrors($errors, 422);
        }

        $validated = $validator->validated();
        $reference = $this->generateReference();
        $subject = $this->buildSubject($validated, $reference);
        $body = $this->renderOrderEmail($validated, $reference, $request);
        $replyTo = $this->formatReplyTo((string) $validated['contact_name'], (string) $validated['email']);

        $sent = $emailService->send(self::RECIPIENT_EMAIL, $subject, $body, [
            'replyTo' => $replyTo,
            'category' => 'billing',
            'source' => self::class . '::submit',
            'tenant_id' => null,
            'allow_missing_tenant' => true,
            'idempotency_key' => $reference,
        ]);

        if (!$sent) {
            Log::warning('Sales order enquiry email failed', [
                'reference' => $reference,
                'recipient' => self::RECIPIENT_EMAIL,
            ]);

            return $this->respondWithError(
                'SALES_ORDER_SEND_FAILED',
                'We could not send the order enquiry. Please try again or email jasper.ford.esq@gmail.com.',
                null,
                502
            );
        }

        return $this->receivedResponse($reference);
    }

    private function receivedResponse(string $reference): JsonResponse
    {
        return $this->respondWithData([
            'status' => 'received',
            'reference' => $reference,
            'message' => __('api.sales_order_received'),
        ], null, 201);
    }

    /**
     * @param array<string,mixed> $data
     */
    private function buildSubject(array $data, string $reference): string
    {
        $organisation = trim((string) ($data['organisation'] ?? ''));
        $contact = trim((string) ($data['contact_name'] ?? ''));
        $name = $organisation !== '' ? $organisation : $contact;
        $plan = trim((string) data_get($data, 'quote.plan_name', ''));

        // Two subjects, so a priced order enquiry and a general one are told apart in the inbox.
        $subject = $plan !== ''
            ? "Project NEXUS order enquiry {$reference} - {$name} - {$plan}"
            : "Project NEXUS enquiry {$reference} - {$name}";

        return Str::limit($subject, 180, '');
    }

    /**
     * @param array<string,mixed> $data
     */
    private function renderOrderEmail(array $data, string $reference, Request $request): string
    {
        $quote = is_array($data['quote'] ?? null) ? $data['quote'] : [];
        $hasQuote = $quote !== [];
        $lineItems = is_array($quote['line_items'] ?? null) ? $quote['line_items'] : [];
        $submittedAt = now()->toDateTimeString();

        $contactRows = [
            ['Reference', $reference],
            ['Submitted at', $submittedAt],
            ['Contact', (string) $data['contact_name']],
            ['Organisation', (string) ($data['organisation'] ?? '')],
            ['Email', (string) $data['email']],
            ['Region', (string) ($data['region'] ?? '')],
        ];

        // Only rendered when a quote came with the enquiry. A general enquiry showed these as a
        // column of dashes, which reads like the quote failed to save rather than never existing.
        $quoteRows = $hasQuote ? [
            ['Product line', (string) ($quote['product_line_label'] ?? '')],
            ['Recommended plan', (string) ($quote['plan_name'] ?? '')],
            ['Capacity', (string) ($quote['active_member_label'] ?? '')],
            ['Billing preference', (string) ($quote['billing_cycle'] ?? '')],
            ['Pricing mode', (string) ($quote['pricing_mode'] ?? '')],
            ['Monthly recurring', (string) ($quote['monthly_recurring_label'] ?? '')],
            ['Annual recurring', (string) ($quote['annual_recurring_label'] ?? '')],
            ['Annual saving', (string) ($quote['annual_savings_label'] ?? '')],
            ['One-off total', (string) ($quote['one_off_label'] ?? '')],
            ['First-year estimate', (string) ($quote['first_year_label'] ?? '')],
        ] : [
            ['Quote', 'No quote attached - general enquiry from the sales site.'],
        ];

        $rows = [
            ...$contactRows,
            ...$quoteRows,
            ['Page URL', (string) ($data['page_url'] ?? '')],
            ['IP', (string) $request->ip()],
            ['User agent', Str::limit((string) $request->userAgent(), 500, '')],
        ];

        $summaryRows = array_map(
            fn (array $row): string => '<tr><th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#475569;width:220px;">' . $this->escape($row[0]) . '</th><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#0f172a;">' . $this->escape($row[1] !== '' ? $row[1] : '-') . '</td></tr>',
            $rows
        );

        $lineItemRows = array_map(function (array $item): string {
            $quantity = (int) ($item['quantity'] ?? 1);
            return '<tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">' . $this->escape((string) ($item['label'] ?? '')) . '</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">' . $this->escape((string) ($item['cadence'] ?? '')) . '</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">' . $quantity . '</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;">' . $this->escape((string) ($item['amount_label'] ?? '')) . '</td></tr>';
        }, $lineItems);

        $lineItemsHtml = $lineItemRows !== []
            ? implode('', $lineItemRows)
            : '<tr><td colspan="4" style="padding:10px 12px;color:#64748b;">No paid line items selected.</td></tr>';

        return '<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Inter,Arial,sans-serif;color:#0f172a;">'
            . '<div style="max-width:760px;margin:0 auto;padding:28px;">'
            . '<div style="background:#0b1220;color:#fff;border-radius:16px;padding:24px 28px;margin-bottom:20px;">'
            . '<p style="margin:0 0 8px;color:#38bdf8;font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;">' . ($hasQuote ? 'Project NEXUS sales order enquiry' : 'Project NEXUS sales enquiry') . '</p>'
            . '<h1 style="margin:0;font-size:28px;line-height:1.15;">' . $this->escape($reference) . '</h1>'
            . '<p style="margin:12px 0 0;color:#cbd5e1;">' . ($hasQuote ? 'A new pricing/order enquiry was submitted from the sales site.' : 'A new enquiry was submitted from the sales site. Reply to this email to answer the sender directly.') . '</p>'
            . '</div>'
            . '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin-bottom:20px;">'
            . '<table role="presentation" style="width:100%;border-collapse:collapse;">' . implode('', $summaryRows) . '</table>'
            . '</div>'
            . ($hasQuote
                ? '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin-bottom:20px;">'
                    . '<div style="padding:16px 18px;border-bottom:1px solid #e5e7eb;"><strong>Selected quote line items</strong></div>'
                    . '<table role="presentation" style="width:100%;border-collapse:collapse;">'
                    . '<thead><tr><th style="text-align:left;padding:10px 12px;background:#f1f5f9;">Item</th><th style="text-align:left;padding:10px 12px;background:#f1f5f9;">Cadence</th><th style="text-align:left;padding:10px 12px;background:#f1f5f9;">Qty</th><th style="text-align:left;padding:10px 12px;background:#f1f5f9;">Amount</th></tr></thead>'
                    . '<tbody>' . $lineItemsHtml . '</tbody></table></div>'
                : '')
            . '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;">'
            . '<strong>Notes</strong><p style="white-space:pre-wrap;line-height:1.6;color:#334155;">' . $this->escape((string) ($data['note'] ?? 'No extra notes added.')) . '</p>'
            . '</div></div></body></html>';
    }

    private function formatReplyTo(string $name, string $email): string
    {
        $safeName = trim((string) preg_replace('/[\r\n<>"]+/', ' ', $name));

        return $safeName !== '' ? "{$safeName} <{$email}>" : $email;
    }

    private function generateReference(): string
    {
        return 'NXSO-' . now()->format('ymd') . '-' . Str::upper(Str::random(6));
    }

    private function escape(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
