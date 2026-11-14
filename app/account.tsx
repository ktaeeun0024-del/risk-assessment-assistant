"use client";

// 계정 화면: 로그인 · 회사 가입(이메일 인증 + 사업자등록번호, 사이트 관리자 승인) · 직원 초대 수락 ·
// 비밀번호 찾기 · 비밀번호 변경 · 직원 관리 · 가입 승인(사이트 관리자)
import { useEffect, useState } from "react";

export type Me = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  companyId: number;
  companyName: string;
  mustChangePassword: boolean;
  isSiteAdmin: boolean;
};

type Member = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  createdAt: string;
};

type Invite = { id: number; name: string; email: string; expiresAt: string; createdAt: string };

export const ROLE_NAMES = { admin: "관리자", member: "직원" } as const;

// JSON으로 보내고, 실패하면 서버가 준 안내 문구로 오류를 던진다
export async function postJson<T>(url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new Error(data?.error ?? "요청을 처리하지 못했어요.");
  return data as T;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "실패했어요.");

// 버튼을 누르는 동안 막고, 오류 문구를 보여 주는 공통 처리
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (err) {
      setError(message(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

// 다시 보내기 버튼을 60초 동안 막는다 (서버도 같은 제한이 있다)
function useCooldown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, start: () => setLeft(60) };
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label>
      인증번호 6자리
      <input
        className="code-input"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        placeholder="000000"
        required
      />
    </label>
  );
}

function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  label = "비밀번호",
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
}) {
  return (
    <>
      <label>
        {label} (8자 이상)
        <input type="password" value={password} onChange={(e) => onPassword(e.target.value)} minLength={8} autoComplete="new-password" required />
      </label>
      <label>
        {label} 확인
        <input type="password" value={confirm} onChange={(e) => onConfirm(e.target.value)} minLength={8} autoComplete="new-password" required />
      </label>
    </>
  );
}

type Tab = "login" | "register" | "invite" | "reset";

export function AuthPanel({ initial, onDone }: { initial: "login" | "register"; onDone: (me: Me) => void }) {
  const [tab, setTab] = useState<Tab>(initial);
  const [notice, setNotice] = useState("");
  useEffect(() => setTab(initial), [initial]);

  function go(next: Tab, note = "") {
    setTab(next);
    setNotice(note);
  }

  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        {(
          [
            ["login", "로그인"],
            ["register", "회사 가입"],
            ["invite", "초대받았어요"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => go(key)}>
            {label}
          </button>
        ))}
      </div>
      {notice && <p className="ok">{notice}</p>}
      {tab === "login" && <LoginForm onDone={onDone} onForgot={() => go("reset")} />}
      {tab === "register" && <RegisterForm onDone={onDone} />}
      {tab === "invite" && <InviteForm onDone={onDone} />}
      {tab === "reset" && <ResetForm onDone={() => go("login", "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요.")} />}
    </section>
  );
}

