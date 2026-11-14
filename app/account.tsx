"use client";

// 계정 화면: 로그인 · 회사 등록 · 비밀번호 변경 · 직원 관리
import { useEffect, useState } from "react";

export type Me = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "member";
  companyId: number;
  companyName: string;
  mustChangePassword: boolean;
};

type Member = {
  id: number;
  name: string;
  email: string;
  role: "admin" | "member";
  mustChangePassword: boolean;
  createdAt: string;
};

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

export function AuthPanel({ initial, onDone }: { initial: "login" | "register"; onDone: (me: Me) => void }) {
  const [tab, setTab] = useState(initial);
  const [form, setForm] = useState({ companyName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setTab(initial), [initial]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await postJson<{ user: Me }>(`/api/auth/${tab}`, form);
      onDone(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "login"} onClick={() => setTab("login")}>
          로그인
        </button>
        <button type="button" role="tab" aria-selected={tab === "register"} onClick={() => setTab("register")}>
          회사 등록
        </button>
      </div>
      <form className="stack" onSubmit={submit}>
        {tab === "register" && (
          <>
            <p className="hint">
              회사를 등록하면 등록한 사람이 관리자가 돼요. 직원 계정은 관리자가 &lsquo;직원 관리&rsquo;에서 만들어요.
            </p>
            <label>
              회사 이름
              <input value={form.companyName} onChange={set("companyName")} maxLength={80} required />
            </label>
            <label>
              내 이름
              <input value={form.name} onChange={set("name")} maxLength={50} required />
            </label>
          </>
        )}
        <label>
          이메일
          <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
        </label>
        <label>
          비밀번호{tab === "register" && " (8자 이상)"}
          <input
            type="password"
            value={form.password}
            onChange={set("password")}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            minLength={tab === "register" ? 8 : undefined}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "처리 중…" : tab === "login" ? "로그인" : "회사 등록하고 시작하기"}
        </button>
      </form>
    </section>
  );
}

export function PasswordPanel({ forced, onDone }: { forced: boolean; onDone: (me: Me) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("새 비밀번호 두 칸이 서로 달라요.");
      return;
    }
    setBusy(true);
    try {
      const data = await postJson<{ user: Me }>("/api/auth/password", { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>비밀번호 변경</h2>
      {forced && (
        <p className="notice-box">
          관리자가 만든 임시 비밀번호로 로그인했어요. 새 비밀번호로 바꿔야 다른 기능을 쓸 수 있어요.
        </p>
      )}
      <form className="stack" onSubmit={submit}>
        <label>
          {forced ? "임시 비밀번호" : "지금 비밀번호"}
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          새 비밀번호 (8자 이상)
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} autoComplete="new-password" required />
        </label>
        <label>
          새 비밀번호 확인
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} autoComplete="new-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        {done && <p className="ok">비밀번호를 바꿨어요. 다른 기기의 로그인은 모두 끊었어요.</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
      </form>
    </section>
  );
}

export function MembersPanel({ me }: { me: Me }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [issued, setIssued] = useState<{ email: string; tempPassword: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/company/members", { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error ?? "직원 목록을 불러오지 못했어요.");
        setMembers(data.members);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "직원 목록을 불러오지 못했어요."));
  }, []);

  async function run(url: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const data = await postJson<{ members: Member[]; tempPassword?: string; email?: string }>(url, body);
      setMembers(data.members);
      setIssued(data.tempPassword && data.email ? { email: data.email, tempPassword: data.tempPassword } : null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await run("/api/company/members", { name, email })) {
      setName("");
      setEmail("");
    }
  }

  return (
    <section className="panel">
      <h2>직원 관리 · {me.companyName}</h2>
      <p className="hint">
        직원 계정을 만들면 임시 비밀번호가 한 번만 보여요. 직원에게 직접 전달하면, 직원은 처음 로그인할 때 새 비밀번호로
        바꿔요. 같은 회사 계정끼리만 평가표 기록을 함께 봐요.
      </p>

      {issued && (
        <div className="notice-box">
          <strong>{issued.email}</strong> 임시 비밀번호: <code className="temp">{issued.tempPassword}</code>
          <br />이 안내를 닫으면 다시 볼 수 없어요. 지금 직원에게 전달해 주세요.
          <button type="button" className="ghost small" onClick={() => setIssued(null)}>
            전달했어요
          </button>
        </div>
      )}

      <form className="inline-form" onSubmit={add}>
        <input placeholder="직원 이름" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        <input type="email" placeholder="직원 이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit" className="primary" disabled={busy}>
          계정 만들기
        </button>
      </form>
      {error && <p className="error">{error}</p>}

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
                  className="ghost small"
                  disabled={busy}
                  onClick={() => run("/api/company/members/reset", { userId: m.id })}
                >
                  임시 비밀번호 다시 발급
                </button>
                <button
                  type="button"
                  className="ghost small danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`${m.name}(${m.email}) 계정을 삭제할까요? 이 직원이 만든 평가표는 회사 기록에 남아요.`)) {
                      run("/api/company/members/remove", { userId: m.id });
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
    </section>
  );
}
