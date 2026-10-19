import type { Metadata } from "next";
import { MobileGateFlow } from "./MobileGateFlow";
import { getLanes } from "@/lib/data";

export const metadata: Metadata = { title: "遠端開閘" };

export default async function MobileGatePage() {
  const lanes = await getLanes();
  return <MobileGateFlow lanes={lanes} />;
}
