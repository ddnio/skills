import { checkCodexAvailable } from './codex-adapter.mjs';
import { preflight as kimiPreflight } from './kimi-adapter.mjs';

const PROVIDERS = {
  codex: {
    name: 'codex',
    displayName: 'Codex',
    transports: ['broker', 'app-server', 'exec'],
    supportsFreshThread: true,
    supportsFollowup: true,
    preflight() {
      const ok = checkCodexAvailable();
      return {
        status: ok ? 'ok' : 'error',
        codex_available: ok,
        model: 'codex',
        message: ok ? 'Codex CLI ready' : 'Codex CLI not found. Install: npm i -g @openai/codex',
      };
    },
  },
  kimi: {
    name: 'kimi',
    displayName: 'Kimi',
    transports: ['exec'],
    supportsFreshThread: false,
    supportsFollowup: false,
    preflight() {
      const kimi = kimiPreflight();
      return {
        status: kimi.ok ? 'ok' : 'error',
        kimi_available: kimi.ok,
        kimi_version: kimi.version,
        model: 'kimi',
        message: kimi.ok
          ? `Kimi CLI ready (${kimi.version})`
          : `Kimi CLI not found or failed: ${kimi.error}. Install: https://moonshotai.github.io/kimi-cli/`,
      };
    },
  },
};

export function normalizeProviderName(value) {
  const raw = String(value || 'codex').trim().toLowerCase();
  return raw || 'codex';
}

export function getProvider(value) {
  const name = normalizeProviderName(value);
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unsupported buddy model: ${name}. Expected one of: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

export function shouldFallbackFromBrokerError(error) {
  const message = String(error?.message || error || '');
  return /\b(?:listen|bind)\s+(?:EPERM|EACCES)\b|broker did not become reachable|ECONNREFUSED|EADDRINUSE/i.test(message);
}
