import type { Metadata } from "next";
import { IncidentWorkspace } from "./IncidentWorkspace";
import { getIncidents } from "@/lib/data";

export const metadata: Metadata = { title: "例外處理" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const [incidents, params] = await Promise.all([getIncidents(), searchParams]);
  return <IncidentWorkspace incidents={incidents} initialId={params.id} />;
}
