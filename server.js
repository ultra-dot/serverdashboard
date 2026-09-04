// ULTRADOT Dashboard — Node.js built-in only (zero external deps)
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http_mod = require('http');

const PORT = 8000;
const ROOT = __dirname;

// --- CPU sampling via /proc/stat (more accurate than os.cpus()) ---
function readProcStat() {
  const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  // line format: cpu  user nice system idle iowait irq softirq steal guest guest_nice
  const parts = stat.split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

let prevCpu = readProcStat();
setInterval(() => {
  const cur = readProcStat();
  const dTotal = cur.total - prevCpu.total;
  const dIdle = cur.idle - prevCpu.idle;
  prevCpu = { idle: cur.idle, total: cur.total };
  cachedCpuPct = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0;
}, 2000);
let cachedCpuPct = 0;

// --- Rolling history buffer (30 samples) ---
const HISTORY_LEN = 30;
const history = { cpu: [], mem: [], disk: [] };
function pushHistory(sample) {
  for (const k of ['cpu', 'mem', 'disk']) {
    history[k].push(sample[k]);
    if (history[k].length > HISTORY_LEN) history[k].shift();
  }
}
setInterval(() => {
  pushHistory({
    cpu: Math.round(cachedCpuPct * 10) / 10,
    mem: readMem().pct,
    disk: readDisk().pct
  });
}, 4000);

// --- Disk via df ---
function readDisk() {
  try {
    const out = execSync('df -BG /', { encoding: 'utf8' });
    const line = out.split('\n')[1].split(/\s+/);
    const total = parseInt(line[1]);
    const used = parseInt(line[2]);
    const avail = parseInt(line[3]);
    const pct = parseInt(line[4]);
    return { total: `${total}G`, used: `${used}G`, avail: `${avail}G`, pct };
  } catch (e) {
    return { total: 'N/A', used: 'N/A', avail: 'N/A', pct: 0 };
  }
}

// --- Memory ---
function readMem() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalGB: (total / 1024 ** 3).toFixed(2),
    usedGB: (used / 1024 ** 3).toFixed(2),
    freeGB: (free / 1024 ** 3).toFixed(2),
    pct: Math.round((used / total) * 100)
  };
}

// --- Network: first non-internal IPv4 ---
function readIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name]) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'N/A';
}

// --- /api/system aggregator ---
function getSystem() {
  return {
    host: {
      hostname: os.hostname(),
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
      cpus: os.cpus().length,
      ip: readIp()
    },
    cpu: { pct: cachedCpuPct, model: os.cpus()[0].model.split('@')[0].trim() },
    mem: readMem(),
    disk: readDisk(),
    history: {
      cpu: history.cpu.slice(),
      mem: history.mem.slice(),
      disk: history.disk.slice()
    },
    time: {
      now: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      uptime: formatUptime(os.uptime()),
      uptimeSec: os.uptime(),
      timestamp: Date.now()
    }
  };
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// --- HTTP server ---
const server = http.createServer((req, res) => {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/api/system') {
    try {
      const data = JSON.stringify(getSystem());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url.startsWith('/api/status')) {
    const urlParam = new URL(req.url, `http://${req.headers.host}`).searchParams.get('url');
    if (!urlParam) {
      res.writeHead(400); res.end('Missing url'); return;
    }
    const lib = urlParam.startsWith('https') ? https : http_mod;
    const request = lib.get(urlParam, { timeout: 5000 }, (response) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ up: response.statusCode >= 200 && response.statusCode < 400 }));
    });
    request.on('error', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ up: false }));
    });
    request.on('timeout', () => {
      request.destroy();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ up: false }));
    });
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(ROOT, filePath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ULTRADOT] Dashboard running on http://0.0.0.0:${PORT}`);
});
