// update.mjs —— VPN Gate SSTP 节点 → 检测 → 生成 AK 客户端链接清单
// 数据源: https://www.vpngate.net/api/iphone/（回退: fdciabdul/Vpngate-Scraper-API 镜像）
// 检测: 自建 CF 检测 Worker（cmliu/CF-Workers-CheckSocks5，地址在 CHECK_WORKER 环境变量）
// 输出: dist/ak.txt（全部）+ dist/ak-<国家>.txt（分国家）+ dist/stats.json + dist/index.html
// 无第三方依赖（Node 18+ 原生 fetch）
import fs from 'node:fs';
import path from 'node:path';

const CHECK_WORKER = process.env.CHECK_WORKER || 'https://ak-check.class-40b.workers.dev/check?sstp=vpn:vpn@';
const CONCURRENCY = +(process.env.CHECK_CONCURRENCY || 6);
const LIMIT = +(process.env.LIMIT || 0); // 本地测试用：只检前 N 个（0=全部）
const CHECK_TIMEOUT_MS = +(process.env.CHECK_TIMEOUT_MS || 75000);
const AK_UUID = '2523c510-9ff0-415b-9582-93949bfae7e3'; // AK.js 顶部 uuid（公开默认值）
const AK_HOST = 'txs.mavita.kdns.fr'; // AK Worker 域名
const DIST = path.resolve(import.meta.dirname, 'dist');
const UA = { 'User-Agent': 'Mozilla/5.0 (ak-nodes)' };

const COUNTRY_ZH = {
  JP: '日本', KR: '韩国', US: '美国', CA: '加拿大', RU: '俄罗斯', RO: '罗马尼亚', TH: '泰国', VN: '越南',
  DE: '德国', FR: '法国', GB: '英国', UK: '英国', SG: '新加坡', TW: '台湾', HK: '香港', CN: '中国',
  AU: '澳大利亚', NL: '荷兰', SE: '瑞典', CH: '瑞士', IT: '意大利', ES: '西班牙', PL: '波兰', IN: '印度',
  BR: '巴西', MX: '墨西哥', ID: '印度尼西亚', MY: '马来西亚', PH: '菲律宾', TR: '土耳其', UA: '乌克兰',
  CZ: '捷克', GR: '希腊', PT: '葡萄牙', FI: '芬兰', NO: '挪威', DK: '丹麦', IE: '爱尔兰', BE: '比利时',
  AT: '奥地利', HU: '匈牙利', AR: '阿根廷', CL: '智利', CO: '哥伦比亚', NZ: '新西兰', ZA: '南非',
  IL: '以色列', AE: '阿联酋', SA: '沙特', EG: '埃及', HR: '克罗地亚', BY: '白俄罗斯', GD: '格林纳达',
  LV: '拉脱维亚', EE: '爱沙尼亚', LT: '立陶宛', SK: '斯洛伐克', SI: '斯洛文尼亚', BG: '保加利亚',
  RS: '塞尔维亚', GE: '格鲁吉亚', MD: '摩尔多瓦', AM: '亚美尼亚', KZ: '哈萨克斯坦', UZ: '乌兹别克斯坦',
  MN: '蒙古', NP: '尼泊尔', LK: '斯里兰卡', MM: '缅甸',
};
const DC_KEYWORDS = ['AMAZON', 'AWS', 'GOOGLE', 'MICROSOFT', 'AZURE', 'DIGITALOCEAN', 'LINODE', 'AKAMAI', 'VULTR',
  'OVH', 'HETZNER', 'ALIBABA', 'ALICLOUD', 'TENCENT', 'ORACLE', 'CLOUDFLARE', 'CHOOPA', 'CONTABO', 'IONOS',
  'LEASEWEB', 'M247', 'G-CORE', 'COLOCROSSING', 'QUICKPACKET', 'XTOM', 'BANDWAGON', 'VPS', 'SERVER',
  'HOSTING', 'DATACENTER', 'DATA CENTER', 'CLOUD', 'VIRTUAL', 'DEDICATED', 'MAXKO', 'IPAX'];
const RES_KEYWORDS = ['KOREA TELECOM', 'SK BROADBAND', 'SKB', 'LG U+', 'LGU', 'NTT', 'SOFTBANK', 'KDDI',
  'COMMUNICATION', 'TELECOM', 'BROADBAND', 'COMCAST', 'XFINITY', 'VERIZON', 'AT&T', 'VODAFONE', 'ORANGE',
  'DEUTSCHE TELEKOM', 'TELUS', 'ROGERS', 'BELL CANADA', 'BREEZE', 'LIBERO', 'FASTWEB', 'BT ', 'IIJ', 'SEIKO',
  'CLEVER-NET', 'ROSTELECOM', 'MAGTICOM', 'MAGITICOM', 'CHINA TELECOM', 'CHINA UNICOM', 'CHINA MOBILE'];

