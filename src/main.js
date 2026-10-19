const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig, getDefaults } = require('./config-manager');
const { VPNManager } = require('./vpn-manager');
const { testMailAccess } = require('./mail-poller');

let mainWindow = null;
let tray = null;
let vpnManager = null;
let currentConfig = null;
let isQuitting = false;

// Global hata yakalama
process.on('uncaughtException', (err) => {
  console.error('Main uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Main unhandledRejection:', reason);
});

// macOS tek örnek kilidi
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function getTrayIcon(status) {
  const assetsDir = path.join(__dirname, '..', 'assets');
  let iconName = 'tray-disconnected.png';
  if (status === 'connected') {
    iconName = 'tray-connected.png';
  }
  const iconPath = path.join(assetsDir, iconName);
  
  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    icon.setTemplateImage(false);
    return icon;
  }
  return null;
}

function updateDock(status) {
  if (process.platform === 'darwin' && app.dock) {
    const iconName = status === 'connected' ? 'dock-connected.png' : 'dock-disconnected.png';
    const iconPath = path.join(__dirname, '..', 'assets', iconName);
    if (fs.existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath);
      app.dock.setIcon(img);
    }
  }
}

function updateTray(statusInfo) {
  const status = statusInfo ? statusInfo.status : 'disconnected';
  
  // Dock ikonunu güncelle (macOS alt bar)
  updateDock(status);

  if (!tray) return;

  const icon = getTrayIcon(status);
  if (icon) {
    tray.setImage(icon);
  }

  let statusText = 'Bağlantı Kesildi 🔴';
  if (status === 'connected') statusText = `Bağlı 🟢 (${currentConfig?.vpnHost || 'VPN'})`;
  else if (status === 'connecting') statusText = 'Bağlanıyor... 🟡';
  else if (status === 'waiting_otp') statusText = '2FA Bekleniyor... 🟡';
  else if (status === 'disconnecting') statusText = 'Kesiliyor... 🟡';

  tray.setToolTip(`OtoVPN: ${statusText}`);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Durum: ${statusText}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'VPN\'e Bağlan',
      enabled: status === 'disconnected' || status === 'error',
      click: () => {
        handleConnect();
      }
    },
    {
      label: 'Bağlantıyı Kes',
      enabled: status === 'connected' || status === 'connecting' || status === 'waiting_otp',
      click: () => {
        handleDisconnect();
      }
    },
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.isVisible() ? 'Pencereyi Gizle' : 'Pencereyi Göster',
      click: () => {
        toggleWindow();
      }
    },
    {
      label: 'Ayarlar...',
      click: () => {
        showWindow();
        if (mainWindow) {
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Çıkış',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function showNotification(title, body) {
  if (!currentConfig || !currentConfig.notificationsEnabled) return;
  try {
    if (Notification.isSupported()) {
      const notifIcon = getTrayIcon(vpnManager ? vpnManager.status : 'disconnected');
      new Notification({
        title,
        body,
        icon: notifIcon
      }).show();
    }
  } catch (e) {
    console.error('Bildirim hatası:', e);
  }
}

function createWindow() {
  const initialIcon = path.join(__dirname, '..', 'assets', 'dock-disconnected.png');

  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 440,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    icon: initialIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!currentConfig || !currentConfig.startMinimized) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = getTrayIcon('disconnected');
  tray = new Tray(icon);

  tray.on('click', () => {
    toggleWindow();
  });

  updateTray({ status: 'disconnected' });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

async function handleConnect() {
  currentConfig = loadConfig();
  const res = await vpnManager.connect(currentConfig);
  return res;
}

async function handleDisconnect() {
  const res = await vpnManager.disconnect();
  return res;
}

app.whenReady().then(() => {
  currentConfig = loadConfig();
  vpnManager = new VPNManager();

  // Dock ikonunu başlangıçta kırmızı yap
  updateDock('disconnected');

  createTray();
  createWindow();

  vpnManager.on('status-changed', (statusInfo) => {
    updateTray(statusInfo);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn:status-changed', statusInfo);
    }

    if (statusInfo.status === 'connected') {
      showNotification('OtoVPN Bağlandı 🟢', `Güvenli VPN tüneli kuruldu: ${currentConfig.vpnHost}`);
    } else if (statusInfo.status === 'disconnected') {
      showNotification('OtoVPN Bağlantısı Koptu 🔴', 'VPN tüneli kapandı veya kesildi.');
      
      if (currentConfig.autoReconnect && !isQuitting) {
        showNotification('OtoVPN', 'Bağlantı koptuğu için otomatik yeniden bağlanılıyor...');
        setTimeout(() => handleConnect(), 3000);
      }
    } else if (statusInfo.status === 'error') {
      showNotification('OtoVPN Hatası ⚠️', statusInfo.error || 'Bağlantı sırasında bir hata oluştu.');
    }
  });

  vpnManager.on('log', (logEntry) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn:log', logEntry);
    }
  });

  vpnManager.on('tick', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn:tick', data);
    }
  });

  vpnManager.on('otp-waiting', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn:otp-waiting');
    }
  });

  vpnManager.on('otp-progress', (prog) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vpn:otp-progress', prog);
    }
  });

  if (currentConfig.autoConnect) {
    setTimeout(() => {
      handleConnect();
    }, 1500);
  }
});

// macOS'ta pencereler kapansa bile çıkma
app.on('window-all-closed', () => {});

app.on('before-quit', async (e) => {
  if (vpnManager && vpnManager.status !== 'disconnected' && !isQuitting) {
    e.preventDefault();
    isQuitting = true;
    try {
      await vpnManager.disconnect();
    } catch (err) {}
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    showWindow();
  }
});

// IPC Dinleyicileri
ipcMain.handle('vpn:get-state', () => {
  return {
    ...vpnManager.getStatus(),
    config: currentConfig
  };
});

ipcMain.handle('vpn:connect', async () => {
  return await handleConnect();
});

ipcMain.handle('vpn:disconnect', async () => {
  return await handleDisconnect();
});

ipcMain.handle('vpn:submit-otp', (event, otp) => {
  return vpnManager.submitManualOTP(otp);
});

ipcMain.handle('config:get', () => {
  currentConfig = loadConfig();
  return currentConfig;
});

ipcMain.handle('config:save', (event, newConfig) => {
  const res = saveConfig(newConfig);
  if (res.success) {
    currentConfig = res.config;
    updateTray(vpnManager.getStatus());
  }
  return res;
});

ipcMain.handle('config:reset', () => {
  const defaults = getDefaults();
  const res = saveConfig(defaults);
  if (res.success) {
    currentConfig = res.config;
    updateTray(vpnManager.getStatus());
  }
  return res;
});

ipcMain.handle('test:mail', async () => {
  return await testMailAccess();
});

ipcMain.handle('test:binary', (event, binPath) => {
  const p = binPath || currentConfig.openfortivpnPath || '/opt/homebrew/bin/openfortivpn';
  return {
    exists: fs.existsSync(p),
    path: p
  };
});

ipcMain.handle('app:hide', () => {
  if (mainWindow) mainWindow.hide();
});

ipcMain.handle('app:quit', () => {
  isQuitting = true;
  app.quit();
});
