import { PersonaSwitcher } from "@/components/PersonaSwitcher";
import { Sidebar } from "@/components/Sidebar";
import { getCurrentUser } from "@/lib/auth";
import { getIncidents } from "@/lib/data";
import { mockPersonas } from "@/lib/mock/tenancy";
import { can } from "@/lib/permissions";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [incidents, user] = await Promise.all([getIncidents(), getCurrentUser()]);
  const open = incidents.filter((i) => i.status === "open").length; // 待處理（未認領）
  const hidden = [
    !can(user, "site.view") && "/console/sites",
    !can(user, "user.manage_org") && "/console/accounts",
  ].filter(Boolean) as string[];
  return (
    <>
      <div className="pd-mock-banner" role="note">
        模擬環境・Mock 資料，未連接設備、金流與資料庫
        <PersonaSwitcher current={user.id} options={mockPersonas.map((p) => ({ id: p.id, label: p.label }))} />
      </div>
      <div className="pd-app">
        <Sidebar openIncidents={open} hidden={hidden} userName={user.name} userRole={user.label} />
        {children}
      </div>
    </>
  );
}
