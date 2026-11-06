FROM node:22-alpine AS builder

WORKDIR /app

# Instala dependências
COPY package.json package-lock.json* ./
RUN npm ci

# Copia todo o código fonte
COPY . .

# Desativa telemetria do Next.js e faz o build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Imagem de produção enxuta
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Cria usuário não-root por segurança
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copia arquivos necessários do build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/data ./data
COPY --from=builder /app/scripts ./scripts

# Permissões de escrita para a pasta de dados e sessões WhatsApp
RUN mkdir -p /app/data /app/.waha_sessions && \
    chown -R nextjs:nodejs /app/data /app/.waha_sessions

USER nextjs

EXPOSE 3000

CMD ["npm", "run", "start"]
