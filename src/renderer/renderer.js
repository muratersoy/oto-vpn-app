// DOM Elementleri
const beaconContainer = document.getElementById('beacon-container');
const heroIconDisconnected = document.getElementById('hero-icon-disconnected');
const heroIconConnecting = document.getElementById('hero-icon-connecting');
const heroIconConnected = document.getElementById('hero-icon-connected');

const statusPill = document.getElementById('status-pill');
const statusText = document.getElementById('status-text');
const currentHostDisplay = document.getElementById('current-host-display');
const timerBadge = document.getElementById('timer-badge');
const timerText = document.getElementById('timer-text');

const otpCard = document.getElementById('otp-card');
const otpTimer = document.getElementById('otp-timer');
const manualOtpInput = document.getElementById('manual-otp-input');
const btnSubmitOtp = document.getElementById('btn-submit-otp');

const btnConnect = document.getElementById('btn-connect');
const btnConnectIcon = document.getElementById('btn-connect-icon');
const btnConnectLabel = document.getElementById('btn-connect-label');
const btnSpinner = btnConnect.querySelector('.btn-spinner');
const btnCancel = document.getElementById('btn-cancel');

const displayUser = document.getElementById('display-user');
const display2fa = document.getElementById('display-2fa');
const displaySleep = document.getElementById('display-sleep');

// Terminal
const btnToggleLogs = document.getElementById('btn-toggle-logs');
const terminalDrawer = document.getElementById('terminal-drawer');
const terminalBody = document.getElementById('terminal-body');
const btnCloseTerminal = document.getElementById('btn-close-terminal');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnCopyLogs = document.getElementById('btn-copy-logs');

// Ayarlar
const btnOpenSettings = document.getElementById('btn-open-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnResetDefaults = document.getElementById('btn-reset-defaults');
const btnTestBinary = document.getElementById('btn-test-binary');
const binaryTestResult = document.getElementById('binary-test-result');
const btnTestMail = document.getElementById('btn-test-mail');
const mailTestResult = document.getElementById('mail-test-result');

const toast = document.getElementById('toast');

let currentStatus = 'disconnected';
let appConfig = {};
let logEntries = [];

// Zaman Biçimlendirme (saniye -> 00:00:00)
function formatDuration(sec) {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Toast Bildirimi
let toastTimeout = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2800);
}

// UI Durum Güncellemesi
function updateUI(statusInfo) {
  const status = statusInfo.status || 'disconnected';
  currentStatus = status;

  // Beacon & İkonlar
  beaconContainer.classList.remove('beacon-red', 'beacon-yellow', 'beacon-green');
  heroIconDisconnected.classList.add('hidden');
  heroIconConnecting.classList.add('hidden');
  heroIconConnected.classList.add('hidden');

  statusPill.classList.remove('pill-red', 'pill-yellow', 'pill-green');
  btnConnect.classList.remove('btn-connect', 'btn-disconnect', 'btn-connecting');

  if (status === 'connected') {
    beaconContainer.classList.add('beacon-green');
    heroIconConnected.classList.remove('hidden');

    statusPill.classList.add('pill-green');
    statusText.textContent = 'VPN Bağlantısı Aktif';

    btnConnect.classList.add('btn-disconnect');
    btnSpinner.classList.add('hidden');
    btnConnectIcon.classList.remove('hidden');
    btnConnectLabel.textContent = 'Bağlantıyı Kes';
    btnCancel.classList.add('hidden');

    otpCard.classList.add('hidden');
    timerBadge.classList.remove('hidden');

    if (statusInfo.duration !== undefined) {
      timerText.textContent = formatDuration(statusInfo.duration);
    }
  } else if (status === 'connecting' || status === 'waiting_otp' || status === 'disconnecting') {
    beaconContainer.classList.add('beacon-yellow');
    heroIconConnecting.classList.remove('hidden');

    statusPill.classList.add('pill-yellow');
    statusText.textContent = status === 'waiting_otp' 
      ? '2FA Kodu Bekleniyor...' 
      : (status === 'disconnecting' ? 'Bağlantı Kesiliyor...' : 'Bağlanıyor...');

    btnConnect.classList.add('btn-connecting');
    btnSpinner.classList.remove('hidden');
    btnConnectIcon.classList.add('hidden');
    btnConnectLabel.textContent = status === 'disconnecting' ? 'Kesiliyor...' : 'İptal Et';
    btnCancel.classList.remove('hidden');

    if (status === 'waiting_otp') {
      otpCard.classList.remove('hidden');
      manualOtpInput.focus();
    } else {
      otpCard.classList.add('hidden');
    }

    timerBadge.classList.add('hidden');
  } else {
    // Disconnected veya Error
    beaconContainer.classList.add('beacon-red');
    heroIconDisconnected.classList.remove('hidden');

    statusPill.classList.add('pill-red');
    statusText.textContent = status === 'error' ? 'Bağlantı Hatası' : 'Bağlantı Kesildi';

    btnConnect.classList.add('btn-connect');
    btnSpinner.classList.add('hidden');
    btnConnectIcon.classList.remove('hidden');
    btnConnectLabel.textContent = "VPN'e Bağlan";
    btnCancel.classList.add('hidden');

    otpCard.classList.add('hidden');
    timerBadge.classList.add('hidden');
    timerText.textContent = '00:00:00';
  }
}

