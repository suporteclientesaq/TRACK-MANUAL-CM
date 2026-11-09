/**
 * Informações de versão e build do Track Manual.
 */
export const APP_VERSION = "3.0.3";
export const APP_RELEASE_NAME = "Track Manual Flow — Atendimento e conversões";
export const APP_BUILD_DATE = "09/11/2026";
export const APP_UPDATE_STATUS = "Atualizado";

export const APP_CHANGELOG = [
  {
    version: "3.0.3",
    date: "09/11/2026",
    title: "WAHA: VPS, sessões e QR",
    highlights: [
      "QR oficial em imagem, base64 e valor bruto; atualização automática sem reaproveitar QR antigo",
      "Método PUT de sessão, erros de chave/início e recuperação de FAILED corrigidos",
      "Vínculo WAHA por ambiente do servidor, sessão default no Core e configuração recuperável",
    ],
  },
  {
    version: "3.0.2",
    date: "09/11/2026",
    title: "Certificado SSL do Postgres",
    highlights: [
      "Suporte a certificado CA do provedor com verificação TLS e hostname preservados",
      "Parâmetros da URI não removem a CA configurada e mudanças recriam o pool",
      "Diagnósticos específicos por provedor, sem exigir Supabase para Postgres personalizado",
    ],
  },
  {
    version: "3.0.1",
    date: "09/11/2026",
    title: "CTWA e seleção de campanhas",
    highlights: [
      "Campanhas ativas por padrão, seleção por campanha e paginação completa com avisos de limite",
      "CTWA exige origem explícita e Página/WABA; referência de clique preservada em conjunto",
      "Proteção contra mistura de anúncios, cliques antigos e recuperação por telefone de outro contexto",
    ],
  },
  {
    version: "3.0.0",
    date: "09/11/2026",
    title: "Workspace Flow",
    highlights: [
      "Nova navegação, inbox responsivo e funil com etapas persistidas",
      "Conversões conferidas, idempotência e indicadores sem eventos de teste",
      "Proteção de sessões, backup consistente e credenciais por canal",
    ],
  },
  {
    version: "2.6.2",
    date: "08/11/2026",
    title:
      "Inbox em Tempo Real Estilo WhatsApp Web e Resgate Profundo de Nomes",
    highlights: [
      "Extração e live polling de mensagens acelerado para 2s em tempo real estilo WhatsApp Web",
      "Novo botão de 'Sincronizar' no topo da Central de Conversas para atualização instantânea e resgate forçado",
      "Resgate profundo de nomes: recupera automaticamente nomes de contatos a partir de notas, propostas comerciais e pushName",
      "Ordenação nativa por atividade recente (updated_at desc) no SQLite, Postgres e Supabase",
      "Captura de fotos de perfil (profilePicUrl) do WhatsApp diretamente nas mensagens recebidas",
      "Suporte a mensagens de áudio, fotos e mídias no histórico mesmo sem texto digitado",
      "Normalização de DDI 55 nos envios de mensagens para evitar falhas silenciosas de entrega",
    ],
  },
  {
    version: "2.6.1",
    date: "08/11/2026",
    title: "Correções de Segurança de Tipos (TypeScript) e Estabilidade",
    highlights: [
      "Correção de erros TypeScript em actions.ts: funções com redirect() agora têm retorno explícito satisfazendo o compilador",
      "Correção de erros de tipo nulo em leads/[id]/page.tsx com asserção explícita após guard notFound()",
      "Zero erros reais de tipo em toda a base de código (erros restantes são apenas de módulos CSS/Next.js fora do escopo do tsc standalone)",
    ],
  },
  {
    version: "2.6.0",
    date: "08/11/2026",
    title:
      "Favicon Customizável, Recuperação de Nomes WhatsApp, Auto-Limpeza e Correção de Seleção",
    highlights: [
      "Favicon customizável nas Configurações com Upload de imagem, Preview em tempo real e 4 Presets estilizados",
      "Auto-limpeza de mídias pesadas antigas com chave Liga/Desliga e botão de execução imediata",
      "Recuperação automática de nomes e fotos de perfil dos contatos (pushName/notifyName do WhatsApp)",
      "Correção crítica da seleção de contatos pelo link direto (/conversas?lead=ID) eliminando risco de troca de lead",
      "Exibição de fotos reais de perfil do WhatsApp e Lightbox para zoom em fotos e comprovantes recebidos",
      "Correção da contagem e consolidação de vendas pelo telefone do cliente em todas as abas",
      "Classificação rigorosa de rastreio: substituição do falso 'Orgânico' por 'Origem Não Rastreada (Sem Clique Meta)'",
      "Visualização de jornada de cliques Multi-Toque e deduplicação last-click aprimorada",
    ],
  },
  {
    version: "2.5.0",
    date: "08/11/2026",
    title:
      "Envio de Mídia, Notificações Sonoras, Atalhos de Barra e Exportação Executiva",
    highlights: [
      "Envio de fotos, comprovantes e arquivos PDF diretamente pelo painel de conversas",
      "Notificação sonora Web Audio e alerta no título da aba em novas mensagens de WhatsApp",
      "Atalhos de barra (/) rápidos (/ola, /anuncio, /pix, /confirmado, /catalogo)",
      "Filtro de funil avançado com aba exclusiva para leads com menção a PIX",
      "Exportação Executiva em 1 clique (CSV / Excel formatado com ROAS e campanhas)",
      "Impressão Executiva em PDF nativa pronta para apresentação a clientes",
      "Blindagem definitiva de atribuição CTWA (AD) contra perdas em reinicializações",
    ],
  },
  {
    version: "2.4.0",
    date: "08/11/2026",
    title: "Blindagem de Rastreio CTWA e Ordenação em Tempo Real no Chat",
    highlights: [
      "Recuperação profunda de anúncios e criativos do WhatsApp",
      "Auto-atribuição de ctwa_ad_ nos leads com source_id",
      "Ordenação das conversas por atividade recente estilo WhatsApp Web",
    ],
  },
  {
    version: "2.1.0",
    date: "04/10/2026",
    title: "Atribuição Last-Click Modelo UTMFY e Deduplicação",
    highlights: [
      "Filtros de data dinâmicos (Hoje, Ontem, 7D, 30D, Este Mês, Tudo, Personalizado)",
      "Atribuição Last-Click multi-campanha com deduplicação de leads repetidos",
      "Gráfico diário de evolução comparativo de Faturamento vs Investimento",
      "Tabelas analíticas por Campanha, Conjuntos (AdSets) e Criativos (Ads)",
    ],
  },
  {
    version: "2.0.0",
    date: "23/09/2026",
    title: "Meta Conversions API (CAPI v22.0) e Multi-Tenant",
    highlights: [
      "Envio de eventos de compra e leads para o Meta via Conversions API",
      "Normalização e hashing SHA-256 de dados de clientes",
      "Suporte a múltiplos clientes e chaves de webhook individuais",
    ],
  },
];
