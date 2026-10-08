# SLZB JSON API

Base URL：部署域名或 `http://localhost:3000`。响应设置 `Cache-Control: private, no-store`，不允许跨域浏览器读写。所有金额使用十进制字符串，时间戳单位为毫秒。

## 认证

Portal 通过 `POST /api/session` 登录，服务端设置 `slzb_session` HttpOnly、SameSite=Strict Cookie；生产模式 Secure，12 小时过期。Session Secret 或访问密码轮换会使旧 Cookie 失效。

外部脚本推荐设置至少 32 位 `MONITOR_API_TOKEN`，通过 `Authorization: Bearer <token>` 访问。不要把该 Token 填入前端或浏览器持久存储。未设置密码的演示模式公开读取。

```bash
curl "$SLZB_URL/api/holdings" \
  -H "Authorization: Bearer $SLZB_API_TOKEN"

curl -X POST "$SLZB_URL/api/sync" \
  -H "Authorization: Bearer $SLZB_API_TOKEN"
```

`SLZB_URL` 和 `SLZB_API_TOKEN` 是调用方自行设置的 shell 变量。浏览器 Cookie 请求的 POST/DELETE 必须带相同 origin；已验证的 API Bearer 请求豁免 Origin 检查。

## 接口清单

| 方法   | 路径                                             | 说明                                          |
| ------ | ------------------------------------------------ | --------------------------------------------- |
| GET    | `/api/health`                                    | 公共服务存活检查，不探测交易所及数据库        |
| GET    | `/api/session`                                   | 验证当前登录状态                              |
| POST   | `/api/session`                                   | `{ "password": "..." }` 登录，同源请求        |
| DELETE | `/api/session`                                   | 退出登录，同源请求                            |
| GET    | `/api/dashboard`                                 | 聚合资产、摘要、成交、挂单、历史、连接状态    |
| GET    | `/api/holdings`                                  | 持仓列表：可用/冻结、估值、成本、浮盈亏、权重 |
| GET    | `/api/pnl`                                       | 资产与盈亏摘要、数据口径提示                  |
| GET    | `/api/trades`                                    | 配置交易对各最近 100 笔成交，按时间倒序       |
| GET    | `/api/trades?symbol=BTCUSDT&fromId=0&limit=1000` | 单交易对按交易 ID 向后分页                    |
| GET    | `/api/orders`                                    | 全现货账户当前挂单                            |
| GET    | `/api/history`                                   | 近 90 天每小时最后一个已保存净值点            |
| GET    | `/api/connection`                                | 数据源、环境、交易对和同步状态，不返回密钥    |
| POST   | `/api/sync`                                      | 同步并尝试保存净值快照；返回完整 Dashboard    |
| GET    | `/api/cron`                                      | 仅接受 `CRON_SECRET` Bearer，写后台快照       |

`/api/health` 为存活探针，`/api/connection` 才会访问真实账户。聚合类 GET 不保存净值；`/api/sync` 才保存。交易所查询在同一服务实例内合并并缓存 30 秒，手动刷新也遵守缓存，响应的 `updatedAt` 为真实数据获取时间。多实例之间没有共享缓存。分页成交请求不使用聚合缓存。

## 成交分页

`symbol` 必须存在于 `TRACKED_SYMBOLS`，`limit` 为 1–1000 的整数（默认 100），`fromId` 为非负整数 ID。

从 `fromId=0` 开始；收到 `nextFromId` 后把它传入下一次请求，直到返回 `null`。如果不传 `fromId`，Binance 默认返回最近成交，此时 nextFromId 仅能用于读取之后的新成交，不是向更早历史翻页。仅传 fromId 或 limit 而不传 symbol 返回 400。

```json
{
  "data": [
    {
      "id": "12345",
      "symbol": "BTCUSDT",
      "side": "BUY",
      "price": "60000",
      "quantity": "0.1",
      "quoteQuantity": "6000",
      "fee": "0.00015",
      "feeAsset": "BNB",
      "time": 1767225600000,
      "isMaker": true
    }
  ],
  "nextFromId": null,
  "coverage": "未传 fromId 时返回最近成交；fromId=0 可从最早可用成交向后分页。"
}
```

接口保留手续费原币种，成交额使用交易对的报价币（例如 ETHBTC 的成交额是 BTC）。不跨币种直接求和。单交易对分页接口不自动将成交写入数据库。

## 返回结构与空值

聚合 `/api/dashboard`、`/api/sync` 直接返回 Dashboard。其他数据端点返回 `{ data, updatedAt, warnings }`；单交易对成交使用上面的分页结构。

`holdings[].price/value/averageCost/unrealizedPnl` 和 `summary.totalPnl` 可能为 `null`，表示缺数据，**不是零**。`summary.unrealizedPnl` 只汇总已配置成本的持仓，`costCoverage` 为覆盖币种数量。`summary.tradeCount` 是本次返回的成交数，并非日交易数或全历史成交数。

`connection.tradesComplete` 表示本次所有配置交易对查询是否成功，**不代表历史数据完整**。`connection.ordersComplete=false` 时，空挂单数组不代表账户没有挂单。`connection.database` 仅表示已配置连接串；`snapshotsSaved` 只表示本次 sync 是否实际写入成功，GET 查询通常为 false。

## 错误

```json
{ "error": { "code": "UNAUTHORIZED", "message": "请先登录账户监控。" } }
```

- `400`：输入/分页参数无效。
- `401`：未登录、密码错误或 Cron 未授权。
- `403`：请求来源不合法。
- `404`：数据资源不存在。
- `429`：登录限流或交易所限流。
- `502`：交易所请求失败、网络错误或区域拒绝。
- `503`：必需配置缺失、Cron 无数据库或快照写入失败。
- `500`：服务内部异常（不透出原始异常/密钥/连接串）。

部分交易对或挂单读取失败时，资产仍可显示，HTTP 200 加 `warnings` 和完整性标记。账户余额或市场报价请求失败时返回错误，不会悄悄替换为演示数据。
