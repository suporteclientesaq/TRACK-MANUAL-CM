import { getDashboardData } from "@/lib/dashboard";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{
    periodo?: string;
    cliente?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const sp = await searchParams;
  const data = await getDashboardData({
    clientId: sp.cliente || null,
    period: sp.periodo || "30d",
  });

  return <DashboardClient data={data} />;
}
