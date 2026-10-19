# OtoVPN — macOS Menubar & VPN Kontrolcüsü

`openfortivpn` için geliştirilmiş, 2FA/OTP kodlarını Apple Mail üzerinden otomatik yakalayan ve tüm ayarları arayüzden yönetilebilen modern **Electron** menubar (menü çubuğu) uygulamasıdır.

## Özellikler

- **Menü Çubuğu (Tray) Simgesi**:
  - 🟢 **Yeşil**: VPN tüneli kuruldu, aktif ve güvende.
  - 🔴 **Kırmızı**: VPN bağlantısı kapalı veya kesildi.
  - 🟡 **Sarı**: Bağlanıyor / 2FA kodu bekleniyor / Bağlantı kesiliyor.
- **Ayarlar Paneli**:
  - **VPN Sunucu Bilgileri**: Host:Port, Kullanıcı Adı, Şifre (gizle/göster), Güvenilen Sertifika Hash (SHA256 - opsiyonel).
  - **Sistem & Root Yetkisi**: Mac Sudo Şifresi (yalnızca yerel yapılandırma dosyasında saklanır), openfortivpn program yolu, Uyku engelleme (`caffeinate -i`).
  - **2FA & Mail.app**: Mail.app otomatik OTP kod dinleme (açık/kapalı), gönderen filtreleri (örn: `fortinet`), zaman aşımı süresi ve **"Mail.app Erişimini Test Et"** butonu.
  - **Otomasyon & Tercihler**: Açılışta otomatik bağlan, beklenmedik kopmada otomatik yeniden bağlan, sistem bildirimleri.
- **2FA Doğrulaması**:
  - Mail.app'e gelen doğrulama kodunu AppleScript ile otomatik okur ve anında VPN sürecine aktarır.
  - İstenirse ekrandaki kutucuktan manuel 6 haneli kod girişi de yapılabilir.
- **Canlı Terminal / Günlükler**:
  - openfortivpn çıktısını anlık olarak renkli konsolda gösterir. Kopyalama ve temizleme desteği sunar.

## Gereksinimler

- macOS (Apple Silicon veya Intel)
- [openfortivpn](https://github.com/adrienverge/openfortivpn):
  ```bash
  brew install openfortivpn
  ```

## Kurulum ve Çalıştırma

1. Depoyu klonlayın ve dizine girin:
   ```bash
   git clone https://github.com/muratersoy/oto-vpn-app.git
   cd oto-vpn-app
   ```

2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

3. Uygulamayı başlatın:
   ```bash
   npm start
   ```

4. İlk açılışta sağ üstteki dişli simgesinden (veya menü çubuğundan "Ayarlar..." seçeneğinden) VPN sunucu adresi ve kimlik bilgilerinizi kaydedin.

## Uygulama Paketi (.app) Oluşturma

macOS için bağımsız `.app` oluşturmak için:

```bash
npm run package
```

Paket oluşturulduktan sonra `dist/OtoVPN-darwin-arm64/OtoVPN.app` dosyasını `/Applications` klasörünüze taşıyabilirsiniz.

## Güvenlik & Gizlilik

- Uygulama kaynak kodunda **hiçbir sunucu adresi, kullanıcı adı, şifre veya sertifika bilgisi barındırılmaz**.
- Girilen tüm ayarlar yalnızca kullanıcının kendi bilgisayarında yerel olarak `~/.config/oto-vpn/config.json` dosyasında saklanır.
- Kodlar açık ve şeffaftır; harici hiçbir sunucuya veya üçüncü taraf servise telemetri/analitik verisi göndermez.

## Lisans

MIT
