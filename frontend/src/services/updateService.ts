import { Call, Browser, Events } from '@wailsio/runtime';
import { APP_VERSION } from '../version';

export interface UpdateProgress {
  status: 'idle' | 'downloading' | 'completed' | 'installing' | 'error';
  downloaded: number;
  total: number;
  percent: number;
  error?: string;
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl: string;
  assetFileName: string;
  assetSize: number;
  publishedAt: string;
  platformOS: string;
  platformArch: string;
}

export function parseSemver(v: string): number[] {
  const clean = v.replace(/^v/i, '').split('-')[0];
  return clean.split('.').map((p) => parseInt(p, 10) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  const max = Math.max(l.length, c.length);
  for (let i = 0; i < max; i++) {
    const lVal = l[i] ?? 0;
    const cVal = c[i] ?? 0;
    if (lVal > cVal) return true;
    if (lVal < cVal) return false;
  }
  return false;
}

function detectOS(): 'windows' | 'darwin' | 'linux' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'darwin';
  return 'linux';
}

function findMatchingAsset(assets: any[], os: string): any {
  if (!assets || !Array.isArray(assets)) return null;
  if (os === 'windows') {
    return (
      assets.find((a) => a.name?.endsWith('.exe') && a.name?.includes('installer')) ||
      assets.find((a) => a.name?.endsWith('.exe'))
    );
  } else if (os === 'darwin') {
    return (
      assets.find((a) => a.name?.endsWith('.dmg')) ||
      assets.find((a) => a.name?.endsWith('.zip') && a.name?.includes('macos'))
    );
  } else {
    return (
      assets.find((a) => a.name?.endsWith('.deb')) ||
      assets.find((a) => a.name?.endsWith('.appimage')) ||
      assets.find((a) => a.name?.endsWith('.rpm'))
    );
  }
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  // 1. Try Go backend service first
  try {
    const res = await Call.ByName('dhub/internal/services.UpdateService.CheckForUpdate');
    if (res && typeof res === 'object') {
      return res as UpdateInfo;
    }
  } catch (err) {
    console.debug('Backend update check call returned:', err);
  }

  // 2. Fallback: direct fetch from GitHub API (GitHub API has CORS enabled for public repositories)
  const resp = await fetch('https://api.github.com/repos/tss182/dhub/releases/latest', {
    headers: {
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!resp.ok) {
    if (resp.status === 404) {
      return {
        hasUpdate: false,
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        releaseTitle: '',
        releaseNotes: '',
        releaseUrl: 'https://github.com/tss182/dhub/releases',
        downloadUrl: 'https://github.com/tss182/dhub/releases',
        assetFileName: '',
        assetSize: 0,
        publishedAt: '',
        platformOS: detectOS(),
        platformArch: 'amd64',
      };
    }
    throw new Error(`GitHub API error: HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const latestTag = data.tag_name || '';
  const hasUpdate = isNewer(latestTag, APP_VERSION);
  const os = detectOS();
  const asset = findMatchingAsset(data.assets, os);

  return {
    hasUpdate,
    currentVersion: APP_VERSION,
    latestVersion: latestTag,
    releaseTitle: data.name || latestTag,
    releaseNotes: data.body || '',
    releaseUrl: data.html_url || 'https://github.com/tss182/dhub/releases',
    downloadUrl: asset ? asset.browser_download_url : (data.html_url || 'https://github.com/tss182/dhub/releases'),
    assetFileName: asset?.name || '',
    assetSize: asset?.size || 0,
    publishedAt: data.published_at || '',
    platformOS: os,
    platformArch: 'amd64',
  };
}

export async function openUpdateURL(url: string): Promise<void> {
  try {
    if (Browser && typeof Browser.OpenURL === 'function') {
      await Browser.OpenURL(url);
      return;
    }
  } catch (e) {
    console.warn('Browser.OpenURL fallback to backend:', e);
  }

  try {
    await Call.ByName('dhub/internal/services.UpdateService.OpenURL', url);
  } catch (e) {
    window.open(url, '_blank');
  }
}

export async function downloadAndStageUpdate(downloadUrl: string, assetFileName: string): Promise<string> {
  return await Call.ByName('dhub/internal/services.UpdateService.DownloadAndStage', downloadUrl, assetFileName);
}

export async function applyDownloadedUpdate(filePath?: string): Promise<void> {
  return await Call.ByName('dhub/internal/services.UpdateService.ApplyUpdate', filePath || '');
}

export async function cancelUpdateDownload(): Promise<void> {
  return await Call.ByName('dhub/internal/services.UpdateService.CancelDownload');
}

export function onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void {
  return Events.On('update:progress', (event: any) => {
    if (event && event.data) {
      callback(event.data as UpdateProgress);
    }
  });
}


