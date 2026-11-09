/** @type {import('next').NextConfig} */
const nextConfig = {
  // As miniaturas vêm de domínios do Meta que mudam o tempo todo (fbcdn, cdninstagram),
  // então usamos <img> comum em vez do otimizador de imagens do Next.
  poweredByHeader: false,
  devIndicators: false,
  // O driver do Postgres e Baileys (WhatsApp) ficam fora do empacotamento.
  serverExternalPackages: ["pg", "@whiskeysockets/baileys", "pino"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
