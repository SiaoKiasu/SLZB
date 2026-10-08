# SLZB 多用户只读 API

Base URL 为本地 `http://localhost:3000` 或部署域名。所有账户接口必须使用用户会话 Cookie，金额为十进制字符串，时间戳为毫秒，响应 `Cache-Control: private, no-store`。

## 登录与持久会话

`POST /api/session` 接收 `{ "username": "xiaowang", "password": "..." }`，必须携带与服务地址相同的 `Origin`。响应设置一年有效期的 `slzb_session` HttpOnly / SameSite=Strict Cookie，生产环境带 Secure。

所有成功认证的账户请求在 Cookie 已使用一天后自动续期。会话绑定用户名、密码哈希、分配的账户 ID 和 sessionVersion；用户被移除、停用，账户被停用，密码、绑定、版本或签名密钥改变后，旧 Cookie 失效。退出接口清除当前浏览器 Cookie；管理员撤销登录可以使此前签发的 Cookie 在所有设备失效。

**每次请求只访问服务端绑定的账户。没有客户端 accountId 切换功能，也没有全局 MONITOR_API_TOKEN。** 添加 `accountId`、自定义 Header 或别人的交易对不能扩大访问权限。默认 Demo 也需要用户名及密码登录。

## 接口

| 方法   | 路径                                             | 作用                                           |
| ------ | ------------------------------------------------ | ---------------------------------------------- |
| GET    | `/api/health`                                    | 公共存活探针，不检查交易所                     |
| GET    | `/api/session`                                   | 当前用户名、显示名称、账户名称；未登录返回 401 |
| POST   | `/api/session`                                   | 用户名 + 密码登录                              |
| DELETE | `/api/session`                                   | 退出当前浏览器                                 |
| GET    | `/api/dashboard`                                 | 当前用户绑定账户的聚合视图                     |
| GET    | `/api/holdings`                                  | 当前账户持仓                                   |
| GET    | `/api/pnl`                                       | 当前账户估值及配置口径盈亏                     |
| GET    | `/api/trades`                                    | 监控交易对各最近 100 笔成交                    |
| GET    | `/api/trades?symbol=BTCUSDT&fromId=0&limit=1000` | 当前账户单交易对向后分页                       |
| GET    | `/api/orders`                                    | 当前账户全 Spot 钱包当前挂单                   |
| GET    | `/api/history`                                   | 当前账户近 90 天每小时末净值点                 |
| GET    | `/api/connection`                                | 当前账户来源及覆盖状态，不含密钥或其他用户     |
| POST   | `/api/sync`                                      | 当前账户同步并尝试保存快照                     |
| GET    | `/api/cron`                                      | 管理员 Cron Bearer 鉴权，采集所有启用真实账户  |

除健康检查、登录和独立 Cron 外，全部接口都验证用户 Cookie。POST/DELETE 必须携带同源 Origin；没有可通过网页更改用户、密码、绑定或 API 密钥的接口。

聚合 `/api/dashboard` 和 `/api/sync` 直接返回 Dashboard。其他账户数据端点通常返回 `{ data, updatedAt, warnings }`。会话成功返回 `{ authenticated: true, demo, user: { username, displayName }, accountLabel }`。只有未配置自建用户的内置 Demo 才返回 `demo: true` 以显示演示登录提示。

## 成交分页与完整性

`symbol` 必须在该用户所属账户的监控列表。`limit` 为 1–1000，`fromId` 为非负整数 ID；传 limit/fromId 时必须同时传 symbol。

从 `fromId=0` 开始；收到 `nextFromId` 后传入下一次请求，直到 null。不传 fromId 时是交易所最近成交；之后的 nextFromId 只能读取更新的成交，不能用于倒序翻旧记录。

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

`connection.tradesComplete` 只表示本轮配置交易对查询都成功，不代表全历史完整。`ordersComplete=false` 时空列表不是“没有挂单”。历史接口不返回其他账户历史；存储 scope 不接受来自浏览器的参数。

金额 null 表示未知。未知行情资产不计入小计，暂停累计盈亏及净值快照。浮盈亏仅汇总有成本的资产；累计盈亏需要管理员维护起始净值、时间及期间净入金。

## Cron

需 `Authorization: Bearer <CRON_SECRET>`；用户 Cookie 无法调用。可用 `?accountId=friend-a` 单独采集一个账户（仅限管理员密钥）。余额/行情读取两路并发，使用共同 45 秒预算，不下载成交。响应包含 `{ ok, results: [{ accountId, saved }] }`；任一账户失败返回 503。无可采集账户返回 404。

## 错误与缓存

格式为 `{ "error": { "code": "UNAUTHORIZED", "message": "请登录你的查看账号。" } }`。

400 参数无效，401 未登录或账号密码错误，403 来源校验失败，404 资源不存在，429 请求限流，502 交易所异常，503 服务配置或采集失败。密码错误、用户不存在、停用时都返回相同登录错误，避免泄露用户存在性。

同一账户的聚合查询在同一实例合并并缓存 30 秒，不同账户独立。服务器每次都先验证会话及最新账户绑定，再访问缓存。实例间没有共享缓存，账户之间绝不共享客户端数据。单交易对分页不缓存。没有认证信息、配置文件内容、密码哈希或交易所密钥的读写接口。
