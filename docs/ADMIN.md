# 管理员配置指南

所有配置由你完成，朋友无需接触交易所 API、Vercel 或配置文件。管理入口是项目目录中的 `npm run setup`，不通过公开网页提供管理权限。

## 最快开通一个朋友

```bash
npm ci
npm run setup
```

### 第一步：新增交易所账户

选择菜单 **1. 新增交易所账户 / API**。

- 内部 ID：例如 `friend-a`，不要把此 ID 复用于另一个不相关的账户。
- 显示名称：例如 `小王的现货账户`。
- 数据来源：Binance 现货。也可以先选模拟数据，只测试登录与页面。
- 环境：主网或 Spot Testnet，API 密钥必须与环境对应。
- API Key / Secret：输入你保管的 HMAC 只读密钥，输入时隐藏显示，不要开启交易/提现权限。
- 账户本金：初始投入的 USDT 金额，纯数字即可；可留空。不是持仓成本，也不会直接替代盈亏。

持仓、交易对和成本回溯自动处理，不再询问交易对或 JSON。首次同步分批执行，保持页面打开即可继续。旧向导如果停在成本 JSON 问题，按 Ctrl+C 退出，更新代码后重新运行。

### 第二步：新增查看用户

选择菜单 **3. 新增查看用户并绑定账户**。

- 用户名：例如 `xiaowang`，不区分英文大小写，支持 3–64 位英文字母、数字、点、短横线或下划线。
- 显示名称：例如 `小王`。
- 绑定账户：选择刚才的 `friend-a`。
- 密码：设置至少 8 位密码并再次确认。只保存带随机盐的 scrypt 哈希，不保存明文密码。

每个用户只有一个绑定账户。多个用户可以绑定同一个账户；不同账户之间的余额、成交、缓存及净值历史分开处理。

### 第三步：打开本地服务

首次配置后重启本地开发服务：

```bash
npm run dev
```

