import { chromium, type Browser } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import { platform } from 'os';

const CHROME_PATH = platform() === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome';
const PROFILE_DIR = `${process.env.HOME}/.claude-browser`;
const DEBUG_PORT = 9222;

export async function launchBrowser(): Promise<{
  browser: Browser;
  chrome: ChildProcess | null;
}> {
  // Try connecting to an already-running Chrome first
  try {
    const browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${DEBUG_PORT}`
    );
    console.log('Connected to existing Chrome on port 9222.');
    return { browser, chrome: null };
  } catch {
    // No Chrome running — spawn one
  }

  console.log('Launching Chrome...');
  const chrome = spawn(CHROME_PATH, [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
  ], { stdio: 'ignore', detached: true });

  let browser: Browser | undefined;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${DEBUG_PORT}`
      );
      break;
    } catch {
      if (attempt === 14)
        throw new Error('Could not connect to Chrome after 22s');
    }
  }

  return { browser: browser!, chrome };
}

export async function closeBrowser(
  browser: Browser,
  chrome: ChildProcess | null
) {
  await browser.close();
  if (chrome) chrome.kill();
}
