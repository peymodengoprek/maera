# Changelog

Semua perubahan penting pada proyek ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/) dan
proyek ini memakai [Semantic Versioning](https://semver.org/lang/id/).

## [0.3.0] - 2026-11-24

Rilis awal paket `@maera/core`, `@maera/ui`, dan `@maera/cli`.

### Added

#### `@maera/core`

- Compiler `*.maera` berbasis YAML dengan validasi skema, pelacakan nomor baris,
  dan penolakan kunci tidak dikenal pada `app`, `source`, dan `widget`.
- Reactive store pub-sub (`set`, `get`, `getBinding`, `history`, `historyOf`,
  `sub`, `subBinding`) beserta jalur tulis (`write`/`publish`) untuk kontrol
  interaktif.
- Data source `mock`, `rest`, `websocket`, dan `mqtt` over WebSocket, termasuk
  auto-reconnect dengan backoff dan penutupan koneksi yang bersih.
- Kondisi `state:` dan `steps:` untuk memetakan nilai numerik ke `text` dan
  `status` (`ok`, `info`, `warning`, `danger`), dengan `at` inklusif dan urutan
  langkah yang bebas.
- Generator JSON Schema untuk `*.maera` dari satu sumber kebenaran
  (`WIDGET_SPECS`, `STATUS_LEVELS`).

#### `@maera/ui`

- Renderer DOM/SVG tanpa framework dengan grid 12 kolom dan tema terang/gelap
  melalui variabel CSS `--m-*`.
- Widget `stat`, `gauge`, `text`, `status`, `chart`, `switch`, dan `slider`.
- Integrasi `state:`/`steps:` pada `stat`, `gauge`, dan `status`, termasuk
  pewarnaan kartu lewat `data-status`.
- Widget kontrol interaktif `switch` dan `slider` dengan indikator status
  "menunggu konfirmasi" dan penanganan kegagalan pengiriman.

#### `@maera/cli`

- Perintah `maera dev` dengan dev server, live reload, fallback port
  `3000`-`3009`, serta `HOST`/`PORT` yang dapat dikonfigurasi.
- Perintah `maera build` yang menghasilkan satu file HTML mandiri dan dapat
  dijalankan lewat `file://`.
- Perintah `maera schema` untuk menulis JSON Schema `*.maera`.
- Dukungan nama file `*.maera` bebas dan pembersihan resource saat `Ctrl+C`.

#### Tooling & CI

- Monorepo npm workspaces dengan urutan build `core` -> `ui` -> `cli`.
- Workflow GitHub Actions untuk Linux dan Windows pada Node.js 18, 20, dan 22
  yang menjalankan build, test, typecheck, dan pemeriksaan contoh.
- Highlighting YAML untuk `*.maera` di VS Code dan integrasi JSON Schema.

### Changed

- Skrip demo diganti dengan skrip `example` yang membangun
  `examples/index.maera` menjadi `dist/example.html`.
- `maera dev` tidak lagi menulis `examples/demo.bundle.js`.

### Breaking Changes (Pra-Rilis)

- Properti `status.threshold` di level widget **dihapus**. Gunakan
  `state.threshold` (atau `steps:`) sebagai gantinya. Konfigurasi lama yang
  masih memakai `status.threshold` akan ditolak oleh compiler.
- `state:` dan `steps:` tidak boleh dipakai bersamaan pada widget yang sama dan
  hanya didukung oleh `stat`, `gauge`, dan `status`.
