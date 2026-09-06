const os = require('os');
const { execFile } = require('child_process');

const SAMPLE_INTERVAL_MS = 2000;
const PING_INTERVAL_MS = 10000;
const HIGH_USAGE_DURATION_MS = 10000;
const HIGH_USAGE_PERCENT = 85;
const HIGH_LATENCY_MS = 150;
const HIGH_PACKET_LOSS_PERCENT = 2;
const PING_TARGET = '1.1.1.1';

function emptyStatus() {
  return {
    target: PING_TARGET,
    cpuPercent: null,
    memoryPercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    downloadBytesPerSecond: null,
    uploadBytesPerSecond: null,
    latencyMs: null,
    packetLossPercent: null,
    level: 'normal',
    warnings: [],
    sampledAt: null,
  };
}

function cpuSnapshot(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times || {};
    idle += Number(times.idle) || 0;
    total += Object.values(times).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }
  return { idle, total };
}

function parseStatistics(stdout) {
  const parsed = JSON.parse(stdout || 'null');
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  if (!rows.length) return null;
  return rows.reduce((sum, row) => ({
    received: sum.received + (Number(row.ReceivedBytes) || 0),
    sent: sum.sent + (Number(row.SentBytes) || 0),
  }), { received: 0, sent: 0 });
}

function parsePing(stdout) {
  const output = String(stdout || '');
  const loss = output.match(/(?:Loss|Verlust)\s*=\s*(\d+)%|(\d+)%\s*(?:loss|Verlust)/i);
  const average = output.match(/(?:Average|Mittelwert)\s*=\s*<?(\d+)\s*ms/i);
  return {
    packetLossPercent: loss ? Number(loss[1] || loss[2]) : null,
    latencyMs: average ? Number(average[1]) : null,
  };
}

function createMonitor({ onStatus = () => {}, osModule = os, execFileFn = execFile, now = Date.now } = {}) {
  let status = emptyStatus();
  let lastCpu = null;
  let lastNetwork = null;
  let cpuHighSince = null;
  let memoryHighSince = null;
  let pingRunning = false;
  let sampleTimer = null;
  let pingTimer = null;

  function publish() {
    const warnings = [];
    const at = now();
    const cpuHigh = status.cpuPercent !== null && status.cpuPercent >= HIGH_USAGE_PERCENT;
    const memoryHigh = status.memoryPercent !== null && status.memoryPercent >= HIGH_USAGE_PERCENT;
    cpuHighSince = cpuHigh ? (cpuHighSince || at) : null;
    memoryHighSince = memoryHigh ? (memoryHighSince || at) : null;
    if (cpuHighSince && at - cpuHighSince >= HIGH_USAGE_DURATION_MS) warnings.push('cpu');
    if (memoryHighSince && at - memoryHighSince >= HIGH_USAGE_DURATION_MS) warnings.push('memory');
    if (status.latencyMs !== null && status.latencyMs >= HIGH_LATENCY_MS) warnings.push('latency');
    if (status.packetLossPercent !== null && status.packetLossPercent >= HIGH_PACKET_LOSS_PERCENT) warnings.push('packet-loss');
    if (status.packetLossPercent === 100) warnings.push('network-unavailable');
    const critical = warnings.includes('network-unavailable');
    status = { ...status, warnings, level: critical ? 'critical' : warnings.length ? 'warning' : 'normal', sampledAt: at };
    onStatus(status);
  }

  function sampleSystem() {
    const currentCpu = cpuSnapshot(osModule.cpus());
    let cpuPercent = null;
    if (lastCpu && currentCpu.total > lastCpu.total) {
      cpuPercent = Math.round((1 - (currentCpu.idle - lastCpu.idle) / (currentCpu.total - lastCpu.total)) * 100);
    }
    lastCpu = currentCpu;
    const total = osModule.totalmem();
    const used = total - osModule.freemem();
    status = {
      ...status,
      cpuPercent: Number.isFinite(cpuPercent) ? Math.max(0, Math.min(100, cpuPercent)) : null,
      memoryPercent: total ? Math.round((used / total) * 100) : null,
      memoryUsedBytes: total ? used : null,
      memoryTotalBytes: total || null,
    };

    const command = '$ErrorActionPreference="Stop"; Get-NetAdapterStatistics | Select-Object ReceivedBytes,SentBytes | ConvertTo-Json -Compress';
    execFileFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 1500, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (!err) {
        try {
          const currentNetwork = parseStatistics(stdout);
          const at = now();
          if (currentNetwork && lastNetwork && at > lastNetwork.at) {
            const seconds = (at - lastNetwork.at) / 1000;
            status = {
              ...status,
              downloadBytesPerSecond: Math.max(0, (currentNetwork.received - lastNetwork.received) / seconds),
              uploadBytesPerSecond: Math.max(0, (currentNetwork.sent - lastNetwork.sent) / seconds),
            };
          } else if (!currentNetwork) {
            status = { ...status, downloadBytesPerSecond: null, uploadBytesPerSecond: null };
          }
          lastNetwork = currentNetwork ? { ...currentNetwork, at } : null;
        } catch {
          status = { ...status, downloadBytesPerSecond: null, uploadBytesPerSecond: null };
          lastNetwork = null;
        }
      } else {
        status = { ...status, downloadBytesPerSecond: null, uploadBytesPerSecond: null };
        lastNetwork = null;
      }
      publish();
    });
  }

  function samplePing() {
    if (pingRunning) return;
    pingRunning = true;
    execFileFn('ping.exe', ['-n', '3', '-w', '1000', PING_TARGET], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }, (err, stdout) => {
      pingRunning = false;
      const result = err ? { latencyMs: null, packetLossPercent: 100 } : parsePing(stdout);
      status = { ...status, ...result };
      publish();
    });
  }

  return {
    start() {
      if (sampleTimer) return;
      sampleSystem();
      samplePing();
      sampleTimer = setInterval(sampleSystem, SAMPLE_INTERVAL_MS);
      pingTimer = setInterval(samplePing, PING_INTERVAL_MS);
    },
    stop() {
      clearInterval(sampleTimer);
      clearInterval(pingTimer);
      sampleTimer = null;
      pingTimer = null;
    },
    getStatus: () => status,
  };
}

module.exports = { createMonitor, emptyStatus, parsePing, parseStatistics };