在 [http://localhost:3000](http://localhost:3000) 用 `xiaowang` 和你设的密码登录。本机的 localhost 地址只能在本机使用；朋友远程访问时应使用 Vercel 的 HTTPS 部署地址。

## 日常维护

继续执行 `npm run setup`：

| 操作                        | 效果                                           |
| --------------------------- | ---------------------------------------------- |
| 修改交易所账户 / API / 本金 | 更新密钥、名称或账户本金                       |
| 修改用户密码                | 旧密码与旧登录失效                             |
| 更改用户绑定的账户          | 旧登录失效，重新登录后只看到新分配的账户       |
| 停用 / 启用查看用户         | 停用后下次请求被拒绝；重新启用不会恢复此前登录 |
| 撤销某个用户的全部登录      | 增加会话版本，所有设备需重新输入密码           |
| 新增查看用户                | 不影响其他用户的登录                           |

本地文件变更在下一次请求重新读取。Vercel 使用环境变量，**必须重新导出并 Redeploy 后才生效**。浏览器页面的下一次自动刷新通常不超过 60 秒；服务端已生效的权限变更立即约束新请求。

## Vercel 配置步骤

```bash
npm run config:check
npm run config:export
```

导出的文件：

- `.slzb/vercel-config.json`：账户 API 与用户映射；完整复制到 Vercel `PORTAL_CONFIG_JSON`。
- `.slzb/session-secret.txt`：完整复制到 Vercel `SESSION_SECRET`。

这些是管理员私密文件，Git 已忽略。不要发给朋友或提交 Git。Vercel 上不需要上传 `.slzb` 目录，也不要设置 `PORTAL_CONFIG_FILE`。

保持 Session Secret 稳定可以保留其他用户登录；主动轮换它会使所有用户退出。新增或修改用户后，只更新 `PORTAL_CONFIG_JSON` 并 Redeploy 即可。

## 配置文件结构

配置工具写入 `.slzb/accounts.json`。熟悉 JSON 后也可直接编辑；密码哈希建议通过工具生成。

```json
{
  "accounts": [
    {
      "id": "friend-a",
      "label": "小王的现货账户",
      "source": "binance",
      "environment": "mainnet",
      "enabled": true,
      "apiKey": "你的只读API_Key",
      "apiSecret": "对应的API_Secret",
      "principal": "100000"
    }
  ],
  "users": [
    {
      "username": "xiaowang",
      "displayName": "小王",
      "passwordHash": "由配置工具生成的scrypt哈希",
      "accountId": "friend-a",
      "enabled": true,
      "sessionVersion": 1
    }
  ]
}
```

这段是字段说明，哈希占位符不能直接运行。`principal` 可省略；历史 `symbols` 仅作为额外发现提示，旧 `costs` 不再生效。配置最多 20 个账户、100 个用户，服务端会拒绝重复用户名、重复账户 ID、无效绑定或缺密钥的真实账户。显示名称和密码不能使用空值。

读取优先级：`PORTAL_CONFIG_JSON` → `PORTAL_CONFIG_FILE` 指向文件 → 默认 `.slzb/accounts.json`。只有完全未配置且没有遗留真实账户设置时，才提供内置 Demo；损坏的显式配置会报错，不会回退到演示。配置工具本地保存时会清空 `.env.local` 中的 JSON 变量以使用文件；如果 shell 另行设置了 JSON 变量，启动服务前先取消它。

## 本金与自动盈亏

`principal` 为管理员登记的初始投入金额，仅用于展示。留空显示“尚未设置”，不会用首次读取的净值冒充本金。原 `performance.baseline` 是某个统计起点净值，不能保证是真正本金，所以不自动迁移为本金。

持仓成本由历史成交移动加权重建。USDT 及成交基础币手续费可计入；第三币手续费（如 BNB 抵扣）、非 USDT 计价成交、转账引起的数量差异目前显示待核对。已实现盈亏和未实现盈亏不是交易所官方 PnL，具体范围见 README 的盈亏口径。

本地进度存于 `.slzb/ledgers/`（权限 600，目录 700，Git/Vercel 均忽略）。云端应设置 Neon `DATABASE_URL` 保存跨实例进度；无数据库时实例冷启动会重新同步。首次扫描最多每轮 24 个请求，每页 1,000 笔，可能需要数十分钟以上；保持页面可见，每分钟继续。仅浏览网页不需要额外配置币种。

## 历史净值与后台采集

可选设置 Neon `DATABASE_URL`，第一次使用自动建表；也可预先执行 `docs/schema.sql`。每次页面同步按五分钟桶保存快照，图表读取近 90 天每小时末点。数据库访问使用账户 ID、主网/Testnet、API Key 指纹隔离。

更换 Key 会创建新的历史命名空间，原记录保留，不自动混合；若只是同一交易所账户轮换 Key 且需保留连续曲线，应由管理员核对后迁移命名空间。

为关闭页面后的采集设置 `CRON_SECRET`（`openssl rand -hex 32` 生成）。默认每日 UTC 00:00 调用 `/api/cron`，为所有启用的真实账户采集估值。任务只获取余额和行情，不获取成交。某个账户失败不会覆盖或冒充其他账户成功，返回 503 及逐账户状态；可带 `?accountId=friend-a` 单独重试。

页面每 60 秒刷新与后台 Cron 相互独立。Vercel Hobby 默认只允许每日一次定时任务；更频繁后台采集需要相应套餐或外部调度器。多账户 Cron 有 45 秒查询总预算，慢请求或过多账户可能需要分账户调度。

## 从旧单账户版本迁移

1. 保留原只读 API 和已知本金，运行 `npm run setup` 新增账户与查看用户。
2. 在向导中登记本金，历史成本由程序重新同步；无需搬运旧成本 JSON。
3. 导出新的 `PORTAL_CONFIG_JSON` 和 `SESSION_SECRET` 到 Vercel。
4. 删除旧 `DATA_SOURCE`、`BINANCE_API_KEY`、`BINANCE_API_SECRET`、`PORTAL_PASSWORD`、`MONITOR_API_TOKEN` 等单账户变量，并 Redeploy。
5. 旧共享密码 Cookie 不再有效；朋友第一次改用你新建的用户名和密码登录。

无需重新创建交易所 API。Vercel 的动态出口可能与交易所 IP 白名单冲突；按账户允许地区选择部署位置并使用固定出口方案。只读 API 的认证失败信息会返回给已登录用户，未登录者不会得到账户配置详情。
