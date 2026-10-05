<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Escolha um dos cinco tipos de troca de grupo.',
        'no_givers' => 'Adicione pelo menos uma pessoa que dá tempo.',
        'no_receivers' => 'Adicione pelo menos uma pessoa que recebe tempo.',
        'hours_missing' => 'Indique para cada pessoa um número de horas superior a zero.',
        'earned_exceeds_paid' => 'As pessoas que dão tempo ganhariam :earned horas, mas quem participa pagaria apenas :paid. Num workshop ou aula, cada participante paga o tempo que recebe, por isso tem de pagar pelo menos o que é ganho. Se várias pessoas dão o seu tempo a uma só pessoa, escolha antes «Uma equipa ajuda alguém».',
        'unbalanced' => 'As horas ganhas (:earned) têm de ser iguais às horas pagas (:paid). Altere alguns números para que coincidam.',
        'too_many_participants' => 'Uma troca de grupo pode ter no máximo :max pessoas.',
    ],
    'ledger' => [
        'to_fund' => 'Troca de grupo «:title» — horas restantes para o Fundo Comunitário',
    ],
    'fund' => [
        'description' => 'Horas restantes da troca de grupo «:title»',
    ],
];
