"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getClient } from "@/lib/store";
import {
  channelStatus,
  connectChannel,
  disconnectChannel,
  saveChannelConfiguration,
  type ChannelStatus,
  type ChannelProvider,
} from "@/lib/channels";
export async function inspectChannelAction(
  clientId: string,
): Promise<ChannelStatus> {
  await requireAuth();
  if (!(await getClient(clientId)))
    return {
      ok: false,
      state: "close",
      qrcode: null,
      phone: null,
      error: "Cliente não encontrado.",
    };
  try {
    return await channelStatus(clientId);
  } catch (error) {
    return {
      ok: false,
      state: "close",
      qrcode: null,
      phone: null,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível consultar o canal.",
    };
  }
}
export async function configureAndConnectChannelAction(
  clientId: string,
  input: {
    provider: ChannelProvider;
    serverUrl: string;
    sessionName: string;
    apiKey: string;
  },
): Promise<ChannelStatus> {
  await requireAuth();
  try {
    await saveChannelConfiguration(clientId, input);
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host") || "localhost:3000";
    const proto = (h.get("x-forwarded-proto") || "http").split(",")[0].trim();
    const result = await connectChannel(
      clientId,
      (proto === "https" ? "https" : "http") +
        "://" +
        host.split(",")[0].trim(),
    );
    revalidatePath("/whatsapp");
    return result;
  } catch (error) {
    return {
      ok: false,
      state: "close",
      qrcode: null,
      phone: null,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível conectar o canal.",
    };
  }
}
export async function disconnectChannelAction(
  clientId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  if (!(await getClient(clientId)))
    return { ok: false, error: "Cliente não encontrado." };
  try {
    const result = await disconnectChannel(clientId);
    revalidatePath("/whatsapp");
    return result;
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível desconectar.",
    };
  }
}