// Log Ekleme
function appendLog(logEntry) {
  const { level = 'info', message = '' } = logEntry;
  const time = new Date().toLocaleTimeString();

  logEntries.push(`[${time}] ${message}`);

  const lineEl = document.createElement('div');
  lineEl.className = `log-line log-${level}`;
  lineEl.textContent = `[${time}] ${message}`;

  terminalBody.appendChild(lineEl);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

// Config Değerlerini UI'a Yaz
function populateConfigUI(cfg) {
  appConfig = cfg;
  currentHostDisplay.textContent = cfg.vpnHost || 'Belirtilmedi';
  displayUser.textContent = cfg.vpnUser || 'Belirtilmedi';
  display2fa.textContent = cfg.mailCheckEnabled ? 'Mail.app Otomatik' : 'Manuel';
  displaySleep.textContent = cfg.preventSleep ? 'Caffeinate Aktif' : 'Pasif';

  document.getElementById('cfg-vpnHost').value = cfg.vpnHost || '';
  document.getElementById('cfg-vpnUser').value = cfg.vpnUser || '';
  document.getElementById('cfg-vpnPass').value = cfg.vpnPass || '';
  document.getElementById('cfg-vpnCert').value = cfg.vpnCert || '';

  document.getElementById('cfg-macPass').value = cfg.macPass || '';
  document.getElementById('cfg-openfortivpnPath').value = cfg.openfortivpnPath || '';
  document.getElementById('cfg-preventSleep').checked = !!cfg.preventSleep;

  document.getElementById('cfg-mailCheckEnabled').checked = !!cfg.mailCheckEnabled;
  document.getElementById('cfg-mailSenderKeywords').value = cfg.mailSenderKeywords || '';
  document.getElementById('cfg-mailTimeout').value = cfg.mailTimeout || 90;
  document.getElementById('cfg-mailPollInterval').value = cfg.mailPollInterval || 3;

  document.getElementById('cfg-autoConnect').checked = !!cfg.autoConnect;
  document.getElementById('cfg-autoReconnect').checked = !!cfg.autoReconnect;
  document.getElementById('cfg-notificationsEnabled').checked = !!cfg.notificationsEnabled;
  document.getElementById('cfg-minimizeToTray').checked = !!cfg.minimizeToTray;
}

// Config Değerlerini Inputlardan Topla
function collectConfigFromUI() {
  return {
    vpnHost: document.getElementById('cfg-vpnHost').value.trim(),
    vpnUser: document.getElementById('cfg-vpnUser').value.trim(),
    vpnPass: document.getElementById('cfg-vpnPass').value,
    vpnCert: document.getElementById('cfg-vpnCert').value.trim(),

    macPass: document.getElementById('cfg-macPass').value,
    openfortivpnPath: document.getElementById('cfg-openfortivpnPath').value.trim(),
    preventSleep: document.getElementById('cfg-preventSleep').checked,

    mailCheckEnabled: document.getElementById('cfg-mailCheckEnabled').checked,
    mailSenderKeywords: document.getElementById('cfg-mailSenderKeywords').value.trim(),
    mailTimeout: parseInt(document.getElementById('cfg-mailTimeout').value, 10) || 90,
    mailPollInterval: parseInt(document.getElementById('cfg-mailPollInterval').value, 10) || 3,

    autoConnect: document.getElementById('cfg-autoConnect').checked,
    autoReconnect: document.getElementById('cfg-autoReconnect').checked,
    notificationsEnabled: document.getElementById('cfg-notificationsEnabled').checked,
    minimizeToTray: document.getElementById('cfg-minimizeToTray').checked
  };
}

// Olay Dinleyicileri
btnConnect.addEventListener('click', async () => {
  if (currentStatus === 'connected' || currentStatus === 'connecting' || currentStatus === 'waiting_otp') {
    await window.api.disconnect();
  } else {
    if (!appConfig.vpnHost || !appConfig.vpnUser) {
      showToast('Lütfen önce Ayarlar ekranından VPN sunucu ve kullanıcı bilgilerinizi kaydedin.');
      settingsModal.classList.remove('hidden');
      return;
    }
    await window.api.connect();
  }
});

btnCancel.addEventListener('click', async () => {
  await window.api.disconnect();
});

btnSubmitOtp.addEventListener('click', async () => {
  const code = manualOtpInput.value.trim();
  if (code) {
    await window.api.submitOTP(code);
    manualOtpInput.value = '';
    showToast(`2FA Kodu iletildi: ${code}`);
  }
});

manualOtpInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    btnSubmitOtp.click();
  }
});

