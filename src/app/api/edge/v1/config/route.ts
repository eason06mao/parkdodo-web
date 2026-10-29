import { withEdge } from "@/lib/edge/http";
import { getConfig } from "@/lib/edge/service";

// GET /api/edge/v1/config：車道、設備、費率、已付款名單、月租白名單、場內車輛（斷網時本機判斷用）
export async function GET(req: Request) {
  return withEdge(req, (c, gw) => getConfig(c, gw));
}