// ---------------------------------------------------------------- 抓取
async function fetchText(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const hi = lines.findIndex(l => l.replace(/^#/, '').startsWith('HostName'));
  if (hi < 0) throw new Error('找不到 CSV 表头行');
  const rows = [];
  for (const ln of lines.slice(hi + 1)) {
    const f = ln.split(',');
    if (f.length < 7) continue;
    const host = f[0].trim(), ip = f[1].trim();
    if (!host || !ip) continue;
    rows.push({ host, ip, country: f[5].trim(), code: f[6].trim(), config_b64: f[f.length - 1].trim() });
  }
  return rows;
}

function parseMirror(json) {
  const items = Array.isArray(json) ? json : [json];
  const servers = [];
  for (const it of items) {
    if (it && Array.isArray(it.servers)) servers.push(...it.servers);
    else if (it && typeof it === 'object') servers.push(it);
  }
  const rows = [];
  for (const s of servers) {
    const host = String(s.hostname || s.host || '').trim();
    const ip = String(s.ip || '').trim();
    if (!host || !ip) continue;
    rows.push({
      host, ip,
      country: String(s.countrylong || s.country_long || s.country || '').trim(),
      code: String(s.countryshort || s.country_short || '').trim(),
      config_b64: String(s.openvpn_configdata_base64 || s.config_b64 || '').trim(),
    });
  }
  return rows;
}

async function fetchRows() {
  try {
    const rows = parseCsv(await fetchText('http://www.vpngate.net/api/iphone/'));
    if (rows.length) return { rows, source: 'vpngate.net/api/iphone' };
  } catch (e) { console.log('[!] 官方 API 失败:', e.message); }
  try {
    const j = JSON.parse(await fetchText('https://raw.githubusercontent.com/fdciabdul/Vpngate-Scraper-API/main/json/data.json'));
    const rows = parseMirror(j);
    if (rows.length) return { rows, source: 'github-mirror' };
  } catch (e) { console.log('[!] 回退镜像失败:', e.message); }
  throw new Error('数据源全部失败');
}

// ---------------------------------------------------------------- SSTP 筛选
// 端口来自 OpenVPN 配置里的 remote 行（SSTP 与 OpenVPN-TCP 共用端口）
function toSstpNodes(rows) {
  const nodes = [];
  for (const r of rows) {
    if (!r.config_b64) continue;
    let cfg = '';
    try { cfg = Buffer.from(r.config_b64, 'base64').toString('utf8'); } catch { continue; }
    if (!/^proto\s+(tcp|tcp4|tcp6)\b/m.test(cfg)) continue;
    const m = cfg.match(/^remote\s+\S+\s+(\d+)/m);
    if (!m) continue;
    const port = +m[1];
    if (!(port >= 1 && port <= 65535)) continue;
    let host = r.host;
    if (!host.endsWith('.opengw.net')) host += '.opengw.net';
    nodes.push({ host, port, ip: r.ip, country: r.country, code: r.code });
  }
  const seen = new Set(), out = [];
  for (const n of nodes) {
    const k = `${n.host.toLowerCase()}:${n.port}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- 检测
function classify(host, org, isDc) {
  if (isDc === true) return 'datacenter';
  if (isDc === false) return 'residential';
  const o = (org || '').toUpperCase();
  if (o) {
    if (DC_KEYWORDS.some(k => o.includes(k))) return 'datacenter';
    if (RES_KEYWORDS.some(k => o.includes(k))) return 'residential';
  }
  const h = host.toLowerCase();
  if (h.startsWith('public-vpn')) return 'datacenter';
  if (/^vpn\d{5,}/.test(h) || /^vpnv\d+/.test(h)) return 'residential';
  return 'unknown';
}

async function checkOne(node) {
  const url = CHECK_WORKER + encodeURIComponent(`${node.host}:${node.port}`);
  const out = { ...node, success: false, error: null, latency: null, colo: null, exit: null, kind: 'unknown' };
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!r.ok) { out.error = 'HTTP ' + r.status; return out; }
    const j = await r.json();
    out.success = !!j.success;
    out.latency = j.responseTime ?? null;
    out.colo = j.colo ?? null;
    out.exit = j.exit || null;
    out.error = out.success ? null : (j.error || j.message || 'check failed');
    // 出口查询被限流/报错（如 iplocate 429）：隧道已打通（拿到了它的 HTTP 响应）→ 节点算可用
    if (!out.success && /lookup request failed: HTTP\/1\.1 \d+/i.test(out.error)) { out.success = true; out.tunnelOnly = true; out.error = null; }
    const org = out.exit?.asn?.org || out.exit?.asn?.name || '';
    out.kind = classify(node.host, org, out.exit?.is_datacenter);
  } catch (e) { out.error = (e.name || 'Error') + ': ' + e.message; }
  return out;
}

async function checkAll(nodes) {
  const results = new Array(nodes.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < nodes.length) {
      const i = next++;
      results[i] = await checkOne(nodes[i]);
      done++;
      if (done % 10 === 0 || done === nodes.length) console.log(`  ...已检测 ${done}/${nodes.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, nodes.length) }, worker));
  return results;
}

