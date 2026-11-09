# Flow 3.0.1 — CTWA e seleção de campanhas

Complemento de 9 de novembro de 2026 à entrega local. Não foi aplicado ao repositório de origem nem ao sistema online. Nenhuma conversão real foi enviada para certificar atribuição.

## CTWA que não aparecia atribuído

A revisão encontrou causas concretas no código, mas não dispõe do payload e da resposta de uma ocorrência real da instalação do usuário para apontar uma causa única daquele incidente.

- Um CTWA capturado podia ser retirado do envio quando faltava Página/WABA: o fluxo mudava para identificação por telefone. Agora a conferência bloqueia esse caso e orienta a corrigir o cadastro.
- `fbclid`, dados arbitrários de `conversionData` e bytes convertidos em base64 podiam ser tratados como CTWA. Os parsers agora exigem campo ou parâmetro explícito; um identificador Facebook não se torna CTWA por semelhança de formato.
- Anúncio, URL e clique podiam vir de interações distintas. A atualização agora preserva uma observação coerente, com horário e origem, usando transação/CAS no armazenamento. Um novo clique incompleto não herda o anúncio antigo; uma nova referência sem clique não herda o CTWA anterior.
- Mensagens comuns e mensagens enviadas pelo operador preservam a referência corrente. Replays antigos entram no histórico sem substituir uma referência mais recente. A recuperação manual não procura um clique por telefone em outro registro/empresa.
- Trocar anúncio ou CTWA manualmente limpa a contraparte antiga sem evidência de pareamento. Os formulários preservam dados atuais quando um webhook chega durante a edição.
- Uma conversão com horário anterior à referência canônica atual fica bloqueada para não usar um clique futuro. Não foi implementado um seletor automático de referência histórica nem uma janela própria de atribuição que substitua a regra da Meta.

A conferência deve mostrar `ctwa_clid`, `action_source: business_messaging`, canal WhatsApp e Página/WABA adequados quando há CTWA real. Sem clique, a identificação por telefone continua disponível, com aviso de possível ausência de atribuição.

Tokens incorretos que foram gravados em versões anteriores sem informação de procedência não podem ser identificados ou reconstruídos com garantia. É necessário conferir uma entrada nova de um anúncio real, seu payload e a resposta da Meta. Aceitação do evento não confirma atribuição ao anúncio.

## Campanhas que vinham todas ou não podiam ser selecionadas

A consulta anterior buscava anúncios da conta sem filtro de campanha e sem percorrer toda a paginação. O painel também podia usar o status do anúncio como se fosse o status da campanha. Na ausência de conta configurada, a descoberta podia escolher silenciosamente a primeira conta disponível.

A versão 3.0.1:

1. Busca campanhas no endpoint de campanhas com seu próprio status. O padrão é **Somente ativas**.
2. Permite alternar para pausadas/todos e selecionar campanhas específicas por empresa.
3. Sincroniza apenas anúncios pertencentes às campanhas aprovadas pelo filtro; remove o fallback que buscava anúncios individuais fora da seleção.
4. Percorre cursores sem mandar credenciais a URLs arbitrárias. Limites e interrupções produzem aviso de dados parciais, sem promessa de consulta completa.
5. Exibe campanhas mesmo sem contatos ou vendas. Números do painel não são fabricados por sua existência no catálogo.
6. Não escolhe uma conta silenciosamente quando o token tem várias. Alterar a conta invalida o catálogo/índice associado à anterior.
7. Mantém a data da consulta visível. Os status em cache não se atualizam por si só na Meta: use **Carregar campanhas da conta** para consultar novamente.

No dashboard, os filtros de campanha afetam tabelas e sincronização. KPIs gerais, gráfico e funil continuam representando todos os contatos/compras do cliente e período. Campanha ativa não significa que todos os anúncios/conjuntos dela estejam ativos ou entregando.

O investimento diário continua pendente; consultar campanhas ou guardar gasto acumulado não torna o ROAS por período válido.

## Validação

Os testes adicionais cobrem parsers de CTWA, mistura de origens, concorrência/CSV, recuperação manual, prévia sem Página/WABA, payload correto, paginação, filtros de campanha, status separado e catálogo sem contatos. Um teste de navegador percorre interface → Server Action → Graph simulado → SQLite → tabela, incluindo seleção persistida e celular.

O resultado consolidado final acompanha `VALIDACAO-3.0.json`. Meta e WhatsApp reais, Postgres e PostgREST ainda exigem homologação. Essa validação usa apenas dados e respostas fictícios.
