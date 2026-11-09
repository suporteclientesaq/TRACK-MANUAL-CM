> **Documento histórico — versão 2.6.2.** Este relatório descreve o ponto de partida no commit `7a42f374440688273d15c6beb5c946f3e24f5ca8`; seus resultados e falhas não são o estado final da versão 3.0. Consulte [a revisão atual](FLOW-3.0-REVISAO.md) e [o acompanhamento dos 52 achados](FLOW-3.0-ACHADOS.md). Nenhuma credencial é reproduzida neste documento.

# Auditoria do Track Manual CM

**Repositório:** [suporteclientesaq/TRACK-MANUAL-CM](https://github.com/suporteclientesaq/TRACK-MANUAL-CM)  
**Versão:** 2.6.2 · branch main · commit `7a42f374440688273d15c6beb5c946f3e24f5ca8`  
**Data da revisão:** 8 de novembro de 2026, horário de São Paulo.  
**Escopo:** 126 arquivos versionados; revisão de arquitetura, segurança, APIs, persistência, conversões, WhatsApp, interface, testes e implantação.

## Parecer

O projeto já reúne recursos de um CRM de atendimento WhatsApp com envio de conversões à Meta e análise de anúncios. Há uma base aproveitável, mas esta versão precisa de correções antes de ser usada como fonte confiável de faturamento/ROAS ou de receber uma publicação nova com dados reais.

A revisão identificou **52 achados**, agrupados por causa e fluxo: **2 críticos (P0), 28 de prioridade alta (P1) e 22 de prioridade média (P2)**. P1 é prioridade de correção; não significa necessariamente vulnerabilidade de segurança. Cada item informa se foi reproduzido localmente ou identificado por leitura do código.

As primeiras ações são proteger as rotas de sessão WhatsApp, tratar o segredo publicado, corrigir o backup e garantir idempotência de conversões. Em seguida, corrigir os indicadores financeiros e a preservação de mensagens/rastreio.

## Como entendi o produto

O fluxo de negócio é: anúncio Click-to-WhatsApp → conversa/lead → atendimento → venda → evento de conversão → Meta → indicadores no painel.

Os leads entram por Leona, webhooks WAHA/Evolution, conexão nativa Baileys ou importações CSV/TXT. O painel guarda contato, referência do anúncio e mensagens; permite cadastrar clientes com pixels/tokens próprios; consulta anúncios e envia eventos pela Conversions API. As telas principais são leads, conversas, clientes, eventos, dashboard, WhatsApp e configurações.

O código escolhe entre SQLite local, Postgres direto e API REST do Supabase. A aplicação usa Next.js 16.3.5/React 19, Server Actions e rotas HTTP. A autenticação é de **um administrador compartilhado**, por senha e cookie assinado; vários clientes cadastrados não significam usuários/perfis separados por empresa.

| Camada | Responsabilidade | Arquivos centrais |
| --- | --- | --- |
| Telas e ações | Operação, revisão/envio e atendimento | app/(painel), app/actions.ts |
| Ingestão | Normalização, merge e referência de anúncio | lib/ingest.ts, leona.ts, normalize.ts |
| WhatsApp | Nativo Baileys e conectores externos | lib/whatsapp-baileys.ts, waha.ts, evolution.ts |
| Conversões/anúncios | Payload CAPI e consultas Marketing API | lib/meta.ts |
| Indicadores | Atribuição, receita, gasto e funil | lib/attribution.ts, dashboard.ts |
| Persistência | Três implementações de armazenamento | lib/store*.ts, schema-sql.ts |
| Acesso/segredos | Senha, sessão e criptografia | lib/auth.ts, config.ts, crypto.ts |

A documentação ficou atrás da implementação: o README afirma que nada é enviado sem clique, mas o webhook Leona pode enviar Purchase automaticamente. Recursos de chat contínuo também exigem uma arquitetura de execução diferente do painel serverless descrito na instalação.

## O que foi validado

| Verificação | Resultado | Interpretação |
| --- | --- | --- |
| npm ci com lockfile | Concluiu | Ambiente local reproduzível com Node 24.22.1; projeto exige Node >=22.13 |
| npm test | **112 passaram; 3 falharam; 115 no total** | FromMe é regressão; duas expectativas de raw precisam revisão de contrato |
| tsc --noEmit --incremental false | **Falhou** | Erro TS2322 em lib/whatsapp-baileys.ts:518 |
| npm run build | **Passou** | Tipos foram ignorados; aviso de configuração eslint obsoleta |
| npm audit | **6 pacotes afetados** | 1 crítico, 3 altos, 2 moderados; exploração no app não demonstrada |
| Navegador Chromium/Playwright, build de produção local | Telas principais abriram sem pageerror | Login novo, clientes, leads/detalhe válido, dashboard, conversas, eventos, WhatsApp e configurações |
| Troca de conversa A → B | **Rascunho de A permaneceu em B** | Reproduzido sem enviar mensagem |
| Viewport móvel de 390px | **Campo de resposta parcialmente fora da tela** | Grid não se adapta; captura incluída |
| Rota WAHA sem cookie | **HTTP 200 com estado de sessão** | Ausência de autenticação confirmada localmente |
| Provas locais com SQLite | **Backup, filtros e cache incorretos** | Sem acesso a banco remoto |
| Provas com rede/banco simulados | **Webhook repetido, duplicação após falha, métricas erradas e corrida de segredo** | Confirmam regras de código; não são integração contra Meta/WhatsApp reais |

### Exemplos que mostram o impacto

- Dois webhooks iguais com valor 200 e o mesmo ID externo produziram dois IDs internos de Purchase.
- Um Purchase de teste de 100, um checkout de 40 e uma compra real de 60 geraram receita 200 e três compras; o resultado comercial esperado era receita 60 e uma compra.
- Uma atualização parcial de anúncio apagou gasto, campanha e impressões já existentes.
- A cópia do arquivo SQLite principal perdeu commits que estavam no WAL.
- O campo passou a dizer “Responder para Contato B”, mantendo o texto escrito para Contato A.

## Como ler as prioridades

- **P0:** corrigir antes de exposição pública; há quebra crítica de controle de acesso/segredo.
- **P1:** corrigir antes de confiar no fluxo afetado, por risco de duplicação, perda, atribuição, receita incorreta ou indisponibilidade.
- **P2:** corrigir na estabilização; afeta precisão, experiência, manutenção ou cenários condicionais.
- **Evidência por código:** caminho identificado estaticamente; condições do ambiente real podem alterar o alcance.
- **Reprodução local/com dublês:** exercício isolado do mecanismo, com dados fictícios; não demonstra incidente em produção.

## Catálogo de achados

### Segurança e recuperação

**S01 · P0 · Segredo de login e criptografia publicado**  
Evidência: Reproduzido offline.

data/config.json contém appSecret, sal e hash de senha. Instalações locais/Docker que reutilizam esse arquivo aceitam sessão fabricada sem saber a senha; a chave dos tokens também fica conhecida. Não foi verificado se uma instalação de produção usa esse segredo.

**Correção:** Remover estado de execução do Git e da imagem; gerar segredo exclusivo, respeitar APP_SECRET também local; rotacionar os segredos expostos, revogar sessões e recadastrar/recriptografar tokens. Apagar o arquivo sozinho não resolve a exposição histórica.

**Referências:** [data/config.json:3](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/data/config.json#L3) · [lib/config.ts:30](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/config.ts#L30) · [lib/crypto.ts:50](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/crypto.ts#L50) · [Dockerfile:34](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/Dockerfile#L34)

**S02 · P0 · Sessões WhatsApp acessíveis sem login**  
Evidência: HTTP local + código.

As rotas compatíveis com WAHA expõem status/QR/número e permitem iniciar ou encerrar sessões sem autenticação. Sessão desconhecida seleciona o primeiro cliente. GET anônimo local retornou 200 com dados de sessão; não foram executadas ações mutadoras externas.

**Correção:** Exigir sessão autenticada ou chave de serviço com escopo; retirar o fallback para primeiro cliente; 404 para sessão desconhecida; iniciar conexão apenas por ação autenticada.

**Referências:** [app/api/waha/api/sessions/[session]/route.ts:11](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/waha/api/sessions/%5Bsession%5D/route.ts#L11) · [app/api/waha/api/[session]/auth/qr/route.ts:11](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/waha/api/%5Bsession%5D/auth/qr/route.ts#L11)

**S03 · P1 · Backup pode perder dados já confirmados**  
Evidência: Reproduzido SQLite.

O SQLite usa WAL, mas o download copia apenas .db. Provas locais recuperaram zero registros ou banco sem tabelas, apesar de dados confirmados no banco aberto. O arquivo também omite config.json, necessário para recuperar tokens criptografados.

**Correção:** Usar API de backup consistente SQLite e pacote de recuperação protegido; incluir procedimento de configuração/chaves e, se necessário, sessões; testar restauração em instalação vazia.

**Referências:** [lib/store-sqlite.ts:157](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-sqlite.ts#L157) · [app/api/backup/route.ts:26](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/backup/route.ts#L26)

**S04 · P2 · Trocar senha mantém sessões antigas válidas**  
Evidência: Código.

O cookie contém apenas validade e assinatura e dura 30 dias. Atualizar o hash da senha não revoga cookies existentes; logout só remove o cookie daquele navegador.

**Correção:** Versionar credenciais/sessões e revogar sessões na troca de senha. Separar a chave de login da chave que protege tokens.

**Referências:** [lib/auth.ts:8](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/auth.ts#L8) · [lib/crypto.ts:50](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/crypto.ts#L50) · [app/actions.ts:90](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L90)

**S05 · P2 · Login sem limite de tentativas bloqueia o processo com scryptSync**  
Evidência: Código.

Não há rate limit/backoff na aplicação; cada tentativa calcula hash síncrono. Isso favorece força bruta e indisponibilidade. Não foram consultadas proteções externas da hospedagem.

**Correção:** Limitação persistida por origem/conta, backoff e hash assíncrono com limite de concorrência; elevar a política de senha de seis caracteres.

**Referências:** [app/actions.ts:60](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L60) · [lib/config.ts:98](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/config.ts#L98)

**S06 · P2 · Preferências permitem gravar configurações sensíveis arbitrárias**  
Evidência: Código; exige login.

saveSystemSettingsAction aceita qualquer chave de settings. Em modo online pode substituir hash/sal/segredo por uma sessão autenticada, sem a verificação da senha atual do fluxo oficial. O restore de sessão também precisa validar nomes de arquivos do bundle. O aplicativo tem administrador único; não é uma escalada anônima demonstrada.

**Correção:** Allowlist de preferências, validação de tipo/faixa e serviço separado de credenciais; restringir arquivos restaurados à pasta de sessão. Tratar SVG configurável de forma isolada/sanitizada.

**Referências:** [app/actions.ts:1448](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L1448) · [lib/whatsapp-baileys.ts:97](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L97) · [app/(painel)/configuracoes/SystemSettingsForm.tsx:262](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/configuracoes/SystemSettingsForm.tsx#L262)

**S07 · P1 · Dependências instaladas com alertas conhecidos**  
Evidência: npm audit.

npm audit retornou seis pacotes afetados: uma classificação crítica, três altas e duas moderadas. Produção: next 16.3.5, sharp 0.35.4 e source-map-js 1.2.1. Desenvolvimento: vite 8.3.0, vitest/@vitest/mocker 5.0.1. A classificação do catálogo não prova que todos os vetores são exploráveis neste app.

**Correção:** Atualizar para versões corrigidas compatíveis, revisar cada advisory aplicável e repetir build/testes/auditoria. Não executar atualização automática sem revisar o impacto.

**Referências:** [package.json:15](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/package.json#L15) · [package-lock.json:1](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/package-lock.json#L1)

**S08 · P2 · Postgres não valida certificado remoto**  
Evidência: Código.

Conexões remotas usam rejectUnauthorized:false. O tráfego é cifrado, mas a identidade do servidor não é validada.

**Correção:** Configurar a CA do provedor e habilitar verificação TLS. Não foi executada interceptação ou teste de conexão de produção.

**Referências:** [lib/store-pg.ts:89](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-pg.ts#L89)

### Conversões e atribuição

**C01 · P1 · Webhook pode enviar compra automática e duplicar a mesma venda**  
Evidência: Reproduzido com dublês.

Qualquer valor positivo no webhook Leona pode virar Purchase, mesmo sem status de aprovação. Repetir o mesmo corpo com event_id externo gera UUID novo. GET também executa o fluxo mutável. Contradiz o README de envio somente após clique.

**Correção:** Modo automático explicitamente optativo; condição inequívoca de aprovação; POST e identificador único de pedido/evento por cliente. No modo manual, registrar para conferência.

**Referências:** [app/api/webhook/leona/[key]/route.ts:52](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/webhook/leona/%5Bkey%5D/route.ts#L52) · [app/api/webhook/leona/[key]/route.ts:81](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/webhook/leona/%5Bkey%5D/route.ts#L81)

**C02 · P1 · Meta recebe antes de o evento existir no banco**  
Evidência: Reproduzido com dublês.

sendAndRecord envia antes de inserir o registro. Se a API aceita e o banco falha, perde-se o event_id recuperável; novo clique envia outro ID e pode contar novamente.

**Correção:** Persistir evento/payload imutáveis e chave de idempotência antes do envio; estados pendente/enviado/incerto/erro; fila de saída e tentativas reutilizando o ID.

**Referências:** [app/actions.ts:376](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L376) · [app/api/webhook/leona/[key]/route.ts:82](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/webhook/leona/%5Bkey%5D/route.ts#L82)

**C03 · P1 · Duplicidade é bloqueada só na interface; venda rápida pula conferência**  
Evidência: Reproduzido com dublês.

O servidor consulta alreadySent, mas não o utiliza para impedir nova compra. countSent=99 ainda permitiu envio na prova isolada. QuickSale chama envio diretamente e omite revisão, avisos e modo de teste.

**Correção:** Aplicar a regra no servidor; identificar a venda e exigir confirmação explícita validada para venda nova. Unificar formulário, inbox, QuickSale e webhook no mesmo serviço.

**Referências:** [app/actions.ts:336](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L336) · [app/actions.ts:431](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L431) · [components/QuickSaleButton.tsx:45](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/QuickSaleButton.tsx#L45)

**C04 · P1 · A prévia pode mostrar R$100 e o envio usar R$1000**  
Evidência: Código.

Campos continuam editáveis enquanto a prévia aguarda. Uma resposta antiga recoloca a prévia depois de o valor mudar; doSend reconstrói o input atual.

**Correção:** Vincular prévia a snapshot/versionamento e enviar o snapshot aprovado; invalidar respostas antigas ou desabilitar edição durante a operação.

**Referências:** [app/(painel)/leads/[id]/SendEventForm.tsx:54](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/leads/%5Bid%5D/SendEventForm.tsx#L54) · [app/(painel)/leads/[id]/SendEventForm.tsx:71](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/leads/%5Bid%5D/SendEventForm.tsx#L71)

**C05 · P1 · Click ID real é substituído por identificador artificial**  
Evidência: Reproduzido com dublês.

Atribuir anúncio manualmente ou receber source_id sem click ID pode sobrescrever ctwa_clid real por ctwa_ad_<id>. Esse valor não é um token CTWA e o montador o remove antes da CAPI.

**Correção:** Manter ad_id e ctwa_clid separados; nunca fabricar click ID; preservar sinal real e registrar sua origem/data. Revisar também backfills existentes.

**Referências:** [app/actions.ts:1406](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L1406) · [lib/ingest.ts:116](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/ingest.ts#L116) · [lib/leona.ts:160](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/leona.ts#L160) · [lib/meta.ts:85](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L85)

**C06 · P1 · Interface promete atribuição que não está comprovada**  
Evidência: Reproduzido com dublês.

Identificador artificial recebe rótulo last-click/100% atribuído, embora o evento vire chat, sem ctwa_clid e sem aviso. events_received significa aceitação pela API, não atribuição da venda ao anúncio.

**Correção:** Separar anúncio identificado, token CTWA real, evento recebido e atribuição confirmada/indeterminada. Remover promessas de 100% e exibir avisos corretos.

**Referências:** [lib/attribution.ts:53](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/attribution.ts#L53) · [lib/meta.ts:134](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L134) · [app/actions.ts:1307](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L1307)

**C07 · P1 · Vendas antigas mudam de anúncio quando o lead recebe novo clique**  
Evidência: Código.

Dashboard usa source_id atual do lead para todas as vendas. Uma compra originada no anúncio A pode migrar para B após novo clique posterior, sem comparação com a data da conversão.

**Correção:** Touchpoints imutáveis e snapshot da atribuição em cada conversão, respeitando tempo do clique, janela e modelo utilizado.

**Referências:** [lib/dashboard.ts:152](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L152) · [lib/dashboard.ts:187](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L187) · [lib/attribution.ts:49](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/attribution.ts#L49)

**C08 · P2 · Reenvios podem inflar a receita interna**  
Evidência: Código.

Cada tentativa cria linha nova; o erro original continua reenviável. Várias tentativas bem-sucedidas do mesmo event_id podem ser somadas pelo dashboard, embora a Meta deduplique.

**Correção:** Separar evento de suas tentativas, manter unicidade de identidade comercial e agregar métricas por evento único.

**Referências:** [app/actions.ts:440](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L440) · [lib/dashboard.ts:187](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L187)

**C09 · P2 · Reenvio pode mudar corpo, destino e modo teste/produção**  
Evidência: Código.

O retry reconstrói o evento com cliente/lead atuais, em vez de reutilizar o payload salvo. Alterar pixel, click ID ou código de teste muda a tentativa; nome do evento também pode mudar.

**Correção:** Preservar destino, modo, nome, corpo e ID originais. Correções devem ser um fluxo explícito, distinto de reenviar.

**Referências:** [app/actions.ts:309](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L309) · [app/actions.ts:440](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L440)

**C10 · P2 · Fallback para chat pode deixar identidade vazia**  
Evidência: Código.

Com send_extra_data desligado, retirar clid/page da primeira tentativa pode deixar user_data vazio. LeadSubmitted também não é remapeado nessa recuperação.

**Correção:** Reconstruir o fallback a partir da identidade original, validá-lo e registrar a resposta de cada tentativa.

**Referências:** [lib/meta.ts:149](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L149) · [lib/meta.ts:369](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L369)

**C11 · P1 · Atualização parcial apaga dados válidos do anúncio**  
Evidência: Reproduzido SQLite.

upsertAd escreve todas as colunas e transforma ausentes em null. Ajustar só o gasto ou receber enriquecimento parcial apaga campanha, impressões e outros valores; falha posterior da API mantém a perda.

**Correção:** PATCH por campos presentes ou merge transacional; separar atualização de gasto do snapshot completo da Meta; preservar último cache válido.

**Referências:** [lib/store-sqlite.ts:402](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-sqlite.ts#L402) · [lib/store-pg.ts:393](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-pg.ts#L393) · [lib/store-rest.ts:435](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-rest.ts#L435) · [app/actions.ts:1012](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L1012) · [lib/ingest.ts:42](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/ingest.ts#L42)

**C12 · P1 · Mover lead para outro cliente quebra histórico financeiro**  
Evidência: SQLite + código.

O formulário permite mudar client_id sem migrar eventos. O schema aceita cliente e lead incompatíveis, e o dashboard os filtra separadamente.

**Correção:** Proibir a troca quando existe histórico ou oferecer migração explícita e transacional. Usar integridade composta lead/cliente.

**Referências:** [app/(painel)/leads/LeadForm.tsx:17](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/leads/LeadForm.tsx#L17) · [app/actions.ts:174](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L174) · [lib/schema-sql.ts:56](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/schema-sql.ts#L56)

**C13 · P2 · Dados de dois cliques podem formar uma referência falsa**  
Evidência: Reproduzido com dublês.

Merge independente dos campos pode juntar click ID B com ad_id/miniatura de A, quando a nova entrada traz apenas parte da referência.

**Correção:** Tratar a referência do anúncio como touchpoint atômico, com procedência e horário; não misturar campos de toques distintos.

**Referências:** [lib/leona.ts:160](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/leona.ts#L160) · [lib/ingest.ts:123](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/ingest.ts#L123)

### Dashboard e consultas

**D01 · P1 · Testes e checkouts entram como vendas e receita**  
Evidência: Reproduzido com dublês.

Purchase de teste100 + InitiateCheckout40 + Purchase real60 resultaram em receita200 e três compras. O filtro inclui testes e considera venda qualquer evento de valor positivo.

**Correção:** Receita realizada deve considerar Purchase em produção e uma única venda aprovada. Separar valor potencial, testes e etapas do funil.

**Referências:** [lib/dashboard.ts:146](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L146) · [lib/dashboard.ts:160](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L160) · [lib/dashboard.ts:187](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L187)

**D02 · P1 · ROAS mistura períodos e omite anúncios sem resultado**  
Evidência: Código.

O gasto vem de date_preset=maximum, enquanto receita é filtrada por hoje/7/30 dias. Anúncios que gastaram sem gerar leads/vendas podem ficar fora do denominador.

**Correção:** Insights diários de todos os anúncios com investimento; mesmo intervalo, fuso e moeda para gasto/receita; persistir dimensões diárias.

**Referências:** [lib/meta.ts:503](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L503) · [lib/meta.ts:642](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L642) · [lib/dashboard.ts:230](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L230)

**D03 · P1 · O funil apresenta números calculados sem observação real**  
Evidência: Reproduzido com dublês.

Na ausência de dados, respostas viram 72% dos leads e propostas/checkout viram 1,8 vezes compras. A tela os apresenta como etapas observadas.

**Correção:** Usar contagens reais; exibir zero ou indisponível quando não há evidência. Se houver projeção, rotular e apresentar fora dos indicadores realizados.

**Referências:** [lib/dashboard.ts:375](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L375)

**D04 · P2 · Gráfico diário de gasto e ROAS fica zerado**  
Evidência: Reproduzido com dublês.

A série inicializa spend=0 e nunca preenche investimento diário. A prova mostrou KPI de gasto1000 e série diária gasto/ROAS0.

**Correção:** Alimentar a série com insights diários reais e compartilhar os mesmos filtros do KPI.

**Referências:** [lib/dashboard.ts:324](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L324) · [lib/dashboard.ts:357](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L357)

**D05 · P2 · Lead orgânico único pode ser chamado de duplicado**  
Evidência: Código.

Leads sem anúncio são excluídos de totalLeads, mas a diferença para o total bruto é exibida como duplicatas removidas.

**Correção:** Separar contatos únicos, orgânicos, atribuídos e duplicatas verdadeiras; deduplicar por identidade dentro do cliente.

**Referências:** [lib/dashboard.ts:206](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L206) · [lib/dashboard.ts:400](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L400)

**D06 · P2 · Valores de moedas/clientes diferentes são somados**  
Evidência: Código.

Consolidado soma valores sem conversão e mostra moeda do primeiro cliente. Mapas de anúncios usam só ad_id, embora a chave de armazenamento seja client_id/ad_id. Venda rápida força BRL.

**Correção:** Particionar por moeda ou converter com taxa registrada; chave client_id:ad_id; moeda padrão do cliente no envio rápido e nos relatórios.

**Referências:** [lib/dashboard.ts:149](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L149) · [lib/dashboard.ts:177](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L177) · [app/(painel)/conversas/ConversasClient.tsx:507](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L507) · [components/QuickSaleButton.tsx:47](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/QuickSaleButton.tsx#L47)

**D07 · P2 · Métricas podem ser truncadas sem aviso**  
Evidência: Código; teto remoto depende da configuração.

Dashboard lê no máximo dez mil leads/eventos antes de filtros locais; Meta só primeira página de150 anúncios; REST não percorre páginas/Content-Range e fica sujeito ao max-rows do PostgREST.

**Correção:** Filtrar e agregar no banco; paginar toda a consulta Meta/REST; informar quando o resultado estiver parcial. Testar bases maiores que os limites.

**Referências:** [lib/dashboard.ts:140](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/dashboard.ts#L140) · [lib/meta.ts:642](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/meta.ts#L642) · [lib/store-rest.ts:117](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-rest.ts#L117)

**D08 · P2 · Filtros com venda/sem venda divergem entre bancos**  
Evidência: Reproduzido SQLite + código.

SQLite e REST ignoram esses filtros. Com dois leads, um comprado, ambos retornaram os dois. PG considera qualquer evento enviado, inclusive teste/etapa, como venda.

**Correção:** Contrato único de filtros e testes iguais nos três bancos; venda deve seguir a regra de Purchase aprovado em produção.

**Referências:** [lib/store-sqlite.ts:254](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-sqlite.ts#L254) · [lib/store-rest.ts:254](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-rest.ts#L254) · [lib/store-pg.ts:228](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-pg.ts#L228)

### WhatsApp e conversas

**W01 · P1 · Rascunho muda de destinatário ao trocar de conversa**  
Evidência: Reproduzido no navegador.

Digite para A e selecione B: a tela mantém o texto de A no campo que agora responde a B. A prova confirmou isso sem enviar mensagem. A ação usa o lead selecionado no momento do envio.

**Correção:** Rascunhos e pendências por conversa; limpar/confirmar quando necessário; vincular destinatário e conteúdo ao envio iniciado.

**Referências:** [app/(painel)/conversas/ConversasClient.tsx:216](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L216) · [app/(painel)/conversas/ConversasClient.tsx:438](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L438) · [app/(painel)/conversas/ConversasClient.tsx:816](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L816)

**W02 · P1 · Vendas de clientes diferentes se misturam pelo telefone**  
Evidência: Código.

phoneEventsMap não inclui client_id. Na visão de todos os clientes, compra na empresa A aparece no contato da empresa B se o telefone coincidir.

**Correção:** Chave composta cliente:telefone e variantes de número restritas ao mesmo cliente; teste com número repetido em empresas distintas.

**Referências:** [app/(painel)/conversas/ConversasClient.tsx:332](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L332) · [app/(painel)/conversas/ConversasClient.tsx:415](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L415)

**W03 · P1 · Conectar WAHA/Evolution não configura o envio pelo chat**  
Evidência: Código.

Conexão usa parâmetros da tela, mas não os persiste nas chaves settings que sendWhatsAppMessageAction lê. WAHA fica em localStorage e Evolution em state. Mídia só chama nativo.

**Correção:** Persistir provider/configuração por cliente no servidor, com credenciais cifradas; um adapter único para conexão, status, texto, mídia e histórico.

**Referências:** [app/actions.ts:616](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L616) · [app/actions.ts:674](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L674) · [app/actions.ts:770](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L770) · [app/actions.ts:822](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L822) · [app/(painel)/whatsapp/WhatsAppClient.tsx:105](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/whatsapp/WhatsAppClient.tsx#L105)

**W04 · P1 · Mídias não são preservadas e o áudio não tem player funcional**  
Evidência: Código.

Baileys identifica mídia, mas não baixa/persiste o conteúdo; envio registra só texto/tipo. Inbox de áudio contém desenho de waveform, sem elemento de áudio ou reprodução. Documentos ficam sem download.

**Correção:** Storage de anexos com autorização/retenção e referências persistidas; baixar pelo provider; controles reais de áudio, imagem e documento.

**Referências:** [lib/whatsapp-baileys.ts:510](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L510) · [lib/whatsapp-baileys.ts:792](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L792) · [app/(painel)/conversas/ConversasClient.tsx:1203](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L1203)

**W05 · P1 · Histórico perde horário, mensagens repetidas e atualizações concorrentes**  
Evidência: Código.

Ingestão usa horário atual, deduplica por texto/5s e regrava o array JSON inteiro. Dois 'ok' legítimos podem sumir; dois webhooks simultâneos podem sobrescrever uma mensagem.

**Correção:** Tabela messages com ID único por provider/cliente/sessão, horário de origem/recebimento, direção e anexos; append atômico e paginação.

**Referências:** [lib/ingest.ts:121](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/ingest.ts#L121) · [lib/ingest.ts:143](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/ingest.ts#L143) · [lib/ingest.ts:190](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/ingest.ts#L190) · [lib/whatsapp-baileys.ts:665](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L665)

**W06 · P1 · Mensagens enviadas viram recebidas; nome do operador pode substituir contato**  
Evidência: Teste existente + código.

Evolution calcula fromMe e o descarta; o teste existente falha. Baileys também pode usar pushName da mensagem enviada para renomear o lead.

**Correção:** Preservar direção em todo o contrato; não usar identidade local como nome do cliente; revisar ingestão/histórico e notificações.

**Referências:** [lib/evolution.ts:45](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/evolution.ts#L45) · [lib/evolution.ts:260](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/evolution.ts#L260) · [app/api/webhook/evolution/[key]/route.ts:74](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/webhook/evolution/%5Bkey%5D/route.ts#L74) · [lib/whatsapp-baileys.ts:509](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L509) · [tests/evolution.test.ts:61](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/tests/evolution.test.ts#L61)

**W07 · P1 · Status conectado não comprova conexão; retomada depende da interface**  
Evidência: Código.

Credencial salva com me.id pode retornar open sem socket aberto. Após reinício, reconexão depende de consulta de status. O nativo é bloqueado em serverless e o status geral ignora providers externos.

**Correção:** Worker contínuo com bootstrap e supervisão; estados baseados em conexão confirmada; provider por cliente. Frontend pode ser serverless, o worker Baileys precisa processo persistente.

**Referências:** [lib/whatsapp-baileys.ts:162](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L162) · [lib/whatsapp-baileys.ts:311](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L311) · [app/api/whatsapp/live-status/route.ts:15](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/whatsapp/live-status/route.ts#L15)

**W08 · P1 · Conexões simultâneas podem abrir dois sockets da mesma sessão**  
Evidência: Código.

O guard só fica efetivo depois de awaits; duas chamadas iniciais passam e criam sockets concorrentes, cujos eventos compartilham estado.

**Correção:** Promise/lock por cliente antes do primeiro await, dono único por sessão e generation token nos listeners.

**Referências:** [lib/whatsapp-baileys.ts:332](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L332) · [lib/whatsapp-baileys.ts:380](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L380)

**W09 · P1 · Mensagem entregue pode ser reenviada após falha no banco**  
Evidência: Código; depende do provider disponível.

O nativo envia primeiro e grava depois. Erro ao gravar retorna falha, e a ação pode tentar WAHA/Evolution, repetindo texto já entregue.

**Correção:** Separar aceite externo e persistência; ID durável de mensagem e fila de saída; fallback só quando há falha comprovada anterior ao envio.

**Referências:** [lib/whatsapp-baileys.ts:727](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L727) · [app/actions.ts:761](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L761)

**W10 · P1 · Identificador @lid pode virar telefone falso**  
Evidência: Código; sem conta real.

Parsers removem o sufixo de JID sem resolver LID para número real. Identificador numérico de tamanho aceito passa em normalizePhone como se fosse telefone.

**Correção:** Resolver PN pelo mapping/remoteJidAlt, preservar JID original e rejeitar inferência de telefone a partir de LID.

**Referências:** [lib/evolution.ts:47](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/evolution.ts#L47) · [lib/waha.ts:37](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/waha.ts#L37) · [lib/whatsapp-baileys.ts:584](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L584)

**W11 · P2 · WAHA já conectado mantém webhook antigo**  
Evidência: Código.

Retorno imediato no estado WORKING acontece antes da atualização do callback. Troca de domínio/cliente pode manter leads indo ao endereço anterior.

**Correção:** Atualizar e validar webhook também ao reutilizar sessão conectada; callback deve ser consistente com o cliente selecionado.

**Referências:** [lib/waha.ts:330](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/waha.ts#L330) · [lib/waha.ts:382](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/waha.ts#L382)

**W12 · P2 · Painel WAHA mistura clientes e calcula datas inválidas**  
Evidência: Código.

Widget consulta conversas de todos os clientes e trata timestamp ISO como número em segundos; ordenação/idade podem virar NaN.

**Correção:** Filtrar por cliente e padronizar o contrato de datas antes de ordenar/exibir.

**Referências:** [app/(painel)/whatsapp/WahaDashboard.tsx:161](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/whatsapp/WahaDashboard.tsx#L161) · [app/(painel)/whatsapp/WahaDashboard.tsx:68](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/whatsapp/WahaDashboard.tsx#L68)

### Interface, manutenção e operação

**O01 · P2 · Inbox fica cortado no celular**  
Evidência: Reproduzido no navegador.

Grid fixa colunas de300px sem adaptação. Em viewport390px, o campo de resposta ficou x376/largura30, parcialmente fora da tela; screenshot confirma colunas cortadas.

**Correção:** Uma coluna no celular: lista → conversa → detalhes; 100dvh, teclado móvel, min-width:0 e painel lateral recolhível.

**Referências:** [app/(painel)/conversas/ConversasClient.tsx:563](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L563)

**O02 · P2 · Polling pesado força rolagem e pode sobrescrever respostas novas**  
Evidência: Código.

A cada2s transfere até1000 leads com raw/histórico/eventos/mídias. Substituir o array dispara rolagem ao fim; não há garantia de uma requisição por vez, cancelamento ou pausa em aba oculta. Erros silenciosos deixam dados antigos marcados como ao vivo.

**Correção:** Resumo paginado + histórico da conversa selecionada; cursor de atualização/SSE/WebSocket ou polling sequencial com backoff; autoscroll só perto do fim e com nova mensagem; indicar dados desatualizados.

**Referências:** [app/(painel)/conversas/ConversasClient.tsx:262](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L262) · [app/(painel)/conversas/ConversasClient.tsx:321](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L321) · [app/api/conversas/live/route.ts:15](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/api/conversas/live/route.ts#L15)

**O03 · P2 · Progresso de sincronização simula sucesso independente do resultado**  
Evidência: Código.

Modal chega a100% por timer aleatório. Dashboard ignora retorno ok/message da operação. Pode informar conclusão enquanto a sincronização falha ou continua rodando.

**Correção:** Progresso indeterminado ou etapas reais; finalizar apenas pela promise; erro visível, finally e proteção contra disparos concorrentes.

**Referências:** [components/ActionProgressModal.tsx:45](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/ActionProgressModal.tsx#L45) · [app/(painel)/dashboard/DashboardClient.tsx:211](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/dashboard/DashboardClient.tsx#L211)

**O04 · P2 · Configurações prometem comportamentos sem implementação**  
Evidência: Código.

Janela de atribuição, formato de moeda, badge e limpeza automática são salvos sem consumidores. Som desativado não é respeitado. A limpeza manual só percorre500 leads recentes, podendo nunca atingir os antigos.

**Correção:** Implementar cada preferência ou retirar o controle; limpeza por idade com paginação/agendador; respeitar som e janela nos consumidores.

**Referências:** [app/(painel)/configuracoes/SystemSettingsForm.tsx:140](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/configuracoes/SystemSettingsForm.tsx#L140) · [app/(painel)/conversas/ConversasClient.tsx:77](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/conversas/ConversasClient.tsx#L77) · [app/actions.ts:1469](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/actions.ts#L1469)

**O05 · P2 · Exportações CSV podem quebrar ou executar fórmulas na planilha**  
Evidência: Código.

Dashboard não escapa aspas em nomes. Exportações não neutralizam prefixos de fórmula. Exportar Leads usa só os registros da página atual, normalmente50, sem deixar claro o escopo.

**Correção:** Serializador único de CSV, neutralização de fórmulas e codificação consistente; exportação completa do filtro ou rótulo explícito 'página atual'; moeda correta.

**Referências:** [app/(painel)/dashboard/DashboardClient.tsx:96](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/dashboard/DashboardClient.tsx#L96) · [components/ExportLeadsButton.tsx:42](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/ExportLeadsButton.tsx#L42) · [app/(painel)/page.tsx:68](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/app/(painel)/page.tsx#L68)

**O06 · P2 · Barra global fica presa após ação sem navegação**  
Evidência: Código.

Intercepta todo submit; só finaliza quando URL muda. Erro de login ou formulário que retorna estado pode manter92% indefinidamente.

**Correção:** Vincular indicadores à navegação/operação real; encerrar em sucesso/erro e não interceptar formulários indiscriminadamente.

**Referências:** [components/GlobalProgressBar.tsx:14](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/GlobalProgressBar.tsx#L14) · [components/GlobalProgressBar.tsx:45](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/GlobalProgressBar.tsx#L45) · [components/GlobalProgressBar.tsx:78](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/components/GlobalProgressBar.tsx#L78)

**O07 · P1 · Build publica mesmo com erro de TypeScript**  
Evidência: tsc e build executados.

tsc falhou em whatsapp-baileys.ts:518 por string|null|undefined incompatível com string|null. Build passou e registrou 'Skipping validation of types'. Config eslint também é inválida para a versão instalada.

**Correção:** Corrigir o tipo e reativar validação; remover configuração obsoleta; CI deve bloquear build com falhas de tipos, testes ou lint.

**Referências:** [lib/whatsapp-baileys.ts:518](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/whatsapp-baileys.ts#L518) · [next.config.mjs:8](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/next.config.mjs#L8)

**O08 · P1 · Testes falham e não há CI verificando a branch**  
Evidência: Suíte + GitHub.

115 testes:112 passaram,3 falharam. Uma falha é fromMe; duas cobram raw exatamente igual ao objeto original, agora enriquecido com messages/message_text, e podem exigir atualização do contrato/teste. Não significam, sozinhas, perda de dados. Não há workflow e a única branch main aparece desprotegida.

**Correção:** Consertar regressão e alinhar o contrato de raw; workflow com npm ci, tipos, testes/build; proteção de branch e testes de negócio para as falhas críticas.

**Referências:** [tests/evolution.test.ts:61](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/tests/evolution.test.ts#L61) · [tests/store.test.ts:98](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/tests/store.test.ts#L98) · [tests/store.test.ts:127](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/tests/store.test.ts#L127) · [package.json:5](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/package.json#L5)

**O09 · P1 · Primeiras requisições podem gerar segredos diferentes**  
Evidência: Reproduzido com store simulado.

readOnline lê ausência de app_secret, gera e faz upsert. Duas chamadas simultâneas retornaram chaves diferentes; somente a última ficou persistida, invalidando o que usou a outra.

**Correção:** Criação atômica insert-if-absent e releitura do vencedor; preferir segredo durável fora do banco.

**Referências:** [lib/config.ts:53](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/config.ts#L53)

**O10 · P1 · Senha Postgres pode ficar com sal e hash incompatíveis**  
Evidência: Código; falha/concorrência.

setSettings no Postgres atualiza cada chave em autocommit. Falha entre queries ou concorrência na troca de senha pode separar o par e bloquear acesso.

**Correção:** Guardar credencial numa linha ou transação de leitura/escrita consistente; testar interrupção e duas trocas concorrentes.

**Referências:** [lib/config.ts:88](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/config.ts#L88) · [lib/store-pg.ts:411](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/lib/store-pg.ts#L411)

**O11 · P2 · Iniciador local não percebe alterações em components/public**  
Evidência: Código.

sourceHash percorre apenas app/lib e três arquivos de configuração. Alterar um botão compartilhado ou asset pode não provocar novo build ao usar iniciar, mantendo versão antiga.

**Correção:** Usar build ID baseado nas fontes completas relevantes e lockfile, ou invalidar build de forma explícita na distribuição.

**Referências:** [scripts/iniciar.mjs:55](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/scripts/iniciar.mjs#L55) · [scripts/iniciar.mjs:65](https://github.com/suporteclientesaq/TRACK-MANUAL-CM/blob/7a42f374440688273d15c6beb5c946f3e24f5ca8/scripts/iniciar.mjs#L65)

## Sequência de correção recomendada

### 1. Conter exposição e garantir recuperação

Resolver S01/S02 primeiro. Se alguma instalação usou a configuração publicada, tratá-la como segredo comprometido: remover do código/imagem, gerar chave exclusiva, invalidar sessões e preservar/recadastrar tokens com procedimento seguro. Corrigir o backup e ensaiar a restauração antes de alterações de banco.

Critérios de aceite: rotas WAHA anônimas retornam 401/403; sessão desconhecida retorna 404; instalação nova gera segredo exclusivo; cookies antigos não funcionam após revogação; restauração recupera o último registro confirmado e permite ler os tokens.

### 2. Tornar conversões e indicadores confiáveis

Criar serviço único para conversão e separar “evento” de “tentativa”. Persistir ID antes do efeito externo; usar identidade da venda e replay seguro. Corrigir prévia/duplicação e separar teste de produção. Remover click ID artificial e guardar atribuição histórica.

Corrigir dashboard: Purchase em produção, mesmas datas/fuso/moeda, todos os anúncios com gasto, série diária real e funil observado. Até lá, não usar esses números para decidir investimento ou prestar contas sem conciliação.

Critérios de aceite: repetir a mesma venda não gera outra conversão; falha no banco após aceite externo permite retry com mesmo ID; dados de teste não alteram receita; clique posterior não muda venda passada; soma diária confere com total no mesmo período.

### 3. Estabilizar atendimento e persistência

Rascunhos por conversa, separação por cliente e provider configurado no servidor. Tabela de mensagens, identificador externo, direção e horário originais; storage de mídias; player funcional. Worker Baileys contínuo, bootstrap, reconexão e dono único da sessão.

Critérios de aceite: troca A/B preserva o rascunho correto; mesmo telefone em dois clientes não mistura vendas; duas mensagens simultâneas não se perdem; restart retoma a recepção sem abrir a interface; áudio/imagem/documento podem ser recuperados; WAHA/Evolution conectados enviam pelo mesmo provider.

### 4. Consolidar qualidade e escala

Reativar tipos, corrigir testes e atualizar dependências. Adicionar CI e proteção da branch. Paginação/agregação no banco; polling incremental ou streaming; layout móvel; progresso real; configurações efetivas; exportação segura.

Critérios de aceite: tsc/testes/build passam sem ignorar falhas; teste móvel em360–390px com teclado; exportação respeita filtro completo; cada preferência produz efeito observável; testes de volume não perdem registros após os limites.

## Melhorias de arquitetura e produto

1. **Modelo de dados explícito.** Separar clients, leads/contacts, messages, attachments, touchpoints, conversions e conversion_attempts. Evita usar raw JSON como banco de mensagens e impede somar tentativas como vendas.
2. **Provider WhatsApp por cliente.** Um contrato único de conexão/status/texto/mídia/histórico, com capacidades claras. Evitar fallback silencioso entre números ou fornecedores.
3. **Painel e worker separados.** O frontend pode continuar em Netlify/Vercel; o processo Baileys precisa de execução contínua e armazenamento durável de sessões. Se tudo ficar em Docker, documentar volumes e restauração.
4. **Segredos fora da árvore do projeto.** Configuração gerada por instalação, credenciais cifradas no servidor, chave externa ao banco. Sessões WhatsApp e backups também contêm material sensível e precisam de proteção própria.
5. **Contrato de armazenamento e migrações.** Tipar filtros/operações e rodar os mesmos testes em SQLite/Postgres/REST. Usar migrações versionadas em vez de três schemas soltos; evitar DDL/backfills em cada partida.
6. **Indicadores conciliáveis.** Documentar fórmulas, origem, intervalo, fuso, moeda e completude. Separar aceitação da API, atribuição ao anúncio e venda comercial aprovada.
7. **Atendimento observável.** Estados reais de envio/entrega/leitura, última sincronização válida, erro recuperável, IDs de correlação e alertas de webhook/worker; retirar checks azuis e percentuais sem evidência.
8. **Consultas adequadas ao volume.** Lista resumida paginada; mensagens só da conversa aberta; mídia em storage; agregações por cliente/período. Verificar planos antes de adicionar índices, com atenção à ordenação por updated_at.
9. **Revisão de acessibilidade.** Contatos selecionáveis por teclado, botões semânticos, nomes acessíveis, dialog com foco/Escape e contraste coerente. O inbox precisa respeitar tema/densidade configurados.
10. **Documentação operacional atual.** Instalação conforme provider, modo manual/automático, recuperação, rotação de chave, limitações serverless, exportação e atualização. O README não deve prometer confirmação manual quando o backend automatiza.
11. **Se houver acesso de funcionários/clientes no futuro:** substituir senha única por contas, papéis, auditoria e autorização por empresa. Hoje cadastrar várias empresas não oferece esse isolamento.
12. **Integrações resilientes.** Timeout, retry limitado/backoff e fila para enriquecimento Meta. Evitar consulta Graph a cada mensagem e tarefas fire-and-forget que podem ser interrompidas em serverless.

## Pontos positivos preserváveis

- Separação inicial entre lógica de domínio e armazenamento, com uma fachada para três modos.
- Senhas com scrypt/sal e comparação em tempo constante; tokens Meta com AES-256-GCM e IV aleatório.
- RLS habilitada nas tabelas expostas, acesso privilegiado concentrado no servidor, adequado ao modelo atual de administrador único.
- Histórico de payload/resposta Meta e preservação de event_id no caminho de retry, embora a modelagem das tentativas precise correção.
- 115 testes existentes fornecem uma base útil de normalização, parsers, montagem de eventos e persistência.
- Recursos de conferência e identificação de cliente já existem e podem ser unificados no fluxo confiável.

## Limites e estado da entrega

Esta revisão cobre o código disponível no commit indicado e reproduções locais com dados fictícios. Não houve acesso a banco de produção, painel da hospedagem, tokens Meta, WhatsApp real ou dados de clientes; nenhum evento ou mensagem foi enviado a serviços reais. Meta, Postgres remoto e PostgREST reais não foram validados ponta a ponta. Não é possível garantir que uma revisão encontre toda falha possível nem afirmar que estes caminhos já causaram incidentes.

O repositório permaneceu sem alterações: não houve commit, PR, publicação, troca de senha ou rotação de chave. Os testes e o navegador usaram diretórios temporários separados. Este documento entrega o diagnóstico e os critérios concretos para uma próxima etapa de correção.

Foram aplicadas as skills de ambiente em nuvem, verificação, Supabase e práticas de Postgres para orientar a análise. Todas as referências de código apontam para o commit fixado, para que mudanças futuras não desloquem a evidência.

