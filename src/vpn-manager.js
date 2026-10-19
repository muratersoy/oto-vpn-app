const EventEmitter = require('events');
const { spawn, exec } = require('child_process');
const fs = require('fs');

const RUNNER_EXP_FILE = '/tmp/oto_vpn_runner.exp';
const MANUAL_OTP_FILE = '/tmp/oto_vpn_manual_otp.txt';
const POLL_MAIL_SCRIPT = '/tmp/oto_vpn_poll_mail.sh';

function escapeTcl(val) {
  if (val === undefined || val === null) return '';
  return String(val)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

function generatePollScript(keywords, maxWait) {
  const kwList = (keywords || 'fortinet')
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  const keywordConditions = kwList.length > 0
    ? kwList.map(k => `(sndr contains "${k}")`).join(' or ')
    : 'true';

  return `#!/bin/bash
START_EPOCH=$1
MAX_WAIT=\${2:-${maxWait || 90}}
POLL_INTERVAL=2
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # 1. Manuel OTP kontrolü (Kullanıcı arayüzden girdiyse anında al)
    if [ -f "${MANUAL_OTP_FILE}" ]; then
        MANUAL=$(cat "${MANUAL_OTP_FILE}" 2>/dev/null | tr -dc '0-9')
        if [ \${#MANUAL} -ge 6 ]; then
            echo "$MANUAL"
            exit 0
        fi
    fi

    # 2. Mail.app Gelen Kutusu (Inbox) doğrudan kontrolü (Hızlı: ~50ms)
    RAW=$(osascript 2>/dev/null <<APPLESCRIPT
set startEpoch to $START_EPOCH
tell application "Mail"
    set cutoffDate to (current date) - ((do shell script "date +%s") as integer - startEpoch)
    try
        set msgList to messages 1 through 15 of inbox
        repeat with m in msgList
            if date received of m >= cutoffDate then
                set sndr to (sender of m as string)
                if (${keywordConditions}) then
                    return (subject of m as string) & " " & (content of m as string)
                end if
            end if
        end repeat
    end try
    return ""
end tell
APPLESCRIPT
)

    OTP=$(echo "$RAW" | grep -oE '[0-9]{6}' | head -n 1)
    if [ -n "$OTP" ]; then
        echo "$OTP"
        exit 0
    fi

    sleep $POLL_INTERVAL
    ELAPSED=$((ELAPSED + POLL_INTERVAL))
done
exit 1
`;
}

class VPNManager extends EventEmitter {
  constructor() {
    super();
    this.status = 'disconnected';
    this.process = null;
    this.startTime = null;
    this.timerInterval = null;
    this.currentDuration = 0;
    this.activeConfig = null;
    this.lastError = null;
    this.otpCountdownTimer = null;
  }

  getStatus() {
    return {
      status: this.status,
      startTime: this.startTime,
      duration: this.currentDuration,
      error: this.lastError
    };
  }

  setStatus(newStatus, error = null) {
    if (this.status === newStatus && !error) return;
    this.status = newStatus;
    this.lastError = error;

    if (newStatus === 'connected') {
      this.stopOtpCountdown();
      this.startTime = Date.now();
      this.startDurationTimer();
    } else if (newStatus === 'disconnected' || newStatus === 'error') {
      this.stopOtpCountdown();
      this.stopDurationTimer();
      this.startTime = null;
      this.currentDuration = 0;
    } else if (newStatus === 'waiting_otp') {
      this.startOtpCountdown(this.activeConfig?.mailTimeout || 90);
    }

    this.emit('status-changed', {
      status: this.status,
      startTime: this.startTime,
      duration: this.currentDuration,
      error: this.lastError
    });
  }

  startDurationTimer() {
    this.stopDurationTimer();
    this.timerInterval = setInterval(() => {
      if (this.startTime) {
        this.currentDuration = Math.floor((Date.now() - this.startTime) / 1000);
        this.emit('tick', { duration: this.currentDuration });
      }
    }, 1000);
  }

  stopDurationTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  startOtpCountdown(totalSeconds) {
    this.stopOtpCountdown();
    let remaining = totalSeconds;
    this.emit('otp-progress', { remaining });
    this.otpCountdownTimer = setInterval(() => {
      remaining--;
      if (remaining >= 0) {
        this.emit('otp-progress', { remaining });
      } else {
        this.stopOtpCountdown();
      }
    }, 1000);
  }

  stopOtpCountdown() {
    if (this.otpCountdownTimer) {
      clearInterval(this.otpCountdownTimer);
      this.otpCountdownTimer = null;
    }
  }

  submitManualOTP(otp) {
    const clean = (otp || '').trim().replace(/[^0-9]/g, '');
    if (!clean) return false;
    try {
      fs.writeFileSync(MANUAL_OTP_FILE, clean, 'utf8');
      this.emit('log', { level: 'info', message: `✍️ Manuel 2FA kodu girildi: ${clean}` });
      return true;
    } catch (err) {
      this.emit('log', { level: 'error', message: `Manuel 2FA yazma hatası: ${err.message}` });
      return false;
    }
  }

  async connect(config) {
    if (this.status === 'connected' || this.status === 'connecting' || this.status === 'waiting_otp') {
      return { success: false, message: 'VPN zaten bağlanıyor veya bağlı durumda.' };
    }

    this.activeConfig = config;
    this.setStatus('connecting');
    this.emit('log', { level: 'info', message: '🚀 VPN bağlantı süreci başlatılıyor...' });

    if (!config.vpnHost || !config.vpnUser) {
      const err = 'VPN sunucu adresi veya kullanıcı adı eksik. Lütfen Ayarlar bölümünden doldurun.';
      this.emit('log', { level: 'error', message: `❌ ${err}` });
      this.setStatus('error', err);
      return { success: false, error: err };
    }

    const binPath = config.openfortivpnPath || '/opt/homebrew/bin/openfortivpn';
    if (!fs.existsSync(binPath)) {
      const err = `openfortivpn dosyası bulunamadı: ${binPath}`;
      this.emit('log', { level: 'error', message: `❌ ${err}` });
      this.setStatus('error', err);
      return { success: false, error: err };
    }

    // Temizle
    try {
      if (fs.existsSync(MANUAL_OTP_FILE)) fs.unlinkSync(MANUAL_OTP_FILE);
    } catch (e) {}

    // Doğrudan Mail.app inbox dinleyen scripti yaz
    const pollScriptContent = generatePollScript(config.mailSenderKeywords, config.mailTimeout);
    try {
      fs.writeFileSync(POLL_MAIL_SCRIPT, pollScriptContent, { mode: 0o755 });
    } catch (err) {
      const msg = `Poll script yazılamadı: ${err.message}`;
      this.emit('log', { level: 'error', message: `❌ ${msg}` });
      this.setStatus('error', msg);
      return { success: false, error: msg };
    }

    const startEpoch = Math.floor(Date.now() / 1000 - 10);
    const maxWait = config.mailTimeout || 90;
    const certArg = (config.vpnCert && config.vpnCert.trim())
      ? `--trusted-cert=${escapeTcl(config.vpnCert.trim())}`
      : '';

    // Expect script içeriğini oluştur
    const expScript = `#!/usr/bin/expect -f
set timeout -1

set vpn_host {${escapeTcl(config.vpnHost)}}
set vpn_user {${escapeTcl(config.vpnUser)}}
set vpn_pass {${escapeTcl(config.vpnPass)}}
set cert_arg {${certArg}}
set mac_pass {${escapeTcl(config.macPass)}}
set openfortivpn_bin {${escapeTcl(binPath)}}
set poll_script {${escapeTcl(POLL_MAIL_SCRIPT)}}
set start_epoch {${startEpoch}}
set max_wait {${maxWait}}

send_user "\\n===STATUS:STARTING===\\n"

spawn sudo -S $openfortivpn_bin $vpn_host --username=$vpn_user --password=$vpn_pass $cert_arg

expect {
    -re "(?i)(password for|şifre|password:)" {
        send_user "\\n===STATUS:SUDO_PROMPT===\\n"
        if {$mac_pass != ""} {
            send "$mac_pass\\r"
        }
        exp_continue
    }
    -re "(?i)(Two-factor|Token|token|OTP|code).*?:" {
        send_user "\\n===STATUS:WAITING_OTP===\\n"
        set otp ""
        if {[catch {exec /bin/bash "$poll_script" "$start_epoch" "$max_wait"} res]} {
            send_user "\\n===STATUS:OTP_ERROR: $res===\\n"
            set otp ""
        } else {
            set otp [string trim $res]
        }
        
        if {$otp != ""} {
            send_user "\\n===STATUS:SENDING_OTP: $otp===\\n"
            send "$otp\\r"
        } else {
            send_user "\\n===STATUS:OTP_TIMEOUT===\\n"
        }
        exp_continue
    }
    -re "Tunnel is up and running." {
        send_user "\\n===STATUS:CONNECTED===\\n"
        exp_continue
    }
    -re "(?i)Authentication failed" {
        send_user "\\n===STATUS:AUTH_FAILED===\\n"
        exit 1
    }
    -re "(?i)Closed connection to gateway" {
        send_user "\\n===STATUS:GATEWAY_CLOSED===\\n"
        exit 0
    }
    -re "(?i)Wrong password|incorrect password" {
        send_user "\\n===STATUS:PASSWORD_ERROR===\\n"
        exit 1
    }
    eof {
        send_user "\\n===STATUS:EOF===\\n"
        exit 0
    }
}
`;

    try {
      fs.writeFileSync(RUNNER_EXP_FILE, expScript, { mode: 0o755 });
    } catch (err) {
      const msg = `Expect script yazılamadı: ${err.message}`;
      this.emit('log', { level: 'error', message: `❌ ${msg}` });
      this.setStatus('error', msg);
      return { success: false, error: msg };
    }

    const cmd = config.preventSleep ? '/usr/bin/caffeinate' : '/usr/bin/expect';
    const args = config.preventSleep ? ['-i', '/usr/bin/expect', RUNNER_EXP_FILE] : [RUNNER_EXP_FILE];

    this.emit('log', { level: 'info', message: `📡 openfortivpn çalıştırılıyor (${config.vpnHost})...` });

    try {
      this.process = spawn(cmd, args, {
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`
        }
      });
    } catch (err) {
      const msg = `Süreç başlatma hatası: ${err.message}`;
      this.emit('log', { level: 'error', message: `❌ ${msg}` });
      this.setStatus('error', msg);
      return { success: false, error: msg };
    }

    this.process.stdout.on('data', (data) => {
      this.handleProcessOutput(data.toString());
    });

    this.process.stderr.on('data', (data) => {
      this.handleProcessOutput(data.toString(), true);
    });

    this.process.on('error', (err) => {
      this.emit('log', { level: 'error', message: `Process hatası: ${err.message}` });
      this.setStatus('error', err.message);
    });

    this.process.on('close', (code) => {
      this.emit('log', { level: 'info', message: `VPN süreci kapandı (Çıkış kodu: ${code})` });
      this.process = null;
      if (this.status !== 'disconnected') {
        this.setStatus('disconnected');
      }
    });

    return { success: true };
  }

  handleProcessOutput(text, isStderr = false) {
    const lines = text.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.includes('===STATUS:WAITING_OTP===')) {
        this.setStatus('waiting_otp');
        this.emit('log', { level: 'warn', message: '⏳ Sunucu 2FA kodu istiyor! Mail.app dinleniyor...' });
        this.emit('otp-waiting');
        continue;
      }

      if (line.includes('===STATUS:SENDING_OTP:')) {
        const match = line.match(/===STATUS:SENDING_OTP:\s*([^=]+)===/);
        const code = match ? match[1].trim() : '******';
        this.emit('log', { level: 'success', message: `🔑 2FA kodu sunucuya iletiliyor: ${code}` });
        this.setStatus('connecting');
        continue;
      }

      if (line.includes('===STATUS:CONNECTED===') || line.includes('Tunnel is up and running.')) {
        this.setStatus('connected');
        this.emit('log', { level: 'success', message: '🎉 Güvenli VPN tüneli başarıyla kuruldu!' });
        continue;
      }

      if (line.includes('===STATUS:AUTH_FAILED===') || line.includes('Authentication failed')) {
        this.emit('log', { level: 'error', message: '❌ Kimlik doğrulama başarısız! Kullanıcı adı veya şifreyi kontrol edin.' });
        this.setStatus('error', 'Kimlik doğrulama başarısız.');
        continue;
      }

      if (line.includes('===STATUS:SUDO_PROMPT===')) {
        this.emit('log', { level: 'info', message: '🔐 Mac sudo yetkisi sağlandı.' });
        continue;
      }

      if (line.includes('===STATUS:GATEWAY_CLOSED===') || line.includes('Closed connection to gateway')) {
        this.emit('log', { level: 'warn', message: '⚠️ Ağ geçidi bağlantısı kapattı.' });
        this.setStatus('disconnected');
        continue;
      }

      if (line.includes('===STATUS:STARTING===') || line.includes('===STATUS:EOF===')) {
        continue;
      }

      const level = isStderr ? 'warn' : 'info';
      this.emit('log', { level, message: line });
    }
  }

  async disconnect() {
    if (this.status === 'disconnected') {
      return { success: true };
    }

    this.setStatus('disconnecting');
    this.emit('log', { level: 'info', message: '🛑 VPN bağlantısı sonlandırılıyor...' });

    if (this.process) {
      try {
        this.process.kill('SIGINT');
      } catch (e) {}
    }

    const macPass = this.activeConfig?.macPass || '';
    const killCmd = macPass
      ? `echo "${macPass}" | sudo -S pkill -INT -f "openfortivpn"`
      : `sudo pkill -INT -f "openfortivpn"`;
    await new Promise((resolve) => {
      exec(killCmd, () => {
        resolve();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 1200));

    await new Promise((resolve) => {
      exec(`pgrep -f "openfortivpn"`, (err, stdout) => {
        if (stdout && stdout.trim()) {
          const forceKillCmd = macPass
            ? `echo "${macPass}" | sudo -S pkill -9 -f "openfortivpn"`
            : `sudo pkill -9 -f "openfortivpn"`;
          exec(forceKillCmd, () => {
            resolve();
          });
        } else {
          resolve();
        }
      });
    });

    try {
      if (fs.existsSync(RUNNER_EXP_FILE)) fs.unlinkSync(RUNNER_EXP_FILE);
      if (fs.existsSync(MANUAL_OTP_FILE)) fs.unlinkSync(MANUAL_OTP_FILE);
      if (fs.existsSync(POLL_MAIL_SCRIPT)) fs.unlinkSync(POLL_MAIL_SCRIPT);
    } catch (e) {}

    this.process = null;
    this.setStatus('disconnected');
    this.emit('log', { level: 'info', message: '✅ VPN bağlantısı tamamen kesildi.' });
    return { success: true };
  }
}

module.exports = { VPNManager };
