// RTSP to HLS proxy using Node.js and ffmpeg
// 1. Instalacja: npm install
// 2. Skonfiguruj kamery w pliku .env
// 3. Uruchom: node server.js
// 4. W Parking.OS wpisz HLS URL: http://localhost:8888/stream/cam1.m3u8

// Wczytaj .env
const envPath = require('path').join(__dirname, '.env');
if (require('fs').existsSync(envPath)) {
  require('fs').readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 8888;
const HLS_DIR = path.join(__dirname, 'hls_output');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// Camera RTSP URLs — configure via environment variables
// transport: 'tcp' — stabilne, brak utraty pakietów (cam1 IMOU)
// transport: 'udp' — YCC365Plus nie obsługuje RTSP/TCP; szybkie ale reorder możliwy
// transcode: true  — dekoduj + re-encode → czyste segmenty HLS (HEVC lub problematyczny H.264)
// transcode: false — pass-through copy (H.264 stabilny, bez re-encode)
const cameras = [
  { id: 'cam1', rtsp: process.env.CAM1_RTSP || '', transcode: true,  transport: 'tcp' },
  // cam2 YCC365Plus C-P05: NIE obsługuje RTSP over TCP — działa tylko UDP
  { id: 'cam2', rtsp: process.env.CAM2_RTSP || '', transcode: true,  transport: 'udp' },
  { id: 'cam3', rtsp: process.env.CAM3_RTSP || '', transcode: false, transport: 'udp' },
  { id: 'cam4', rtsp: process.env.CAM4_RTSP || '', transcode: false, transport: 'udp' },
].filter(c => c.rtsp);

if (cameras.length === 0) {
  console.error('Brak skonfigurowanych kamer. Ustaw zmienne środowiskowe CAM1_RTSP, CAM2_RTSP, CAM3_RTSP.');
  console.error('Przykład: CAM1_RTSP=rtsp://admin:haslo@192.168.0.50:554/cam/realmonitor?channel=1&subtype=0');
  process.exit(1);
}

// Ensure HLS output directory exists
if (!fs.existsSync(HLS_DIR)) fs.mkdirSync(HLS_DIR, { recursive: true });

const app = express();

// CORS for local dev
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());

// Serve HLS files
app.use('/stream', express.static(HLS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    if (filePath.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
  }
}));

// Health check
app.get('/', (_req, res) => {
  res.json({
    status: 'running',
    cameras: cameras.map(c => ({
      id: c.id,
      hls: `http://localhost:${PORT}/stream/${c.id}.m3u8`
    }))
  });
});

