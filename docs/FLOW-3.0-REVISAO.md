# Track Manual CM 3.0 — revisão da entrega Flow

Data: 9 de novembro de 2026. Repositório de origem: `suporteclientesaq/TRACK-MANUAL-CM`.

Base analisada: `main`, commit `7a42f374440688273d15c6beb5c946f3e24f5ca8` (versão 2.6.2). As mudanças desta entrega foram preparadas na branch local `codex/leona-flow-redesign`. O pacote de código e as capturas permitem revisar a implementação; o repositório de origem no GitHub ainda não foi alterado por esta entrega.

A revisão específica posterior está em [Flow 3.0.1 — CTWA e campanhas](FLOW-3.0.1-CTWA-CAMPANHAS.md). Ela inclui filtro de campanhas ativas, seleção explícita, origem atômica e bloqueio quando um CTWA real não tem Página/WABA.

## O produto e a referência visual

O sistema é uma central de atendimento e CRM: recebe contatos e mensagens, organiza o atendimento por empresa, associa referências de anúncios, registra conversões manuais e envia eventos para a Meta. Oferece SQLite local, Postgres direto e PostgREST como alternativas de persistência. O cadastro de várias empresas continua dentro de um painel com um administrador; não equivale a usuários independentes com permissões por empresa.

A referência indicada foi `https://app.leonasolutions.io/welcome`. Foi possível observar a página pública de login, pois a área interna exige autenticação. A nova interface usa navegação lateral, superfícies claras e tons de roxo com identidade própria do Track Manual; não se afirma que seja uma reprodução da área interna da Leona Flow.

## Mudanças concretas

| Área         | Comportamento da entrega                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navegação    | Menu lateral, busca, seleção de empresa, ajuda, saída e navegação móvel com fechamento por Escape.                                                                                                                                                         |
| Conversas    | Lista, histórico e detalhes em três painéis; no celular, navegação entre lista, conversa e detalhes. Rascunhos separados por contato, notas persistidas, busca no histórico e controles reais de áudio/imagem/documento quando o conteúdo está disponível. |
| Contatos     | Filtros por empresa e situação, exportação de todos os contatos do filtro e neutralização de fórmulas no CSV.                                                                                                                                              |
| Funil        | Estágios comerciais persistidos por contato, com seleção ou arraste. Mover para “Ganho” não dispara conversão automaticamente. A tela informa o limite dos contatos recentes exibidos.                                                                     |
| Canais       | Configuração por empresa de WhatsApp nativo, WAHA ou Evolution. A conexão, o status e o envio usam o mesmo provedor configurado. Credenciais externas ficam cifradas no servidor.                                                                          |
| Conversões   | Revisão antes do envio, confirmação de nova compra e evento durável com chave de idempotência antes da chamada externa. Reenvios reutilizam o ID, o destino e o payload armazenados.                                                                       |
| Dashboard    | Receita apenas de `Purchase` em produção; tentativas repetidas deduplicadas. Compras de teste e checkouts não entram como receita. Referência do anúncio preservada a partir do payload da conversão.                                                      |
| Preferências | Tema e cor, alertas de som e título da aba, favicon limitado, limpeza manual de mídia, troca de senha e backup com instruções de recuperação. Controles sem efeito operacional foram retirados.                                                            |

As notificações e atualizações consultam dados com controle de requisição em andamento e pausa de polling quando a aba está oculta. A lista de conversas usa resumos em vez de devolver continuamente todos os históricos e anexos. Atualizações e falhas têm estados visíveis; percentuais aleatórios de sincronização foram removidos dos fluxos novos.

## Segurança, integridade e regras de negócio

- A configuração de execução com segredo publicado foi retirada do código e da imagem Docker. A aplicação reconhece o fingerprint desse segredo antigo e recusa sua reutilização. Isso exige ação de migração em instalações afetadas; a remoção do arquivo não apaga o segredo do histórico público nem substitui a rotação.
- `APP_SECRET` tem prioridade também no modo local. A criação inicial é exclusiva/atômica; credenciais online usam um par de sal e hash armazenado em uma linha. O hash de senha é calculado de forma assíncrona.
- Cookies de login dependem da credencial atual. Trocar a senha revoga os cookies anteriores sem trocar indiscriminadamente a chave AES dos tokens. O contador de tentativas de login é local ao processo; não é um rate limit distribuído.
- As rotas internas compatíveis com WAHA exigem sessão autenticada ou chave de serviço. Sessão desconhecida retorna 404; consultar status ou QR não inicia conexão.
- Preferências aceitam somente as chaves previstas. O download SQLite usa um snapshot consistente, incluindo commits no WAL. Segredos e sessões não acompanham esse download comum.
- O merge de mensagens considera provedor e ID externo, preserva direção e horário de origem e aplica atualizações atômicas nos adaptadores de armazenamento. Atualizações parciais de anúncio preservam os demais campos do cache.
- A ingestão Leona e a importação TXT não transformam um valor positivo em compra automática. Eventos passam pelo fluxo explícito de revisão/envio.
- IDs de clique artificiais não são criados. Conhecer o anúncio não comprova atribuição da Meta. O sistema não promete “100% atribuído” por aceitar um evento.
- O envio de mensagem usa somente o provedor selecionado. Uma falha ao gravar o histórico depois de uma entrega aceita produz aviso, sem provocar fallback silencioso por outro número.
- A restauração de arquivos de sessão valida nomes e diretório; backups novos de sessão nativa no banco usam criptografia. A reconexão nativa na partida se aplica a um servidor Node persistente, não a uma função serverless.

