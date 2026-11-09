# Flow 3.0.2 — certificado SSL de Postgres personalizado

Esta correção foi preparada para a mensagem `self-signed certificate` ao conectar a `db.yousecure.io:5437`. O código e os testes foram alterados localmente; não houve acesso ao banco do usuário ou publicação na instalação Netlify dele.

## Causa e correção

O driver recusou um certificado que não conseguiu validar com as autoridades confiáveis. Essa mensagem acontece antes de concluir a conexão e não confirma que senha e banco estejam corretos.

A versão anterior mantinha a validação TLS, mas não oferecia configuração explícita da CA do provedor. Além disso, parâmetros como `sslmode` na URI podem substituir o objeto `ssl` quando a biblioteca `pg` analisa `connectionString`, descartando uma CA passada separadamente. A orientação da tela também pressupunha Supabase, mesmo em um endereço personalizado.

A versão 3.0.2 interpreta a URI uma vez, entrega campos explícitos ao Pool e configura a confiança TLS separadamente. O certificado e o hostname continuam validados. CA/certificados/credenciais diferentes invalidam o pool e o cache de diagnóstico. A tela separa CA não confiável, certificado expirado e nome incorreto, ocultando credenciais.

## O que configurar no Netlify

1. Aplique o código 3.0.2 com seu `package.json` e `package-lock.json`. A instalação passa a declarar `pg-connection-string` 2.14.0 diretamente.
2. Mantenha `DATABASE_URL` com a URI oficial desse banco, incluindo seu host e sua porta. Não é necessário migrar para um pooler Supabase para corrigir um erro de CA de um provedor diferente.
3. Obtenha a CA oficial no painel, documentação ou suporte do provedor. Não confie automaticamente em um certificado apenas porque o servidor o apresentou.
4. Em Environment variables, crie `DATABASE_SSL_CA` com o PEM completo, incluindo `-----BEGIN CERTIFICATE-----` e `-----END CERTIFICATE-----`. São aceitas quebras de linha reais ou `\n` literais.
5. Se o painel não facilitar PEM multilinha, pode usar `DATABASE_SSL_CA_BASE64` com o PEM completo codificado em base64, em vez de `DATABASE_SSL_CA`. Não configure ambas.
6. Faça um novo deploy do código atualizado e recarregue o painel. Para concluir a homologação, confirme uma consulta e o funcionamento do sistema nesse ambiente.

O suporte à variável depende do código novo; adicionar a variável a uma versão antiga não basta. Não envie a senha do banco no chat. O link oficial da CA ou o nome do painel do provedor ajuda a identificar o arquivo correto sem expor credenciais.

## Compatibilidade

`sslmode=require` mantém TLS verificado com a CA configurada. `sslrootcert` continua disponível para um arquivo acessível no servidor; `sslcert`/`sslkey` são tratados juntos quando o provedor exige autenticação por certificado. Configurações conflitantes geram mensagem em vez de descartar silenciosamente um certificado. Modos fracos não são escolhidos automaticamente após falha de validação; esta correção não requer `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Certificado expirado deve ser renovado. Se o nome do certificado não corresponder ao host, peça ao provedor o endpoint/certificado correto. Adicionar a CA não substitui essas verificações.

## Validação e alcance

Foram exercitados a preservação da CA apesar dos parâmetros da URI, a rotação do pool/cache e os diagnósticos sem segredos. Testes de TLS criam certificados temporários com OpenSSL, que é uma dependência de desenvolvimento desses testes, não do servidor em produção.

Em PostgreSQL 17.11 isolado no Docker, três testes passaram: cadeia privada sem CA rejeitada; CA correta permitindo `SELECT 1` e TLS 1.3; hostname incorreto rejeitado. O teste está em `tests/pg-ssl-integration.test.ts`, opt-in com `TEST_SSL_DATABASE_URL` e `TEST_SSL_DATABASE_CA`; sem essas variáveis, seus três casos são ignorados. Ele executa apenas SELECTs. O contêiner de teste e seu volume foram removidos.

Isso valida a correção em ambiente controlado. A conexão real com `db.yousecure.io` ainda depende da CA oficial e da configuração/publicação na instalação do usuário.

## Instrução curta para o Antigravity

Aplique a correção 3.0.2 preservando as melhorias anteriores de CTWA/campanhas. Leia este guia, `lib/pg-connection.ts`, `lib/store-pg.ts`, `lib/db-url.ts` e `app/StorageProblem.tsx`. Use a CA oficial em `DATABASE_SSL_CA`, não desative a validação global, preserve o endpoint e a porta do provedor e execute tipos, testes e build. Confirme identidade/permissão no repositório e o ambiente correto antes de aplicar a atualização hospedada. Não presuma que a conexão real já foi validada.
