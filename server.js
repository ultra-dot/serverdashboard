// ULTRADOT Dashboard — Node.js built-in only (zero external deps)
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const https = require('https');
const http_mod = require('http');
const crypto = require('crypto');

const PORT = 8000;
const ROOT = __dirname;

// --- Auth & Session In-Memory Store ---
const activeSessions = new Set();

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies.admin_session;
  return Boolean(token && activeSessions.has(token));
}

function parseJsonBody(req, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      callback(null, parsed);
    } catch (e) {
      callback(e);
    }
  });
}

function getServicesConfig() {
  try {
    const fileContent = fs.readFileSync(path.join(ROOT, 'services.json'), 'utf8');
    return JSON.parse(fileContent);
  } catch (e) {
    return {
      adminUsername: process.env.ADMIN_USERNAME || 'admin',
      adminPassword: process.env.ADMIN_PASSWORD || 'admin',
      services: []
    };
  }
}

function checkSystemdActive(serviceName) {
  try {
    const out = execSync(`systemctl --user is-active ${serviceName}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return out === 'active';
  } catch (e) {
    return false;
  }
}

function checkDockerActive(containerName) {
  try {
    const out = execSync(`docker inspect -f "{{.State.Running}}" ${containerName}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    return out === 'true';
  } catch (e) {
    return false;
  }
}

function executeServiceAction(service, action, callback) {
  let cmd = '';
  if (service.type === 'systemd') {
    if (!['start', 'stop', 'restart'].includes(action)) {
      return callback(new Error('Invalid action'));
    }
    cmd = `systemctl --user ${action} ${service.service}`;
  } else if (service.type === 'docker') {
    if (!['start', 'stop', 'restart'].includes(action)) {
      return callback(new Error('Invalid action'));
    }
    cmd = `docker ${action} ${service.container}`;
  } else {
    return callback(new Error('Unknown service type'));
  }

  // If action targets the dashboard web service itself, schedule execution so response returns first
  if (service.id === 'dashboard-web') {
    setTimeout(() => {
      exec(cmd, (err) => {
        if (err) console.error(`[ACTION ERR] ${cmd}:`, err);
      });
    }, 500);
    return callback(null, `Command ${cmd} dijalankan di background.`);
  }

  exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      return callback(new Error(stderr || stdout || err.message));
    }
    callback(null, (stdout || 'Success').trim());
  });
}

// --- CPU sampling via /proc/stat (more accurate than os.cpus()) ---
function readProcStat() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const parts = stat.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch (e) {
    return { idle: 0, total: 100 };
  }
}

let prevCpu = readProcStat();
let cachedCpuPct = 0;
setInterval(() => {
  const cur = readProcStat();
  const dTotal = cur.total - prevCpu.total;
  const dIdle = cur.idle - prevCpu.idle;
  prevCpu = { idle: cur.idle, total: cur.total };
  cachedCpuPct = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0;
}, 2000);

// --- Power (Watts) Sensor & Estimation ---
let prevEnergyUj = null;
let prevEnergyTime = Date.now();
let cachedPowerWatts = 0;
let powerSource = 'est';

function readHardwarePower() {
  // 1. Try Intel RAPL energy counter
  try {
    const raplPath = '/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj';
    if (fs.existsSync(raplPath)) {
      const curUj = parseInt(fs.readFileSync(raplPath, 'utf8').trim());
      const now = Date.now();
      if (prevEnergyUj !== null) {
        const dEnergyJ = (curUj - prevEnergyUj) / 1e6;
        const dTimeS = (now - prevEnergyTime) / 1000;
        if (dTimeS > 0 && dEnergyJ >= 0) {
          cachedPowerWatts = Math.round((dEnergyJ / dTimeS) * 10) / 10;
          powerSource = 'rapl';
        }
      }
      prevEnergyUj = curUj;
      prevEnergyTime = now;
      return true;
    }
  } catch (e) { /* ignore */ }

  // 2. Try hwmon power sensors
  try {
    if (fs.existsSync('/sys/class/hwmon')) {
      const hwmonDirs = fs.readdirSync('/sys/class/hwmon');
      for (const dir of hwmonDirs) {
        const pFile = path.join('/sys/class/hwmon', dir, 'power1_input');
        if (fs.existsSync(pFile)) {
          const uWatts = parseInt(fs.readFileSync(pFile, 'utf8').trim());
          cachedPowerWatts = Math.round((uWatts / 1e6) * 10) / 10;
          powerSource = 'hwmon';
          return true;
        }
      }
    }
  } catch (e) { /* ignore */ }

  return false;
}

function calculatePower() {
  const hasHw = readHardwarePower();
  if (!hasHw) {
    // Dynamic VPS estimation: base host idle draw + active load per allocated vCPU core
    const cpus = os.cpus().length || 1;
    const cpuPct = cachedCpuPct || 0;
    const baseIdle = 10 + (cpus * 2.5);
    const dynamicLoad = (cpus * 12) * (cpuPct / 100);
    cachedPowerWatts = Math.round((baseIdle + dynamicLoad) * 10) / 10;
    powerSource = 'est';
  }
}

setInterval(calculatePower, 2000);
calculatePower();

function readPower() {
  const cpus = os.cpus().length || 1;
  return {
    watts: cachedPowerWatts,
    source: powerSource,
    detail: powerSource === 'rapl' ? 'RAPL sensor' : powerSource === 'hwmon' ? 'hwmon sensor' : `est · ${cpus} vCPU draw`
  };
}