// ─── ONVIF PTZ ─────────────────────────────────────────────────────────────
function extractIp(rtspUrl) {
  const m = (rtspUrl || '').match(/rtsp:\/\/(?:[^@]+@)?(\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : '';
}

const ptzConfig = {
  cam2: { ip: process.env.CAM2_IP || extractIp(process.env.CAM2_RTSP), port: parseInt(process.env.CAM2_ONVIF_PORT || '80') },
  cam3: { ip: process.env.CAM3_IP || extractIp(process.env.CAM3_RTSP), port: parseInt(process.env.CAM3_ONVIF_PORT || '80') },
  cam4: { ip: process.env.CAM4_IP || extractIp(process.env.CAM4_RTSP), port: parseInt(process.env.CAM4_ONVIF_PORT || '80') },
};

// Verified working paths for this camera type (C-P05 / YCC365Plus):
// Media: /onvif/Media  — Profile token: Profile_1
// PTZ:   /onvif/PTZ
const ONVIF_MEDIA_PATH = '/onvif/Media';
const ONVIF_PTZ_PATH   = '/onvif/PTZ';

const profileCache = {};

// One dedicated agent per camera IP — keeps maxSockets=1 so the fragile camera
// web-server never gets two simultaneous connections.
const onvifAgents = {};
function getOnvifAgent(ip) {
  if (!onvifAgents[ip]) {
    onvifAgents[ip] = new http.Agent({ keepAlive: false, maxSockets: 1 });
  }
  return onvifAgents[ip];
}

function onvifPost(ip, port, servicePath, bodyXml) {
  return new Promise((resolve, reject) => {
    const envelope = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<s:Envelope',
      ' xmlns:s="http://www.w3.org/2003/05/soap-envelope"',
      ' xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl"',
      ' xmlns:trt="http://www.onvif.org/ver10/media/wsdl"',
      ' xmlns:tt="http://www.onvif.org/ver10/schema">',
      '<s:Body>', bodyXml, '</s:Body>',
      '</s:Envelope>',
    ].join('');
    const buf = Buffer.from(envelope, 'utf8');
    const req = http.request(
      {
        hostname: ip, port, path: servicePath, method: 'POST',
        agent: getOnvifAgent(ip),
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': buf.length,
          'Connection': 'close',
          'SOAPAction': '""',
        },
        timeout: 5000,
      },
      res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${d.substring(0,200)}`));
          else resolve(d);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(buf);
    req.end();
  });
}

async function getProfileToken(camId, cfg) {
  if (profileCache[camId]) return profileCache[camId];
  try {
    const r = await onvifPost(cfg.ip, cfg.port, ONVIF_MEDIA_PATH, '<trt:GetProfiles/>');
    const m = r.match(/token="([^"]+)"/);
    if (m) {
      profileCache[camId] = m[1];
      console.log(`[ptz] ${camId} token: ${m[1]}`);
      return m[1];
    }
  } catch (e) {
    console.error(`[ptz] GetProfiles failed for ${camId}:`, e.message);
  }
  profileCache[camId] = 'Profile_1';
  console.log(`[ptz] ${camId} using fallback token Profile_1`);
  return 'Profile_1';
}

app.post('/ptz/:camId', async (req, res) => {
  const { camId } = req.params;
  const { action, x = 0, y = 0, z = 0 } = req.body || {};
  const cfg = ptzConfig[camId];

  if (!cfg || !cfg.ip) {
    return res.status(404).json({ error: `PTZ nie skonfigurowane dla ${camId}` });
  }

  console.log(`[ptz] ${camId} action=${action} ip=${cfg.ip}`);

  try {
    const token = await getProfileToken(camId, cfg);
    let bodyXml;

    if (action === 'stop') {
      bodyXml = `<tptz:Stop><tptz:ProfileToken>${token}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`;
      await onvifPost(cfg.ip, cfg.port, ONVIF_PTZ_PATH, bodyXml);
      return res.json({ ok: true });
    } else if (action === 'move') {
      // ContinuousMove + server-side auto-stop after 500ms
      // Cheap cameras (YCC365Plus) ignore ONVIF Stop — auto-stop ensures short controlled movement
      const MOVE_DURATION_MS = parseInt(process.env.PTZ_MOVE_DURATION_MS || '500');
      bodyXml = `<tptz:ContinuousMove><tptz:ProfileToken>${token}</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="${x}" y="${y}"/><tt:Zoom x="${z}"/></tptz:Velocity></tptz:ContinuousMove>`;
      await onvifPost(cfg.ip, cfg.port, ONVIF_PTZ_PATH, bodyXml);
      res.json({ ok: true });
      // auto-stop (non-blocking — response already sent)
      setTimeout(async () => {
        try {
          const stopXml = `<tptz:Stop><tptz:ProfileToken>${token}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`;
          await onvifPost(cfg.ip, cfg.port, ONVIF_PTZ_PATH, stopXml);
        } catch (e) { console.error(`[ptz] auto-stop error:`, e.message); }
      }, MOVE_DURATION_MS);
      return;
    } else if (action === 'home') {
      bodyXml = `<tptz:GotoHomePosition><tptz:ProfileToken>${token}</tptz:ProfileToken></tptz:GotoHomePosition>`;
    } else {
      return res.status(400).json({ error: 'Nieznana akcja PTZ' });
    }

    await onvifPost(cfg.ip, cfg.port, ONVIF_PTZ_PATH, bodyXml);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ptz] ${camId} error:`, err.message);
    // SOAP faults (HTTP 4xx/5xx from camera) are non-fatal — camera likely processed the command.
    // Only return HTTP 500 for real network errors (timeout, connection refused).
    const isNetworkError = /timeout|ECONNREFUSED|ECONNRESET|EHOSTUNREACH/i.test(err.message);
    if (isNetworkError) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ ok: true, warning: err.message });
    }
  }
});
// ─────────────────────────────────────────────────────────────────────────────

