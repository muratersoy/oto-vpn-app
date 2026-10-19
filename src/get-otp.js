const fs = require('fs');
const path = require('path');
const { MailPoller } = require('./mail-poller');
const { loadConfig } = require('./config-manager');

const MANUAL_OTP_FILE = '/tmp/oto_vpn_manual_otp.txt';

// Argümanlar: startEpoch
const startEpoch = parseFloat(process.argv[2]) || (Date.now() / 1000 - 30);

// Config oku
const config = loadConfig();

// Eğer önceden kalmış manuel OTP dosyası varsa temizle
try {
  if (fs.existsSync(MANUAL_OTP_FILE)) {
    fs.unlinkSync(MANUAL_OTP_FILE);
  }
} catch (e) {}

const poller = new MailPoller({
  startEpoch,
  senderKeywords: config.mailSenderKeywords || 'fortinet',
  maxWait: config.mailTimeout || 90,
  pollInterval: config.mailPollInterval || 3,
  onLog: (msg) => {
    // stderr'e yaz ki stdout sadece OTP kodunu versin
    process.stderr.write(`${msg}\n`);
  },
  onProgress: (prog) => {
    process.stderr.write(`[PROGRESS:${prog.remaining}]\n`);
  }
});

// Manuel OTP kontrolü için periyodik kontrol
const manualCheckInterval = setInterval(() => {
  try {
    if (fs.existsSync(MANUAL_OTP_FILE)) {
      const manualCode = fs.readFileSync(MANUAL_OTP_FILE, 'utf8').trim().replace(/[^0-9]/g, '');
      if (manualCode && manualCode.length >= 6) {
        process.stderr.write(`Manuel OTP dosyadan okundu: ${manualCode}\n`);
        poller.setManualOtp(manualCode);
        clearInterval(manualCheckInterval);
      }
    }
  } catch (e) {}
}, 500);

poller.start().then((otp) => {
  clearInterval(manualCheckInterval);
  if (otp) {
    // Sadece OTP kodunu stdout'a bas (expect bunu yakalar)
    process.stdout.write(otp);
    process.exit(0);
  } else {
    process.exit(1);
  }
}).catch((err) => {
  clearInterval(manualCheckInterval);
  process.stderr.write(`Hata: ${err.message}\n`);
  process.exit(1);
});
