// Shared alert configuration, used by both the overlay and the control panel.
// Adding a new alert type later (Cheer, Raid, ...) only means adding an
// entry here plus a small block of trigger UI in control.js.
window.ALERT_TYPES = {
  follow: {
    label: 'New Follower',
    icon: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9.5" cy="8.2" r="3.3"/>
        <path d="M3.8 19c0-3.5 2.9-5.9 5.7-5.9 1 0 1.9.2 2.8.7"/>
        <path d="M18.2 8.8v6M21.2 11.8h-6"/>
      </svg>`,
  },
  subscription: {
    label: 'New Subscriber',
    giftLabel: 'Gift Sub',
    icon: `
      <svg viewBox="0 0 24 24" fill="rgba(53,201,168,0.18)" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
        <path d="M12 3.4l2.47 5.1 5.53.76-4.03 3.9.98 5.6L12 16.06l-4.95 2.7.98-5.6-4.03-3.9 5.53-.76L12 3.4Z"/>
      </svg>`,
    tiers: {
      '1000': 'Tier 1',
      '2000': 'Tier 2',
      '3000': 'Tier 3',
      prime: 'Prime',
    },
  },
  cheer: {
    label: 'Cheer',
    icon: `
      <svg viewBox="0 0 24 24" fill="rgba(53,201,168,0.18)" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
        <path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z"/>
      </svg>`,
  },
  raid: {
    label: 'Raid',
    icon: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 10v4h3l5 4V6L7 10H4Z"/>
        <path d="M16 9.5c1 1 1 4 0 5M19 7.5c2 2.2 2 6.8 0 9"/>
      </svg>`,
  },
};

// Twitch allows up to 500 characters in a chat/cheer/resub message; that's
// far too long for a one-line card or history row, so every message we
// show gets cut down to this regardless of source.
const ALERT_MESSAGE_PREVIEW_LENGTH = 60;

function truncateMessage(text) {
  if (!text) return '';
  return text.length > ALERT_MESSAGE_PREVIEW_LENGTH
    ? `${text.slice(0, ALERT_MESSAGE_PREVIEW_LENGTH - 3)}…`
    : text;
}

// Shared "detail line" text (e.g. "Tier 1 · 8 months"), used by both the
// overlay card and the dashboard's event history. Pass { truncate: false }
// to get the same string with the full message text instead of the
// ~60-char preview — the dashboard uses that to detect when it was
// actually cut short and to fill in a hover tooltip with the rest.
window.buildAlertDetail = function buildAlertDetail(type, data, { truncate = true } = {}) {
  const config = window.ALERT_TYPES[type] || {};
  const d = data || {};
  const clip = truncate ? truncateMessage : (text) => text || '';

  if (type === 'subscription') {
    const tierLabel = (config.tiers && config.tiers[d.tier]) || 'Tier 1';

    if (d.isGift) {
      if (d.giftCount && d.giftCount > 1) {
        return `Gifted ${d.giftCount} × ${tierLabel} subs`;
      }
      return `Gifted a ${tierLabel} sub`;
    }

    const base = d.months && d.months > 1 ? `${tierLabel} · ${d.months} months` : tierLabel;
    // Only resubs shared with a chat message (channel.subscription.message)
    // carry text — a plain new sub (channel.subscribe) never has one.
    return d.message ? `${base} · ${clip(d.message)}` : base;
  }

  if (type === 'cheer') {
    const bits = d.bits || 0;
    const base = `${bits.toLocaleString('en-US')} Bits`;
    return d.message ? `${base} · ${clip(d.message)}` : base;
  }

  if (type === 'raid') {
    const viewers = d.viewers || 0;
    return `Raiding in with ${viewers.toLocaleString('en-US')} viewers`;
  }

  return '';
};