function startCamera(cam) {
  const outputPath = path.join(HLS_DIR, `${cam.id}.m3u8`);

  // Usuń stare pliki z poprzedniej sesji — bez tego player odtwarza
  // przeterminowane segmenty sprzed wielu godzin po restarcie ffmpeg
  try {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    fs.readdirSync(HLS_DIR)
      .filter(f => f.startsWith(`${cam.id}_`) && f.endsWith('.ts'))
      .forEach(f => fs.unlinkSync(path.join(HLS_DIR, f)));
  } catch { /* ignoruj błędy usuwania */ }

  console.log(`[${cam.id}] Uruchamianie streamu HLS...`);

  // Kamera HEVC (cam1 IMOU) wymaga transkodowania → libx264
  // Kamera H.264 (cam2/3/4 YCC365Plus) — kopiujemy strumień bez transkodowania
  const videoArgs = cam.transcode
    ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', '2M', '-vf', 'scale=1280:720']
    : ['-c:v', 'copy'];

  // TCP (cam1): low-latency, no reorder buffer needed
  // UDP (cam2/3/4): needs reorder buffer, no max_delay=0 — camera doesn't support TCP
  const isTcp = (cam.transport || 'tcp') === 'tcp';
  const transportArgs = isTcp
    ? [
        '-rtsp_transport', 'tcp',
        '-analyzeduration', '3000000',
        '-probesize',       '3000000',
        '-fflags',          '+discardcorrupt+genpts+nobuffer',
        '-flags',           'low_delay',
        '-max_delay',       '0',
        '-reorder_queue_size', '0',
        '-err_detect',      'ignore_err',
      ]
    : [
        '-rtsp_transport', 'udp',
        '-buffer_size',    '4096000',  // bufor UDP na ewentualne reorder pakietów
        '-fflags',         '+discardcorrupt+genpts',
        '-err_detect',     'ignore_err',
        // '-use_wallclock_as_timestamps', '1', // odkomentuj jeśli DTS errors w logach
      ];

  const ffmpeg = spawn(FFMPEG, [
    ...transportArgs,
    '-i', cam.rtsp,
    ...videoArgs,
    '-an',
    '-vsync', 'passthrough',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+discont_start',
    '-hls_segment_filename', path.join(HLS_DIR, `${cam.id}_%03d.ts`),
    outputPath
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('error')) {
      console.error(`[${cam.id}] ffmpeg error: ${msg.trim()}`);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${cam.id}] ffmpeg zakończony (code ${code}). Restart za 5s...`);
    setTimeout(() => startCamera(cam), 5000);
  });

  return ffmpeg;
}

// Start all cameras
const server = app.listen(PORT, () => {
  console.log(`HLS proxy nasłuchuje na http://localhost:${PORT}`);
  console.log('Dostępne streamy:');
  cameras.forEach(cam => {
    console.log(`  ${cam.id}: http://localhost:${PORT}/stream/${cam.id}.m3u8`);
    startCamera(cam);
  });
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Zamykanie...');
  server.close();
  // Clean up HLS files
  try {
    const files = fs.readdirSync(HLS_DIR);
    files.forEach(f => fs.unlinkSync(path.join(HLS_DIR, f)));
    fs.rmdirSync(HLS_DIR);
  } catch { /* ignore */ }
  process.exit(0);
});