## Indicadores: o que significa ausência de dados

O cache existente da Meta contém investimento acumulado da vida do anúncio. Ele não prova o investimento de “hoje”, “7 dias” ou “30 dias”. Por isso, investimento por período, lucro, CPA e ROAS ficam sem dados quando essa base não existe; não são preenchidos com zero nem calculados com um denominador incompatível. Receita de compras registradas pode continuar disponível.

O funil usa evidências de atendimento/eventos, sem substituir ausência de respostas por uma estimativa fixa de 72% nem inventar propostas a partir das compras. Uma resposta de aceitação da CAPI confirma recepção do evento, não atribuição, venda comprovada ou qualidade máxima de correspondência.

## Validação realizada e alcance

Os dados das capturas são fictícios. Foram exercitados os fluxos locais sem conectar uma conta WhatsApp real e sem enviar mensagem ou conversão real.

| Verificação          | Resultado registrado durante a preparação                                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testes automatizados | 235 testes passaram em 20 arquivos, incluindo idempotência, regras do dashboard, segurança e integridade de mensagens.                                                                                                                                |
| Navegador            | 19 verificações de fluxo passaram no build de produção: rascunhos por contato, notas, bloqueio de venda sem token, estágio persistente, preferências, CSV completo, restauração do backup, autenticação das APIs, telas principais e navegação móvel. |
| TypeScript           | Verificação local passou com `npm run typecheck` (`next typegen` seguido de `tsc --noEmit --incremental false`).                                                                                                                                      |
| Build de produção    | `npm run build` passou com a verificação de tipos ativa, sem ignorar erros de TypeScript.                                                                                                                                                             |
| Dependências         | Atualizadas; a auditoria local com a base disponível retornou zero vulnerabilidades conhecidas naquele momento. Isso não garante ausência de vulnerabilidades futuras ou de aplicação.                                                                |
| CI                   | Workflow preparado para Node 22 e 24 com instalação, tipos, testes e build. Ainda não foi executado pelo GitHub no repositório de origem.                                                                                                             |

Os logs e resultados finais que acompanham o pacote prevalecem sobre contagens intermediárias caso uma correção posterior altere a suíte. Consulte também [os 52 achados acompanhados](FLOW-3.0-ACHADOS.md) e [a auditoria histórica da versão 2.6.2](AUDITORIA-2.6.2.md).

## Trabalho restante e limites conhecidos

Não se afirma que todos os achados da auditoria original tenham sido eliminados. Não houve integração real com Meta, WhatsApp, WAHA, Evolution, Postgres ou PostgREST; os adaptadores remotos ainda precisam de validação em um ambiente de homologação com dados e permissões próprios.

As próximas melhorias de arquitetura são persistir investimento diário validado da Meta, ampliar a cobertura contratual dos três bancos, separar mensagens/anexos em estruturas próprias com storage e paginação por histórico, adotar migrações numeradas e preparar observabilidade e filas de trabalho. A listagem do dashboard informa quando o limite de carga impede uma visão completa; isso não substitui agregações SQL em bases grandes.

Para múltiplas réplicas, são necessários rate limit compartilhado e ownership único de sessão nativa. Para usuários separados por empresa, é necessário implementar autenticação e autorização por usuário/organização. Endereços de WAHA/Evolution são configuráveis por administrador para atender servidores privados; a implantação pode precisar de allowlist e regras de rede próprias.

O uso em produção depende de backup restaurável, segredo exclusivo, configuração dos provedores e homologação dos envios. Consulte [FLOW-3.0-MIGRACAO.md](FLOW-3.0-MIGRACAO.md) antes de substituir uma instalação existente.
