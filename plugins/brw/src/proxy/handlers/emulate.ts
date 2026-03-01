import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

// Common device descriptors — based on Chrome DevTools device list
const DEVICES: Record<string, {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent: string;
}> = {
  // --- iPhones ---
  'iphone se': { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 12': { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 12 pro': { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 12 pro max': { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 12 mini': { width: 375, height: 812, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 13': { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 13 pro': { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 13 pro max': { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 13 mini': { width: 375, height: 812, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  'iphone 14': { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 14 pro': { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 14 pro max': { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 14 plus': { width: 428, height: 926, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 15': { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 15 pro': { width: 393, height: 852, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'iphone 15 pro max': { width: 430, height: 932, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },

  // --- iPads ---
  'ipad': { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'ipad mini': { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'ipad air': { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'ipad pro': { width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  'ipad pro 11': { width: 834, height: 1194, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },

  // --- Samsung Galaxy ---
  'galaxy s21': { width: 360, height: 800, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'galaxy s22': { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'galaxy s23': { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
  'samsung galaxy s24': { width: 360, height: 780, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
  'galaxy s5': { width: 360, height: 640, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'galaxy note 3': { width: 360, height: 640, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 4.3; SM-N9005 Build/JSS15J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'galaxy tab s4': { width: 712, height: 1138, deviceScaleFactor: 2.25, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 8.1.0; SM-T837A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36' },

  // --- Google Pixel ---
  'pixel 5': { width: 393, height: 851, deviceScaleFactor: 2.75, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'pixel 6': { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'pixel 7': { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'pixel 8': { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },

  // --- Nexus ---
  'nexus 5': { width: 360, height: 640, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'nexus 5x': { width: 412, height: 732, deviceScaleFactor: 2.625, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 8.0.0; Nexus 5X Build/OPR4.170623.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'nexus 6': { width: 412, height: 732, deviceScaleFactor: 3.5, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 7.1.1; Nexus 6 Build/N6F26U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'nexus 6p': { width: 412, height: 732, deviceScaleFactor: 3.5, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 8.0.0; Nexus 6P Build/OPP3.170518.006) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },
  'nexus 7': { width: 600, height: 960, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 7 Build/MOB30X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36' },
  'nexus 10': { width: 800, height: 1280, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 10 Build/MOB31T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36' },

  // --- Microsoft Surface ---
  'surface pro': { width: 1368, height: 912, deviceScaleFactor: 2, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  'surface pro 7': { width: 1368, height: 912, deviceScaleFactor: 2, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  'surface duo': { width: 540, height: 720, deviceScaleFactor: 2.5, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 11.0; Surface Duo) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' },

  // --- BlackBerry ---
  'blackberry z30': { width: 360, height: 640, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/10.0.9.2372 Mobile Safari/537.10+' },
  'blackberry playbook': { width: 600, height: 1024, deviceScaleFactor: 1, mobile: true, userAgent: 'Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML, like Gecko) Version/7.2.1.0 Safari/536.2+' },

  // --- Nokia ---
  'nokia lumia 520': { width: 320, height: 533, deviceScaleFactor: 1.5, mobile: true, userAgent: 'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)' },
  'nokia n9': { width: 480, height: 854, deviceScaleFactor: 1, mobile: true, userAgent: 'Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13' },

  // --- LG ---
  'lg optimus l70': { width: 384, height: 640, deviceScaleFactor: 1.25, mobile: true, userAgent: 'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36' },

  // --- Kindle ---
  'kindle fire hdx': { width: 800, height: 1280, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true' },

  // --- Desktop presets ---
  'desktop 1080p': { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  'desktop 1440p': { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  'laptop': { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  'macbook pro': { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
};

// Track active emulation per tab
const activeEmulation = new Map<string, Record<string, unknown>>();

export async function handleEmulate(
  cdp: CDPManager,
  params: {
    action?: string;
    device?: string;
    width?: number;
    height?: number;
    scale?: number;
    mobile?: boolean;
    touch?: boolean;
    userAgent?: string;
    geolocation?: string;
    media?: string;
    timezone?: string;
    locale?: string;
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab || cdp.getActiveTabId() || '';
  const client = cdp.getClient(tabId || undefined);

  if (params.action === 'reset') {
    await client.Emulation.clearDeviceMetricsOverride();
    try { await client.Emulation.setTouchEmulationEnabled({ enabled: false }); } catch { /* ignore */ }
    try { await client.Emulation.clearGeolocationOverride(); } catch { /* ignore */ }
    try { await client.Emulation.setEmulatedMedia({ features: [] }); } catch { /* ignore */ }
    try { await client.Emulation.setTimezoneOverride({ timezoneId: '' }); } catch { /* ignore */ }
    try { await client.Emulation.setLocaleOverride({ locale: '' }); } catch { /* ignore */ }
    try { await client.Emulation.setUserAgentOverride({ userAgent: '' }); } catch { /* ignore */ }
    activeEmulation.delete(tabId);
    return { ok: true, active: null };
  }

  const settings: Record<string, unknown> = activeEmulation.get(tabId) || {};

  // Device preset
  if (params.device) {
    const deviceKey = params.device.toLowerCase();
    const device = DEVICES[deviceKey];
    if (!device) {
      const available = Object.keys(DEVICES).join(', ');
      return { ok: false, error: `Unknown device: ${params.device}. Available: ${available}`, code: 'INVALID_ARGUMENT' };
    }

    await client.Emulation.setDeviceMetricsOverride({
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.deviceScaleFactor,
      mobile: device.mobile,
    });
    await client.Emulation.setUserAgentOverride({ userAgent: device.userAgent });
    await client.Emulation.setTouchEmulationEnabled({ enabled: true });

    settings.device = params.device;
    settings.width = device.width;
    settings.height = device.height;
    settings.scale = device.deviceScaleFactor;
    settings.mobile = device.mobile;
    settings.userAgent = device.userAgent;
    settings.touch = true;
  }

  // Custom viewport
  if (params.width || params.height) {
    await client.Emulation.setDeviceMetricsOverride({
      width: params.width || 1280,
      height: params.height || 800,
      deviceScaleFactor: params.scale || 1,
      mobile: params.mobile || false,
    });
    settings.width = params.width || 1280;
    settings.height = params.height || 800;
    settings.scale = params.scale || 1;
    settings.mobile = params.mobile || false;
  }

  // Touch emulation
  if (params.touch !== undefined) {
    await client.Emulation.setTouchEmulationEnabled({ enabled: params.touch });
    settings.touch = params.touch;
  }

  // User agent
  if (params.userAgent) {
    await client.Emulation.setUserAgentOverride({ userAgent: params.userAgent });
    settings.userAgent = params.userAgent;
  }

  // Geolocation
  if (params.geolocation) {
    const parts = params.geolocation.split(',').map(Number);
    if (parts.length === 2 && !parts.some(isNaN)) {
      await client.Emulation.setGeolocationOverride({
        latitude: parts[0],
        longitude: parts[1],
        accuracy: 100,
      });
      settings.geolocation = { latitude: parts[0], longitude: parts[1] };
    }
  }

  // Media features
  if (params.media) {
    const eqIdx = params.media.indexOf('=');
    if (eqIdx > 0) {
      const name = params.media.substring(0, eqIdx);
      const value = params.media.substring(eqIdx + 1);
      await client.Emulation.setEmulatedMedia({
        features: [{ name, value }],
      });
      settings.media = { [name]: value };
    }
  }

  // Timezone
  if (params.timezone) {
    await client.Emulation.setTimezoneOverride({ timezoneId: params.timezone });
    settings.timezone = params.timezone;
  }

  // Locale
  if (params.locale) {
    await client.Emulation.setLocaleOverride({ locale: params.locale });
    settings.locale = params.locale;
  }

  activeEmulation.set(tabId, settings);
  return { ok: true, active: settings };
}
