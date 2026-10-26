# Cipin CLI

AI coding agent di terminal, terhubung ke gateway [Cipincode](https://cipincode.com).

## Pasang

```sh
npm install -g cipincli
```

Butuh Node.js 18 atau lebih baru. Mendukung macOS, Linux, dan Windows (x64 dan arm64, kecuali Windows arm64).
Cek versi terpasang dengan `cipin --version`, dan versi terbaru di [Releases](https://github.com/cipincliofficial/cipincli/releases) atau `npm view cipincli version`.

Perbarui dengan menjalankan lagi `npm install -g cipincli@latest`.

## Pakai

```sh
cipin login     # buka browser, setujui, tempel kode XXXX-XXXX
cipin           # mulai
cipin whoami    # akun dan paket
cipin topup     # buka halaman top up
cipin logout
```

## Syarat penggunaan

Anda bisa login dengan akun gratis, tetapi Cipin CLI hanya menjawab saat ada **paket Unlimited** aktif.
Token gratis dan paket token tidak berlaku di Cipin CLI. Top up di https://cipincode.com/mbr/dashboard/topup.
Syarat & ketentuan lengkap: https://cipincode.com/syarat-ketentuan

## Rilis (untuk pengelola)

1. Naikkan `version` di `npm/package.json` (misal `2.1.5`).
2. `git tag v2.1.5 && git push origin v2.1.5`: GitHub Actions membangun binary semua platform dan membuat Release.
3. Setelah Release muncul: `cd npm && npm publish`.

Versi di npm, tag Git, dan `cipin --version` harus sama.

## Lisensi

MIT. Cipin CLI dikembangkan dari [opencode](https://github.com/anomalyco/opencode) (© opencode, MIT). Pemberitahuan lisensi asli ada di [LICENSE](LICENSE).
