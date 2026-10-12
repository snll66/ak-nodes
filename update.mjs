// update.mjs —— VPN Gate SSTP + 附加数据源（HTTPS/TURN）→ 检测 → 生成 AK 客户端链接清单
// 数据源: https://www.vpngate.net/api/iphone/（回退: fdciabdul/Vpngate-Scraper-API 镜像）+ sources/*.csv
// 检测: 自建 CF 检测 Worker（cmliu/CF-Workers-CheckSocks5，地址在顶部配置区）
// 输出: dist/ak.txt（全部）+ dist/ak-<国家>.txt（分国家）+ dist/stats.json + dist/index.html
// 无第三方依赖（Node 18+ 原生 fetch）
import fs from 'node:fs';
import path from 'node:path';

// ========== 配置区：换节点域名 / 检测地址 / UUID，开关 ECH / ed / 只留家宽，就改下面几行 ==========
const CHECK_WORKER = 'https://ak-check.class-40b.workers.dev/check?sstp=vpn:vpn@'; // 检测 Worker 地址（结尾必须带 /check?sstp=vpn:vpn@）
const AK_UUID = '2523c510-9ff0-415b-9582-93949bfae7e3'; // 节点 UUID（要和 AK.js 里的一致）
const AK_HOST = 'txs.mavita.kdns.fr'; // 节点域名（AK Worker 的域名）
const ECH = true; // ECH 参数：true=开（链接带 ech=cloudflare-ech.com+https://223.5.5.5/dns-query），false=关
const ED = false; // ?ed=2560 参数：true=带，false=去掉（path 变成 /sstp://节点:端口）
const ONLY_RES = true; // 只留住宅：true=清单只保留住宅节点（没住宅的国家保留延迟最低 1 个兜底），false=全类型都留
const AK_ADDRS = ['cf.090227.xyz']; // 优选域名（连接地址）：可填多个，按顺序轮流分给各节点；清空数组=直连 AK_HOST
// =======================================================================================
const CHECK_BASE = CHECK_WORKER.split('?')[0]; // 检测接口基地址（各类型分别拼 ?sstp= / ?turn= / ?https=）
const CONCURRENCY = +(process.env.CHECK_CONCURRENCY || 6);
const LIMIT = +(process.env.LIMIT || 0); // 本地测试用：只检前 N 个 SSTP（0=全部）
const SKIP_EXTRA = process.env.SKIP_EXTRA === '1'; // 本地测试用：跳过附加数据源
const CHECK_TIMEOUT_MS = +(process.env.CHECK_TIMEOUT_MS || 75000);
const DIST = path.resolve(import.meta.dirname, 'dist');
const SOURCES_DIR = path.resolve(import.meta.dirname, 'sources'); // 附加数据源目录（*.csv）
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
const ZH2CODE = Object.fromEntries(Object.entries(COUNTRY_ZH).map(([k, v]) => [v, k]));
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
    nodes.push({ host, port, ip: r.ip, country: r.country, code: r.code, stype: 'sstp' });
  }
  const seen = new Set(), out = [];
  for (const n of nodes) {
    const k = `${n.host.toLowerCase()}:${n.port}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------- 附加数据源（HTTPS / TURN）
// sources/ 目录下任意 *.csv，自动识别三种写法并去重（可混用、可带表头）：
//   1) 统一格式：type,host,port,user,pass,country          （type=https/turn；country 中文）
//   2) 扫描原格式：协议,节点链接,类型,出口IP,出口地区,…    （第 2 列是完整链接，自动取端口/账号/国家）
//   3) 直接粘链接：每行一条 https://host:port 或 turn://host:port（可带 #标签、可带 账号:密码@）
// 注意：明文 http:// 不支持（AK 引擎只认 https://），会被跳过并计数
function loadExtraNodes() {
  const EN2ZH = {
    'Japan': '日本', 'South Korea': '韩国', 'Korea': '韩国', 'United States': '美国', 'Germany': '德国',
    'France': '法国', 'Netherlands': '荷兰', 'Singapore': '新加坡', 'Hong Kong': '香港', 'Taiwan': '台湾',
    'United Kingdom': '英国', 'Canada': '加拿大', 'Russia': '俄罗斯', 'India': '印度', 'Thailand': '泰国',
    'Vietnam': '越南', 'Italy': '意大利', 'Spain': '西班牙', 'Poland': '波兰', 'Sweden': '瑞典',
    'Switzerland': '瑞士', 'Turkey': '土耳其', 'Ukraine': '乌克兰', 'Romania': '罗马尼亚', 'Czechia': '捷克',
    'Finland': '芬兰', 'Norway': '挪威', 'Denmark': '丹麦', 'Ireland': '爱尔兰', 'Belgium': '比利时',
    'Austria': '奥地利', 'Hungary': '匈牙利', 'Greece': '希腊', 'Portugal': '葡萄牙', 'Bulgaria': '保加利亚',
    'Serbia': '塞尔维亚', 'Croatia': '克罗地亚', 'Indonesia': '印度尼西亚', 'Malaysia': '马来西亚',
    'Philippines': '菲律宾', 'Mexico': '墨西哥', 'Argentina': '阿根廷', 'Brazil': '巴西', 'Australia': '澳大利亚',
    'New Zealand': '新西兰', 'South Africa': '南非', 'Israel': '以色列', 'Egypt': '埃及',
  };
  const isPort = s => /^\d{1,5}$/.test(s) && +s >= 1 && +s <= 65535;
  const mapHint = s => {
    s = String(s || '').trim();
    if (['住宅', '家宽', 'residential', 'isp'].includes(s)) return 'residential';
    if (['商业', '机房', '企业', 'hosting', 'business', 'commercial'].includes(s)) return 'commercial';
    return '';
  };
  const nodes = [];
  let httpSkipped = 0;
  let bCountryIdx = -1, bDcIdx = -1; // TURN 工具格式表头里国家/机房列的列号
  const push = (stype, host, port, user, pass, country, hint) => {
    if (stype === 'http') { httpSkipped++; return; }
    if ((stype !== 'https' && stype !== 'turn') || !host || !isPort(String(port))) return;
    const zh = country ? (EN2ZH[country] || country) : '';
    nodes.push({ host, port: +port, user: user || '', pass: pass || '', country: zh, code: ZH2CODE[zh] || 'XX', stype, hint: hint || '' });
  };
  if (!fs.existsSync(SOURCES_DIR)) return nodes;
  for (const f of fs.readdirSync(SOURCES_DIR).filter(x => x.endsWith('.csv')).sort()) {
    let text = '';
    try { text = fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8'); } catch { continue; }
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.replace(/^\uFEFF/, '').trim();
      if (!t || t.startsWith('#')) continue;
      const f6 = t.split(',').map(x => x.trim());
      if (f6[0] === 'TYPE' || f6.includes('EXIT_LOCATION_COUNTRY') || f6.includes('EXIT_IS_DATACENTER')) {
        const i = f6.indexOf('EXIT_LOCATION_COUNTRY'); if (i >= 0) bCountryIdx = i;
        const j = f6.indexOf('EXIT_IS_DATACENTER'); if (j >= 0) bDcIdx = j;
        continue;
      }
      // 分支 1/2：行里带完整链接（扫描格式第 2 列 / 直接粘链接第 1 列）
      let nodeStr = '', countryHint = '';
      if (f6[1] && f6[1].includes('://')) { nodeStr = f6[1]; countryHint = f6[4] || ''; }
      else if (f6[0] && f6[0].includes('://')) { nodeStr = f6[0]; countryHint = f6[1] || ''; }
      if (nodeStr) {
        const m = nodeStr.match(/^([a-z][a-z0-9+.-]*):\/\//i);
        if (!m) continue;
        const scheme = m[1].toLowerCase();
        if (scheme !== 'https' && scheme !== 'turn' && scheme !== 'http') continue; // sstp 等来源不接
        let rest = nodeStr.slice(m[0].length).split('#')[0];
        let user = '', pass = '';
        const at = rest.lastIndexOf('@');
        if (at >= 0) { const cred = rest.slice(0, at); rest = rest.slice(at + 1); const ci = cred.indexOf(':'); user = ci >= 0 ? cred.slice(0, ci) : cred; pass = ci >= 0 ? cred.slice(ci + 1) : ''; }
        const ci2 = rest.lastIndexOf(':');
        const host = ci2 > 0 ? rest.slice(0, ci2) : rest;
        const port = ci2 > 0 ? rest.slice(ci2 + 1) : (scheme === 'turn' ? '3478' : '443');
        push(scheme, host, port, user, pass, countryHint, mapHint(f6[2]));
        continue;
      }
      // 分支 3：统一格式 type,host,port,user,pass,country[,hint]
      if (isPort(f6[2])) { push(f6[0], f6[1], f6[2], f6[3], f6[4], f6[5] || '', mapHint(f6[6])); continue; }
      // 分支 4：TURN 工具格式 TYPE,USERNAME,PASSWORD,HOSTNAME,PORT,LINK,…
      if (isPort(f6[4])) { push(f6[0], f6[3], f6[4], f6[1], f6[2], bCountryIdx >= 0 ? (f6[bCountryIdx] || '') : '', bDcIdx >= 0 && String(f6[bDcIdx]).toLowerCase() === 'true' ? 'commercial' : ''); continue; }
    }
  }
  const seen = new Set(), out = [];
  for (const n of nodes) {
    const k = `${n.stype}:${n.host.toLowerCase()}:${n.port}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(n);
  }
  const dup = nodes.length - out.length;
  console.log(`[源] 附加数据源 ${out.length} 个（HTTPS ${out.filter(n => n.stype === 'https').length}、TURN ${out.filter(n => n.stype === 'turn').length}）${dup ? `，去重去掉 ${dup} 条` : ''}${httpSkipped ? `，跳过明文 http ${httpSkipped} 条（引擎不支持）` : ''}`);
  return out;
}

