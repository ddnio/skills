#!/usr/bin/env node
/**
 * buddy-broker-cli.mjs — manual broker control for debugging.
 *
 * Usage:
 *   node scripts/buddy-broker-cli.mjs start [--project-dir <path>]
 *   node scripts/buddy-broker-cli.mjs status [--project-dir <path>]
 *   node scripts/buddy-broker-cli.mjs stop [--project-dir <path>] [--force]
 *
 * Output: single JSON object on stdout, exit code 0 on success.
 */
import {
  getBrokerPaths,
  isBrokerAlive,
  spawnBroker,
  sendCommand,
  sendShutdown,
} from './lib/buddy-broker.mjs';
import { getBuddyHome } from './lib/paths.mjs';
import fs from 'node:fs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[k] = next;
        i++;
      } else {
        out[k] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function emit(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const projectRoot = args['project-dir'] || process.cwd();
  const home = getBuddyHome();
  const paths = getBrokerPaths(home, projectRoot);

  switch (cmd) {
    case 'start': {
      const result = await spawnBroker({ projectRoot, home });
      emit({ status: 'ok', action: 'start', reused: !!result.reused, pid: result.pid, paths });
      return;
    }
    case 'status': {
      const alive = await isBrokerAlive(paths);
      if (!alive) {
        emit({
          status: 'ok',
          action: 'status',
          alive: false,
          pid_file_present: fs.existsSync(paths.pidPath),
          socket_file_present: fs.existsSync(paths.sockPath),
          paths,
        });
        return;
      }
      try {
        const reply = await sendCommand(paths, {
          method: 'initialize',
          params: { clientInfo: { title: 'codex-buddy-cli', name: 'codex-buddy', version: '1.0.0' } },
        });
        emit({
          status: 'ok',
          action: 'status',
          alive: true,
          pid_file_present: fs.existsSync(paths.pidPath),
          socket_file_present: fs.existsSync(paths.sockPath),
          user_agent: reply.result?.userAgent || null,
          paths,
        });
      } catch (e) {
        emit({
          status: 'ok',
          action: 'status',
          alive: true,
          pid_file_present: fs.existsSync(paths.pidPath),
          socket_file_present: fs.existsSync(paths.sockPath),
          last_error: e.message,
          paths,
        });
      }
      return;
    }
    case 'stop': {
      const wasAlive = await isBrokerAlive(paths);
      await sendShutdown(paths);
      // --force: ensure files are gone even if broker was wedged.
      if (args.force) {
        try { fs.unlinkSync(paths.sockPath); } catch {}
        try { fs.unlinkSync(paths.pidPath); } catch {}
      }
      emit({ status: 'ok', action: 'stop', was_alive: wasAlive, paths });
      return;
    }
    default:
      emit({ status: 'error', error: `unknown command: ${cmd || '(none)'}`, usage: 'start|status|stop' }, 2);
  }
}

main().catch((err) => {
  emit({ status: 'error', error: err.message, stack: err.stack }, 1);
});
