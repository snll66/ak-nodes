# ak-nodes —— VPN Gate SSTP 节点自动清单（AK 用）

每 **12 小时**自动：抓取 [VPN Gate](https://www.vpngate.net/) 的 SSTP 节点 → 用自建 CF 检测 Worker 逐个验活 → 生成 **AK 客户端**（VLESS 链接）清单，发布到 GitHub Pages（客户端从订阅地址拉取）。

## 订阅地址（客户端用这个）

```
https://snll66.github.io/ak-nodes/ak.txt
```

每行一条 `vless://` 链接，直接导入客户端（如 v2rayNG）当**订阅**用，每 12 小时自动更新。

## 产物

| 文件 | 说明 |
|---|---|
| `dist/ak.txt` | **全部可用节点**（每行一条链接）——**这一份就是订阅** |
| `dist/ak-<国家码>.txt` | 按国家拆分（如 `ak-KR.txt`、`ak-JP.txt`） |
| `dist/stats.json` | 统计信息（可用数、国家分布、生成时间；同时回写 `data/`） |

## 结构

```
update.mjs                       抓取 + 检测 + 生成（Node，零依赖）
.github/workflows/update.yml     每 12 小时跑一次（也支持手动触发）
check-worker/                    检测 Worker 源码（部署在 Cloudflare）
sources/                         附加数据源（*.csv，原样粘贴扫描结果即可）
data/                            最近一次生成的清单（工作流回写，保持仓库活跃）
```

## 怎么换配置（改 update.mjs 顶部「配置区」）

在 GitHub 网页上直接编辑 `update.mjs`（点右上角铅笔图标），改引号里的值，提交即可：

| 要换什么 | 改哪一行 | 当前值 |
|---|---|---|
| 节点域名 | `AK_HOST` | `q.4.j.9.0.g.123.kdns.fr` |
| 节点 UUID | `AK_UUID` | `b2b57076-…`（与 AK.js 一致） |
| 检测 Worker | `CHECK_WORKER` | `https://ak-check.class-40b.workers.dev/check?sstp=vpn:vpn@` |
| ECH 参数 | `ECH`（true=开 / false=关） | `true` |
| `?ed=2560` 参数 | `ED`（true=带 / false=去掉） | `true` |
| 只留住宅 | `ONLY_RES`（true=只留住宅，无住宅的国家保留 1 个兜底 / false=全都留） | `true` |
| 优选域名（连接地址） | `AK_ADDRS`（数组，可填多个；留空=直连） | 6 个域名轮询 |

改完去 **Actions → Update AK node list → Run workflow** 手动跑一次立刻生效（不跑就等下一个 12 小时自动跑）。

## 原理

1. 拉 VPN Gate 官方列表（回退：GitHub 镜像），从每个节点的 OpenVPN 配置里提取 SSTP 端口（`proto tcp` + `remote` 行）；同时读取 `sources/` 里的附加节点（HTTPS / TURN）；
2. 逐个调用自建检测 Worker（跑在 Cloudflare 上，`/check?sstp=…`、`/check?turn=…`、`/check?https=…`）——只有「从 CF 能连上」的节点才保留；
3. 生成 AK 格式的 VLESS 链接（`/sstp://…`、`/turn://…`、`/?https://…` 三种路径），发布到 GitHub Pages。

**节点名格式**：`国家-类别-序号`（SSTP）或 `国家-协议-类别-序号`（HTTPS/TURN），如 `日本-住宅-01`、`日本-HTTPS-商业-01`、`法国-TURN-商业-01`。

**住宅/商业怎么判断**：优先看检测时读到的**出口 IP 属性**（运营商类型 `isp`→住宅；`hosting`/`business`/托管标记→商业）；读不到时用数据源自带的类型标注兜底；都没有则标「未知」（不硬说成商业）。

**本地测试**：`SKIP_EXTRA=1 LIMIT=12 node update.mjs`（跳过附加数据源、只测少量节点）。

## 致谢

- [cmliu/CF-Workers-CheckSocks5](https://github.com/cmliu/CF-Workers-CheckSocks5) —— 检测 Worker（GPL-3.0）
- [hezhanleiok/gate](https://github.com/hezhanleiok/gate) —— 流水线设计参考
- [VPN Gate](https://www.vpngate.net/) —— 节点数据源（筑波大学公共 VPN 项目）