// --- Rolling history buffer (30 samples) ---
const HISTORY_LEN = 30;
const history = { cpu: [], mem: [], disk: [], power: [] };
function pushHistory(sample) {
  for (const k of ['cpu', 'mem', 'disk', 'power']) {
    history[k].push(sample[k]);
    if (history[k].length > HISTORY_LEN) history[k].shift();
  }
}

// Initial seed samples so client sparklines render immediately on startup
const initSample = {
  cpu: Math.round(cachedCpuPct * 10) / 10,
  mem: readMem().pct,
  disk: readDisk().pct,
  power: cachedPowerWatts
};
pushHistory(initSample);
pushHistory(initSample);

setInterval(() => {
  pushHistory({
    cpu: Math.round(cachedCpuPct * 10) / 10,
    mem: readMem().pct,
    disk: readDisk().pct,
    power: cachedPowerWatts
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
    cpu: { pct: cachedCpuPct, model: (os.cpus()[0]?.model || 'CPU').split('@')[0].trim() },
    mem: readMem(),
    disk: readDisk(),
    power: readPower(),
    history: {
      cpu: history.cpu.slice(),
      mem: history.mem.slice(),
      disk: history.disk.slice(),
      power: history.power.slice()
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
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Auth API ---
  if (req.url === '/api/auth/check' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ authenticated: isAuthenticated(req) }));
    return;
  }

  if (req.url === '/api/auth/login' && req.method === 'POST') {
    parseJsonBody(req, (err, body) => {
      if (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload tidak valid' }));
        return;
      }
      const cfg = getServicesConfig();
      const expectedUser = process.env.ADMIN_USERNAME || cfg.adminUsername || 'admin';
      const expectedPass = process.env.ADMIN_PASSWORD || cfg.adminPassword || 'admin';
      if (body.username && body.password && body.username === expectedUser && body.password === expectedPass) {
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.add(token);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `admin_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`
        });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Username atau password salah!' }));
      }
    });
    return;
  }

  if (req.url === '/api/auth/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.admin_session) {
      activeSessions.delete(cookies.admin_session);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'admin_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // --- Services Management API (Protected) ---
  if (req.url === '/api/services' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Silakan login terlebih dahulu' }));
      return;
    }
    const cfg = getServicesConfig();
    const list = (cfg.services || []).map(s => {
      let isRunning = false;
      if (s.type === 'systemd') {
        isRunning = checkSystemdActive(s.service);
      } else if (s.type === 'docker') {
        isRunning = checkDockerActive(s.container);
      }
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        port: s.port,
        note: s.note,
        url: s.url,
        running: isRunning
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ services: list }));
    return;
  }

  if (req.url === '/api/services/action' && req.method === 'POST') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Silakan login terlebih dahulu' }));
      return;
    }
    parseJsonBody(req, (err, body) => {
      if (err || !body.id || !body.action) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ID service atau action tidak boleh kosong' }));
        return;
      }
      const cfg = getServicesConfig();
      const target = (cfg.services || []).find(s => s.id === body.id);
      if (!target) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Service '${body.id}' tidak ditemukan` }));
        return;
      }

      executeServiceAction(target, body.action, (err, msg) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: msg }));
      });
    });
    return;
  }

  // --- Music Downloader API (Protected) ---
  if (req.url === '/api/music/grab' && req.method === 'POST') {
    if (!isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Silakan login terlebih dahulu' }));
      return;
    }
    parseJsonBody(req, (err, body) => {
      if (err || !body.links || !Array.isArray(body.links) || body.links.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Minimal 1 link URL harus diisi' }));
        return;
      }

      // Sanitize URLs to prevent command injection
      const cleanLinks = body.links.map(l => String(l).trim()).filter(l => l.length > 0);
      const urlRegex = /^https?:\/\/[^\s"'$`\\;><&|()]+$/i;
      const invalidLinks = cleanLinks.filter(l => !urlRegex.test(l));

      if (invalidLinks.length > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ada URL dengan format tidak valid atau berbahaya' }));
        return;
      }

      const grabSingle = '/home/baha/.local/bin/grab-music';
      const grabParallel = '/home/baha/.local/bin/grab-parallel';

      let command = '';
      if (cleanLinks.length === 1) {
        command = `${grabSingle} "${cleanLinks[0]}"`;
      } else {
        const quotedArgs = cleanLinks.map(l => `"${l}"`).join(' ');
        command = `${grabParallel} ${quotedArgs}`;
      }

      exec(command, { timeout: 300000 }, (execErr, stdout, stderr) => {
        const output = (stdout || stderr || (execErr ? execErr.message : 'Selesai')).trim();
        if (execErr) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: output || execErr.message }));
          return;
        }

        // Optional auto-restart Navidrome to scan new FLAC files
        try {
          execSync('docker restart navidrome', { stdio: 'ignore' });
        } catch (e) { /* ignore restart error */ }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: output, count: cleanLinks.length }));
      });
    });
    return;
  }

  // --- /api/system aggregator ---
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

  // --- /api/status proxy ping ---
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

  // --- Static file serving ---
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(ROOT, filePath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ULTRADOT] Dashboard running on http://0.0.0.0:${PORT}`);
});
