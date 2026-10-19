import type { Metadata } from "next";
import { AnalyticsBoard } from "./AnalyticsBoard";

export const metadata: Metadata = { title: "營收與車輛戰情板" };

export default function AnalyticsPage() {
  return <AnalyticsBoard />;
}
