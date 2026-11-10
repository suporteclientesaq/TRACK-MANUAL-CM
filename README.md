# Track Manual Flow 3.0.3

Central de atendimento e CRM para organizar contatos WhatsApp, acompanhar oportunidades e registrar conversões manuais na Meta. Interface com navegação lateral, atendimento em três painéis, funil persistente e adaptação ao celular.

A ingestão de contatos pela Leona, por webhooks e por importação não dispara `Purchase` automaticamente. Uma venda passa por conferência; outra compra do mesmo contato exige confirmação explícita. Reenvios conservam o identificador, destino, modo de teste e corpo da intenção original. A aceitação do evento pela Meta não comprova atribuição ao anúncio.

## Instalação local

Use Node.js 22.13 ou superior. A validação local desta entrega usou Node 24.22.1.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run start
```

Abra `http://localhost:3000`, crie a senha inicial e cadastre as empresas em **Clientes**. Os iniciadores `iniciar.bat`, `iniciar.command` e `iniciar.sh` continuam disponíveis para a instalação local.

Sem configuração de banco remoto, o sistema usa SQLite em `data/` ou no diretório de `TRACK_DATA_DIR`. Não versione essa pasta. Antes de atualizar uma instalação existente, leia o [procedimento de migração](docs/FLOW-3.0-MIGRACAO.md).

## Armazenamento e ambiente

| Variável                                              | Uso                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRACK_DATA_DIR`                                      | Diretório persistente do SQLite, configuração e sessões locais.                                                                                                                  |
| `APP_SECRET`                                          | Segredo exclusivo, estável, com pelo menos 32 caracteres aleatórios. Tem prioridade local e online. Preserve-o fora do Git; sua troca exige recadastrar ou recifrar credenciais. |
| `DATABASE_SSL_CA`                                     | Certificado CA oficial do provedor em PEM; aceita quebras de linha reais ou `\n` literais. Mantém validação do certificado e hostname.                                           |
| `DATABASE_SSL_CA_BASE64`                              | Alternativa: o PEM completo em base64, em vez de `DATABASE_SSL_CA`. Use apenas uma das duas.                                                                                     |
| `DATABASE_URL`                                        | Postgres direto. O servidor cria as tabelas ao inicializar o armazenamento.                                                                                                      |
| `SUPABASE_DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | PostgREST, como alternativa à conexão direta. Use chave de serviço exclusivamente no servidor e prepare o esquema de `supabase-tabelas.sql`.                                     |
| `TRACK_WHATSAPP_AUTO_RECONNECT=false`                 | Desabilita a retomada automática de canais nativos, útil em homologação e CI.                                                                                                    |
| `TRACK_WAHA_API_KEY`                                  | Chave opcional de serviço, com pelo menos 32 caracteres, para as rotas internas compatíveis com WAHA. O painel autenticado usa a própria sessão.                                 |

Não coloque `.env`, bancos, chaves ou sessões no repositório nem na imagem Docker. O [guia de migração](docs/FLOW-3.0-MIGRACAO.md) explica volume persistente, segredo antigo exposto, restauração e rollback.

## Certificado SSL do banco

Se aparecer `self-signed certificate`, obtenha o certificado CA oficial com o provedor e configure `DATABASE_SSL_CA` no ambiente do Track Manual. Use o PEM completo com as linhas BEGIN/END CERTIFICATE. Mantenha host, porta, usuário e banco da URI fornecida pelo provedor. Em VPS com Docker, recrie o contêiner do Track Manual com as variáveis novas e o volume existente. Em hospedagem gerenciada, faça um novo deploy. A aplicação aplica a CA configurada também com `sslmode=require`.

Veja [a correção de SSL e as instruções para o Antigravity](docs/FLOW-3.0.2-SSL-POSTGRES.md). Certificado expirado e hostname incorreto precisam ser corrigidos pelo provedor; não se resolvem apenas adicionando uma CA. Testes locais de TLS exigem o OpenSSL CLI; a aplicação em execução usa o TLS do Node.

## WAHA na VPS e QR de pareamento

A versão 3.0.3 corrige QR no formato oficial `{mimetype,data}`, QR bruto e imagem binária; status, start/restart, atualização de sessão por PUT e consulta automática do QR. Chave/endereço recusados não substituem uma configuração funcional antes da verificação.

