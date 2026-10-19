// 本機測試資料庫指令（Windows／macOS／Linux 通用，需要 Docker）
//   npm run db:up       啟動 PostgreSQL
//   npm run db:migrate  在 parkdodo_dev 建立全部資料表
//   npm run db:test     建一個暫時的 pdtest 資料庫跑約束測試，跑完刪掉
//   npm run db:reset    刪掉所有本機資料，重新啟動（只影響本機）
import { spawnSync } from "node:child_process";

const MIGRATIONS = ["/db/migrations/0001_v2_core.sql"];
const TESTS = ["/db/tests/0001_constraints_test.sql"];

function run(args, { quiet = false } = {}) {
  const r = spawnSync("docker", args, { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  if (r.error) {
    console.error("找不到 docker 指令，請先安裝並開啟 Docker Desktop。");
    process.exit(1);
  }
  return r.status ?? 1;
}

function must(args) {
  const code = run(args);
  if (code !== 0) process.exit(code);
}

const psql = (db, file) =>
  must(["compose", "exec", "-T", "db", "psql", "-q", "-v", "ON_ERROR_STOP=1", "-U", "parkdodo", "-d", db, "-f", file]);

function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    if (run(["compose", "exec", "-T", "db", "pg_isready", "-U", "parkdodo", "-d", "parkdodo_dev"], { quiet: true }) === 0) return;
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},1000)"]);
  }
  console.error("PostgreSQL 沒有在 40 秒內就緒，請執行 docker compose logs db 查看原因。");
  process.exit(1);
}

const cmd = process.argv[2];
switch (cmd) {
  case "up":
    must(["compose", "up", "-d", "db"]);
    waitHealthy();
    console.log("PostgreSQL 已啟動：127.0.0.1:5432／資料庫 parkdodo_dev");
    break;
  case "migrate":
    waitHealthy();
    for (const f of MIGRATIONS) psql("parkdodo_dev", f);
    console.log("資料表建立完成。");
    break;
  case "test":
    waitHealthy();
    must(["compose", "exec", "-T", "db", "dropdb", "-U", "parkdodo", "--if-exists", "pdtest"]);
    must(["compose", "exec", "-T", "db", "createdb", "-U", "parkdodo", "pdtest"]);
    for (const f of MIGRATIONS) psql("pdtest", f);
    for (const f of TESTS) psql("pdtest", f);
    must(["compose", "exec", "-T", "db", "dropdb", "-U", "parkdodo", "pdtest"]);
    break;
  case "reset":
    must(["compose", "down", "-v"]);
    must(["compose", "up", "-d", "db"]);
    waitHealthy();
    console.log("本機資料已清空並重新啟動，接著執行 npm run db:migrate。");
    break;
  default:
    console.log("用法：node scripts/db.mjs up | migrate | test | reset");
    process.exit(1);
}
