import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Os testes conferem o endereço real do Meta, então ignoram qualquer desvio do ambiente.
    env: { META_GRAPH_URL: "", NODE_NO_WARNINGS: "1" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // "server-only" só existe para impedir uso no navegador; nos testes é vazio.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
});
