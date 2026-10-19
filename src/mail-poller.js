const { execFile } = require('child_process');

/**
 * Mail.app üzerinde son gelen 2FA OTP kodunu arar
 */
function buildAppleScript(startEpoch, senderKeywords) {
  const keywords = (senderKeywords || 'fortinet')
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(Boolean);

  const keywordConditions = keywords.length > 0
    ? keywords.map(k => `(sndr contains "${k}")`).join(' or ')
    : 'true';

  return `
set matchedCode to ""
set cutoffEpoch to ${Math.floor(startEpoch)}

tell application "Mail"
    set cutoffDate to (current date) - ((do shell script "date +%s") as integer - cutoffEpoch)
    set latestDate to cutoffDate
    
    -- 1. Önce gelen kutularını tara
    try
        set inboxes to every mailbox whose name is "INBOX" or name is "Gelen Kutusu"
        repeat with aBox in inboxes
            try
                set recentMsgs to (messages of aBox whose date received >= cutoffDate)
                repeat with aMsg in recentMsgs
                    set sndr to (sender of aMsg as string)
                    if (${keywordConditions}) then
                        set msgDate to date received of aMsg
                        if msgDate >= latestDate then
                            set latestDate to msgDate
                            set msgBody to (content of aMsg as string)
                            set msgSubject to (subject of aMsg as string)
                            
                            if msgBody contains "authentication token code is " then
                                set AppleScript's text item delimiters to "authentication token code is "
                                set parts to text items of msgBody
                                if (count of parts) > 1 then
                                    set rawCode to text item 2 of parts
                                    set AppleScript's text item delimiters to {" ", ".", "\\n", return, "\\r"}
                                    set firstWord to text item 1 of rawCode
                                    if firstWord is not "" then
                                        set matchedCode to firstWord
                                    end if
                                end if
                            else if msgSubject contains "AuthCode:" then
                                set AppleScript's text item delimiters to "AuthCode:"
                                set parts to text items of msgSubject
                                if (count of parts) > 1 then
                                    set rawCode to text item 2 of parts
                                    set AppleScript's text item delimiters to {" ", ".", "\\n", return, "\\r"}
                                    set firstWord to text item 1 of rawCode
                                    if firstWord is not "" then
                                        set matchedCode to firstWord
                                    end if
                                end if
                            end if
                        end if
                    end if
                end repeat
            end try
        end repeat
    end try
    
    -- 2. Eğer gelen kutularında bulunamadıysa tüm posta kutularını tara
    if matchedCode is "" then
        set allBoxes to every mailbox of every account
        repeat with boxList in allBoxes
            repeat with aBox in boxList
                try
                    set recentMsgs to (messages of aBox whose date received >= cutoffDate)
                    repeat with aMsg in recentMsgs
                        set sndr to (sender of aMsg as string)
                        if (${keywordConditions}) then
                            set msgDate to date received of aMsg
                            if msgDate >= latestDate then
                                set latestDate to msgDate
                                set msgBody to (content of aMsg as string)
                                set msgSubject to (subject of aMsg as string)
                                if msgBody contains "authentication token code is " then
                                    set AppleScript's text item delimiters to "authentication token code is "
                                    set parts to text items of msgBody
                                    if (count of parts) > 1 then
                                        set rawCode to text item 2 of parts
                                        set AppleScript's text item delimiters to {" ", ".", "\\n", return, "\\r"}
                                        set firstWord to text item 1 of rawCode
                                        if firstWord is not "" then
                                            set matchedCode to firstWord
                                        end if
                                    end if
                                else if msgSubject contains "AuthCode:" then
                                    set AppleScript's text item delimiters to "AuthCode:"
                                    set parts to text items of msgSubject
                                    if (count of parts) > 1 then
                                        set rawCode to text item 2 of parts
                                        set AppleScript's text item delimiters to {" ", ".", "\\n", return, "\\r"}
                                        set firstWord to text item 1 of rawCode
                                        if firstWord is not "" then
                                            set matchedCode to firstWord
                                        end if
                                    end if
                                end if
                            end if
                        end if
                    end repeat
                end try
            end repeat
        end repeat
    end if
end tell
return matchedCode
  `;
}

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      resolve((stdout || '').trim());
    });
  });
}

/**
 * Mail.app bağlantı ve hesap test fonksiyonu
 */
async function testMailAccess() {
  const script = `
tell application "Mail"
    set accList to name of every account
    set accCount to count of accounts
    set mbCount to 0
    repeat with acc in every account
        set mbCount to mbCount + (count of mailboxes of acc)
    end repeat
    return (accCount as string) & "|||" & (accList as string) & "|||" & (mbCount as string)
end tell
  `;
  try {
    const raw = await runAppleScript(script);
    const parts = raw.split('|||');
    return {
      success: true,
      accountCount: parseInt(parts[0], 10) || 0,
      accounts: parts[1] || 'Hesap bulunamadı',
      mailboxCount: parseInt(parts[2], 10) || 0
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * 2FA OTP kodunu bulana kadar veya zaman aşımına uğrayana kadar Mail.app'i dinler
 */
class MailPoller {
  constructor(options = {}) {
    this.startEpoch = options.startEpoch || (Date.now() / 1000 - 5);
    this.senderKeywords = options.senderKeywords || 'fortinet';
    this.maxWait = options.maxWait || 90;
    this.pollInterval = options.pollInterval || 3;
    this.onLog = options.onLog || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.isCancelled = false;
    this.timer = null;
    this.manualOtp = null;
  }

  cancel() {
    this.isCancelled = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setManualOtp(otp) {
    this.manualOtp = (otp || '').trim();
  }

  async start() {
    let elapsed = 0;
    const script = buildAppleScript(this.startEpoch, this.senderKeywords);

    this.onLog(`📬 Mail.app dinleniyor (Maksimum bekleme: ${this.maxWait} sn, Başlangıç: ${new Date(this.startEpoch * 1000).toLocaleTimeString()})...`);

    while (elapsed < this.maxWait && !this.isCancelled) {
      if (this.manualOtp && this.manualOtp.length >= 6) {
        this.onLog(`✍️ Kullanıcı manuel 2FA kodu girdi: ${this.manualOtp}`);
        return this.manualOtp;
      }

      this.onProgress({
        elapsed,
        maxWait: this.maxWait,
        remaining: Math.max(0, this.maxWait - elapsed)
      });

      try {
        const rawCode = await runAppleScript(script);
        const cleanCode = (rawCode || '').replace(/[^0-9]/g, '');

        if (cleanCode && cleanCode.length >= 6) {
          this.onLog(`✅ Mail.app üzerinden yeni 2FA kodu bulundu: ${cleanCode}`);
          return cleanCode;
        }
      } catch (err) {
        this.onLog(`⚠️ Mail kontrolü uyarısı: ${err.message}`);
      }

      // Bekle
      await new Promise(resolve => {
        this.timer = setTimeout(resolve, this.pollInterval * 1000);
      });
      elapsed += this.pollInterval;
    }

    if (this.isCancelled) {
      this.onLog('⏹️ 2FA dinlemesi iptal edildi.');
      return null;
    }

    if (this.manualOtp && this.manualOtp.length >= 6) {
      return this.manualOtp;
    }

    this.onLog('⏰ 2FA bekleme süresi doldu (Kod bulunamadı).');
    return null;
  }
}

module.exports = {
  MailPoller,
  testMailAccess,
  runAppleScript
};
