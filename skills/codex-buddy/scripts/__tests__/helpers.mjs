import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export function checkUnixSocketSupport(prefix = 'buddy-socket-check') {
  const sockPath = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}.sock`);
  return new Promise((resolve) => {
    const server = net.createServer();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { server.close(); } catch {}
      try { fs.unlinkSync(sockPath); } catch {}
      resolve(ok);
    };
    server.once('listening', () => finish(true));
    server.once('error', () => finish(false));
    server.listen(sockPath);
  });
}
