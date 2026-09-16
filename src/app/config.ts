/** Public endpoints and identity for the app. Change these in one place. */

/** Community Discord invite. */
export const DISCORD_URL = 'https://discord.gg/7mhYNtdmQV';

/** GitHub repository that publishes releases (installer + update manifest). */
export const GITHUB_REPO = 'BearFighter/base-ifier';
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

/** Account service for paid features (see docs/auth-api.md). Not live yet. */
export const AUTH_BASE_URL = 'https://baseifier.bitdeathlabs.com';

declare const __APP_VERSION__: string;
/** Version from package.json, injected by Vite. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
