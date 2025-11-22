/**
 * Wait until all provided bots are not busy. Checks every 3 seconds.
 * @param {Iterable} bots - Set or Array of bot instances. The function reads `bot.isBusy`.
 * @returns {Promise<void>} resolves when all bots have isBusy === false
 */
function sleep (ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function waitUntilAllBotsIdle (bots) {
  const list = Array.from(bots || []);
  while (true) {
    let allIdle = true;
    for (const bot of list) {
      if (!bot) { continue; }
      // Treat any truthy isBusy as busy. If property missing, assume not busy.
      if (bot.isBusy) { allIdle = false; break; }
    }
    if (allIdle) { return; }
    await sleep(3000);
  }
}

export default waitUntilAllBotsIdle;
