"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, ShieldCheck, Users, Wallet, X } from "lucide-react";
import type { DirectoryView } from "@/lib/directory-schema";

type Account = DirectoryView["accounts"][number];
type User = DirectoryView["users"][number];
type Editor =
  { type: "account"; original: Account | null } | { type: "user"; original: User | null };
const actionNames: Record<string, string> = {
  createAccount: "新增账户",
  updateAccount: "修改账户",
  createUser: "新增用户",
  updateUser: "修改用户",
  revokeSessions: "撤销登录",
  deleteUser: "删除用户",
};
async function request(body?: unknown): Promise<DirectoryView> {
  const response = await fetch("/api/admin", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error?.message ?? "请求失败。"), {
      status: response.status,
    });
  return result;
}
export function AdminPanel({
  onUpdated,
  onView,
  onPendingChange,
  onUnauthorized,
}: {
  onUpdated: () => Promise<void>;
  onView: (id: string, costs?: boolean) => void;
  onPendingChange: (pending: boolean) => void;
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<DirectoryView | null>(null);
  const [section, setSection] = useState<"users" | "accounts" | "audit">("users");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;
  function failed(e: unknown) {
    const err = e as Error & { status?: number };
    if (err.status === 401 || err.status === 403) unauthorized.current();
    if (err.status === 409) setConflict(true);
    setError(err.message);
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request();
      if (!mounted.current) return;
      setData(next);
      setEditor(null);
      setConflict(false);
    } catch (e) {
      if (mounted.current) failed(e);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onPendingChange(busy || Boolean(editor));
  }, [busy, editor, onPendingChange]);
  useEffect(() => () => onPendingChange(false), [onPendingChange]);
  async function mutate(payload: Record<string, unknown>) {
    if (!data || inFlight.current || conflict) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await request({ ...payload, revision: data.revision });
      if (!mounted.current) return;
      setData(next);
      setEditor(null);
      setNotice("已保存");
      await onUpdated();
    } catch (e) {
      if (mounted.current) failed(e);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function changeSection(next: typeof section) {
    if (editor || busy) return;
    setSection(next);
    setError("");
    setNotice("");
  }
  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <div className="admin-tabs" role="tablist" aria-label="管理分类">
          {(
            [
              ["users", "用户管理", Users],
              ["accounts", "交易所账户", Wallet],
              ["audit", "操作记录", ShieldCheck],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              disabled={busy || Boolean(editor)}
              className={section === id ? "active" : ""}
              onClick={() => changeSection(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            if (!editor || window.confirm("放弃当前编辑并重新加载？")) void reload();
          }}
        >
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          重新加载
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="admin-notice" role="status">
          {notice}
        </div>
      )}
      {!data ? (
        <div className="panel empty">
          <h3>{busy ? "正在加载" : "管理后台尚未就绪"}</h3>
        </div>
      ) : (
        <>
          {editor && (
            <section className="panel admin-editor">
              <div className="panel-heading">
                <h2>
                  {editor.original ? "编辑" : "新增"}
                  {editor.type === "user" ? "用户" : "账户"}
                </h2>
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label="取消编辑"
                  onClick={() => setEditor(null)}
                >
                  <X size={18} />
                </button>
              </div>
              {editor.type === "account" ? (
                <AccountForm
                  key={editor.original?.id ?? "new-account"}
                  initial={editor.original}
                  disabled={busy || conflict}
                  onCancel={() => setEditor(null)}
                  onSave={(account) =>
                    mutate({ action: editor.original ? "updateAccount" : "createAccount", account })
                  }
                />
              ) : (
                <UserForm
                  key={editor.original?.username ?? "new-user"}
                  initial={editor.original}
                  accounts={data.accounts}
                  disabled={busy || conflict}
                  onCancel={() => setEditor(null)}
                  onSave={(user) =>
                    mutate({ action: editor.original ? "updateUser" : "createUser", user })
                  }
                />
              )}
            </section>
          )}
          {section === "users" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  用户 <span className="count">{data.users.length + 1}</span>
                </h2>
                <button
                  className="button primary"
                  disabled={busy || Boolean(editor) || conflict || !data.accounts.length}
                  onClick={() => {
                    setEditor({ type: "user", original: null });
                    setNotice("");
                  }}
                >
                  <Plus size={15} />
                  新增用户
                </button>
              </div>
              {!data.accounts.length && (
                <div className="admin-empty">
                  <p>先添加交易所账户，再创建查看用户。</p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setSection("accounts");
                      setEditor({ type: "account", original: null });
                    }}
                  >
                    添加账户
                  </button>
                </div>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th>权限</th>
                      <th>可查看账户</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>{data.administrator.displayName}</strong>
                        <small>{data.administrator.username}</small>
                      </td>
                      <td>
                        <span className="admin-role">管理员</span>
                      </td>
                      <td>全部账户</td>
                      <td>启用</td>
                      <td>
                        <span className="admin-muted">环境变量固定</span>
                      </td>
                    </tr>
                    {data.users.map((u) => (
                      <tr key={u.username}>
                        <td>
                          <strong>{u.displayName}</strong>
                          <small>{u.username}</small>
                        </td>
                        <td>只读</td>
                        <td>
                          {data.accounts.find((a) => a.id === u.accountId)?.label ?? u.accountId}
                        </td>
                        <td>
                          <span className={u.enabled ? "positive" : "admin-muted"}>
                            {u.enabled ? "启用" : "停用"}
                          </span>
                        </td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              className="text-button"
                              disabled={busy || Boolean(editor) || conflict}
                              onClick={() => {
                                setEditor({ type: "user", original: u });
                                setNotice("");
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="text-button"
                              disabled={busy || Boolean(editor) || conflict}
                              onClick={() => {
                                if (window.confirm(`撤销 ${u.displayName} 的全部登录？`))
                                  void mutate({ action: "revokeSessions", username: u.username });
                              }}
                            >
                              撤销登录
                            </button>
                            <button
                              className="text-button negative"
                              disabled={busy || Boolean(editor) || conflict}
                              onClick={() => {
                                if (window.confirm(`删除用户 ${u.displayName}？`))
                                  void mutate({ action: "deleteUser", username: u.username });
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {section === "accounts" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>
                  交易所账户 <span className="count">{data.accounts.length}</span>
                </h2>
                <button
                  className="button primary"
                  disabled={busy || Boolean(editor) || conflict}
                  onClick={() => {
                    setEditor({ type: "account", original: null });
                    setNotice("");
                  }}
                >
                  <Plus size={15} />
                  新增账户
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>账户</th>
                      <th>来源</th>
                      <th>本金 · USDT</th>
                      <th>API</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.accounts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.label}</strong>
                          <small>{a.id}</small>
                        </td>
                        <td>
                          {a.source === "demo"
                            ? "演示"
                            : `Binance · ${a.environment === "mainnet" ? "现货" : "测试网"}`}
                        </td>
                        <td>
                          {a.principal === null
                            ? "—"
                            : Number(a.principal).toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}
                        </td>
                        <td>{a.hasCredentials ? "已配置" : "—"}</td>
                        <td>
                          <span className={a.enabled ? "positive" : "admin-muted"}>
                            {a.enabled ? "启用" : "停用"}
                          </span>
                        </td>
                        <td>
                          <div className="admin-row-actions">
                            <button
                              className="text-button"
                              disabled={busy || Boolean(editor) || !a.enabled}
                              onClick={() => onView(a.id)}
                            >
                              查看
                            </button>
                            <button
                              className="text-button"
                              disabled={busy || Boolean(editor) || !a.enabled}
                              onClick={() => onView(a.id, true)}
                            >
                              成本
                            </button>
                            <button
                              className="text-button"
                              disabled={busy || Boolean(editor) || conflict}
                              onClick={() => {
                                setEditor({ type: "account", original: a });
                                setNotice("");
                              }}
                            >
                              编辑
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!data.accounts.length && (
                      <tr>
                        <td colSpan={6} className="admin-empty">
                          尚未添加账户
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {section === "audit" && (
            <section className="panel">
              <div className="panel-heading">
                <h2>操作记录</h2>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作人</th>
                      <th>操作</th>
                      <th>对象</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audit.map((event, i) => (
                      <tr key={`${event.at}-${i}`}>
                        <td>{new Date(event.at).toLocaleString("zh-CN")}</td>
                        <td>{event.by}</td>
                        <td>{actionNames[event.action] ?? event.action}</td>
                        <td>{event.target}</td>
                      </tr>
                    ))}
                    {!data.audit.length && (
                      <tr>
                        <td colSpan={4} className="admin-empty">
                          暂无记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function AccountForm({
  initial,
  disabled,
  onSave,
  onCancel,
}: {
  initial: Account | null;
  disabled: boolean;
  onSave: (v: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const [source, setSource] = useState(initial?.source ?? "binance");
  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSave({
          id: initial?.id ?? f.get("id"),
          label: f.get("label"),
          source,
          environment: initial?.environment ?? f.get("environment"),
          enabled: f.get("enabled") === "on",
          principal: String(f.get("principal") ?? "").trim() || null,
          ...(source === "binance"
            ? { apiKey: f.get("apiKey"), apiSecret: f.get("apiSecret") }
            : {}),
        });
      }}
    >
      <fieldset disabled={disabled}>
        <div className="admin-fields">
          <label>
            账户名称
            <input name="label" required maxLength={60} defaultValue={initial?.label} />
          </label>
          <label>
            账户 ID
            <input
              name="id"
              required
              pattern="[a-zA-Z0-9_\-]{1,64}"
              maxLength={64}
              readOnly={Boolean(initial)}
              defaultValue={initial?.id}
              placeholder="例如 chengyu_li"
            />
          </label>
          <label>
            来源
            <select
              name="source"
              value={source}
              disabled={Boolean(initial)}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              <option value="binance">Binance</option>
              <option value="demo">演示账户</option>
            </select>
          </label>
          <label>
            网络
            <select
              name="environment"
              defaultValue={initial?.environment ?? "mainnet"}
              disabled={Boolean(initial)}
            >
              <option value="mainnet">现货主网</option>
              <option value="testnet">测试网</option>
            </select>
          </label>
          <label>
            本金 · USDT
            <input
              name="principal"
              inputMode="decimal"
              pattern="[0-9]{1,20}(\.[0-9]{1,16})?"
              maxLength={37}
              defaultValue={initial?.principal ?? ""}
              placeholder="未设置"
            />
          </label>
          <label className="admin-check">
            <input type="checkbox" name="enabled" defaultChecked={initial?.enabled ?? true} />
            启用账户
          </label>
          {source === "binance" && (
            <>
              <label>
                API Key
                <input
                  type="password"
                  name="apiKey"
                  autoComplete="new-password"
                  maxLength={512}
                  required={!initial?.hasCredentials}
                  placeholder={initial?.hasCredentials ? "已配置，留空保留" : "只读 API Key"}
                />
              </label>
              <label>
                API Secret
                <input
                  type="password"
                  name="apiSecret"
                  autoComplete="new-password"
                  maxLength={512}
                  required={!initial?.hasCredentials}
                  placeholder={initial?.hasCredentials ? "已配置，留空保留" : "API Secret"}
                />
              </label>
            </>
          )}
        </div>
        <div className="admin-form-actions">
          <button className="button primary" type="submit">
            保存账户
          </button>
          <button className="button" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function UserForm({
  initial,
  accounts,
  disabled,
  onSave,
  onCancel,
}: {
  initial: User | null;
  accounts: Account[];
  disabled: boolean;
  onSave: (v: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          password = String(f.get("password") ?? "");
        void onSave({
          username: initial?.username ?? f.get("username"),
          displayName: f.get("displayName"),
          accountId: f.get("accountId"),
          enabled: f.get("enabled") === "on",
          ...(password ? { password } : {}),
        });
      }}
    >
      <fieldset disabled={disabled}>
        <div className="admin-fields">
          <label>
            显示名称
            <input name="displayName" required maxLength={60} defaultValue={initial?.displayName} />
          </label>
          <label>
            登录用户名
            <input
              name="username"
              required
              pattern="[a-zA-Z0-9_.\-]{3,64}"
              maxLength={64}
              readOnly={Boolean(initial)}
              defaultValue={initial?.username}
              autoComplete="off"
            />
          </label>
          <label>
            {initial ? "重置密码" : "登录密码"}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={256}
              required={!initial}
              placeholder={initial ? "留空保留原密码" : "至少 8 位"}
            />
          </label>
          <label>
            绑定账户
            <select
              name="accountId"
              required
              defaultValue={
                initial?.accountId ?? accounts.find((a) => a.enabled)?.id ?? accounts[0]?.id
              }
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.enabled ? "" : "（已停用）"}
                </option>
              ))}
            </select>
          </label>
          <label>
            权限
            <input value="只读" readOnly />
          </label>
          <label className="admin-check">
            <input name="enabled" type="checkbox" defaultChecked={initial?.enabled ?? true} />
            允许登录
          </label>
        </div>
        <div className="admin-form-actions">
          <button className="button primary" type="submit">
            保存用户
          </button>
          <button className="button" type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}
