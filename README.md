# Track Manual

Painel para enviar manualmente ao Meta as conversões de anúncios Click-to-WhatsApp. Os leads chegam da
Leona, você confere cada venda, põe o valor e clica em enviar. Nada sai sem o seu clique, e tudo que foi
enviado fica registrado com a resposta do Meta.

O mesmo código roda de dois jeitos:

| | Online (Netlify + Supabase) | No computador |
| --- | --- | --- |
| Abre no celular em qualquer lugar | Sim | Só no mesmo Wi-Fi |
| Leads chegam sozinhos da Leona | Sim | Não (importa o CSV) |
| Contas necessárias | GitHub, Netlify, Supabase (gratuitas) | Nenhuma |
| Onde ficam os dados | Postgres no Supabase | Arquivo na pasta `data/` |

O painel decide o modo sozinho: com a variável `DATABASE_URL` definida, é online; sem ela, é local.

---

## Colocar Online (Netlify + Supabase)

### 1. Arrumar o Repositório

O repositório precisa ter **só esta versão, na raiz** (package.json, app/, lib/ etc. direto na raiz, sem
pasta `track-manual/` dentro). Se a pasta do repositório no seu computador tem uma versão antiga:

1. Apague tudo dentro dela, **menos a pasta `.git`** (ela fica escondida; se não a vir, tudo bem).
2. Cole dentro dela o **conteúdo** da pasta `track-manual` deste zip (os arquivos e pastas, não a pasta em si).
3. Faça o commit e o push (no GitHub Desktop: escreva uma mensagem, "Commit to main", depois "Push origin").

O Netlify percebe o push e faz o build sozinho. Nesse primeiro build ele ainda vai reclamar de banco de
dados; é o próximo passo.

### 2. Criar o Banco no Supabase

1. Entre em supabase.com e crie um projeto (região **South America (São Paulo)**).
2. Na criação ele pede uma **senha do banco**. Use só letras e números (sem símbolos) e guarde a senha.
3. Com o projeto pronto, clique em **Connect** (botão no topo) e escolha a aba **Transaction pooler**.
4. Copie a URI, que se parece com
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
   e troque `[YOUR-PASSWORD]` pela senha do passo 2.

Não precisa criar tabela nenhuma: o painel cria tudo sozinho na primeira vez que conecta.

### 3. Configurar o Netlify

1. No site, **Site configuration > Environment variables > Add a variable**.
2. Chave `DATABASE_URL`, valor = a URI do passo anterior. Salve.
3. **Deploys > Trigger deploy > Deploy site**.
4. Abra o endereço do site (`https://seu-site.netlify.app`). Na primeira tela, crie a sua senha.

Opcional: a variável `APP_SECRET` (64 caracteres aleatórios) guarda fora do banco o segredo que protege os
tokens do Meta. Sem ela, o painel gera um e guarda na tabela `settings`.

### 4. Cadastrar o Cliente e Ligar a Leona

1. **Clientes > Cadastrar Cliente**: pixel, token da API de Conversões, ID da Página, e o **código de
   Eventos de Teste** para começar em modo de teste (veja "Acessos no Meta" abaixo).
2. Na página do cliente, a seção **Como os Leads Entram** mostra o endereço e o corpo para o bloco de
   **Integração** da Leona. Adicione o bloco no fluxo de boas-vindas, logo depois do início: método POST,
   cabeçalho `Content-Type: application/json`, o endereço e o corpo. Ligue as duas saídas do bloco ao passo
   seguinte.
3. Confira os nomes das variáveis no seletor de variáveis da Leona (CTWA Click ID, Source ID, Source URL,
   Thumbnail URL, Media URL).
4. Para os contatos antigos, exporte na Leona e use **Importar**.

### 5. Validar

1. Clique em um anúncio de verdade e mande uma mensagem. O lead aparece no painel; abra-o e veja em
   **Dados Brutos Recebidos** se o CTWA Click ID chegou. Se veio vazio, o nome da variável no bloco está errado.
2. Envie uma Compra de teste. Ela tem de aparecer em **Eventos de Teste** no Gerenciador de Eventos.
3. Se o Meta recusar, leia a mensagem no histórico. Tente desmarcar "Enviar dados extras" no cliente.
4. Deu certo: apague o código de teste do cliente. A partir daí conta como conversão.

---

## Rodar no Computador (Sem Contas)

1. Instale o **Node.js** (versão LTS) em https://nodejs.org.
2. Descompacte esta pasta e abra `iniciar.bat` (Windows), `iniciar.command` (Mac) ou `./iniciar.sh` (Linux).
3. Na primeira vez ele prepara tudo (2 a 4 minutos); depois abre na hora, em `http://localhost:3000`.
4. Crie a senha, cadastre o cliente e importe o CSV da Leona.

Os dados ficam na pasta `data/` (banco + configuração). Para backup, copie a pasta.

---

## O Que o Painel Faz

**Leads.** Chegam pela Leona (online) ou pelo CSV exportado dela. O painel reconhece as colunas pelo nome:
nome, telefone, e-mail, CTWA Click ID, ID de origem (ID do anúncio), URL de origem, URL da miniatura e URL
da mídia. O estado é sugerido pelo DDD; cidade e CEP você completa. Importar de novo só atualiza pelo telefone.

**Envio Manual.** Você escolhe o evento (Compra, Lead, Lead Qualificado, Início de Checkout e mais dez),
informa valor e produto, clica em **Conferir Antes de Enviar** e vê exatamente o que vai para o Meta. Só
depois aparece o botão de enviar. Se a mesma compra já foi enviada para aquele lead, o painel avisa e trava.

