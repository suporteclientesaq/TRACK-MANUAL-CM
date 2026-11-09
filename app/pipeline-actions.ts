"use server";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { getLead, updateLeadWithRaw } from "@/lib/store";
import { isPipelineStage } from "@/lib/pipeline";
export async function movePipelineLead(
  leadId: string,
  stage: string,
): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  if (!isPipelineStage(stage)) return { ok: false, message: "Etapa inválida." };
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, message: "Contato não encontrado." };
  await updateLeadWithRaw(
    leadId,
    {},
    { pipeline_stage: stage, pipeline_updated_at: new Date().toISOString() },
  );
  revalidatePath("/funil");
  revalidatePath("/conversas");
  return { ok: true, message: "Etapa atualizada." };
}
