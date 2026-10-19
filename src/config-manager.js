const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'oto-vpn');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function getDefaultOpenfortivpnPath() {
  if (fs.existsSync('/opt/homebrew/bin/openfortivpn')) {
    return '/opt/homebrew/bin/openfortivpn';
  }
  if (fs.existsSync('/usr/local/bin/openfortivpn')) {
    return '/usr/local/bin/openfortivpn';
  }
  return '/opt/homebrew/bin/openfortivpn';
}

const DEFAULT_CONFIG = {
  // VPN Sunucu Ayarları
  vpnHost: '',
  vpnUser: '',
  vpnPass: '',
  vpnCert: '',
  
  // Sistem Yetkileri
  macPass: '',
  openfortivpnPath: getDefaultOpenfortivpnPath(),
  preventSleep: true, // caffeinate -i
  
  // 2FA / Mail.app Dinleme
  mailCheckEnabled: true,
  mailSenderKeywords: 'fortinet',
  mailTimeout: 90,
  mailPollInterval: 3,
  
  // Uygulama & Otomasyon
  autoConnect: false,
  autoReconnect: false,
  notificationsEnabled: true,
  minimizeToTray: true
};

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  try {
    ensureDir();
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
    // İlk açılışta varsayılanları kaydet
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  } catch (err) {
    console.error('Config okuma hatası:', err);
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    ensureDir();
    const merged = { ...DEFAULT_CONFIG, ...config };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return { success: true, config: merged };
  } catch (err) {
    console.error('Config yazma hatası:', err);
    return { success: false, error: err.message };
  }
}

function getDefaults() {
  return { ...DEFAULT_CONFIG };
}

module.exports = {
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  getDefaults
};
