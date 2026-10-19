const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('vpn:get-state'),
  connect: () => ipcRenderer.invoke('vpn:connect'),
  disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  submitOTP: (otp) => ipcRenderer.invoke('vpn:submit-otp', otp),
  
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  
  testMail: () => ipcRenderer.invoke('test:mail'),
  testBinary: (path) => ipcRenderer.invoke('test:binary', path),
  
  hideApp: () => ipcRenderer.invoke('app:hide'),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  onStatusChanged: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('vpn:status-changed', sub);
    return () => ipcRenderer.removeListener('vpn:status-changed', sub);
  },

  onLog: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('vpn:log', sub);
    return () => ipcRenderer.removeListener('vpn:log', sub);
  },

  onTick: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('vpn:tick', sub);
    return () => ipcRenderer.removeListener('vpn:tick', sub);
  },

  onOtpWaiting: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('vpn:otp-waiting', sub);
    return () => ipcRenderer.removeListener('vpn:otp-waiting', sub);
  },

  onOtpProgress: (callback) => {
    const sub = (event, data) => callback(data);
    ipcRenderer.on('vpn:otp-progress', sub);
    return () => ipcRenderer.removeListener('vpn:otp-progress', sub);
  },

  onOpenSettings: (callback) => {
    const sub = () => callback();
    ipcRenderer.on('open-settings', sub);
    return () => ipcRenderer.removeListener('open-settings', sub);
  }
});
