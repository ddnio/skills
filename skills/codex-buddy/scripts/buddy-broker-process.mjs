#!/usr/bin/env node
/**
 * buddy-broker-process.mjs — W7 broker daemon.
 *
 * Entry: spawned detached by lib/buddy-broker.mjs#spawnBroker. Reads target
 * paths from env (BUDDY_BROKER_SOCK, BUDDY_BROKER_PID, BUDDY_BROKER_PROJECT_ROOT).
 * Listens on a Unix domain socket; accepts line-delimited JSON-RPC.
 *
 * Methods (W7):
 *   ping          → { ok: true, pid, started_at, project_root }
 *   status        → same as ping plus uptime_ms
 *   shutdown      → { ok: true }, then closes server and exits cleanly
 *
 * Codex app-server forwarding (turn/start, thread/*) is W8.
 *
 * Lifecycle invariants:
 *   - PID file is written before listen() resolves; removed on graceful exit.
 *   - Socket file is unlinked on graceful exit and on SIGTERM.
 *   - Idle timeout: if no client connects within IDLE_TIMEOUT_MS, the broker
 *     exits to avoid orphans when a Claude session ends without firing the
 *     session-end hook.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const SOCK = process.env.BUDDY_BROKER_SOCK;
const PID_PATH = process.env.BUDDY_BROKER_PID;
const PROJECT_ROOT = process.env.BUDDY_BROKER_PROJECT_ROOT || process.cwd();
const IDLE_TIMEOUT_MS = Number.parseInt(process.env.BUDDY_BROKER_IDLE_MS || '', 10) || 60 * 60 * 1000; // 1h
const STARTED_AT = Date.now();

if (!SOCK || !PID_PATH) {
  process.stderr.write('[buddy-broker] missing BUDDY_BROKER_SOCK or BUDDY_BROKER_PID env\n');
  process.exit(2);
}

let server;
let shuttingDown = false;
let idleTimer;

function log(msg) {
  // stdout/stderr are already redirected to broker-<hash>.log by the parent.
  process.stdout.write(`[buddy-broker ${new Date().toISOString()}] ${msg}\n`);
}

function cleanupFiles() {
  try { fs.unlinkSync(SOCK); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}
}

function gracefulExit(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (idleTimer) clearTimeout(idleTimer);
  if (server) {
    try { server.close(); } catch {}
  }
  cleanupFiles();
  // Give in-flight writes a tick to drain.
  setTimeout(() => process.exit(code), 10);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    log(`idle timeout (${IDLE_TIMEOUT_MS}ms) reached — exiting`);
    gracefulExit(0);
  }, IDLE_TIMEOUT_MS);
  // Don't keep the event loop alive solely for the idle timer.
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

function handleRequest(req) {
  const { method, id } = req || {};
  switch (method) {
    case 'ping':
    case 'status':
      return {
        id,
        result: {
          ok: true,
          pid: process.pid,
          started_at: STARTED_AT,
          uptime_ms: Date.now() - STARTED_AT,
          project_root: PROJECT_ROOT,
          method,
        },
      };
    case 'shutdown':
      // Reply, then schedule exit so the client gets the result.
      setImmediate(() => gracefulExit(0));
      return { id, result: { ok: true, shutting_down: true } };
    default:
      return { id, error: { code: -32601, message: `unknown method: ${method}` } };
  }
}

function attachConnection(sock) {
  resetIdleTimer();
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let req;
      try {
        req = JSON.parse(line);
      } catch (e) {
        sock.write(JSON.stringify({ error: { code: -32700, message: `parse error: ${e.message}` } }) + '\n');
        continue;
      }
      const reply = handleRequest(req);
      try { sock.write(JSON.stringify(reply) + '\n'); } catch {}
    }
  });
  sock.on('error', () => { try { sock.destroy(); } catch {} });
  sock.on('close', () => {});
}

async function main() {
  // Defensive: refuse to start if a sibling broker is already alive on the same sock.
  if (fs.existsSync(SOCK)) {
    // Try to connect. If it answers, abort. Else it's stale — unlink.
    const reachable = await new Promise((resolve) => {
      const probe = net.createConnection(SOCK);
      probe.once('connect', () => { probe.destroy(); resolve(true); });
      probe.once('error', () => resolve(false));
      setTimeout(() => { try { probe.destroy(); } catch {}; resolve(false); }, 200);
    });
    if (reachable) {
      log(`refusing to start: another broker is alive on ${SOCK}`);
      process.exit(0);
    }
    try { fs.unlinkSync(SOCK); } catch {}
  }

  fs.mkdirSync(path.dirname(SOCK), { recursive: true });

  server = net.createServer(attachConnection);
  server.on('error', (err) => {
    log(`server error: ${err.message}`);
    gracefulExit(1);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(SOCK, () => {
      server.removeListener('error', reject);
      // Restrict to the current user; sockets default to umask which is usually fine
      // but be explicit since broker may carry sensitive prompt data later.
      try { fs.chmodSync(SOCK, 0o600); } catch {}
      resolve();
    });
  });

  fs.writeFileSync(PID_PATH, String(process.pid));
  log(`listening on ${SOCK} (pid=${process.pid}, project=${PROJECT_ROOT})`);
  resetIdleTimer();
}

process.on('SIGTERM', () => { log('SIGTERM'); gracefulExit(0); });
process.on('SIGINT', () => { log('SIGINT'); gracefulExit(0); });
process.on('uncaughtException', (err) => {
  log(`uncaught: ${err.stack || err.message}`);
  gracefulExit(1);
});

main().catch((err) => {
  log(`fatal: ${err.stack || err.message}`);
  cleanupFiles();
  process.exit(1);
});
