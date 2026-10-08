import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config";
import { AppError } from "./errors";
import type { ProviderData, Trade } from "./types";
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
  private deadline = Date.now() + 40000;
  constructor(
    private config: Pick<Config, "BINANCE_ENV" | "BINANCE_API_KEY" | "BINANCE_API_SECRET">,
    private transport: typeof fetch = fetch,
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
        [-1121]: "交易对无效，请检查 TRACKED_SYMBOLS。",
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
  async load(symbols: string[]): Promise<ProviderData> {
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
    const trades: Trade[] = [];
    // Two requests at a time keep large watchlists from bursting upstream limits.
    for (let i = 0; i < symbols.length; i += 2) {
      if (Date.now() >= this.deadline) {
        tradesComplete = false;
        warnings.push(`本次查询超时，尚未同步：${symbols.slice(i).join(", ")}。`);
        break;
      }
      const batch = await Promise.allSettled(symbols.slice(i, i + 2).map((s) => this.trades(s)));
      batch.forEach((result, j) => {
        if (result.status === "fulfilled") trades.push(...result.value);
        else {
          tradesComplete = false;
          warnings.push(
            `${symbols[i + j]} 成交读取失败：${result.reason instanceof AppError ? result.reason.message : "返回数据格式异常"}`,
          );
        }
      });
    }
    warnings.push(
      `成交列表仅包含所配置 ${symbols.length} 个交易对各自最近 100 笔；不代表全账户历史。`,
    );
    return {
      balances: account.balances,
      tickers,
      trades: trades.sort((a, b) => b.time - a.time),
      orders,
      warnings,
      tradesComplete,
      ordersComplete,
    };
  }
}
