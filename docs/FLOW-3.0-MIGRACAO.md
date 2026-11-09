# Track Manual CM 3.0 — instalação e migração

Este procedimento acompanha o código preparado a partir de `7a42f374440688273d15c6beb5c946f3e24f5ca8`, na branch local `codex/leona-flow-redesign`. A entrega é um pacote revisável; não altera por si só o repositório GitHub nem a instalação em produção.

## 1. Preserve uma recuperação completa

Antes de substituir o código, faça um backup e confira sua restauração em uma pasta/ambiente separado.

- **SQLite local:** preserve o banco consistente, `config.json`, o valor de `APP_SECRET` se definido e a pasta de sessões nativas. O diretório de dados é `TRACK_DATA_DIR` ou a pasta `data` da instalação. Pare a aplicação para uma cópia integral do diretório, ou use uma ferramenta de backup SQLite que inclua os commits no WAL. Não copie somente um `.db` aberto como garantia de backup.
- **Postgres/PostgREST:** use o mecanismo de backup do provedor e preserve as variáveis de conexão e o segredo externo. O painel não oferece download de arquivo SQLite para bancos remotos.
- **Credenciais:** guarde as chaves em cofre ou armazenamento privado. Não coloque banco, configuração, sessões, `.env` ou segredos no Git. Restrinja o acesso aos backups; o banco contém dados de clientes e pode conter material sensível de versões anteriores.

O download de backup da versão 3.0 é um snapshot consistente do SQLite. Ele **não inclui** `config.json`, `APP_SECRET` nem arquivos locais de sessão WhatsApp. Um banco isolado pode recuperar contatos e eventos, mas não garante a recuperação dos tokens e canais.

## 2. Trate o segredo que foi publicado

A versão antiga versionava um arquivo de configuração de execução. A versão 3.0 remove esse arquivo da distribuição e bloqueia a chave conhecida por fingerprint, sem expor seu valor. Se a instalação reutiliza essa chave, o bloqueio é intencional: não contorne a verificação nem restaure a configuração pública como credencial válida.

1. Preserve o backup antigo em local privado antes de qualquer alteração.
2. Gere um `APP_SECRET` exclusivo com pelo menos 32 caracteres aleatórios; recomenda-se 32 bytes em hexadecimal. Por exemplo, execute `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` em um terminal privado e guarde o resultado diretamente no gerenciador de segredos da instalação. Não envie o resultado em mensagem, log público ou commit.
3. Configure esse segredo no ambiente que executará o servidor. Na versão 3.0, ele tem prioridade tanto local quanto online e deve permanecer estável entre reinícios e restaurações.
4. Considere comprometidos os tokens que estiveram cifrados com uma chave publicamente conhecida. Revogue/substitua as credenciais afetadas nos respectivos provedores e recadastre os tokens Meta e as chaves de WAHA/Evolution no painel.
5. Reinicie a aplicação e entre novamente. A troca do segredo invalida os cookies antigos; trocar também a senha do painel cria uma nova credencial e revoga as sessões de login anteriores.
6. Confira os dispositivos vinculados ao WhatsApp, revogue os que não reconhecer e faça novo pareamento quando necessário. Backups cifrados com a chave anterior não são automaticamente recifrados com a nova.

Trocar `APP_SECRET` sem recadastrar/recifrar os dados existentes torna os tokens e backups de sessão protegidos pela chave anterior ilegíveis. Esta entrega não fornece um migrador automático de rotação. Se uma instalação já tinha um segredo privado exclusivo e não exposto, preserve-o durante uma atualização comum e durante a restauração.

Remover um arquivo da versão atual não apaga o histórico público. Uma limpeza de histórico, se desejada, é um procedimento separado e não substitui revogar/rotacionar os segredos expostos.

## 3. Instale o código em homologação

