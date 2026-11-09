# Instalação e vínculo do WAHA com a VPS

O WAHA é um serviço separado do Track Manual. Comprar uma VPS/PaaS disponibiliza infraestrutura; não instala o WAHA nem informa automaticamente ao Track onde ele está. A chave da plataforma YouSecure e a senha do dashboard não são necessariamente a `WAHA_API_KEY`.

## Se o WAHA já está instalado

No painel da aplicação WAHA, identifique o domínio HTTPS público e a chave da API. O endereço do painel YouSecure (`/paas/dashboard`) não é o endereço da API do WAHA. Em WAHA Core, use a sessão `default`; sessões com outros nomes requerem uma edição que as suporte.

Configure no ambiente que executa o **Track Manual**, não somente no contêiner WAHA:

- `WAHA_SERVER_URL`: URL HTTPS da instalação WAHA, sem `/dashboard`, Swagger ou credenciais.
- `WAHA_API_KEY`: chave de API que essa instalação aceita no cabeçalho `X-Api-Key`.
- `WAHA_SESSION_NAME`: `default` para WAHA Core.
- `WAHA_CLIENT_ID`: ID da empresa no Track Manual, necessário se houver várias empresas. É o ID presente na URL de cadastro da empresa.

Com uma única empresa, o vínculo de ambiente pode ser inferido. Com várias, o sistema não associa silenciosamente a mesma sessão a todas. Depois de reiniciar/publicar o Track, escolha WAHA e “Usar WAHA da VPS configurado no ambiente do servidor”. Assim a chave não precisa ser digitada no navegador. A alteração de variáveis exige uma nova execução/deploy.

Se optar por configuração manual, os três campos continuam necessários. A chave fica cifrada; um endereço de servidor novo exige sua própria chave. A mesma sessão não deve ser cadastrada em duas empresas.

## Se o WAHA ainda não está instalado

Primeiro confirme se seu plano YouSecure oferece contêiner/processo contínuo, volume persistente e rota pública HTTPS. Um serviço que dorme ou reinicia sem preservar a sessão não sustenta o WhatsApp continuamente. O painel protegido não permite confirmar o plano ou instalar o serviço sem acesso autenticado apropriado.

O `compose.yaml` desta pasta é um modelo para **uma VPS com Docker e proxy HTTPS existente**. Ele não foi executado na VPS do usuário e não compra recursos nem altera o painel do provedor. Se usar um painel gerenciado, transcreva as configurações para o serviço de contêiner correspondente.

1. Escolha a imagem oficial e uma tag/digest verificada na documentação/release do WAHA (`WAHA_IMAGE`). Não use uma imagem de terceiro desconhecida.
2. Gere uma chave forte para `WAHA_API_KEY` e uma senha diferente para `WAHA_DASHBOARD_PASSWORD`, em um terminal/cofre privado. Não coloque valores reais no repositório.
3. Defina essas variáveis no terminal/cofre que executará o Compose. A porta interna é 3000; o exemplo expõe apenas `127.0.0.1:3001` ao proxy da própria VPS.
4. Execute na VPS, com as variáveis configuradas:

```sh
docker compose -f compose.yaml config --quiet
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs --tail 100 waha
```

5. Publique o serviço pelo proxy HTTPS existente, encaminhando ao WAHA. Preserve as configurações dos outros aplicativos; confirme domínio/DNS e a porta antes de editar o proxy.
6. Configure o Track Manual conforme a primeira seção. O endereço deve ser acessível **pelo servidor que executa o Track**. `localhost` no Track significa o próprio servidor dele, não uma VPS em outra máquina.

Os volumes preservam sessões e mídia. Não execute `down -v` para reiniciar. Mantenha backup e verifique espaço/RAM e logs do contêiner, especialmente ao usar o engine WEBJS/Chrome.

## Pareamento e diagnóstico

“Salvar e conectar” verifica o serviço antes de substituir credenciais, cria/inicia a sessão e salva o webhook da empresa. O QR pode levar alguns segundos. A tela consulta novamente a cada 5 segundos e substitui o QR recebido; não deve manter um código antigo quando a API falha ou a sessão muda. Se o WAHA ficar `FAILED` após expirar os QR, use “Salvar e conectar” para reiniciar explicitamente.

- Chave recusada: confirme a chave de API do WAHA e suas permissões, não a senha do painel.
- HTML em vez de JSON: endereço do painel, proxy incorreto ou página de login na frente da API.
- Gateway/timeout: serviço parado, DNS, HTTPS, porta ou rota do proxy.
- Sessão não suportada no Core: use `default`.
- Conectado sem webhook: a chave deve permitir atualizar a configuração da sessão.
- QR não aparece no painel WAHA também: investigue o engine/contêiner primeiro; o Track não consegue fabricar um QR válido sem a sessão real.

O pareamento exige o WhatsApp do proprietário do número. Não há garantia de operação real até validar sessão, webhook, recebimento e envio na instalação correta.

Referências oficiais: https://waha.devlike.pro/docs/overview/quick-start/ e https://waha.devlike.pro/docs/how-to/sessions/.
