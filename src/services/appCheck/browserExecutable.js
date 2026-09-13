import { existsSync } from 'node:fs';
import path from 'node:path';

export function findBrowserExecutable (environment = process.env, platform = process.platform) {
  if (environment.BROWSER_EXECUTABLE) {
    const configured = path.resolve(environment.BROWSER_EXECUTABLE);
    if (!existsSync(configured)) { throw new Error('Configured browser executable was not found'); }
    return configured;
  }
  const candidates = platform === 'win32'
    ? [
        environment.PROGRAMFILES && path.join(environment.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
        environment['PROGRAMFILES(X86)'] && path.join(environment['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
        environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
        environment.PROGRAMFILES && path.join(environment.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
        environment['PROGRAMFILES(X86)'] && path.join(environment['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')
      ]
    : [
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
        '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
      ];
  const found = candidates.find(candidate => candidate && existsSync(candidate));
  if (!found) { throw new Error('A regular Chrome or Edge installation is required for App Check'); }
  return found;
}
