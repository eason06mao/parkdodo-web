import { Sidebar } from "@/components/Sidebar";
import { getIncidents } from "@/lib/data";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const incidents = await getIncidents();
  const open = incidents.filter((i) => i.status === "open").length; // 待處理（未認領）
  return (
    <>
      <div className="pd-mock-banner" role="note">模擬環境・Mock 資料，未連接設備、金流與資料庫</div>
      <div className="pd-app">
        <Sidebar openIncidents={open} />
        {children}
      </div>
    </>
  );
}
