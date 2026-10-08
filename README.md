# SLZB · 账户观察室

一个可以部署到 Vercel 的现货账户监控 Portal。第一版支持 **单个 Binance 现货账户**，面向账户所有者及受邀朋友，只读查看资产、盈亏、成交和挂单。

**不填交易所密钥也能运行完整演示。** 切换到真实模式后使用服务端环境变量中的只读 API，浏览器不会接收 Key / Secret。本项目没有下单、撤单、转账或提现接口。

## 已实现

- 中文响应式 Portal：账户总览、资产持仓、交易记录、连接与设置。
- 现货资产估值、可用/冻结余额、资产分布、行情 24h 涨跌幅。
- 根据配置的剩余持仓成本计算浮盈亏，根据起始净值及净入金计算累计盈亏。
- 最新成交、买卖/交易对筛选、分页、CSV 导出、当前挂单。
- 页面可见时每 60 秒同步；手动刷新；错误状态与上次成功同步时间。
- 可选 Neon Postgres：保存净值快照并绘制 24h / 7d / 30d / 90d 曲线。
- 密码登录、12 小时签名 HttpOnly Cookie、同源写请求校验、独立 API Bearer Token。
- Vercel 部署配置、每日后台快照 Cron、JSON API、OpenAPI 文档、自动测试及 GitHub Actions。

## 1. 本地运行（演示模式）

需要 **Node.js 24.x**。

