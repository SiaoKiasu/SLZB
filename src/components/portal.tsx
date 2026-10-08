"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  Download,
  Eye,
  EyeOff,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Dashboard, Holding, Trade } from "@/lib/types";
type Tab = "overview" | "holdings" | "activity" | "settings";
const colors = ["#355b49", "#8da184", "#c5bc92", "#b0c6a8", "#dfdfc6", "#8eaba8"];
const assetNames: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  BNB: "BNB",
  USDT: "Tether",
  USDC: "USD Coin",
};
function number(value: string | number | null, digits = 2) {
  return value === null
    ? "—"
    : Number(value).toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits === 2 ? 2 : 0,
      });
}
function signed(value: string | null) {
  return value === null
    ? "—"
    : `${Number(value) >= 0 ? "+" : "−"}${number(Math.abs(Number(value)))}`;
}
function time(value: number, short = false) {
  return new Date(value).toLocaleString(
    "zh-CN",
    short
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
      : { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false },
  );
}
function Coin({ asset, index = 0 }: { asset: string; index?: number }) {
  return (
    <span
      className={`coin coin-${asset.toLowerCase()}`}
      style={{ "--coin-color": colors[index % colors.length] } as React.CSSProperties}
    >
      {({ BTC: "₿", ETH: "Ξ", SOL: "≋", BNB: "◇", USDT: "₮", USDC: "$" } as Record<string, string>)[
        asset
      ] ?? asset.slice(0, 1)}
    </span>
  );
}
function Badge({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={`badge ${muted ? "muted" : ""}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error?.message ?? "请求失败，请稍后重试。"), {
      status: response.status,
    });
  return data;
}
export function Portal() {
  const [session, setSession] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [protectedSession, setProtected] = useState(false);
  const [password, setPassword] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [hidden, setHidden] = useState(false);
  const [period, setPeriod] = useState(7);
  const [search, setSearch] = useState("");
  const [side, setSide] = useState("ALL");
  const [page, setPage] = useState(1);
  const [showSmall, setShowSmall] = useState(true);
  const [notice, setNotice] = useState(false);
  const [now, setNow] = useState(Date.now());
  const checkSession = useCallback(async () => {
    setSession("loading");
    setError("");
    try {
      const s = await api("/api/session");
      setProtected(s.passwordProtected);
      setSession("ready");
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) setSession("login");
      else {
        setError(err.message);
        setSession("error");
      }
    }
  }, []);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    try {
      setData(await api("/api/sync", { method: "POST" }));
      setError("");
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) {
        setSession("login");
        setData(null);
      }
      setError(err.message);
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void checkSession();
  }, [checkSession]);
  useEffect(() => {
    if (session !== "ready") return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60000);
    const clock = setInterval(() => setNow(Date.now()), 10000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [session, load]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setProtected(true);
      setSession("ready");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await api("/api/session", { method: "DELETE" });
      setData(null);
      setSession("login");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function navigate(next: Tab) {
    setTab(next);
    setSearch("");
    setSide("ALL");
    setPage(1);
  }
  const money = (value: string | number | null) =>
    hidden
      ? "••••••"
      : number(
          value,
          value !== null && Math.abs(Number(value)) > 0 && Math.abs(Number(value)) < 1 ? 8 : 2,
        );
  const profit = (value: string | null) => (hidden ? "••••••" : signed(value));
  if (session !== "ready")
    return (
      <main className="entrance">
        <div className="entrance-art">
          <div className="brand">
            <span className="brand-mark">
              <BarChart3 size={24} />
            </span>{" "}
            SLZB <span className="brand-sub">PORTFOLIO</span>
          </div>
          <div className="entrance-copy">
            <span className="eyebrow">A CLEARER VIEW OF YOUR CAPITAL</span>
            <h1>
              每一笔资产，
              <br />
              心中有数。
            </h1>
            <p>
              持仓、盈亏与交易动态。
              <br />
              一个安静、清晰的账户观察室。
            </p>
            <div className="art-bars">
              {[32, 45, 38, 60, 54, 74, 69, 88, 81, 100].map((h, i) => (
                <i key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <span className="entrance-footer">PRIVATE ACCESS · READ ONLY</span>
        </div>
        <div className="entrance-form">
          <div className="login-card">
            <span className="login-icon">
              <LockKeyhole size={26} />
            </span>
            <span className="eyebrow">YOUR PRIVATE WORKSPACE</span>
            <h2>
              {session === "login"
                ? "欢迎回到账户观察室"
                : session === "error"
                  ? "完成连接配置"
                  : "正在打开账户观察室"}
            </h2>
            <p>通过访问密码，安全查看账户动态。</p>
            {session === "login" && (
              <form onSubmit={login}>
                <label htmlFor="password">访问密码</label>
                <input
                  id="password"
                  autoFocus
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="输入账户访问密码"
                />
                <button className="button primary full" disabled={busy}>
                  {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowUpRight size={16} />}
                  进入账户
                </button>
              </form>
            )}
            {session === "loading" && <LoaderCircle className="spin" />}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {session === "error" && (
              <>
                <p className="help-text">
                  在 Vercel 环境变量或本地 .env.local
                  中完成配置后，重新部署或重启服务。首次体验可设置 DATA_SOURCE=demo。
                </p>
                <button className="button" onClick={checkSession}>
                  <RefreshCw size={15} />
                  重新检查
                </button>
              </>
            )}
            <div className="login-note">
              <ShieldCheck size={16} />
              仅用于查看 · API 密钥保留在服务端
            </div>
          </div>
        </div>
      </main>
    );
  const stale = data && now - data.updatedAt > 120000;
  const partial =
    data &&
    (!data.connection.tradesComplete ||
      !data.connection.ordersComplete ||
      data.summary.unpricedAssets > 0);
  const holdings =
    data?.holdings.filter(
      (h) =>
        h.asset.toLowerCase().includes(search.toLowerCase()) &&
        (showSmall || Number(h.value ?? 0) >= 1),
    ) ?? [];
  const trades =
    data?.trades.filter(
      (t) =>
        (side === "ALL" || side === t.side) &&
        t.symbol.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const pages = Math.max(1, Math.ceil(trades.length / 12));
  const safePage = Math.min(page, pages);
  function exportTrades() {
    const rows = [
      [
        "成交ID",
        "交易对",
        "方向",
        "价格",
        "数量",
        "成交额(报价币)",
        "手续费",
        "手续费币种",
        "时间(UTC)",
      ],
      ...trades.map((t) => [
        t.id,
        t.symbol,
        t.side,
        t.price,
        t.quantity,
        t.quoteQuantity,
        t.fee,
        t.feeAsset,
        new Date(t.time).toISOString(),
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((r) =>
          r
            .map(
              (v) =>
                `"${String(v)
                  .replace(/^[=+\-@]/, "'$&")
                  .replaceAll('"', '""')}"`,
            )
            .join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `SLZB-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const title = {
    overview: "账户总览",
    holdings: "资产持仓",
    activity: "交易记录",
    settings: "连接与设置",
  }[tab];
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="SLZB 首页">
          <span className="brand-mark">
            <BarChart3 size={23} />
          </span>
          SLZB
        </a>
        <div className="workspace-label">
          账户观察室 <span>SPOT</span>
        </div>
        <div className="nav-label">工作空间</div>
        <nav>
          {(
            [
              { id: "overview", label: "账户总览", icon: LayoutDashboard },
              { id: "holdings", label: "资产持仓", icon: Wallet },
              { id: "activity", label: "交易记录", icon: Activity },
              { id: "settings", label: "连接与设置", icon: Settings2 },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${tab === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {tab === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="readonly-box">
            <ShieldCheck size={22} />
            <strong>安心观察，专注决策</strong>
            <p>
              只读账户连接
              <br />
              资产始终在你的交易所
            </p>
          </div>
          <button
            className="help-button"
            onClick={() => {
              navigate("settings");
              setNotice(true);
            }}
          >
            <CircleHelp size={16} />
            接入指南
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar">S</span>
            <div>
              <strong>{data?.accountLabel ?? "我的账户"}</strong>
              <small>PRIVATE WORKSPACE</small>
            </div>
            {protectedSession && (
              <button className="icon-button" onClick={logout} aria-label="退出登录">
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="read-only">
              <ShieldCheck size={14} />
              只读访问
            </span>
            <span className="avatar small">S</span>
            {protectedSession && (
              <button className="icon-button" onClick={logout} aria-label="退出账户">
                <LogOut size={15} />
              </button>
            )}
          </div>
        </header>
        <main className="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">PORTFOLIO / {tab.toUpperCase()}</div>
              <h1>
                {title}
                <button
                  className="icon-button"
                  onClick={() => setHidden(!hidden)}
                  aria-label={hidden ? "显示金额" : "隐藏金额"}
                >
                  {hidden ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </h1>
              <p>掌握资产全貌，跟上每一笔变化。</p>
            </div>
            <div className="heading-actions">
              <Badge
                muted={
                  data?.source === "demo" || Boolean(error) || Boolean(stale) || Boolean(partial)
                }
              >
                {data?.source === "demo"
                  ? "演示模式"
                  : error || stale
                    ? "数据待更新"
                    : partial
                      ? "部分数据未同步"
                      : "Binance 现货"}
              </Badge>
              <button className="button" onClick={load} disabled={busy}>
                <RefreshCw size={15} className={busy ? "spin" : ""} />
                {busy ? "更新中" : "刷新数据"}
              </button>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              {data && " 当前展示上次成功数据。"}
            </div>
          )}
          {data?.source === "demo" && (
            <div className="demo-banner">
              <span>
                <span className="demo-label">DEMO</span>当前为模拟账户。准备好后，接入你的真实资产。
              </span>
              <button onClick={() => navigate("settings")}>
                连接账户 <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="empty large">
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={28} />
                  <h3>正在同步账户数据</h3>
                  <p>第一次连接可能需要一点时间。</p>
                </>
              ) : (
                <>
                  <Wallet size={30} />
                  <h3>暂时无法加载账户</h3>
                  <p>请检查连接配置，然后点击刷新数据。</p>
                </>
              )}
            </div>
          ) : (
            <>
              {(tab === "overview" || tab === "holdings") && (
                <div className="stats">
                  <div className="stat featured">
                    <div className="stat-label">
                      {data.summary.unpricedAssets ? "已估值资产小计" : "总资产估值"}
                      <Wallet size={17} />
                    </div>
                    <div className="stat-value">
                      {money(data.summary.equity)}
                      <span>USDT</span>
                    </div>
                    <div className="stat-note">
                      <span className="live-dot" />
                      {data.summary.pricedAssets} 种已估值资产 · 现货钱包
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">
                      账户累计盈亏
                      <ArrowUpRight size={17} />
                    </div>
                    <div
                      className={`stat-value ${Number(data.summary.totalPnl) < 0 ? "negative" : "positive"}`}
                    >
                      {profit(data.summary.totalPnl)}
                      <span>USDT</span>
                    </div>
                    <div className="stat-note">
                      {data.summary.totalPnl === null
                        ? "配置起始本金与资金流水后显示"
                        : `起始净值 ${money(data.summary.baseline)} · 手工资金口径`}
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">
                      已配置成本持仓浮盈亏
                      <BarChart3 size={17} />
                    </div>
                    <div
                      className={`stat-value ${Number(data.summary.unrealizedPnl) < 0 ? "negative" : "positive"}`}
                    >
                      {profit(data.summary.unrealizedPnl)}
                      <span>USDT</span>
                    </div>
                    <div className="stat-note">
                      覆盖 {data.summary.costCoverage} 种资产 · 基于配置成本
                    </div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">
                      稳定币资产
                      <Wallet size={17} />
                    </div>
                    <div className="stat-value">
                      {money(data.summary.stablecoinValue)}
                      <span>USDT</span>
                    </div>
                    <div className="stat-note">含可用与挂单冻结余额</div>
                  </div>
                </div>
              )}
              {tab === "overview" && (
                <>
                  <div className="charts-grid">
                    <section className="panel chart-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            资产走势 <span className="subtle-tag">USDT</span>
                          </h2>
                          <p>账户资产估值随时间的变化</p>
                        </div>
                        <div className="segmented">
                          {[
                            { d: 1, label: "24H" },
                            { d: 7, label: "7D" },
                            { d: 30, label: "30D" },
                            { d: 90, label: "90D" },
                          ].map((p) => (
                            <button
                              key={p.d}
                              className={period === p.d ? "selected" : ""}
                              onClick={() => setPeriod(p.d)}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <EquityChart data={data} period={period} hidden={hidden} />
                      <div className="chart-footer">
                        <span>
                          <i />
                          {data.source === "demo" ? "模拟净值" : "已保存账户净值"}
                        </span>
                        <span>净值变化包含资金进出，不等同于收益</span>
                      </div>
                    </section>
                    <section className="panel allocation-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>资产分布</h2>
                          <p>按当前估值占比</p>
                        </div>
                        <span className="subtle-tag">{data.holdings.length} ASSETS</span>
                      </div>
                      <div className="donut-wrap">
                        <ResponsiveContainer width="100%" height={180}>
                          <PieChart>
                            <Pie
                              data={data.holdings
                                .filter((h) => Number(h.value) > 0)
                                .map((h) => ({ name: h.asset, value: Number(h.value) }))}
                              dataKey="value"
                              innerRadius={62}
                              outerRadius={79}
                              paddingAngle={3}
                              stroke="none"
                              startAngle={90}
                              endAngle={-270}
                            >
                              {data.holdings
                                .filter((h) => Number(h.value) > 0)
                                .map((h, i) => (
                                  <Cell key={h.asset} fill={colors[i % colors.length]} />
                                ))}
                            </Pie>
                            <Tooltip
                              formatter={(v) => (hidden ? "已隐藏" : `${number(Number(v))} USDT`)}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="donut-center">
                          <small>持有资产</small>
                          <strong>
                            {data.holdings.length}
                            <span> 种</span>
                          </strong>
                        </div>
                      </div>
                      <div className="allocation-list">
                        {data.holdings.slice(0, 5).map((h, i) => (
                          <div key={h.asset}>
                            <span>
                              <i style={{ background: colors[i % colors.length] }} />
                              {h.asset}
                            </span>
                            <strong>{number(h.allocation, 1)}%</strong>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                </>
              )}
              {(tab === "overview" || tab === "holdings") && (
                <section className="panel holdings-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        资产持仓 <span className="count">{data.holdings.length}</span>
                      </h2>
                      <p>现货余额与当前估值</p>
                    </div>
                    {tab === "overview" ? (
                      <button className="text-button" onClick={() => navigate("holdings")}>
                        查看全部 <ArrowUpRight size={15} />
                      </button>
                    ) : (
                      <div className="table-tools">
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={!showSmall}
                            onChange={(e) => setShowSmall(!e.target.checked)}
                          />
                          隐藏小额资产
                        </label>
                        <SearchBox value={search} onChange={setSearch} placeholder="搜索币种" />
                      </div>
                    )}
                  </div>
                  <HoldingTable
                    holdings={tab === "overview" ? data.holdings.slice(0, 5) : holdings}
                    money={money}
                    profit={profit}
                    hidden={hidden}
                  />
                </section>
              )}
              {tab === "overview" && (
                <section className="panel recent-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>最近成交</h2>
                      <p>
                        {data.connection.tradesComplete
                          ? "账户的最新交易动态"
                          : "部分交易对暂未同步成功"}
                      </p>
                    </div>
                    <button className="text-button" onClick={() => navigate("activity")}>
                      全部交易 <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <TradeTable trades={data.trades.slice(0, 4)} hidden={hidden} />
                </section>
              )}
              {tab === "activity" && (
                <>
                  <div className="activity-summary">
                    <div>
                      <span>本次加载成交</span>
                      <strong>
                        {data.trades.length}
                        <small> 笔</small>
                      </strong>
                    </div>
                    <div>
                      <span>当前挂单</span>
                      <strong>
                        {data.connection.ordersComplete ? data.orders.length : "—"}
                        <small> 笔</small>
                      </strong>
                    </div>
                    <div>
                      <span>覆盖交易对</span>
                      <strong>
                        {data.connection.symbols.length}
                        <small> 个</small>
                      </strong>
                    </div>
                    <p>
                      每个配置交易对最近 100 笔成交。
                      <br />
                      手续费按原币种展示。
                    </p>
                  </div>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>成交明细</h2>
                        <p>已执行交易 · 不含充值、提现与内部划转</p>
                      </div>
                      <button className="button" onClick={exportTrades}>
                        <Download size={15} />
                        导出 CSV
                      </button>
                    </div>
                    <div className="filterbar">
                      <div className="segmented">
                        {[
                          { v: "ALL", l: "全部成交" },
                          { v: "BUY", l: "买入" },
                          { v: "SELL", l: "卖出" },
                        ].map((s) => (
                          <button
                            key={s.v}
                            className={side === s.v ? "selected" : ""}
                            onClick={() => {
                              setSide(s.v);
                              setPage(1);
                            }}
                          >
                            {s.l}
                          </button>
                        ))}
                      </div>
                      <SearchBox
                        value={search}
                        onChange={(s) => {
                          setSearch(s);
                          setPage(1);
                        }}
                        placeholder="搜索交易对"
                      />
                    </div>
                    <TradeTable
                      trades={trades.slice((safePage - 1) * 12, safePage * 12)}
                      hidden={hidden}
                    />
                    <div className="pagination">
                      <span>共 {trades.length} 笔匹配成交</span>
                      <div>
                        <button
                          className="icon-button"
                          disabled={safePage <= 1}
                          onClick={() => setPage(safePage - 1)}
                          aria-label="上一页"
                        >
                          <ChevronLeft size={18} />
                        </button>
                        {safePage} / {pages}
                        <button
                          className="icon-button"
                          disabled={safePage >= pages}
                          onClick={() => setPage(safePage + 1)}
                          aria-label="下一页"
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <h2>当前挂单</h2>
                        <p>包含部分成交订单 · 只读查看</p>
                      </div>
                      <span className="count">
                        {data.connection.ordersComplete ? data.orders.length : "同步失败"}
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>交易对</th>
                            <th>方向 / 类型</th>
                            <th>委托价格</th>
                            <th>委托数量</th>
                            <th>已成交数量</th>
                            <th>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.orders.map((o) => (
                            <tr key={`${o.symbol}-${o.id}`}>
                              <td>
                                <strong>{o.symbol}</strong>
                              </td>
                              <td>
                                <span className={o.side === "BUY" ? "positive" : "negative"}>
                                  {o.side === "BUY" ? "买入" : "卖出"}
                                </span>{" "}
                                · {o.type}
                              </td>
                              <td className="numeric">{money(o.price)}</td>
                              <td className="numeric">{hidden ? "••••" : number(o.quantity, 8)}</td>
                              <td className="numeric">
                                {hidden ? "••••" : number(o.executedQuantity, 8)}
                              </td>
                              <td>
                                <span className="subtle-tag">
                                  {o.status === "NEW"
                                    ? "等待成交"
                                    : o.status === "PARTIALLY_FILLED"
                                      ? "部分成交"
                                      : o.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!data.orders.length && (
                        <div className="empty">
                          {data.connection.ordersComplete ? "暂无挂单" : "挂单读取失败，请重试。"}
                        </div>
                      )}
                    </div>
                  </section>
                </>
              )}
              {tab === "settings" && (
                <Settings
                  data={data}
                  notice={notice}
                  onDismiss={() => setNotice(false)}
                  onTest={load}
                  busy={busy}
                />
              )}
              {data.warnings.length > 0 && (
                <details
                  className="data-notes"
                  open={tab === "settings" || Boolean(data.summary.unpricedAssets)}
                >
                  <summary>
                    <CircleHelp size={15} />
                    数据说明与覆盖范围 <span>{data.warnings.length}</span>
                  </summary>
                  <ul>
                    {data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <footer className="page-footer">
                <span>
                  <span
                    className={`status-dot ${error || stale || partial ? "warning-dot" : ""}`}
                  />
                  {error || stale ? "数据待更新" : partial ? "部分数据未同步" : "数据已同步"} ·{" "}
                  {time(data.updatedAt, true)}
                  {data.source === "demo" ? " · 模拟数据" : ""}
                </span>
                <span>每 60 秒刷新 · USDT 计价 · SLZB</span>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={15} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button onClick={() => onChange("")} aria-label="清空搜索">
          <X size={13} />
        </button>
      )}
    </label>
  );
}
function HoldingTable({
  holdings,
  money,
  profit,
  hidden,
}: {
  holdings: Holding[];
  money: (v: string | number | null) => string;
  profit: (v: string | null) => string;
  hidden: boolean;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>资产</th>
            <th>持有数量 / 冻结</th>
            <th>最新价格 / 24h</th>
            <th>资产估值 (USDT)</th>
            <th>持仓浮盈亏 (USDT)</th>
            <th>资产占比</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h, i) => (
            <tr key={h.asset}>
              <td>
                <div className="asset-cell">
                  <Coin asset={h.asset} index={i} />
                  <div>
                    <strong>{h.asset}</strong>
                    <small>{assetNames[h.asset] ?? h.asset}</small>
                  </div>
                </div>
              </td>
              <td className="numeric">
                <strong>{hidden ? "••••" : number(h.quantity, 8)}</strong>
                <small>冻结 {hidden ? "••••" : number(h.locked, 8)}</small>
              </td>
              <td className="numeric">
                <strong>{money(h.price)}</strong>
                <small className={(h.change24h ?? 0) >= 0 ? "positive" : "negative"}>
                  {h.change24h === null
                    ? "暂无行情"
                    : `${h.change24h >= 0 ? "+" : ""}${number(h.change24h)}%`}
                </small>
              </td>
              <td className="numeric">
                <strong>{money(h.value)}</strong>
                {h.value === null && <small>未计入估值</small>}
              </td>
              <td className="numeric">
                <strong
                  className={
                    h.unrealizedPnl === null
                      ? "muted-text"
                      : Number(h.unrealizedPnl) >= 0
                        ? "positive"
                        : "negative"
                  }
                >
                  {profit(h.unrealizedPnl)}
                </strong>
                <small>
                  {h.averageCost === null ? "待配置成本" : `成本 ${money(h.averageCost)}`}
                </small>
              </td>
              <td>
                <div className="allocation-cell">
                  <span>{number(h.allocation, 1)}%</span>
                  <div>
                    <i style={{ width: `${h.allocation}%` }} />
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!holdings.length && <div className="empty">没有符合条件的资产。</div>}
    </div>
  );
}
function TradeTable({ trades, hidden }: { trades: Trade[]; hidden: boolean }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>交易对</th>
            <th>方向</th>
            <th>成交价格</th>
            <th>成交数量</th>
            <th>成交额（报价币）</th>
            <th>手续费</th>
            <th>时间（本地）</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={`${t.symbol}-${t.id}`}>
              <td>
                <strong>{t.symbol}</strong>
                <small>{t.isMaker ? "Maker" : "Taker"}</small>
              </td>
              <td>
                <span className={`side-pill ${t.side === "BUY" ? "buy" : "sell"}`}>
                  {t.side === "BUY" ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}{" "}
                  {t.side === "BUY" ? "买入" : "卖出"}
                </span>
              </td>
              <td className="numeric">{hidden ? "••••" : number(t.price, 8)}</td>
              <td className="numeric">{hidden ? "••••" : number(t.quantity, 8)}</td>
              <td className="numeric">{hidden ? "••••" : number(t.quoteQuantity, 8)}</td>
              <td className="numeric">
                {hidden ? "••••" : number(t.fee, 8)} <small className="inline">{t.feeAsset}</small>
              </td>
              <td className="date-cell">{time(t.time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!trades.length && (
        <div className="empty">暂无匹配成交。真实账户请确认已配置对应交易对。</div>
      )}
    </div>
  );
}
function EquityChart({
  data,
  period,
  hidden,
}: {
  data: Dashboard;
  period: number;
  hidden: boolean;
}) {
  const points = data.history
    .filter((h) => h.time >= Date.now() - period * 86400000)
    .map((h) => ({ time: h.time, value: Number(h.equity) }));
  if (hidden)
    return (
      <div className="empty chart-empty">
        <EyeOff size={25} />
        <p>金额已隐藏</p>
      </div>
    );
  if (points.length < 2)
    return (
      <div className="empty chart-empty">
        <BarChart3 size={28} />
        <h3>{points.length ? "第一笔净值已记录" : "等待净值记录"}</h3>
        <p>
          {data.connection.database
            ? "积累两个时间点后，资产走势将在这里显示。"
            : "连接数据库后，可持续记录账户净值。"}
        </p>
      </div>
    );
  return (
    <div className="equity-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#719c79" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#719c79" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eaece5" strokeDasharray="3 5" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) =>
              new Date(t).toLocaleDateString("zh-CN", {
                month: "2-digit",
                day: "2-digit",
                ...(period === 1 ? { hour: "2-digit" } : {}),
              })
            }
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#93978d", fontSize: 11 }}
            minTickGap={42}
            dy={10}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#93978d", fontSize: 11 }}
            width={55}
          />
          <Tooltip
            labelFormatter={(v) => time(Number(v))}
            formatter={(v) => [`${number(Number(v))} USDT`, "资产估值"]}
            contentStyle={{ border: "1px solid #e5e7df", borderRadius: 10, fontSize: 12 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#52765a"
            strokeWidth={2.5}
            fill="url(#equityFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
function Settings({
  data,
  notice,
  onDismiss,
  onTest,
  busy,
}: {
  data: Dashboard;
  notice: boolean;
  onDismiss: () => void;
  onTest: () => void;
  busy: boolean;
}) {
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>账户连接</h2>
            <p>一个账户，一处清晰的资产视图</p>
          </div>
          <ShieldCheck size={22} className="positive" />
        </div>
        <div className="settings-content">
          <div className="exchange-card">
            <div className="exchange-logo">◇</div>
            <div>
              <h3>{data.environment}</h3>
              <p>{data.accountLabel}</p>
            </div>
            <Badge muted={data.source === "demo"}>
              {data.source === "demo" ? "模拟数据" : "已连接"}
            </Badge>
          </div>
          <dl className="settings-list">
            <div>
              <dt>访问模式</dt>
              <dd>只读查询</dd>
            </div>
            <div>
              <dt>自动刷新</dt>
              <dd>60 秒 / 页面可见时</dd>
            </div>
            <div>
              <dt>净值存储</dt>
              <dd>
                {data.source === "demo"
                  ? "模拟曲线"
                  : data.connection.snapshotsSaved
                    ? "已保存至数据库"
                    : data.connection.database
                      ? "数据库已配置 · 本次未保存"
                      : "尚未配置"}
              </dd>
            </div>
            <div>
              <dt>最近同步</dt>
              <dd>{time(data.updatedAt)}</dd>
            </div>
            <div>
              <dt>成交交易对</dt>
              <dd className="symbol-tags">
                {data.connection.symbols.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </dd>
            </div>
          </dl>
          <button className="button primary" onClick={onTest} disabled={busy}>
            <RefreshCw size={15} className={busy ? "spin" : ""} />
            {busy ? "正在检查" : "测试连接并刷新"}
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>接入真实账户</h2>
            <p>在服务端完成配置，朋友只需登录查看</p>
          </div>
          {notice && (
            <button className="icon-button" onClick={onDismiss} aria-label="关闭提示">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="settings-content">
          <ol className="setup-steps">
            <li>
              <span>01</span>
              <div>
                <strong>创建 Binance 只读 API</strong>
                <p>仅开启读取权限。请勿开启交易或提现权限，使用 HMAC 类型密钥。</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>填写 Vercel 环境变量</strong>
                <p>
                  设置 DATA_SOURCE=binance、API Key / Secret，以及访问密码和会话密钥。完整模板见项目
                  .env.example。
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>重新部署并测试连接</strong>
                <p>
                  修改环境变量后重新部署；本地测试则重启开发服务。确认监控交易对包含已清仓币种。
                </p>
              </div>
            </li>
          </ol>
          <div className="info-box">
            <LockKeyhole size={16} />
            <p>API Secret 只在服务端保存。这里不会读取、展示或存储你的密钥。</p>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>盈亏计算口径</h2>
            <p>把账户表现与资金流动分开看</p>
          </div>
          <BarChart3 size={20} />
        </div>
        <div className="settings-content">
          <div className="formula">累计盈亏 = 当前净值 − 起始净值 − 期间净入金</div>
          <p className="help-text">
            使用 PERFORMANCE_BASELINE_USDT、PERFORMANCE_BASELINE_AT 和 PERFORMANCE_NET_FLOWS_USDT
            设置统计起点。净入金包括充值、提现、内部转账，发生变化后需手工更新。
          </p>
          <dl className="settings-list">
            <div>
              <dt>统计起始时间</dt>
              <dd>
                {data.summary.baselineAt ? time(Date.parse(data.summary.baselineAt)) : "待配置"}
              </dd>
            </div>
            <div>
              <dt>持仓浮盈亏</dt>
              <dd>数量 ×（当前价格 − 配置成本）</dd>
            </div>
          </dl>
          <p className="help-text">
            COST_BASIS_JSON
            设置当前剩余持仓的平均成本（含费用），交易或转账后需要维护。本版不将有限成交记录推断为全历史成本，也不提供自动已实现盈亏。
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>历史净值与更新</h2>
            <p>从接入那一刻，开始积累</p>
          </div>
          <Database size={20} />
        </div>
        <div className="settings-content">
          <div className="feature-line">
            <Check size={17} />
            <div>
              <strong>实时查看无需数据库</strong>
              <p>配置 API 即可查询现货持仓、成交和挂单。</p>
            </div>
          </div>
          <div className="feature-line">
            <Check size={17} />
            <div>
              <strong>Neon Postgres 保存净值</strong>
              <p>设置 DATABASE_URL 后自动建表。五分钟一个快照时间桶，走势图展示近 90 天。</p>
            </div>
          </div>
          <div className="feature-line">
            <Check size={17} />
            <div>
              <strong>关闭页面后也能记录</strong>
              <p>
                设置 CRON_SECRET。默认 Vercel Cron
                每天运行一次；更高频后台采集需相应套餐或外部调度。
              </p>
            </div>
          </div>
          <p className="help-text">
            部署区默认 Frankfurt。连接失败时核对 Binance 对账户所在地区的规则和出口 IP；严格 IP
            白名单需要固定出口网络。
          </p>
        </div>
      </section>
    </div>
  );
}