O WAHA deve existir como serviço persistente separado. Configure no servidor do Track `WAHA_SERVER_URL`, `WAHA_API_KEY`, `WAHA_SESSION_NAME=default` e, se houver várias empresas, `WAHA_CLIENT_ID`. A tela pode usar essas variáveis sem pedir a chave no navegador. Dados manuais também continuam disponíveis. Consulte [instalação e vínculo da VPS](deploy/waha/README.md), com modelo Compose e diagnóstico. O painel YouSecure não é a URL da API do WAHA, e a chave da plataforma não é necessariamente a chave do WAHA.

## Atendimento e canais

Em **Canais WhatsApp**, selecione a empresa e configure um provedor: nativo, WAHA ou Evolution. Status e envios usam o provedor salvo para essa empresa. Configurações antigas guardadas no navegador ou em parâmetros globais precisam ser conferidas e cadastradas nesse novo fluxo.

O modo nativo exige um servidor Node contínuo, disco persistente e um único responsável por sessão. Em serverless, use um provedor externo persistente. O painel não fornece coordenação de sessões nativas entre réplicas.

Em **Clientes**, copie a URL de entrada correspondente à integração escolhida. Configure webhooks e valide recebimento e resposta com um número de homologação. Contatos também podem entrar por CSV/TXT. Um ID de anúncio e um CTWA Click ID são informações diferentes; o sistema não fabrica um clique a partir do anúncio.

Conversas oferecem rascunhos por contato, anotações, busca no histórico e reprodução de mídia quando o conteúdo está disponível. Mover uma oportunidade para **Ganho** no funil salva o estágio comercial; não envia uma conversão por si só.

## Campanhas e CTWA

No dashboard, selecione a empresa, use **Carregar campanhas da conta** e escolha **Somente ativas**, **Somente pausadas** ou **Todos os status**. O seletor permite marcar campanhas específicas da conta daquela empresa. O status pertence à campanha e não é inferido do anúncio; uma campanha ativa pode conter anúncios pausados. Os filtros afetam a tabela e a sincronização, enquanto os indicadores gerais preservam o total do cliente/período. O catálogo informa o horário da consulta; atualize-o para conferir mudanças na Meta.

CTWA é extraído somente de campos ou parâmetros explicitamente identificados. Um CTWA real exige Página ou WABA no cadastro; se faltar, a conversão fica bloqueada em vez de perder o clique em uma mudança automática para telefone. As referências de clique/anúncio/horário são preservadas em conjunto e sob atualização atômica. Isso não garante atribuição pela Meta nem recupera cliques antigos que nunca chegaram corretamente.

Consulte a [revisão específica de CTWA e campanhas](docs/FLOW-3.0.1-CTWA-CAMPANHAS.md).

## Indicadores

Receita e vendas usam apenas `Purchase` de produção aceito, sem somar testes, checkouts ou tentativas repetidas. Moedas permanecem separadas. Referências de anúncio usam o payload preservado da conversão.

O cache legado contém gasto acumulado do anúncio. Sem investimento validado para o período selecionado, investimento, lucro, CPA e ROAS aparecem sem dados. Não são calculados a partir de um denominador incompatível.

## Backup e acesso

O download em **Configurações** gera um snapshot consistente do SQLite. Ele não inclui `config.json`, o segredo externo nem os arquivos locais de sessão. Preserve esses elementos separadamente e teste a restauração. Para bancos remotos, use o backup do provedor.

A autenticação continua sendo de um administrador do painel. Várias empresas cadastradas não representam usuários isolados por organização. O limite de tentativas de login é por processo; múltiplas réplicas precisam de limitação compartilhada.

## Validação e revisão

O workflow de CI prepara instalação, tipos, testes e build em Node 22 e 24. As validações locais usam dados fictícios; integrações reais com Meta, WhatsApp e bancos remotos precisam de homologação própria.

- [Revisão da versão 3.0 e limites conhecidos](docs/FLOW-3.0-REVISAO.md)
- [Instalação e migração](docs/FLOW-3.0-MIGRACAO.md)
- [Situação dos achados da auditoria](docs/FLOW-3.0-ACHADOS.md)
- [Auditoria histórica da versão 2.6.2](docs/AUDITORIA-2.6.2.md)

A referência visual informada foi a Leona Solutions; somente sua página pública de login estava acessível. O Track Manual mantém identidade própria.
