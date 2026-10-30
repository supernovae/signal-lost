// GitHub Pages serves this project from /signal-lost/, so every environment
// uses that base. Subpath bugs then show up in dev and tests, not in production.
export const SITE_BASE = process.env['SIGNAL_LOST_BASE'] ?? '/signal-lost/';
