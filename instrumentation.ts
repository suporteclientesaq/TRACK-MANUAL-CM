/** Restore saved native sessions when a persistent Node server starts. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.TRACK_WHATSAPP_AUTO_RECONNECT === "false"
  )
    return;
  if (
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  )
    return;
  try {
    const { resumeSavedNativeChannels } = await import("@/lib/channels");
    void resumeSavedNativeChannels().catch(() =>
      console.warn(
        "[Track Manual] Não foi possível retomar os canais salvos. Confira a configuração do armazenamento.",
      ),
    );
  } catch {
    console.warn(
      "[Track Manual] Os canais salvos serão retomados quando o armazenamento estiver disponível.",
    );
  }
}
