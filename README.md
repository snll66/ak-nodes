# ak-nodes —— VPN Gate SSTP 节点自动清单（AK 用）

每 **12 小时**自动：抓取 [VPN Gate](https://www.vpngate.net/) 的 SSTP 节点 → 用自建 CF 检测 Worker 逐个验活 → 生成 **AK 客户端**（VLESS 链接）清单，发布到 GitHub Pages。

## 产物（固定网址）

| 文件 | 说明 |
|---|---|
| `ak.txt` | **全部可用节点**（每行一条 `vless://` 链接，直接导入客户端，如 v2rayNG） |
| `ak-<国家码>.txt` | 按国家拆分（如 `ak-KR.txt`、`ak-JP.txt`） |
| `stats.json` | 统计信息（可用数、国家分布、生成时间） |
| `index.html` | 简单索引页 |

网址：`https://snll66.github.io/ak-nodes/ak.txt`

## 结构

```
update.mjs                       抓取 + 检测 + 生成（Node，零依赖）
.github/workflows/update.yml     每 12 小时跑一次（也支持手动触发）
check-worker/                    检测 Worker 源码（部署在 Cloudflare）
data/                            最近一次生成的清单（工作流回写，保持仓库活跃）
```

## 怎么换配置（不用改代码）

进仓库 **Settings → Secrets and variables → Actions → Variables** 标签页，点 **New repository variable** 添加（或点已有的编辑）：

| 变量名 | 干什么的 | 默认值（不设置时） |
|---|---|---|
| `AK_HOST` | 节点域名（AK Worker 的域名，链接里指向它） | `txs.mavita.kdns.fr` |
| `AK_UUID` | AK Worker 的 UUID（要与 AK.js 里的一致） | `2523c510-9ff0-415b-9582-93949bfae7e3` |
| `CHECK_WORKER` | 检测 Worker 地址（结尾必须带 `/check?sstp=vpn:vpn@`） | `https://ak-check.class-40b.workers.dev/check?sstp=vpn:vpn@` |

改完去 **Actions → Update AK node list → Run workflow** 手动跑一次，新配置立刻生效（不手动跑就等下一个 12 小时自动跑）。

- 更新频率：`.github/workflows/update.yml` 里的 `cron`（当前 `0 */12 * * *`）

## 原理

1. 拉 VPN Gate 官方列表（回退：GitHub 镜像），从每个节点的 OpenVPN 配置里提取 SSTP 端口（`proto tcp` + `remote` 行）；
2. 逐个调用自建检测 Worker（跑在 Cloudflare 上，`/check?sstp=vpn:vpn@host:port`）——只有「从 CF 能连上」的节点才保留；
3. 生成 AK 格式的 VLESS 链接（`/sstp://host:port` 路径 + 出口位置标注），发布到 GitHub Pages。

## 致谢

- [cmliu/CF-Workers-CheckSocks5](https://github.com/cmliu/CF-Workers-CheckSocks5) —— 检测 Worker（GPL-3.0）
- [hezhanleiok/gate](https://github.com/hezhanleiok/gate) —— 流水线设计参考
- [VPN Gate](https://www.vpngate.net/) —— 节点数据源（筑波大学公共 VPN 项目）