function LoginForm({ onDone, onForgot }: { onDone: (me: Me) => void; onForgot: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = await run(() => postJson<{ user: Me }>("/api/auth/login", { email, password }));
        if (data) onDone(data.user);
      }}
    >
      <label>
        이메일
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <label>
        비밀번호
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "확인 중…" : "로그인"}
      </button>
      <button type="button" className="link" onClick={onForgot}>
        비밀번호를 잊었어요
      </button>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: (me: Me) => void }) {
  const [step, setStep] = useState<"form" | "code" | "pending">("form");
  const [form, setForm] = useState({ companyName: "", businessNumber: "", name: "", email: "" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const { busy, error, setError, run } = useAction();
  const cooldown = useCooldown();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function sendCode() {
    if (password !== confirm) {
      setError("비밀번호 두 칸이 서로 달라요.");
      return;
    }
    const ok = await run(() => postJson("/api/auth/register", { ...form, password, passwordConfirm: confirm }));
    if (ok) {
      setStep("code");
      setCode("");
      cooldown.start();
    }
  }

  if (step === "pending") {
    return (
      <div className="notice-box">
        <strong>가입 신청을 받았어요.</strong>
        <br />
        사이트 관리자가 회사 정보(사업자등록번호)를 확인한 뒤 승인하면 <strong>{form.email}</strong>로 알려 드려요. 승인 후 로그인할
        수 있어요.
      </div>
    );
  }

  if (step === "code") {
    return (
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = await run(() =>
            postJson<{ user?: Me; pending?: boolean }>("/api/auth/register/verify", { email: form.email, code }),
          );
          if (data?.user) onDone(data.user);
          else if (data?.pending) setStep("pending");
        }}
      >
        <p className="hint">
          <strong>{form.email}</strong>로 인증번호를 보냈어요. 10분 안에 입력해 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.
        </p>
        <CodeInput value={code} onChange={setCode} />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || code.length !== 6}>
          {busy ? "확인 중…" : "인증하고 가입 신청"}
        </button>
        <div className="row-actions">
          <button type="button" className="ghost small" disabled={busy || cooldown.left > 0} onClick={sendCode}>
            {cooldown.left > 0 ? `인증번호 다시 받기 (${cooldown.left}초)` : "인증번호 다시 받기"}
          </button>
          <button type="button" className="ghost small" disabled={busy} onClick={() => setStep("form")}>
            입력 내용 고치기
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        sendCode();
      }}
    >
      <p className="hint">
        이메일 인증을 마치면 가입 신청이 돼요. 사이트 관리자가 사업자등록번호를 확인하고 승인하면 쓸 수 있어요. 가입한 사람이 회사
        관리자가 되고, 직원은 관리자가 메일로 초대해요.
      </p>
      <label>
        회사 이름
        <input value={form.companyName} onChange={set("companyName")} maxLength={80} required />
      </label>
      <label>
        사업자등록번호
        <input
          value={form.businessNumber}
          onChange={set("businessNumber")}
          inputMode="numeric"
          placeholder="123-45-67890"
          maxLength={12}
        />
      </label>
      <label>
        내 이름
        <input value={form.name} onChange={set("name")} maxLength={50} required />
      </label>
      <label>
        이메일 (인증번호를 받을 주소)
        <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
      </label>
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "보내는 중…" : "인증번호 받기"}
      </button>
    </form>
  );
}

function InviteForm({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, setError, run } = useAction();

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== confirm) {
          setError("비밀번호 두 칸이 서로 달라요.");
          return;
        }
        const data = await run(() =>
          postJson<{ user: Me }>("/api/auth/invite", { email, code, password, passwordConfirm: confirm }),
        );
        if (data) onDone(data.user);
      }}
    >
      <p className="hint">회사 관리자가 보낸 초대 메일의 인증번호를 넣고, 앞으로 쓸 비밀번호를 정해 주세요. 초대는 24시간 동안 유효해요.</p>
      <label>
        초대받은 이메일
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <CodeInput value={code} onChange={setCode} />
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy || code.length !== 6}>
        {busy ? "확인 중…" : "가입하고 시작하기"}
      </button>
    </form>
  );
}

function ResetForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, error, setError, run } = useAction();
  const cooldown = useCooldown();

  async function requestCode() {
    const ok = await run(() => postJson("/api/auth/reset", { email }));
    if (ok) {
      setStep("code");
      cooldown.start();
    }
  }

  if (step === "email") {
    return (
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          requestCode();
        }}
      >
        <p className="hint">가입한 이메일을 넣으면 비밀번호를 다시 정할 수 있는 인증번호를 보내 드려요.</p>
        <label>
          이메일
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "보내는 중…" : "인증번호 받기"}
        </button>
      </form>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== confirm) {
          setError("비밀번호 두 칸이 서로 달라요.");
          return;
        }
        const ok = await run(() => postJson("/api/auth/reset/verify", { email, code, password, passwordConfirm: confirm }));
        if (ok) onDone();
      }}
    >
      <p className="hint">
        <strong>{email}</strong>이(가) 가입된 이메일이면 인증번호를 보냈어요. 10분 안에 입력해 주세요.
      </p>
      <CodeInput value={code} onChange={setCode} />
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} label="새 비밀번호" />
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy || code.length !== 6}>
        {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </button>
      <button type="button" className="ghost small" disabled={busy || cooldown.left > 0} onClick={requestCode}>
        {cooldown.left > 0 ? `인증번호 다시 받기 (${cooldown.left}초)` : "인증번호 다시 받기"}
      </button>
    </form>
  );
}