// Terminal Drawer
btnToggleLogs.addEventListener('click', () => {
  terminalDrawer.classList.toggle('collapsed');
});

btnCloseTerminal.addEventListener('click', () => {
  terminalDrawer.classList.add('collapsed');
});

btnClearLogs.addEventListener('click', () => {
  terminalBody.innerHTML = '';
  logEntries = [];
  appendLog({ level: 'system', message: 'Konsol temizlendi.' });
});

btnCopyLogs.addEventListener('click', () => {
  navigator.clipboard.writeText(logEntries.join('\n'));
  showToast('Günlükler panoya kopyalandı.');
});

// Ayarlar Modalı Aç / Kapat
btnOpenSettings.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
});

btnCloseSettings.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

btnCancelSettings.addEventListener('click', () => {
  populateConfigUI(appConfig);
  settingsModal.classList.add('hidden');
});

// Şifre Göster/Gizle Butonları
document.querySelectorAll('.btn-toggle-pass').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = '🔒';
    } else {
      input.type = 'password';
      btn.textContent = '👁️';
    }
  });
});

// Ayarlar Sekmeleri
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(tabId).classList.add('active');
  });
});

// Binary Testi
btnTestBinary.addEventListener('click', async () => {
  const pathVal = document.getElementById('cfg-openfortivpnPath').value.trim();
  binaryTestResult.textContent = 'Kontrol ediliyor...';
  binaryTestResult.className = 'test-feedback';

  const res = await window.api.testBinary(pathVal);
  if (res.exists) {
    binaryTestResult.textContent = `✅ Program mevcut ve erişilebilir: ${res.path}`;
    binaryTestResult.className = 'test-feedback success';
  } else {
    binaryTestResult.textContent = `❌ Belirtilen konumda dosya bulunamadı: ${res.path}`;
    binaryTestResult.className = 'test-feedback error';
  }
});

// Mail.app Testi
btnTestMail.addEventListener('click', async () => {
  mailTestResult.textContent = 'Mail.app sorgulanıyor...';
  mailTestResult.className = 'test-feedback';

  const res = await window.api.testMail();
  if (res.success) {
    mailTestResult.textContent = `✅ Mail.app erişildi! ${res.accountCount} Hesap (${res.accounts}), ${res.mailboxCount} Posta Kutusu aktif.`;
    mailTestResult.className = 'test-feedback success';
  } else {
    mailTestResult.textContent = `❌ Mail.app hatası: ${res.error}`;
    mailTestResult.className = 'test-feedback error';
  }
});

// Ayarları Kaydet
btnSaveSettings.addEventListener('click', async () => {
  const newConfig = collectConfigFromUI();
  const res = await window.api.saveConfig(newConfig);
  if (res.success) {
    populateConfigUI(res.config);
    settingsModal.classList.add('hidden');
    showToast('Ayarlar başarıyla kaydedildi.');
  } else {
    showToast(`Hata: ${res.error}`);
  }
});

// Varsayılanlara Sıfırla
btnResetDefaults.addEventListener('click', async () => {
  if (confirm('Ayarları script içindeki orijinal varsayılanlara sıfırlamak istiyor musunuz?')) {
    const res = await window.api.resetConfig();
    if (res.success) {
      populateConfigUI(res.config);
      showToast('Varsayılan ayarlar yüklendi.');
    }
  }
});

// IPC Dinleyicileri
window.api.onStatusChanged((statusInfo) => {
  updateUI(statusInfo);
});

window.api.onLog((logEntry) => {
  appendLog(logEntry);
});

window.api.onTick((data) => {
  if (timerBadge && !timerBadge.classList.contains('hidden')) {
    timerText.textContent = formatDuration(data.duration);
  }
});

window.api.onOtpWaiting(() => {
  otpCard.classList.remove('hidden');
  manualOtpInput.focus();
});

window.api.onOtpProgress((prog) => {
  otpTimer.textContent = `${prog.remaining}s`;
});

window.api.onOpenSettings(() => {
  settingsModal.classList.remove('hidden');
});

// Başlangıç Yüklemesi
async function init() {
  try {
    const state = await window.api.getState();
    if (state.config) {
      populateConfigUI(state.config);
    }
    updateUI(state);
  } catch (err) {
    console.error('Başlangıç yükleme hatası:', err);
  }
}

init();
