import { listClients } from "@/lib/store";
import { WhatsAppClient } from "./WhatsAppClient";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const clients = await listClients();
  return <WhatsAppClient clients={clients} />;
}