Use Node.js 22.13 ou superior. A CI foi preparada para as linhas 22 e 24. Extraia o código em uma pasta limpa; não carregue dados fictícios de demonstração como dados de produção.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run start
```

Configure previamente as variáveis de banco/ambiente apropriadas ao seu modo de armazenamento. Para homologar sem retomar canais nativos, use `TRACK_WHATSAPP_AUTO_RECONNECT=false`. Evite abrir dois processos sobre a mesma sessão WhatsApp nativa. Confira as mensagens de inicialização antes de disponibilizar o acesso.

O primeiro cadastro de senha tem exclusão mútua. Se o processo local for interrompido durante esse cadastro e ainda não existir senha, pare todos os processos, confirme essa condição e remova apenas o arquivo `config.json.setup-lock` antes de tentar novamente. Não remova esse lock com outro cadastro em andamento.

O pacote não deve conter `data/config.json`, banco, `.env` ou sessões. Se aplicar mudanças por Git a uma cópia antiga, confirme que o arquivo de execução saiu do versionamento e continua fora do índice; preserve sua cópia privada de recuperação antes de removê-lo.

## 4. Escolha a execução do WhatsApp

**Servidor Node persistente:** o modo nativo precisa de processo contínuo, disco persistente e um único responsável por sessão/cliente. O bootstrap retoma canais nativos salvos, salvo quando `TRACK_WHATSAPP_AUTO_RECONNECT=false`. Isso não oferece coordenação entre réplicas; escalar o painel horizontalmente exige separar e supervisionar o worker de WhatsApp.

**Serverless:** use WAHA ou Evolution hospedado em um serviço persistente. A interface informa a indisponibilidade do modo nativo nesse ambiente; emular uma API interna não transforma a função em um worker contínuo.

Na nova tela **Canais**, confira a empresa, escolha o provedor e salve endereço, sessão/instância e chave de acesso. A configuração é por empresa. Configurações antigas guardadas no navegador ou em chaves globais não são uma migração automática para esse cadastro; confira e recadastre cada canal. Depois de trocar domínio/provedor, reconecte e valide o webhook de entrada da empresa correta.

Use HTTPS em produção. Endereços de provedores privados são aceitos por configuração administrativa; adote restrições de rede/allowlist conforme sua infraestrutura. Não compartilhe uma chave de serviço de administração com visitantes do painel.

## 5. Garanta persistência no Docker

A imagem nova não copia dados nem segredos do checkout. O diretório `/app/data` deve estar em volume persistente e gravável pelo usuário da aplicação. O exemplo abaixo usa uma imagem já construída e um arquivo de ambiente privado preparado pelo operador:

```sh
docker volume create track-manual-data
docker run --name track-manual --restart unless-stopped \
  --env-file /caminho/privado/track-manual.env \
  -p 3000:3000 \
  -v track-manual-data:/app/data \
  sua-imagem-track-manual:3.0.0
```

O arquivo privado deve conter o segredo estável e somente as variáveis necessárias. Não use um segredo diferente a cada criação de contêiner. Para migrar um volume existente, preserve-o primeiro, confira permissões e aplique a rotação descrita acima se houver exposição. Um volume persistente não é, por si só, backup externo.

## 6. Confira os fluxos antes da publicação

Em homologação, confirme login e troca de senha, seleção de empresa, recebimento e resposta por um canal de teste autorizado, mídia, rascunhos por contato, notas, funil e restauração do backup. As verificações automatizadas da entrega usam dados fictícios; não certificam contas externas reais.

Para Meta, use um cliente/pixel de homologação e o modo de teste adequado. Confira ID, moeda, horário, valor, destino e avisos na prévia. Uma nova compra exige intenção explícita; uma tentativa incerta deve ser retomada com o mesmo registro/ID. O webhook Leona e a importação TXT agora fazem ingestão sem compra automática a partir de um valor positivo.

É esperado que investimento, lucro, CPA e ROAS de um período apareçam sem dados enquanto não houver investimento diário validado. Não substitua essa ausência por gasto acumulado da vida do anúncio. Estágio “Ganho” do funil não equivale a envio de `Purchase` para Meta.

Confira também limites do proxy, HTTPS e headers de origem. O rate limit de login implementado é por processo; em múltiplas réplicas, configure limitação compartilhada na borda. Não exponha o painel como portal multiusuário por empresa sem implementar autorização própria.

## 7. Publicação e retorno à versão anterior

Publique somente depois de validar a instalação com seus provedores. O workflow incluído prepara verificações no GitHub, mas precisa ser enviado e executado no repositório para produzir evidência de CI remota.

Para retorno, pare os processos, preserve uma cópia do estado atual e restaure o conjunto consistente de código, banco, segredo/configuração e sessões da mesma geração. Não reative a chave antiga publicada para viabilizar um rollback. Como não há migrador automático de rotação, uma mudança de chave pode exigir novo cadastro de credenciais também no ambiente restaurado.

Os pontos ainda pendentes de arquitetura e a cobertura efetivamente realizada estão em [FLOW-3.0-REVISAO.md](FLOW-3.0-REVISAO.md).
