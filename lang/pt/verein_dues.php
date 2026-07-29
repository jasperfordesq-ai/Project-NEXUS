<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'O valor da taxa deve ser maior que zero.',
        'invalid_billing_cycle' => 'O ciclo de faturamento deve ser: anual, bienal, mensal.',
        'fee_not_configured' => 'Nenhuma taxa de adesão ativa está configurada para este Verein.',
        'organization_not_found' => 'Verein não encontrado.',
        'organization_not_club' => 'Esta organização não é uma Verein.',
        'organization_required' => 'Organization_id é obrigatório.',
        'dues_not_found' => 'Registro de quotas de associados não encontrado.',
        'cannot_waive_paid' => 'Não é possível renunciar a uma linha de quotas que já foi paga.',
        'cannot_remind_status' => 'Lembretes só podem ser enviados para dívidas pendentes ou vencidas.',
        'cannot_pay_status' => 'Esta linha de quotas não está em estado de pagamento.',
        'payment_intent_failed' => 'Não foi possível iniciar o processo de pagamento. Por favor, tente novamente mais tarde.',
        'waive_reason_required' => 'É necessário um motivo de renúncia.',
    ],
];
