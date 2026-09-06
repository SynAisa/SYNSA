(function () {
  const root = document.getElementById('system-status');
  if (!root) return;

  const metricEls = {
    cpuPercent: document.getElementById('system-cpu'), memoryPercent: document.getElementById('system-memory'),
    downloadBytesPerSecond: document.getElementById('system-download'), uploadBytesPerSecond: document.getElementById('system-upload'),
    latencyMs: document.getElementById('system-latency'), packetLossPercent: document.getElementById('system-packet-loss'),
  };
  const metricButtons = new Map([...root.querySelectorAll('[data-metric]')].map((button) => [button.dataset.metric, button]));
  const hiddenMetrics = new Set();
  const warningByMetric = {
    cpuPercent: 'cpu', memoryPercent: 'memory', latencyMs: 'latency', packetLossPercent: 'packet-loss',
  };
  const unavailable = () => t('Nicht verfügbar');
  const percent = (value) => Number.isFinite(value) ? `${Math.round(value)} %` : unavailable();
  function rate(value) {
    if (!Number.isFinite(value)) return unavailable();
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']; let amount = value; let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    return `${amount.toFixed(amount < 10 && unit ? 1 : 0)} ${units[unit]}`;
  }
  function saveVisibility() {
    fetch('/api/ui-state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenSystemMetrics: [...hiddenMetrics] }),
    }).catch(() => {});
  }
  function updateMetricVisibility(metric) {
    const button = metricButtons.get(metric);
    if (!button) return;
    const hidden = hiddenMetrics.has(metric);
    button.classList.toggle('is-hidden', hidden);
    button.setAttribute('aria-pressed', String(!hidden));
    button.title = t(hidden ? 'Anzeigen' : 'Ausblenden');
    button.setAttribute('aria-label', `${button.querySelector('.system-status-metric-content > span')?.textContent || metric}: ${t(hidden ? 'Anzeigen' : 'Ausblenden')}`);
  }
  function applyStatus(status) {
    if (!status) return;
    metricEls.cpuPercent.textContent = percent(status.cpuPercent);
    metricEls.memoryPercent.textContent = percent(status.memoryPercent);
    metricEls.downloadBytesPerSecond.textContent = rate(status.downloadBytesPerSecond);
    metricEls.uploadBytesPerSecond.textContent = rate(status.uploadBytesPerSecond);
    metricEls.latencyMs.textContent = Number.isFinite(status.latencyMs) ? `${status.latencyMs} ms` : unavailable();
    metricEls.packetLossPercent.textContent = percent(status.packetLossPercent);
    root.classList.toggle('is-warning', status.level === 'warning');
    root.classList.toggle('is-critical', status.level === 'critical');
    metricButtons.forEach((button, metric) => {
      const warning = (status.warnings || []).includes(warningByMetric[metric])
        || (metric === 'packetLossPercent' && (status.warnings || []).includes('network-unavailable'));
      button.classList.toggle('is-warning', warning && status.level === 'warning');
      button.classList.toggle('is-critical', warning && status.level === 'critical');
      // A warning must stay visible even when the regular value was hidden.
      if (warning) hiddenMetrics.delete(metric);
      updateMetricVisibility(metric);
    });
  }
  metricButtons.forEach((button, metric) => {
    button.addEventListener('click', () => {
      if (hiddenMetrics.has(metric)) hiddenMetrics.delete(metric);
      else hiddenMetrics.add(metric);
      updateMetricVisibility(metric);
      saveVisibility();
    });
  });
  window.DashboardSystemMonitor = { applyStatus };
  fetch('/api/ui-state').then((res) => res.ok ? res.json() : null).then((state) => {
    (state?.hiddenSystemMetrics || []).forEach((metric) => hiddenMetrics.add(metric));
    metricButtons.forEach((_, metric) => updateMetricVisibility(metric));
  }).catch(() => {});
  fetch('/api/system/status').then((res) => res.ok ? res.json() : null).then(applyStatus).catch(() => {});
})();