// ---------------------------------------------------------------- 生成
function akLink(n, name) {
  const p = encodeURIComponent(`/sstp://${n.host}:${n.port}?ed=2560`);
  return `vless://${AK_UUID}@${AK_HOST}:443?type=ws&encryption=none&host=${AK_HOST}&path=${p}&security=tls&sni=${AK_HOST}&fp=chrome&packetEncoding=xudp#${name}`;
}

function main() {
  console.log(`[配置] 检测 Worker: ${CHECK_WORKER}`);
  return fetchRows().then(async ({ rows, source }) => {
    console.log(`[抓取] 来源 ${source}，原始节点 ${rows.length} 个`);
    let nodes = toSstpNodes(rows);
    console.log(`[筛选] SSTP(带 TCP 入口) 节点 ${nodes.length} 个`);
    if (LIMIT > 0) { nodes = nodes.slice(0, LIMIT); console.log(`[测试] LIMIT=${LIMIT}，只检测前 ${nodes.length} 个`); }
    let results = await checkAll(nodes, CONCURRENCY);
    let failed = results.filter(r => !r.success);
    if (failed.length) {
      console.log(`[重试] 对 ${failed.length} 个失败节点低并发重试一轮...`);
      await new Promise(r => setTimeout(r, 5000));
      const retried = await checkAll(failed.map(r => ({ host: r.host, port: r.port, ip: r.ip, country: r.country, code: r.code })), 2);
      const map = new Map(retried.map(r => [`${r.host}:${r.port}`, r]));
      results = results.map(r => map.get(`${r.host}:${r.port}`) || r);
      failed = results.filter(r => !r.success);
    }
    const ok = results.filter(r => r.success);
    console.log(`[检测] 可用 ${ok.length}/${results.length}（其中 ${ok.filter(r => !r.exit).length} 个仅确认隧道通）`);
    for (const r of failed) console.log(`  ✗ ${r.host}:${r.port} — ${r.error}`);

    // 按国家分组
    const byC = new Map();
    for (const n of ok) {
      const c = n.code || '??';
      if (!byC.has(c)) byC.set(c, []);
      byC.get(c).push(n);
    }
    const countries = [...byC.entries()].map(([code, ns]) => {
      ns.sort((a, b) => (a.kind === 'residential' ? 0 : 1) - (b.kind === 'residential' ? 0 : 1)
        || (a.latency ?? 9e9) - (b.latency ?? 9e9) || a.host.localeCompare(b.host));
      return { code, zh: COUNTRY_ZH[code] || code, nodes: ns };
    }).sort((a, b) => b.nodes.length - a.nodes.length || a.code.localeCompare(b.code));

    // 输出
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });
    const all = [];
    for (const c of countries) {
      const lines = [];
      let res = 0, dc = 0;
      for (const n of c.nodes) {
        const isRes = n.kind === 'residential';
        const nn = String(isRes ? ++res : ++dc).padStart(2, '0');
        const link = akLink(n, `AK-SSTP-${c.zh}-${isRes ? '住宅' : '机房'}-${nn}`);
        lines.push(link); all.push(link);
      }
      fs.writeFileSync(path.join(DIST, `ak-${c.code}.txt`), lines.join('\n') + '\n');
      console.log(`  ${c.zh}(${c.code}): ${lines.length} 个`);
    }
    fs.writeFileSync(path.join(DIST, 'ak.txt'), all.join('\n') + '\n');

    const stats = {
      generated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      source,
      worker: CHECK_WORKER,
      raw_nodes: rows.length,
      sstp_nodes: nodes.length,
      checked: results.length,
      success: ok.length,
      countries: countries.map(c => ({ code: c.code, zh: c.zh, count: c.nodes.length })),
    };
    fs.writeFileSync(path.join(DIST, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');

    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AK 节点清单</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7}code{background:#f2f2f2;padding:.1em .4em;border-radius:4px}li{margin:.2em 0}</style></head>
<body><h1>AK 节点清单（自动更新）</h1>
<p>生成时间：${stats.generated_at}｜可用：<b>${stats.success}</b>/${stats.checked}｜来源：${source}</p>
<p>全部链接：<a href="ak.txt">ak.txt</a>（每行一条，直接导入客户端）</p>
<ul>${countries.map(c => `<li>${c.zh}（${c.code}）：<a href="ak-${c.code}.txt">ak-${c.code}.txt</a> — ${c.nodes.length} 个</li>`).join('')}</ul>
<p><a href="stats.json">stats.json</a></p></body></html>`;
    fs.writeFileSync(path.join(DIST, 'index.html'), html);

    console.log(`[完成] 共 ${all.length} 条链接 → dist/ak.txt`);
  });
}

main().catch(e => { console.error('[错误]', e); process.exit(1); });
