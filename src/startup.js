// Fatal startup errors. The packaged Windows executable is usually started with a double click and runs in its
// own console window, which would close before the error can be read: there it waits for Enter.
// server.js imports this module first, so it also covers errors thrown while the other modules load (e.g. data/
// not writable because the folder was extracted under Program Files).
import { isSea } from 'node:sea';

const ownWindow = isSea() && process.platform === 'win32';

export function fatal(message) {
  console.error(`AdbMime cannot start: ${message}`);
  if (!ownWindow || !process.stdin.isTTY) process.exit(1);
  console.error('Press Enter to close this window.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}

const onStartupCrash = (err) => fatal(err?.stack || String(err));
if (ownWindow) process.on('uncaughtException', onStartupCrash);

/** The server is listening: from now on uncaught errors behave as usual. */
export function startupDone() {
  process.off('uncaughtException', onStartupCrash);
}
