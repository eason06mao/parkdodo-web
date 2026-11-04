// npm run test:members — 會員規則、簡訊驗證碼、登入／綁定、月租登記單（記憶體版；設定 DATABASE_URL 時也跑資料庫版）
import assert from "node:assert/strict";
import { test } from "node:test";
import { canSend, checkCode, normalizePhone, OTP_MAX_PER_HOUR, validateProfile } from "../../src/lib/members";

test("手機號碼正規化", () => {
  assert.equal(normalizePhone("0912-345-678"), "0912345678");
  assert.equal(normalizePhone("+886 912 345 678"), "0912345678");
  assert.equal(normalizePhone("912345678"), "0912345678");
  assert.equal(normalizePhone("04-2345-6789"), null);
  assert.equal(normalizePhone("0912"), null);
});

test("驗證碼重寄間隔與每小時上限", () => {
  const t0 = 1_000_000_000_000;
  const first = canSend(null, t0);
  assert.ok(first.ok);
  const s = { codeHash: "h", expiresAt: t0 + 300_000, attempts: 0, sentAt: t0, sendsHour: 1, hourStart: t0 };
  const again = canSend(s, t0 + 10_000);
  assert.ok(!again.ok && again.reason === "resend" && again.waitSec === 50);
  const full = canSend({ ...s, sendsHour: OTP_MAX_PER_HOUR }, t0 + 120_000);
  assert.ok(!full.ok && full.reason === "hourly");
  const nextHour = canSend({ ...s, sendsHour: OTP_MAX_PER_HOUR }, t0 + 3_700_000);
  assert.ok(nextHour.ok && nextHour.sendsHour === 1);
});

test("驗證碼比對：正確、錯誤、過期、鎖定", () => {
  const s = { codeHash: "abc", expiresAt: 2000, attempts: 0, sentAt: 0, sendsHour: 1, hourStart: 0 };
  assert.equal(checkCode(s, "abc", 1000), "ok");
  assert.equal(checkCode(s, "xyz", 1000), "wrong");
  assert.equal(checkCode(s, "abc", 3000), "expired");
  assert.equal(checkCode({ ...s, attempts: 5 }, "abc", 1000), "locked");
  assert.equal(checkCode(null, "abc", 1000), "none");
});

test("會員資料檢查：車牌、月租登記需要稱呼與手機", () => {
  assert.deepEqual(validateProfile({ name: "", plates: [] }), {});
  const e = validateProfile({ name: "", plates: ["ABC1234", "abc-1234", "XX"], lead: { siteCode: "TXG001", planId: null, name: "", phone: "123", note: "" } });
  assert.equal(e.plates?.[1], "車牌重複。");
  assert.ok(e.plates?.[2]);
  assert.ok(e.leadName && e.leadPhone);
  assert.deepEqual(validateProfile({ name: "王先生", plates: ["ABC-1234"], lead: { siteCode: "TXG001", planId: null, name: "", phone: "0912345678", note: "" } }), {});
});

for (const withDb of [false, true]) {
  const url = process.env.DATABASE_URL;
  test(`登入、綁定、月租登記單（${withDb ? "資料庫" : "記憶體"}）`, { skip: withDb && !url && "未設定 DATABASE_URL" }, async () => {
    if (withDb) process.env.DATABASE_URL = url; else delete process.env.DATABASE_URL;
    const s = await import("../../src/lib/membersServer");
    const { pool } = await import("../../src/lib/db");
    const tag = Math.random().toString(36).slice(2, 8);
    const phone = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    try {
      if (!withDb) s.__resetMemoryStore();
      else await pool().query("DELETE FROM member_otps WHERE phone = $1", [phone]);

      // LINE 第一次登入 → 新會員；再登入 → 同一位
      const a = await s.signIn({ provider: "line", subject: `U${tag}`, name: "王先生", email: `${tag}@example.com` }, null, "TXG001");
      assert.ok(a.isNew);
      assert.equal(a.member.name, "王先生");
      const a2 = await s.signIn({ provider: "line", subject: `U${tag}` }, null, "TXG001");
      assert.equal(a2.member.id, a.member.id);
      assert.ok(!a2.isNew);

      // 已登入時用手機驗證 → 綁定到同一位
      const otp = await s.requestOtp(phone);
      assert.match(otp.devCode!, /^\d{6}$/);
      await assert.rejects(() => s.requestOtp(phone), /秒再重寄/);
      await assert.rejects(() => s.verifyOtp(phone, otp.devCode === "000000" ? "111111" : "000000"), /不正確/);
      await s.verifyOtp(phone, otp.devCode!);
      await assert.rejects(() => s.verifyOtp(phone, otp.devCode!), /過期/);  // 用過就失效
      const b = await s.signIn({ provider: "phone", subject: phone }, a.member.id, null);
      assert.ok(b.linked);
      assert.equal(b.member.id, a.member.id);
      assert.equal(b.member.phone, phone);
      assert.deepEqual([...b.member.providers].sort(), ["line", "phone"]);

      // 同一位會員不能綁第二個 LINE
      await assert.rejects(() => s.signIn({ provider: "line", subject: `U${tag}-other` }, a.member.id, null), /已經綁定/);

      // 車牌與月租登記單；重送會更新同一張
      const p = await s.saveProfile(b.member, { name: "王先生", plates: ["abc1234"], lead: { siteCode: "TXG001", planId: "plan-001-shared", name: "", phone, note: "12 月開始" } });
      assert.deepEqual(p.member.plates, ["ABC-1234"]);
      assert.equal(p.lead?.planName, "共用月租");
      assert.equal(p.lead?.name, "王先生");
      const p2 = await s.saveProfile(p.member, { name: "王先生", plates: ["ABC-1234"], lead: { siteCode: "TXG001", planId: null, name: "王大明", phone, note: "" } });
      assert.equal(p2.lead?.id, p.lead?.id);
      assert.equal(p2.lead?.planName, null);
      const leads = await s.listLeads(["TXG001"]);
      assert.equal(leads.filter((l) => l.memberId === a.member.id).length, 1);
      assert.deepEqual(await s.listLeads(["OTHER"]).then((x) => x.filter((l) => l.memberId === a.member.id)), []);

      const done = await s.setLeadStatus(p.lead!.id, "converted", "測試客服", ["TXG001"]);
      assert.equal(done.status, "converted");
      await assert.rejects(() => s.setLeadStatus(p.lead!.id, "closed", "別站客服", ["OTHER"]), /找不到/);

      // 會員 cookie 簽章
      const ck = s.signMember(a.member.id);
      assert.equal(s.readMemberCookie(ck), a.member.id);
      assert.equal(s.readMemberCookie(ck.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), null);
    } finally {
      if (withDb) {
        await pool().query("DELETE FROM monthly_leads WHERE member_id IN (SELECT member_id FROM member_identities WHERE subject = $1)", [`U${tag}`]);
        await pool().query("DELETE FROM members WHERE id IN (SELECT member_id FROM member_identities WHERE subject = $1)", [`U${tag}`]);
      }
    }
  });
}