**Histórico.** Cada envio guarda o que foi enviado, a resposta do Meta e o `fbtrace_id`. Envio com erro
tem **Reenviar**, com o mesmo `event_id`, para o Meta nunca contar em dobro.

**Dados do Meta.** Pelo ID do anúncio, busca campanha, conjunto, anúncio, miniatura, gasto, impressões,
cliques e conversas iniciadas.

**Vários Clientes.** Cada cliente tem pixel, tokens, Página e endereço de entrada próprios.

## Acessos no Meta (Cadastrados Dentro do Painel)

**ID do Pixel.** Gerenciador de Eventos > seu pixel; aparece no topo da tela de Configurações.

**Token da API de Conversões.** Na mesma tela > **API de Conversões** > **Gerar token de acesso**.

**ID da Página.** Na Página do Facebook ligada ao WhatsApp dos anúncios: **Sobre > Transparência da Página**.

**Token de Leitura dos Anúncios** (só para puxar campanha e gasto). Configurações do Negócio > **Usuários >
Usuários do sistema** > **Adicionar** (Funcionário) > **Atribuir ativos** > a conta de anúncios > **Gerar
token** com a permissão `ads_read`, validade "nunca expira". Precisa de um aplicativo no Business Manager;
se não houver, crie um do tipo Empresa em developers.facebook.com.

**Código de Eventos de Teste.** Gerenciador de Eventos > pixel > aba **Eventos de Teste** > código `TEST…`.

## Contagem em Dobro

A Leona já envia Compra pelo bloco de Pixel quando a venda é aprovada pelo fluxo. Se o painel enviar a
mesma venda, o Meta conta duas. Regra recomendada: **o painel é o único que envia Compra**. Depois de
validado, remova os blocos de Pixel de Compra dos fluxos.

## Como o Evento É Montado

```json
{
  "event_name": "Purchase",
  "event_time": 1789967760,
  "event_id": "uuid-gerado-no-envio",
  "action_source": "business_messaging",
  "messaging_channel": "whatsapp",
  "user_data": {
    "ctwa_clid": "texto puro, exatamente como chegou",
    "page_id": "ID da Página",
    "ph": ["hash"], "fn": ["hash"], "ln": ["hash"],
    "ct": ["hash"], "st": ["hash"], "country": ["hash"], "external_id": ["hash"]
  },
  "custom_data": {
    "value": 29.9, "currency": "BRL", "content_name": "3 - FOTOS - 29,90",
    "ctwa_source_id": "ID do anúncio", "ctwa_source_url": "URL de origem"
  }
}
```

- **Quem atribui a venda ao anúncio é o `ctwa_clid`.** ID e URL de origem vão como propriedades personalizadas.
- **Telefone nas duas formas** (com e sem o nono dígito), porque o WhatsApp e o cadastro no Facebook diferem.
- **Nomes limpos**: emojis e letras enfeitadas são removidos antes do hash.
- **Sem `ctwa_clid`** o evento vai como conversa (`chat`), casado só pelo telefone; o painel avisa antes.
- **Página ou WABA.** A documentação do Meta pede o ID da Conta do WhatsApp Business (API Oficial). Com API
  não oficial (uazapi), o caminho usado na prática, inclusive pelo bloco de Pixel da Leona, é `ctwa_clid` +
  ID da Página. O painel usa a Página como padrão. **Valide em modo de teste antes de produção.**
- **Dados extras desligáveis** por cliente, caso o Meta recuse os campos com hash.
- **Prazo**: evento com mais de 7 dias gera aviso; no futuro é bloqueado.

## Para Quem Programa

```bash
npm install
npm run dev                                   # modo local, http://localhost:3000
DATABASE_URL=postgres://... npm run dev       # modo online contra um Postgres
npm test                                      # testes (SQLite)
TEST_DATABASE_URL=postgres://... npm test     # testes também contra Postgres
```

Variáveis: `DATABASE_URL` (liga o modo online), `APP_SECRET` (opcional), `PORT`, `TRACK_DATA_DIR`
(pasta dos dados no modo local), `META_API_VERSION` (padrão v25.0).

```
app/(painel)/            telas: leads, importar, detalhe do lead, eventos, clientes, configurações
app/api/webhook/leona/   entrada automática de leads
app/actions.ts           salvar, importar, conferir, enviar, reenviar, puxar dados do anúncio
lib/store.ts             fachada do banco: escolhe SQLite ou Postgres pelo ambiente
lib/store-sqlite.ts      modo local (SQLite embutido no Node)
lib/store-pg.ts          modo online (Postgres via DATABASE_URL)
lib/config.ts            segredo e senha (config.json local ou tabela settings)
lib/meta.ts              montagem do evento, envio, consulta do anúncio
lib/csv.ts               leitura do CSV e reconhecimento das colunas
lib/ingest.ts            criação/atualização de leads, inclusive em lote
netlify.toml             configuração do Netlify
scripts/iniciar.mjs      iniciador do modo local
tests/                   testes automáticos
```

Funciona igual na Vercel: basta a mesma variável `DATABASE_URL`.

## Segurança

- Tokens do Meta ficam criptografados (AES-256-GCM) e nunca voltam para a tela.
- A senha é guardada como hash (scrypt); o histórico guarda o corpo enviado sem o token.
- Dados pessoais vão ao Meta sempre com hash SHA-256. O painel guarda nome e telefone em texto; trate o
  acesso ao banco com o mesmo cuidado que a Leona.
- O endereço de entrada da Leona funciona como senha: não publique.
