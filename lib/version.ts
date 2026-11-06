/**
 * Informações de versão e build do Track Manual.
 */
export const APP_VERSION = "2.2.0";
export const APP_RELEASE_NAME = "Track Manual Pro — WhatsApp & Meta CAPI Edition";
export const APP_BUILD_DATE = "06/11/2026";
export const APP_UPDATE_STATUS = "Atualizado";

export const APP_CHANGELOG = [
  {
    version: "2.2.0",
    date: "06/11/2026",
    title: "Suporte WAHA, Baileys Nativo Resiliente e Backup 1-Clique",
    highlights: [
      "Integração completa com WAHA (WhatsApp HTTP API) via Docker",
      "Baileys Nativo aprimorado com auto-reconexão após quedas de rede",
      "Decodificador Base64 e extrator de tags de anúncio no texto da mensagem",
      "Atribuição manual de anúncio/campanha diretamente no detalhe do lead",
      "Backup 1-clique do banco SQLite para download instantâneo",
      "Exibição da versão ativa e status do sistema nas configurações",
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
