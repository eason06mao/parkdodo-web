// 資料存取層：畫面只呼叫這裡的函式。
// 目前回傳 Mock；接上雲端 API 後，只需把各函式改成 fetch，元件不必修改。
import { cashKiosk, contracts, incidents, lanes, sessions, sites, buildAnalytics } from "./mock/data";
import type { AnalyticsData, CashKioskStatus, Incident, Lane, MonthlyContract, ParkingSession, Period, Site } from "./types";
import { features } from "./features";

export async function getSites(): Promise<Site[]> { return sites; }
export async function getLanes(): Promise<Lane[]> { return lanes; }
export async function getIncidents(): Promise<Incident[]> { return incidents; }
export async function getSessions(): Promise<ParkingSession[]> { return sessions; }
export async function getContracts(): Promise<MonthlyContract[]> { return contracts; }
export function getAnalytics(period: Period): AnalyticsData { return buildAnalytics(period); }

/** 現金繳費機：功能開關關閉時回傳 null，畫面顯示「預留・未啟用」。 */
export async function getCashKiosk(): Promise<CashKioskStatus | null> {
  return features.cashKiosk ? cashKiosk : null;
}
