<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Esta conversa está pausada por uma regra de proteção da comunidade. A sua comunidade deve ter registado uma confirmação atual do estado :types antes de poder enviar mensagens a este membro. Peça à pessoa mediadora ou à equipa de administração da comunidade que registe este estado apenas como metadados. Não envie nem carregue qualquer documento de verificação.',
        'vetting_required_title' => 'Verificacao de protecao necessaria',
        'vetting_required_detail' => 'Este membro só pode ser contactado para este tipo de interação por pessoas cuja comunidade tenha registado um estado :types atual. O registo contém apenas metadados; não deve ser enviado nem carregado qualquer documento.',
        'vetting_required_action' => 'Abrir ajuda',
        'contact_restricted' => 'Este membro pediu que um coordenador organize o contacto em seu nome. A tua mensagem nao foi enviada. Contacta o teu broker ou administrador da comunidade para organizar o proximo passo seguro.',
        'contact_restricted_title' => 'E necessario acordo com coordenador',
        'contact_restricted_detail' => 'Este membro não está disponível para mensagens diretas porque as suas preferências de salvaguarda requerem que o contacto seja mediado por um coordenador. Pode pedir a um coordenador que ajude a organizar o contacto.',
        'contact_restricted_action' => 'Abrir ajuda',
        'coordination_not_required' => 'O contacto direto com este membro está atualmente disponível — não necessita de um coordenador para o organizar. Por favor, atualize a página e tente enviar uma mensagem novamente.',
        'coordination_request_failed' => 'Não foi possível enviar o seu pedido ao coordenador neste momento. Por favor, tente novamente em breve.',
        'vetting_check_failed' => 'Não foi possível confirmar o seu estado de verificação neste momento. Por favor, tente novamente em breve.',
        'statement_required' => 'É necessário um PDF da Declaração de Proteção à Criança antes de você declarar que esta comunidade trabalha com crianças ou adultos vulneráveis. Faça upload de um para continuar.',
        'invalid_file' => 'O arquivo enviado não pôde ser lido. Tente novamente com um PDF válido.',
        'pdf_required' => 'A declaração de salvaguarda deve ser um arquivo PDF.',
        'file_too_large' => 'O arquivo da declaração de salvaguarda é muito grande. O tamanho máximo é 10MB.',
        'storage_failed' => 'Não foi possível salvar o arquivo enviado. Por favor, tente novamente.',
        'statement_missing' => 'Nenhuma declaração de salvaguarda está arquivada para esta comunidade.',
        'file_missing' => 'O arquivo da instrução de salvaguarda não foi encontrado no servidor. Faça upload novamente.',
        'revoke_failed' => 'Não poderíamos revogar essa preferência. Pode já ter sido revogado.',
        'policy_unavailable' => 'Não podemos confirmar a política de salvaguarda da comunidade neste momento. Nenhuma mensagem foi enviada. Por favor, tente novamente em breve.',
        'interaction_not_allowed' => 'A política de salvaguarda da comunidade do destinatário não permite esta interação direta. Peça ajuda a um coordenador.',
        'policy_unavailable_title' => 'Verificação de proteção temporariamente indisponível',
        'policy_unavailable_detail' => 'O Projeto NEXUS não conseguiu avaliar com segurança a política de contato, portanto esta interação foi pausada.',
        'policy_unavailable_action' => 'Verifique novamente',
        'listing_role_confirmation_required' => 'Esta listagem requer uma decisão separada de DBS Avançado confirmada pela comunidade para esta função. Uma confirmação de contato do mensageiro não atende aos requisitos de proteção específicos da função.',
        'listing_role_feature_unavailable' => 'A verificação de antecedentes criminais específica da função ainda não pode ser habilitada aqui. A confirmação de contato do Messenger não é reutilizada deliberadamente como liberação de função.',
        'compliance_policy_unavailable' => 'Não podemos confirmar com segurança os requisitos de proteção para esta listagem neste momento. Tente novamente mais tarde ou entre em contato com seu corretor.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS Básico',
        'dbs_standard' => 'Padrão DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Verificação da polícia',
        'access_ni' => 'AcessoNI',
        'pvg_scotland' => 'PVG Escócia',
        'international' => 'Verificação de antecedentes internacionais',
        'other' => 'Outra verificação de verificação',
        'uk_safeguarding_clearance' => 'Autorização de salvaguarda do Reino Unido',
    ],
    'jurisdictions' => [
        'unconfigured' => 'A jurisdição de salvaguarda não está configurada',
        'united_kingdom' => 'United Kingdom ? national policy package',
        'england_wales' => 'Inglaterra e País de Gales',
        'scotland' => 'Escócia',
        'northern_ireland' => 'Irlanda do Norte',
        'ireland' => 'República da Irlanda',
        'custom' => 'Jurisdição personalizada',
    ],
    'attestations' => [
        'dbs_enhanced' => 'DBS aprimorado confirmado para contato protegido dos membros',
        'pvg_scotland' => 'Status PVG confirmado para contato protegido de membros',
        'access_ni' => 'Status do AccessNI confirmado para contato protegido de membros',
        'garda_vetting' => 'Garda Vetting confirmada para contato protegido de membros',
        'uk_safeguarding_clearance' => 'Autorização de salvaguarda do Reino Unido confirmada para contato de membro protegido',
    ],
    'confirmation' => [
        'title' => 'Suas preferências de proteção foram salvas',
        'intro' => 'Obrigado por compartilhar isso. Aqui está um resumo do que você escolheu, quem pode ver e o que é ativado como resultado.',
        'your_selections' => 'Suas seleções',
        'no_selections' => 'Você não selecionou nenhuma opção de proteção.',
        'who_can_see_heading' => 'Quem pode ver isso',
        'who_can_see_body' => 'Somente os coordenadores e administradores da comunidade podem ver essas preferências. Outros membros não podem. Todos os acessos são registrados.',
        'what_activates_heading' => 'O que é ativado como resultado',
        'activation_broker_review' => 'Um coordenador analisará e aprovará correspondências ou trocas protegidas quando sua preferência selecionada assim o exigir. Isso não lhes dá acesso ao conteúdo da mensagem.',
        'activation_match_approval' => 'Um coordenador aprovará partidas envolvendo você antes de serem sugeridas ao outro membro.',
        'activation_discovery_hidden' => 'Você ficará oculto para membros que não concluíram a verificação exigida.',
        'activation_notification' => 'Um coordenador foi notificado e entrará em contato para discutir como podemos ajudar.',
        'activation_none' => 'Nenhuma proteção automática é ativada nessas seleções. Suas preferências são registradas para conhecimento do coordenador.',
        'revoke_heading' => 'Como alterá-los ou revogá-los a qualquer momento',
        'revoke_body' => 'Você pode revisar ou revogar qualquer uma dessas preferências a qualquer momento nas configurações do seu perfil. Você não precisa pedir a um administrador para fazer isso.',
        'revoke_cta' => 'Vá para as configurações de proteção',
        'continue_cta' => 'Continuar',
    ],
    'settings' => [
        'page_title' => 'Salvaguardando preferências',
        'intro' => 'Revise ou revogue as preferências de proteção definidas durante a integração. Seus coordenadores podem ver isso, mas outros membros não.',
        'no_preferences' => 'Você não tem preferências de proteção ativas. Você pode defini-los a qualquer momento na página de ajuda de proteção.',
        'selected_on' => 'Selecionado em :date',
        'revoke_button' => 'Revogar',
        'revoke_confirm_title' => 'Revogar esta preferência?',
        'revoke_confirm_body' => 'Esta preferência não se aplicará mais à sua conta. Seus coordenadores serão notificados da mudança.',
        'revoke_confirm_yes' => 'Sim, revogar',
        'revoke_confirm_no' => 'Mantenha-o',
        'revoked_toast' => 'Preferência revogada.',
        'revoke_error_toast' => 'Algo deu errado. Por favor, tente novamente.',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Esta comunidade leva a proteção a sério. Se se considera uma pessoa adulta vulnerável ou precisa de apoio adicional, informe-nos para que a nossa equipa de coordenação possa ajudar a organizar trocas seguras.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Considero-me uma pessoa adulta vulnerável e posso precisar de apoio adicional de proteção',
                    'description' => 'Isto permite que a nossa equipa de coordenação saiba que poderá precisar de apoio adicional ao organizar trocas. Uma pessoa coordenadora entrará em contacto para falar sobre como podemos ajudar. Estas informações são confidenciais.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Preferia interagir apenas com membros que tenham sido devidamente verificados',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Gostaria que uma pessoa coordenadora me ajudasse a organizar as minhas trocas em vez de ser contactado diretamente',
                    'description' => 'Uma pessoa coordenadora fará a mediação de todos os contactos e ajudará a organizar as trocas em seu nome. Os outros membros não poderão enviar-lhe mensagens diretamente.',
                ],
                'no_home_visits' => [
                    'label' => 'Não quero que membros visitem a minha casa sem organização por uma pessoa coordenadora',
                    'description' => 'Todas as visitas domiciliárias serão organizadas através de uma pessoa coordenadora que possa garantir a existência de medidas de proteção adequadas.',
                ],
                'works_with_children' => [
                    'label' => 'Planeio oferecer serviços que possam envolver crianças ou jovens (com menos de 18 anos)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planeio oferecer serviços que possam envolver pessoas adultas vulneráveis',
                ],
                'none_apply' => [
                    'label' => 'Nenhuma destas situações se aplica a mim',
                    'description' => 'Revi as opções acima e nenhuma se aplica à minha situação. Isto fica registado para que a equipa de coordenação saiba que vi e considerei este passo.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irlanda',
            'vetting_authority' => 'Gabinete Nacional de Verificação',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Na Irlanda, isto significa membros com Garda Vetting. A nossa equipa de coordenação garantirá que apenas seja associado a membros verificados.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Uma pessoa coordenadora (intermediária) fará a mediação de todos os contactos e ajudará a organizar as trocas em seu nome. Os outros membros não poderão enviar-lhe mensagens diretamente.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre os requisitos da Garda Vetting. Na Irlanda, determinadas atividades que envolvem crianças exigem verificação ao abrigo da Lei do Gabinete Nacional de Verificação de 2012.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre os requisitos da Garda Vetting. As atividades que envolvem pessoas adultas vulneráveis podem exigir verificação.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Reino Unido',
            'vetting_authority' => 'DBS, Disclosure Scotland e AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Em todo o Reino Unido, os coordenadores confirmam a base apropriada de DBS Aprimorado, PVG e/ou AccessNI para contato protegido.',
                ],
                'works_with_children' => [
                    'description' => 'Um coordenador avaliará a função e a jurisdição aplicável no Reino Unido antes de decidir qual verificação de salvaguarda é legalmente apropriada.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Um coordenador avaliará a função, os adultos envolvidos e a jurisdição aplicável no Reino Unido antes de decidir qual verificação de salvaguarda é legalmente apropriada.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Inglaterra e País de Gales',
            'vetting_authority' => 'Serviço de Divulgação e Impedimento',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Em Inglaterra e no País de Gales, isto significa membros com verificação DBS. A nossa equipa de coordenação garantirá que apenas seja associado a membros verificados.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre os requisitos da verificação DBS.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Escócia',
            'vetting_authority' => 'Disclosure Scotland (regime PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Considero-me uma pessoa adulta vulnerável ou protegida e posso precisar de apoio adicional de proteção',
                ],
                'requires_vetted_partners' => [
                    'description' => 'Na Escócia, isto significa membros do regime PVG. A nossa equipa de coordenação garantirá que apenas seja associado a membros verificados.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre a adesão ao regime PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planeio oferecer serviços que possam envolver pessoas adultas protegidas',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlanda do Norte',
            'vetting_authority' => 'AcessoNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Na Irlanda do Norte, isto significa membros com verificação AccessNI. A nossa equipa de coordenação garantirá que apenas seja associado a membros verificados.',
                ],
                'works_with_children' => [
                    'description' => 'Uma pessoa coordenadora poderá falar consigo sobre a verificação AccessNI.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Personalizado',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'A sua comunidade mudou a sua jurisdição de salvaguarda. Sua proteção existente permanece ativa, mas revise o texto atualizado em Configurações.',
        'jurisdiction_changed_staff' => 'A jurisdição de salvaguarda mudou. As proteções dos membros afetados permanecem ativas e agora exigem revisão dos membros.',
        'attestation_policy_rotated_member' => 'Sua comunidade iniciou uma revisão da política de proteção. Seu corretor deve reconfirmar seu status de contato privado; isso não é uma expiração de certificado.',
        'reminder_subject' => 'Revise suas preferências de proteção',
        'reminder_title' => 'É hora de revisar suas preferências de proteção',
        'reminder_body' => 'Já se passou mais de um ano desde que você definiu suas preferências de proteção para :community. Reserve um momento para revisá-los e confirmar se eles ainda se aplicam ou revogue aqueles que não se aplicam mais.',
        'reminder_cta' => 'Revise as preferências',
        'escalation_subject' => 'Revisão de proteção de membros pendente',
        'escalation_title' => 'Revisão anual de salvaguarda pendente',
        'escalation_body' => ':name não respondeu a uma solicitação para revisar suas preferências de proteção há 30 dias. As suas preferências permanecem ativas – o membro tem o direito de mantê-las. Entre em contato diretamente se desejar fazer o check-in.',
        'escalation_cta' => 'Ver membro no painel de proteção',
    ],
];
