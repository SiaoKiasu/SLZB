import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config";
import { AppError } from "./errors";
import type { ProviderData, Trade, TradeLedger } from "./types";
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const id = z.number().int().safe().transform(String);
const tradeSchema = z.array(
  z.object({
    id,
    symbol: z.string(),
    price: decimal,
    qty: decimal,
    quoteQty: decimal,
    commission: decimal,
    commissionAsset: z.string(),
    time: z.number(),
    isBuyer: z.boolean(),
    isMaker: z.boolean(),
  }),
);
export function signQuery(query: string, secret: string) {
  return createHmac("sha256", secret).update(query).digest("hex");
}
export class BinanceClient {
  private offset = 0;
  private base: string;
  constructor(
    private config: Pick<Config, "BINANCE_ENV" | "BINANCE_API_KEY" | "BINANCE_API_SECRET">,
    private transport: typeof fetch = fetch,
    private deadline = Date.now() + 40000,
  ) {
    this.base =
      config.BINANCE_ENV === "testnet"
        ? "https://testnet.binance.vision"
        : "https://api.binance.com";
  }
  async request(
    path: string,
    params: Record<string, string> = {},
    signed = false,
  ): Promise<unknown> {
    // This adapter intentionally exposes only GET calls; no trading/withdrawal endpoint exists.
    const query = new URLSearchParams(params);
    if (signed) {
      query.set("timestamp", String(Date.now() + this.offset));
      query.set("recvWindow", "10000");
      query.set("signature", signQuery(query.toString(), this.config.BINANCE_API_SECRET));
    }
    let response: Response;
    try {
      response = await this.transport(`${this.base}${path}?${query}`, {
        method: "GET",
        cache: "no-store",
        headers: signed ? { "X-MBX-APIKEY": this.config.BINANCE_API_KEY } : {},
        signal: AbortSignal.timeout(Math.max(1, Math.min(10000, this.deadline - Date.now()))),
      });
    } catch {
      throw new AppError(
        "EXCHANGE_NETWORK",
        "无法连接 Binance，请检查网络、部署区域或稍后重试。",
        502,
      );
    }
    if (response.status === 451 || response.status === 403)
      throw new AppError(
        "EXCHANGE_REGION",
        "Binance 拒绝了当前部署出口。请核对账户适用地区及部署区域。",
        502,
      );
    if (response.status === 429 || response.status === 418)
      throw new AppError("EXCHANGE_RATE_LIMIT", "交易所请求过于频繁，请暂停刷新，稍后重试。", 429);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new AppError("EXCHANGE_RESPONSE", "交易所返回了无法解析的响应。", 502);
    }
    if (!response.ok) {
      const code = (data as { code?: number })?.code;
      const messages: Record<number, string> = {
        [-2015]: "API Key、读取权限或 IP 白名单不匹配。",
        [-2014]: "API Key 格式不正确。",
        [-1022]: "API 签名无效，请检查 Secret 与 API Key 是否配对。",
        [-1021]: "交易所时间校验失败，请重试。",
        [-1121]: "监控交易对不可用，请联系管理员。",
      };
      throw new AppError(
        "EXCHANGE_ERROR",
        (code && messages[code]) || "交易所暂时无法处理查询。",
        502,
      );
    }
    return data;
  }
  async syncTime() {
    const start = Date.now();
    const data = z.object({ serverTime: z.number() }).parse(await this.request("/api/v3/time"));
    this.offset = data.serverTime - Math.round((start + Date.now()) / 2);
  }
  async trades(symbol: string, fromId?: string, limit = 100): Promise<Trade[]> {
    const rows = tradeSchema.parse(
      await this.request(
        "/api/v3/myTrades",
        { symbol, limit: String(limit), ...(fromId ? { fromId } : {}) },
        true,
      ),
    );
    return rows.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.isBuyer ? "BUY" : "SELL",
      price: t.price,
      quantity: t.qty,
      quoteQuantity: t.quoteQty,
      fee: t.commission,
      feeAsset: t.commissionAsset,
      time: t.time,
      isMaker: t.isMaker,
    }));
  }
  async loadBalances() {
    await this.syncTime();
    const account = z
      .object({
        balances: z.array(z.object({ asset: z.string(), free: decimal, locked: decimal })),
      })
      .parse(await this.request("/api/v3/account", { omitZeroBalances: "true" }, true));
    const tickers = z
      .array(
        z.object({
          symbol: z.string(),
          lastPrice: decimal,
          priceChangePercent: z.string().regex(/^-?\d+(\.\d+)?$/),
        }),
      )
      .parse(await this.request("/api/v3/ticker/24hr"));
    return { balances: account.balances, tickers };
  }
  async load(symbols: string[] = [], previous?: TradeLedger): Promise<ProviderData> {
    const { balances, tickers } = await this.loadBalances();
    const warnings: string[] = [];
    let orders: ProviderData["orders"] = [];
    let ordersComplete = true;
    let tradesComplete = true;
    try {
      orders = z
        .array(
          z.object({
            orderId: id,
            symbol: z.string(),
            side: z.enum(["BUY", "SELL"]),
            type: z.string(),
            price: decimal,
            origQty: decimal,
            executedQty: decimal,
            status: z.string(),
            time: z.number(),
          }),
        )
        .parse(await this.request("/api/v3/openOrders", {}, true))
        .map((o) => ({
          id: o.orderId,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          price: o.price,
          quantity: o.origQty,
          executedQuantity: o.executedQty,
          status: o.status,
          time: o.time,
        }));
    } catch (e) {
      ordersComplete = false;
      warnings.push(`挂单读取失败：${e instanceof AppError ? e.message : "返回数据格式异常"}`);
    }
    const ledger: TradeLedger = structuredClone(previous ?? { version: 1, markets: {} });
    let catalogComplete = true;
    try {
      const info = z
        .object({
          symbols: z.array(
            z.object({
              symbol: z.string(),
              baseAsset: z.string(),
              quoteAsset: z.string(),
              isSpotTradingAllowed: z.boolean().optional(),
            }),
          ),
        })
        .parse(await this.request("/api/v3/exchangeInfo"));
      if (!info.symbols.length) throw new Error("empty market catalog");
      for (const market of info.symbols) {
        if (market.isSpotTradingAllowed === false) continue;
        ledger.markets[market.symbol] ??= {
          baseAsset: market.baseAsset,
          quoteAsset: market.quoteAsset,
          nextId: "0",
          complete: false,
          checkedAt: 0,
          trades: [],
        };
      }
    } catch {
      catalogComplete = false;
      warnings.push("交易对目录暂未读取成功，历史发现和盈亏计算暂停；余额仍可查看。");
    }
    // Legacy configured pairs are optional discovery hints, never a holdings filter.
    for (const symbol of symbols)
      if (!ledger.markets[symbol] && symbol.endsWith("USDT")) {
        ledger.markets[symbol] = {
          baseAsset: symbol.slice(0, -4),
          quoteAsset: "USDT",
          nextId: "0",
          complete: false,
          checkedAt: 0,
          trades: [],
        };
      }
    const held = new Set(
      balances.filter((b) => Number(b.free) + Number(b.locked) > 0).map((b) => b.asset),
    );
    const open = new Set(orders.map((o) => o.symbol));
    const entries = Object.entries(ledger.markets);
    const important = ([symbol, m]: (typeof entries)[number]) =>
      held.has(m.baseAsset) || open.has(symbol) || m.trades.length > 0;
    // Reserve most of each batch for discovery/rotation so active pairs cannot starve closed positions.
    const priority = entries
      .filter((e) => important(e) && Date.now() - e[1].checkedAt >= 30000)
      .sort(
        (a, b) => Number(a[1].complete) - Number(b[1].complete) || a[1].checkedAt - b[1].checkedAt,
      )
      .slice(0, 8);
    const chosen = new Set(priority.map(([s]) => s));
    const remaining = entries
      .filter(([s]) => !chosen.has(s))
      .sort(
        (a, b) => Number(a[1].complete) - Number(b[1].complete) || a[1].checkedAt - b[1].checkedAt,
      );
    const queue = [...priority, ...remaining].slice(0, 24);
    let failed = false;
    for (const [symbol, market] of queue) {
      if (Date.now() >= this.deadline - 2000) break;
      try {
        const rows = await this.trades(symbol, market.nextId, 1000);
        // Repeat reads and retries are idempotent even if an upstream page overlaps.
        const unique = new Map(market.trades.map((t) => [t.id, t]));
        for (const row of rows) unique.set(row.id, row);
        market.trades = [...unique.values()];
        if (rows.length) {
          const last = rows.reduce(
            (max, t) => (BigInt(t.id) > max ? BigInt(t.id) : max),
            BigInt(market.nextId) - 1n,
          );
          market.nextId = (last + 1n).toString();
        }
        market.complete = rows.length < 1000;
        market.checkedAt = Date.now();
      } catch (e) {
        failed = true;
        market.complete = false;
        // Rotate failed symbols behind other work; retry on subsequent refreshes.
        market.checkedAt = Date.now();
        warnings.push(
          `${symbol} 成交读取失败：${e instanceof AppError ? e.message : "返回数据格式异常"}`,
        );
        if (e instanceof AppError && e.code === "EXCHANGE_RATE_LIMIT") break;
      }
    }
    const markets = Object.values(ledger.markets);
    const scanned = markets.filter((m) => m.complete).length;
    tradesComplete = catalogComplete && !failed && markets.length > 0 && scanned === markets.length;
    if (!tradesComplete)
      warnings.push(
        `历史自动同步中：${scanned}/${markets.length} 个交易对已完成首次回溯。保持页面打开会继续同步，包括已清仓交易对。`,
      );
    warnings.push(
      "成本与盈亏按 API 可获得的现货成交估算；未包含已下架且目录不可发现的交易对、闪兑和转账的外部成本。不同交易对分批更新，非交易所官方盈亏。跨币交易、第三币手续费或余额无法对账时显示待核对。",
    );
    const checked = markets.filter((m) => m.complete).map((m) => m.checkedAt);
    return {
      balances,
      tickers,
      trades: markets.flatMap((m) => m.trades).sort((a, b) => b.time - a.time),
      orders,
      warnings,
      tradesComplete,
      ordersComplete,
      ledger,
      historySync: {
        scanned,
        total: markets.length,
        oldestCheck: checked.length ? Math.min(...checked) : null,
      },
    };
  }
}