// ---------------------------------------------------------------- 检测
function classify(host, exit, hint) {
  const types = [exit?.asn?.type, exit?.company?.type].map(x => String(x || '').toLowerCase());
  if (exit?.is_datacenter === true || exit?.privacy?.is_hosting === true
    || types.some(t => t === 'hosting' || t === 'business' || t === 'education' || t === 'government' || t === 'military')) return 'commercial';
  if (types.includes('isp')) return 'residential';
  const o = String(exit?.asn?.org || exit?.asn?.name || exit?.company?.name || '').toUpperCase();
  if (o) {
    if (DC_KEYWORDS.some(k => o.includes(k))) return 'commercial';
    if (RES_KEYWORDS.some(k => o.includes(k))) return 'residential';
  }
  if (hint === 'residential' || hint === 'commercial') return hint;
  const h = host.toLowerCase();
  if (h.startsWith('public-vpn')) return 'commercial';
  if (/^vpn\d{5,}/.test(h) || /^vpnv\d+/.test(h)) return 'residential';
  return 'unknown';
}

async function checkOne(node) {
  const cred = node.user ? `${node.user}:${node.pass}@` : (node.stype === 'sstp' ? 'vpn:vpn@' : '');
  const url = `${CHECK_BASE}/check?${node.stype || 'sstp'}=${encodeURIComponent(cred + node.host + ':' + node.port)}`;
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
    out.kind = classify(node.host, out.exit, node.hint);
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
let addrIdx = 0; // 优选域名轮询下标
function akLink(n, name) {
  const addr = AK_ADDRS.length ? AK_ADDRS[addrIdx++ % AK_ADDRS.length] : AK_HOST;
  const cred = n.user ? `${n.user}:${n.pass}@` : '';
  let p;
  if (n.stype === 'turn') p = encodeURIComponent(`/turn://${cred}${n.host}:${n.port}${ED ? '?ed=2560' : ''}`);
  else if (n.stype === 'https') p = encodeURIComponent(`/?https://${cred}${n.host}:${n.port}&insecure`);
  else p = encodeURIComponent(`/sstp://${n.host}:${n.port}${ED ? '?ed=2560' : ''}`);
  const ech = ECH ? `&ech=${encodeURIComponent('cloudflare-ech.com+https://223.5.5.5/dns-query')}` : '';
  return `vless://${AK_UUID}@${addr}:443?type=ws&encryption=none&host=${AK_HOST}&path=${p}&security=tls&sni=${AK_HOST}&fp=chrome${ech}&packetEncoding=xudp#${name}`;
}

function main() {
  console.log(`[配置] 检测: ${CHECK_WORKER}｜域名: ${AK_HOST}｜连接地址: ${AK_ADDRS.length ? AK_ADDRS.join(' / ') : AK_HOST}｜UUID: ${AK_UUID}`);
  return fetchRows().then(async ({ rows, source }) => {
    console.log(`[抓取] 来源 ${source}，原始节点 ${rows.length} 个`);
    let nodes = toSstpNodes(rows);
    console.log(`[筛选] SSTP(带 TCP 入口) 节点 ${nodes.length} 个`);
    if (LIMIT > 0) { nodes = nodes.slice(0, LIMIT); console.log(`[测试] LIMIT=${LIMIT}，只检测前 ${nodes.length} 个 SSTP`); }
    const sstpCount = nodes.length;
    if (SKIP_EXTRA) console.log('[测试] SKIP_EXTRA=1，跳过附加数据源');
    else nodes = nodes.concat(loadExtraNodes());
    let results = await checkAll(nodes, CONCURRENCY);
    let failed = results.filter(r => !r.success);
    if (failed.length) {
      console.log(`[重试] 对 ${failed.length} 个失败节点低并发重试一轮...`);
      await new Promise(r => setTimeout(r, 5000));
      const retried = await checkAll(failed.map(r => ({ host: r.host, port: r.port, user: r.user, pass: r.pass, stype: r.stype, ip: r.ip, country: r.country, code: r.code })), 2);
      const map = new Map(retried.map(r => [`${r.stype}:${r.host}:${r.port}`, r]));
      results = results.map(r => map.get(`${r.stype}:${r.host}:${r.port}`) || r);
      failed = results.filter(r => !r.success);
    }
    let ok = results.filter(r => r.success);
    console.log(`[检测] 可用 ${ok.length}/${results.length}（其中 ${ok.filter(r => !r.exit).length} 个仅确认隧道通）`);
    for (const r of failed) console.log(`  ✗ [${r.stype}] ${r.host}:${r.port} — ${r.error}`);
    // 按国家分组
    const byC = new Map();
    for (const n of ok) {
      const c = n.code || '??';
      if (!byC.has(c)) byC.set(c, []);
      byC.get(c).push(n);
    }
    // 只留住宅：有住宅的国家只留住宅；没住宅的国家保留延迟最低的 1 个兜底
    let fbCountries = 0;
    const countries = [...byC.entries()].map(([code, ns]) => {
      let picked = ns;
      if (ONLY_RES) {
        const res = ns.filter(n => n.kind === 'residential');
        if (res.length) picked = res;
        else { fbCountries++; picked = [ns.slice().sort((a, b) => (a.latency ?? 9e9) - (b.latency ?? 9e9))[0]]; }
      }
      const prio = n => (n.stype === 'sstp' ? 0 : n.stype === 'https' ? 2 : 4) + (n.kind === 'residential' ? 0 : 1);
      picked.sort((a, b) => prio(a) - prio(b) || (a.latency ?? 9e9) - (b.latency ?? 9e9) || a.host.localeCompare(b.host));
      return { code, zh: COUNTRY_ZH[code] || code, nodes: picked };
    }).sort((a, b) => b.nodes.length - a.nodes.length || a.code.localeCompare(b.code));
    const kept = countries.reduce((s, c) => s + c.nodes.length, 0);
    if (ONLY_RES) console.log(`[筛选] 只留住宅：${ok.length} → ${kept}（其中 ${fbCountries} 个国家无住宅，各保留延迟最低 1 个）`);

    // 输出
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });
    const all = [];
    for (const c of countries) {
      const lines = [];
      const cnt = {};
      for (const n of c.nodes) {
        const cls = n.kind === 'residential' ? '住宅' : n.kind === 'commercial' ? '商业' : '未知';
        const label = n.stype === 'sstp' ? cls : `${n.stype === 'https' ? 'HTTPS' : 'TURN'}-${cls}`;
        const nn = String(cnt[label] = (cnt[label] || 0) + 1).padStart(2, '0');
        const link = akLink(n, `${c.zh}-${label}-${nn}`);
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
      sstp_nodes: sstpCount,
      extra_nodes: nodes.length - sstpCount,
      checked: results.length,
      success: kept,
      available: ok.length,
      types: { sstp: ok.filter(r => r.stype === 'sstp').length, https: ok.filter(r => r.stype === 'https').length, turn: ok.filter(r => r.stype === 'turn').length },
      classes: { residential: ok.filter(r => r.kind === 'residential').length, commercial: ok.filter(r => r.kind === 'commercial').length, unknown: ok.filter(r => r.kind === 'unknown').length },
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