```bash
git clone https://github.com/SiaoKiasu/SLZB.git
cd SLZB
npm ci
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。默认 `DATA_SOURCE=demo`，没有密码时可直接体验。演示中的市场价格、资产、成交、净值和本金都是模拟值，不是实时行情。

## 2. 接入真实 API

在 Binance 创建 **HMAC 类型只读 API**，仅保留读取权限。将以下变量写入本地 `.env.local` 或 Vercel 的 Environment Variables：

```dotenv
DATA_SOURCE=binance
ACCOUNT_LABEL=朋友的现货账户
ACCOUNT_ID=friend-main
BINANCE_ENV=mainnet
BINANCE_API_KEY=你的API_Key
BINANCE_API_SECRET=你的API_Secret
TRACKED_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT
PORTAL_PASSWORD=替换为至少12位的随机访问密码
SESSION_SECRET=替换为至少32位的随机会话密钥
```

生成随机值：`openssl rand -hex 32`。密码、Session Secret、API Token、Cron Secret 应各自使用不同的值。不要把真实密钥提交进 Git，也不要放入 `NEXT_PUBLIC_` 变量。

修改变量后，本地需要重启 `npm run dev`；Vercel 需要 **Redeploy**。朋友只需拿到 Portal 地址和访问密码。

使用现货 Testnet 时设置 `BINANCE_ENV=testnet` 并填写 Testnet 对应密钥，不能混用主网密钥。Testnet 资产是测试资产，也可能定期重置。

### 交易对与查询范围

Binance `myTrades` 必须指定 symbol，不能从余额接口列出所有曾经交易过的币种。`TRACKED_SYMBOLS` 支持最多 20 个交易对，应加入已清仓交易对。持仓估值始终读取整个现货余额，不受该列表限制。

Portal 每次加载各交易对最近 100 笔成交，**不是全历史账本**。成交手续费保留原币种，没有用当前汇率转换历史费用。`GET /api/trades?symbol=BTCUSDT&fromId=0&limit=1000` 支持从最早可用 ID 向后分页，详见 [API 文档](docs/API.md)。当前挂单查询整个现货账户；已取消/已完成订单的完整订单历史不在本版范围。

## 3. 盈亏如何配置

### 账户累计盈亏

```text
累计盈亏 = 当前现货资产估值 − 起始净值 − 起始时间以来的净入金
净入金 = 入金 − 出金（包含现货账户与其他钱包之间的划转）
```

例如统计起点现货资产为 100,000 USDT，之后净转入 20,000 USDT，当前为 125,000 USDT，则累计盈亏为 5,000 USDT。

```dotenv
PERFORMANCE_BASELINE_USDT=100000
PERFORMANCE_BASELINE_AT=2026-01-01T00:00:00Z
PERFORMANCE_NET_FLOWS_USDT=20000
```

三个字段必须一起配置；没有净入金时明确填写 `0`。净入金需手工维护；非 USDT 转入转出需按发生时的 USDT 价值记账。起始时间是统计口径标签，程序不会自动从该时间回溯资金流水。提现手续费等会自然体现在账户净值变化中，避免重复扣减。

本版没有自动充值、提现、内部划转账本，也没有 TWR、IRR 或自动已实现盈亏。资金流或成本没有维护时，相关盈亏不能代表真实投资表现。缺少配置显示“待配置”，不把未知数当作零。

### 持仓浮盈亏

`COST_BASIS_JSON` 填写**当前剩余持仓**的平均单位成本，按 USDT 计价并含历史买入费用：

```dotenv
COST_BASIS_JSON={"BTC":"58000","ETH":"2300","SOL":"120"}
```

浮盈亏 =（当前价格 − 配置成本）×（可用数量 + 冻结数量）。发生交易、转入转出后需更新成本。卡片仅汇总已配置成本的资产，显示覆盖数量；未配置资产不参与。这里不会把最近 100 笔成交误当作完整历史计算成本。

### 估值口径

- 使用 Decimal 计算金额，JSON 中金额以字符串返回。
- 优先使用资产/USDT 行情，没有直连行情时尝试 BTC、ETH、USDC 交叉报价。
- 除计价单位 USDT 外，稳定币也用市场价格估值，不强行假定等于 1 USDT。
- 无法估值的资产仍保留在列表，标记为未估值；资产总额变成“已估值资产小计”，暂停累计盈亏与净值快照写入。
- 24h 涨跌幅是**行情**变动；净值曲线包含充值提现，**不是收益率曲线**。
- 只涵盖 Spot 钱包，不含理财、质押、资金账户、保证金或合约账户。

## 4. 部署到 Vercel

1. 在 Vercel 选择 **Add New → Project**，导入 `SiaoKiasu/SLZB`。
2. Framework Preset 选 Next.js，Root Directory 保持仓库根目录，Node.js 选 24.x。构建命令默认 `npm run build`。
3. 首次可仅填 `DATA_SOURCE=demo` 部署。确认页面正常后，再填真实模式所需变量并 Redeploy。
4. 默认函数区域 `fra1`（Frankfurt），在 `vercel.json` 中配置。实际可访问性取决于账户适用地区、交易所政策和网络出口，部署后使用“测试连接并刷新”验证。
5. 如果 Binance API 限制了源 IP，Vercel 默认动态出口可能不匹配。需要固定出口方案（Vercel 对应网络功能或自己托管固定出口的后端），不能把 IP 白名单错误当成密钥错误。
6. 后续推送代码到生产分支，Vercel 自动重新构建部署；在 Vercel 修改环境变量则需要手动 Redeploy。

未提供或配置错误的 API、密码不会自动回退到 Demo，页面会明确报错。真实模式没有访问密码时，账户接口拒绝提供数据。

## 5. 历史净值与后台采集（可选）

在 Vercel Marketplace 连接 Neon Postgres，将连接字符串设为 `DATABASE_URL`。数据库角色需有建表权限；第一次读取/保存时自动创建 `slzb_snapshots`（建表 SQL 见 [schema.sql](docs/schema.sql)）。也可提前用迁移角色建表，再给应用角色必要读写权限。

页面每次同步都会尝试写入快照，同一 5 分钟桶只保留最新值；记录不会混合不同 API Key、账户 ID 或主网/Testnet。更换 API Key 会开启新的历史命名空间。图表读取近 90 天每小时最后一个快照，原始快照保留在数据库，不自动删除。

配置至少 32 位 `CRON_SECRET` 后，`vercel.json` 中的任务每天 UTC 00:00 触发（北京时间约 08:00），关闭浏览器也能记录。Vercel Hobby 的日任务可能在该小时内任意时点执行。想要每 5 分钟采集，可以在相应套餐下将表达式改为 `*/5 * * * *`，或用外部调度器带 Cron Bearer Token 请求 `/api/cron`。

**页面自动刷新与后台定时采集是两套机制。** 免费默认配置在页面关闭后只有每日一个快照，不能声称是全天分钟级记录。数据库故障不影响实时数据显示，但会提示历史不可用；定时任务保存失败会返回非 2xx 状态。

## 接口与开发

详见 [API.md](docs/API.md)、[openapi.json](docs/openapi.json)、[架构说明](docs/ARCHITECTURE.md)。

```bash
npm test           # 金额、登录、签名、错误处理和路由测试
npm run typecheck  # TypeScript 检查
npm run build      # 生产构建
npm run check      # 执行上述全部检查
npm start          # 运行已构建的生产服务
```

登录有单进程尝试次数限制，serverless 多实例不共享该计数。公开部署可在 Vercel Firewall 为 `/api/session` 补充全局速率限制。所有认证、交易所签名、环境变量读取和数据库代码都标记为 `server-only`。本版采用一个共享访问密码，不包含多用户角色、账户自助管理或密码找回。

官方参考：[Binance Spot API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints)、[Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)、[Vercel Cron 限制](https://vercel.com/docs/cron-jobs/usage-and-pricing)、[Vercel Cron 鉴权](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。
