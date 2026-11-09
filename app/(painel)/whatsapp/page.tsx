import { listClients } from "@/lib/store";
import { ChannelPanel } from "./ChannelPanel";
import { publicChannelConfiguration } from "@/lib/channels";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const clients = await listClients();
  const data = await Promise.all(
    clients.map(async ({ id, name }) => ({
      id,
      name,
      configuration: await publicChannelConfiguration(id),
    })),
  );
  const nativeAvailable = !(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME
  );
  return <ChannelPanel clients={data} nativeAvailable={nativeAvailable} />;
}
