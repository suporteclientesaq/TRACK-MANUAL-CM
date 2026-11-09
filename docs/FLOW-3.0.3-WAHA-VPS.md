# Track Manual Flow 3.0.3 — WAHA, QR e VPS

## Resultado entregue

A integração foi corrigida no código local. A instalação real do WAHA na VPS YouSecure continua sem confirmação: o usuário não identificou um serviço WAHA e o painel fornecido exige autenticação. Não houve instalação, alteração de variáveis, pareamento ou envio de mensagens nessa infraestrutura.

Comprar uma VPS não instala automaticamente o WAHA. `https://yousecure.io/paas/dashboard` é o painel do provedor, não o endereço da API WAHA. Nenhuma credencial fornecida na conversa foi utilizada ou incorporada à entrega.

## Correções

- QR oficial `{mimetype, data}`, imagem binária e valor bruto são convertidos para imagem exibível. Respostas HTML, URLs arbitrárias e formatos inválidos são recusados.
- Atualização de sessão usa `PUT`, preserva configurações e webhooks externos. Falhas de autenticação, criação, atualização e início são informadas; consultar status não reinicia sessões.
- `STARTING`, `SCAN_QR_CODE`, `WORKING`, `STOPPED` e `FAILED` refletem o provedor. O QR é consultado durante `SCAN_QR_CODE`; falhas e troca de empresa descartam códigos anteriores. A tela consulta a cada cinco segundos sem sobrepor operações.
- WAHA Core sugere a sessão `default`. Endereços de painel e respostas inválidas recebem diagnóstico específico. A conexão testa a configuração proposta antes de sobrescrever as credenciais salvas.
- Configuração por ambiente do Track permite usar a VPS sem enviar a chave ao navegador. Em várias empresas, exige vínculo explícito por `WAHA_CLIENT_ID`. O cadastro verifica conflitos de sessão tanto no modo manual quanto no modo de ambiente; não constitui um bloqueio distribuído entre processos concorrentes.
- Chaves cifradas ilegíveis podem ser recadastradas. Mudar de servidor não reaproveita silenciosamente a chave anterior.

## Instalar e validar no ambiente real

Siga [deploy/waha/README.md](../deploy/waha/README.md). O modelo Compose requer uma VPS com Docker e proxy HTTPS existente; não foi executado na infraestrutura do usuário. Verifique primeiro o plano e os serviços já instalados. Preserve volumes e outros aplicativos.

Depois de instalar ou localizar o WAHA, configure no **servidor do Track Manual** `WAHA_SERVER_URL`, `WAHA_API_KEY`, `WAHA_SESSION_NAME=default` e o ID correto em `WAHA_CLIENT_ID`. A chave de API da plataforma e a senha do painel não substituem necessariamente a chave de API do WAHA.

Aceitação real: endpoint autenticado acessível pelo Track, sessão iniciada, QR atualizado, pareamento com o telefone do proprietário, estado `WORKING`, webhook recebido no cliente correto, mensagem de saída autorizada e persistência após reinício controlado. A chave não deve aparecer em HTML, logs públicos ou Git. A falha SSL do banco é uma pendência independente; verifique também o guia 3.0.2.

## Evidências e limites

- 293 testes unitários aprovados; três testes condicionais de PostgreSQL não executados nessa rodada padrão. Os três casos TLS já passaram separadamente na versão 3.0.2 em PostgreSQL isolado.
- Typecheck e build de produção aprovados.
- Seis verificações no navegador, com build de produção e API WAHA simulada: vínculo de ambiente sem chave no HTML; QR oficial exibido; `WORKING` remove QR; logout; troca de empresa e sessão padrão; largura de 390 px sem transbordamento. Sem erros de página.
- Os 19 fluxos anteriores de interface/CTWA/campanhas e as 14 imagens de antes/depois são evidências históricas da 3.0.1. Não representam uma conexão WhatsApp real nem uma nova rodada completa dessas telas na 3.0.3.

Nenhum resultado simulado comprova funcionamento na VPS, entrega de mensagens, atribuição Meta ou ausência de todos os bugs. GitHub de origem e produção não foram atualizados nesta entrega.

Referências oficiais: https://waha.devlike.pro/docs/how-to/sessions/ e https://waha.devlike.pro/docs/overview/quick-start/.
