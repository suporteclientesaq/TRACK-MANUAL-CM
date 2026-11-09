import { getDashboardData } from "@/lib/dashboard";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{
    periodo?: string;
    cliente?: string;
    status_campanha?: string;
    campanhas?: string;
  }>;
}

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const sp = await searchParams;
  const data = await getDashboardData({
    clientId: sp.cliente || null,
    period: sp.periodo || "30d",
    campaignStatus:
      sp.status_campanha === "all" || sp.status_campanha === "paused"
        ? sp.status_campanha
        : "active",
    campaignIds: (sp.campanhas || "")
      .split(",")
      .filter((id) => /^\d{1,30}$/.test(id))
      .slice(0, 200),
  });

  return <DashboardClient data={data} />;
}
