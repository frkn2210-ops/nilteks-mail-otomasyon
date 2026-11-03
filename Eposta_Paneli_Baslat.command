#!/bin/bash
cd "$(dirname "$0")"

# Node.js PATH tanımlaması
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=========================================================="
echo "  🌿 NİLTEKS B2B DİJİTAL KATALOG & E-POSTA PANELİ"
echo "=========================================================="
echo ""
echo "  1. Node.js Sunucusu Başlatılıyor (Port 4000)..."
echo ""

PORT=${PORT:-4000}

# Eski çalışan port varsa temizle
lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true

# Sunucuyu arka planda başlat
node server.js &
SERVER_PID=$!

sleep 2

echo "  2. Tarayıcınızda Web Paneli Açılıyor..."
open "http://localhost:${PORT}"

echo ""
echo "  ========================================================"
echo "  ✓ PANEL BAŞARIYLA ÇALIŞIYOR"
echo "  ========================================================"
echo "  👉 Web Paneli        : http://localhost:${PORT}"
echo "  👉 Gönderim Modeli   : Modern Kurumsal Gönderim (Yeni Düzen)"
echo "  👉 Posta Sunucusu    : mail.niltex.com.tr:587"
echo "  👉 Gönderici Adres   : Furkan Aydın <furkan@niltex.com.tr>"
echo "  👉 Yanıt Adresi      : furkan@nilteks.com.tr"
echo "  👉 PDF Açılışı       : Tarayıcıda Doğrudan Açılış (Inline)"
echo "  👉 Yeni Outlook      : Doğrudan Uyumlu (.eml Taslak Desteği)"
echo "  ========================================================"
echo "  Paneli kapatmak istediğinizde bu Terminal penceresini kapatabilirsiniz."
echo ""

wait $SERVER_PID
