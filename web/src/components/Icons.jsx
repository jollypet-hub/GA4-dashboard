// 線條圖示（純 SVG，跟隨文字顏色）

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const Icon = {
  Revenue: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.2 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.6-.6-3-1.6M12 6v2M12 16v2" /></svg>
  ),
  Cart: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6" /><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /></svg>
  ),
  Receipt: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6" /></svg>
  ),
  Target: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
  ),
  Users: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2" /></svg>
  ),
  Warn: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
  ),
  Check: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
  ),
  Trend: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M3 17l5-5 4 4 8-8" /><path d="M15 8h5v5" /></svg>
  ),
  Share: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 11l10-5M7 13l10 5" /></svg>
  ),
  Phone: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
  ),
  Desktop: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /></svg>
  ),
  Tablet: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}><rect x="4" y="3" width="16" height="18" rx="2" /></svg>
  ),
  Calendar: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
  ),
  Chat: (p) => (
    <svg width="22" height="22" viewBox="0 0 24 24" {...base} {...p}><path d="M4 5h16v11H9l-5 4V5z" /><path d="M9 10h.01M12 10h.01M15 10h.01" /></svg>
  ),
  Spark: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></svg>
  ),
  Close: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
  Send: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  ),
  Star: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" /></svg>
  ),
  Download: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...base} {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
  ),
  Funnel: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M3 4h18l-7 8.5V19l-4 2v-8.5L3 4z" /></svg>
  ),
  Tag: (p) => (
    <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M3 12V4h8l10 10-8 8L3 12z" /><circle cx="7.5" cy="8.5" r="1.3" /></svg>
  ),
  Eye: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
  ),
};