export function PasswordPanel({ forced, onDone }: { forced: boolean; onDone: (me: Me) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError("새 비밀번호 두 칸이 서로 달라요.");
      return;
    }
    const data = await run(() => postJson<{ user: Me }>("/api/auth/password", { currentPassword: current, newPassword: next }));
    if (data) {
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone(data.user);
    }
  }

  return (
    <section className="panel">
      <h2>비밀번호 변경</h2>
      {forced && (
        <p className="notice-box">임시 비밀번호로 로그인했어요. 새 비밀번호로 바꿔야 다른 기능을 쓸 수 있어요.</p>
      )}
      <form className="stack" onSubmit={submit}>
        <label>
          {forced ? "임시 비밀번호" : "지금 비밀번호"}
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <PasswordFields password={next} confirm={confirm} onPassword={setNext} onConfirm={setConfirm} label="새 비밀번호" />
        {error && <p className="error">{error}</p>}
        {done && <p className="ok">비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 끊었어요.</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
      </form>
    </section>
  );
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function MembersPanel({ me }: { me: Me }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const { busy, error, setError, run } = useAction();

  function apply(data: { members: Member[]; invites: Invite[] }) {
    setMembers(data.members);
    setInvites(data.invites);
  }

  useEffect(() => {
    fetch("/api/company/members", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "직원 목록을 불러오지 못했어요.");
        apply(data);
      })
      .catch((err) => setError(message(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(url: string, body: unknown, note: string) {
    const data = await run(() => postJson<{ members: Member[]; invites: Invite[] }>(url, body));
    if (data) {
      apply(data);
      setSent(note);
    }
    return !!data;
  }

  return (
    <section className="panel">
      <h2>직원 관리 · {me.companyName}</h2>
      <p className="hint">
        직원 이메일로 초대 메일(인증번호)을 보내면, 직원이 사이트의 &lsquo;초대받았어요&rsquo;에서 인증번호를 넣고 자기 비밀번호를
        정해 가입해요. 같은 회사 계정끼리만 평가표 기록을 함께 봐요.
      </p>

      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act("/api/company/members", { name, email }, `${email}로 초대 메일을 보냈어요.`)) {
            setName("");
            setEmail("");
          }
        }}
      >
        <input placeholder="직원 이름" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        <input type="email" placeholder="직원 이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "보내는 중…" : "초대 메일 보내기"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {sent && !error && <p className="ok">{sent}</p>}

      {invites.length > 0 && (
        <>
          <h3>수락 기다리는 초대</h3>
          <ul className="members">
            {invites.map((inv) => (
              <li key={inv.id}>
                <div>
                  <strong>{inv.name}</strong> <span className="tag warn">초대 중</span>
                  <span className="sub">
                    {inv.email} · {shortDate(inv.expiresAt)}까지
                  </span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="ghost small"
                    disabled={busy}
                    onClick={() => act("/api/company/invites", { inviteId: inv.id, action: "resend" }, `${inv.email}로 초대 메일을 다시 보냈어요.`)}
                  >
                    다시 보내기
                  </button>
                  <button
                    type="button"
                    className="ghost small danger"
                    disabled={busy}
                    onClick={() => act("/api/company/invites", { inviteId: inv.id, action: "cancel" }, "초대를 취소했어요.")}
                  >
                    취소
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>계정</h3>
      <ul className="members">
        {members.map((m) => (
          <li key={m.id}>
            <div>
              <strong>{m.name}</strong> <span className="tag">{ROLE_NAMES[m.role]}</span>
              {m.mustChangePassword && <span className="tag warn">임시 비밀번호</span>}
              <span className="sub">{m.email}</span>
            </div>
            {m.id !== me.id && (
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost small danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`${m.name}(${m.email}) 계정을 삭제할까요? 이 직원이 만든 평가표는 회사 기록에 남아요.`)) {
                      act("/api/company/members/remove", { userId: m.id }, "계정을 삭제했어요.");
                    }
                  }}
                >
                  삭제
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="hint">직원이 비밀번호를 잊으면 로그인 화면의 &lsquo;비밀번호를 잊었어요&rsquo;로 직접 다시 정할 수 있어요.</p>
    </section>
  );
}

type NtsCheck = { ok: boolean; status: string; taxType?: string; closedAt?: string; note?: string; checkedAt: string };

type CompanyApplication = {
  id: number;
  name: string;
  businessNumber: string | null;
  status: "pending" | "approved" | "rejected";
  ntsCheck: NtsCheck | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminName: string | null;
  adminEmail: string | null;
};

const STATUS_NAMES = { pending: "승인 대기", approved: "승인", rejected: "거절" } as const;

export function SiteAdminPanel() {
  const [companies, setCompanies] = useState<CompanyApplication[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    fetch("/api/admin/companies", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "가입 신청 목록을 불러오지 못했어요.");
        setCompanies(data.companies);
      })
      .catch((err) => setError(message(err)))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(companyId: number, action: "approve" | "reject" | "recheck") {
    const data = await run(() => postJson<{ companies: CompanyApplication[] }>("/api/admin/companies", { companyId, action }));
    if (data) setCompanies(data.companies);
  }

  const pending = companies.filter((c) => c.status === "pending");
  const done = companies.filter((c) => c.status !== "pending");

  return (
    <section className="panel">
      <h2>회사 가입 승인</h2>
      <p className="hint">
        국세청 조회 결과가 &lsquo;계속사업자&rsquo;인지, 회사 이름과 신청자가 맞는지 확인한 뒤 승인해 주세요. 승인·거절하면 신청자에게
        메일로 알려요.
      </p>
      {error && <p className="error">{error}</p>}
      {loaded && pending.length === 0 && <p className="ok">기다리는 신청이 없어요.</p>}

      <ul className="members">
        {pending.map((c) => (
          <CompanyItem key={c.id} c={c}>
            <div className="row-actions">
              <button type="button" className="primary small" disabled={busy} onClick={() => act(c.id, "approve")}>
                승인
              </button>
              <button
                type="button"
                className="ghost small danger"
                disabled={busy}
                onClick={() => window.confirm(`'${c.name}' 가입 신청을 거절할까요?`) && act(c.id, "reject")}
              >
                거절
              </button>
              <button type="button" className="ghost small" disabled={busy} onClick={() => act(c.id, "recheck")}>
                국세청 다시 조회
              </button>
            </div>
          </CompanyItem>
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <h3>최근 처리</h3>
          <ul className="members">
            {done.map((c) => (
              <CompanyItem key={c.id} c={c} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CompanyItem({ c, children }: { c: CompanyApplication; children?: React.ReactNode }) {
  const nts = c.ntsCheck;
  const ntsOk = nts?.ok && nts.status === "계속사업자";
  return (
    <li>
      <div>
        <strong>{c.name}</strong> <span className={`tag${c.status === "pending" ? " warn" : ""}`}>{STATUS_NAMES[c.status]}</span>
        <span className="sub">
          사업자등록번호 {c.businessNumber ?? "(없음)"} · 국세청:{" "}
          <span className={ntsOk ? "ok-text" : "warn-text"}>
            {nts ? `${nts.status}${nts.taxType ? ` (${nts.taxType})` : ""}${nts.closedAt ? ` 폐업일 ${nts.closedAt}` : ""}` : "조회 안 함"}
          </span>
          {nts?.note && ` · ${nts.note}`}
        </span>
        <span className="sub">
          신청자 {c.adminName ?? "-"} &lt;{c.adminEmail ?? "-"}&gt; · 신청 {shortDate(c.createdAt)}
          {c.reviewedAt && ` · 처리 ${shortDate(c.reviewedAt)}`}
        </span>
      </div>
      {children}
    </li>
  );
}
