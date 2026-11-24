Roadmap & Issue Tracker — Maera
Diperbarui: 23 November 2026

Legenda: [x] selesai & terverifikasi di lokal · [~] selesai di sandbox, menunggu verifikasi lokal · [ ] terbuka.

Label: core, ui, cli, docs, ci, release, test, dx, tooling, a11y, perf, enhancement.

Checkpoint Sesi Berikutnya (Tutup Status [~])
Terapkan 3 file yang tertunda di repositori lokal (pastikan penamaan di dalamnya sudah memakai @maera-js/* dan *.maera sesuai repo saat ini):

packages/cli/src/bin.ts (dukungan file .maera bebas & output 1 file HTML mandiri)

packages/cli/package.json (tambah dependensi @maera-js/core dan @maera-js/ui)

package.json root (urutan build core -> ui -> cli; skrip demo diganti example)

Verifikasi lokal:
Jalankan npm install, npm run build, npm test, npm run typecheck, npm run example, buka dist/example.html, dan tes npm run dev. Jika tampilannya benar, ubah seluruh [~] di bawah menjadi [x] lalu commit.

Selesai ([x])
[x] [core] Compiler index.maera (parse YAML, validasi, resolve binding) dengan pelacak nomor baris pada error.

[x] [core] Reactive store pub-sub (set, get, getBinding, history, historyOf, sub, subBinding).

[x] [core] Source mock (random walk) dan rest (polling GET, path, headers).

[x] [core] state: dan steps: dengan text dan status (ok, info, warning, danger); evaluate() murni (28 tes core lolos).

[x] [ui] mount(), grid 12 kolom, tema terang/gelap lewat --m-*, widget stat, gauge, text.

[x] [cli] Paket @maera-js/cli dengan maera dev dan maera build awal.

[x] [tooling] Highlighting YAML untuk *.maera (.vscode/settings.json, .gitattributes).

[x] [repo] Monorepo memakai npm workspaces, inisialisasi git selesai, dan file examples/demo.* lama sudah dibersihkan (examples/index.maera aktif).

Menunggu Konfirmasi Lokal ([~])
[~] [ui] Widget status (titik dan label) dan chart (garis SVG dari riwayat store, sumbu Y dari min/max atau data).

[~] [ui] state:/steps: dipasang ke status, gauge, stat: status mewarnai kartu lewat data-status (--m-status), text tampil sebagai keterangan.

[~] [cli] Hardening: subcommand salah ditolak, --help, fallback port 3000-3009, bind 127.0.0.1 (env HOST/PORT), error build tanpa stack trace, Ctrl+C membersihkan.

[~] [cli] maera dev <file.maera> dan maera build menjadi 1 file HTML mandiri (jalan lewat file://, tanpa request keluar, live reload di dev, error compile tampil di halaman).

Catatan Perubahan Tidak Kompatibel (Pra-Rilis): Properti threshold di level widget status dihapus (diganti state.threshold); skrip demo diganti example; maera dev tidak lagi menulis examples/demo.bundle.js.

Rilis v0.1 — Stabilisasi & Kualitas Inti
Issue #1: Tolak kunci tidak dikenal pada app, source, dan widget
Label: core, dx

Konteks: state dan steps sudah melaporkan UNKNOWN_KEY, tetapi salah ketik seperti titel: atau colums: pada level app, source, atau widget masih diabaikan diam-diam.

Kriteria Selesai:

UNKNOWN_KEY dengan nomor baris dilaporkan untuk app, setiap source, dan setiap widget.

Pesan error menyertakan daftar kunci yang valid untuk blok tersebut.

Issue #2: Tes DOM renderer & audit kontras warna tema terang
Label: ui, test, a11y

Konteks: Renderer baru diverifikasi manual di browser, dan rasio kontras warna --m-warning pada tema terang berpotensi di bawah standar aksesibilitas.

Kriteria Selesai:

Tes otomatis (happy-dom atau jsdom) mencakup perubahan data-status & caption dari state/steps, status titik on/off/unknown, dan pelepasan semua subscription/timer saat destroy().

Rasio kontras minimal 4,5:1 terverifikasi untuk keempat status (ok, info, warning, danger) pada tema terang dan gelap (atau nilai warna --m-* disesuaikan).

Issue #3: Setup GitHub Actions CI (Linux & Windows)
Label: ci

Konteks: Repositori sudah berada di GitHub; otomatisasi dibutuhkan untuk mencegah regresi path khusus Windows (seperti kasus check-example.ts).

Kriteria Selesai:

Workflow berjalan pada setiap push dan pull_request dengan matriks Node 18, 20, 22 pada OS ubuntu-latest dan windows-latest.

Urutan eksekusi wajib: npm ci -> npm run build -> npm test -> npm run typecheck -> npm run check:example (build harus sebelum typecheck agar tipe packages/core/dist tersedia).

Rilis v0.2 — Fitur Fase 3
Issue #4: Source real-time WebSocket dan MQTT over WebSocket
Label: core, fase-3

Kriteria Selesai:

type: websocket dan type: mqtt (url, topic, path) tervalidasi di compiler lengkap dengan nomor baris.

Mendukung auto-reconnect dengan strategi backoff, dan stop() menutup koneksi dengan bersih.

Dilengkapi pengujian otomatis menggunakan server tiruan (mock server).

Issue #5: Jalur tulis store & widget kontrol interaktif (switch, slider)
Label: core, ui, fase-3

Konteks: Dibutuhkan jalur pengiriman perintah dari UI kembali ke source yang belum tersedia di @maera-js/core.

Kriteria Selesai:

API tulis (write / publish) pada @maera-js/core dirancang dan didokumentasikan lebih dulu.

Widget switch dan slider terimplementasi di @maera-js/ui dengan indikator status "menunggu konfirmasi" serta penanganan jika pengiriman gagal.

Issue #6: Generator JSON Schema untuk *.maera
Label: tooling, fase-3

Konteks: Dikerjakan setelah spesifikasi widget/source di Issue #1 dan #5 stabil.

Kriteria Selesai:

Skema JSON dihasilkan dari satu sumber kebenaran (WIDGET_SPECS, STATUS_LEVELS) agar tidak terjadi duplikasi aturan.

VS Code memberikan autocomplete (misal type: gauge, status: warning) dan garis merah untuk nilai yang tidak valid pada file *.maera.

Rilis v1.0 — Dokumentasi & Publikasi
Issue #7: Dokumentasi referensi sintaks index.maera
Label: docs

Konteks: README saat ini perlu dilengkapi referensi teknis menyeluruh terkait state, steps, status, dan CLI. (Catatan: pembangunan situs Live Playground dipisah menjadi issue tersendiri agar dokumentasi inti cepat rilis).

Kriteria Selesai:

Halaman referensi sintaks mencakup semua widget, source, state, steps, daftar status, aturan at inklusif, serta perbedaan on/off (boolean) vs state/steps (angka).

Seluruh contoh di README.md sinkron dan teruji dengan examples/index.maera.

Issue #8: Persiapan publikasi paket @maera-js/* ke npm
Label: release

Kriteria Selesai:

Ketersediaan organisasi/scope @maera di registry npm sudah diverifikasi dan didaftarkan.

Konfigurasi files dan exports tiap paket diverifikasi menggunakan npm pack --dry-run.

Versi dependensi @maera-js/cli terhadap @maera-js/core dan @maera-js/ui sinkron.

CHANGELOG.md tersedia dan mencatat perubahan tidak kompatibel pra-rilis.

Backlog & Peningkatan Opsional (Prioritas Rendah)
Issue #9 (ui, enhancement): Migrasi styling ke Tailwind CSS v4 dengan @theme dipetakan ke variabel --m-* (tampilan terang/gelap identik, tema tetap bisa ditimpa lewat CSS variables).   
Teks

Issue #10 (cli, perf, enhancement): Pra-kompilasi AST saat maera build menjadi JSON statis (mount(ast)) agar js-yaml tidak ikut dibundel dan ukuran HTML mengecil (maera dev tetap kompilasi di browser).

Issue #11 (cli, dx, enhancement): HMR pada maera dev yang mempertahankan riwayat store saat file .maera disimpan (tanpa reset grafik akibat location.reload()).

Issue #12 (core, ui, enhancement): Dukungan state/steps untuk nilai non-angka (teks dan boolean lewat equal) tanpa menambah bentuk sintaks ketiga.

Issue #13 (core, enhancement): Pelacak nomor baris untuk YAML gaya flow ({a: 1}) atau dokumentasi resmi sebagai batasan parser.

Issue #14 (docs, enhancement): Situs dokumentasi interaktif & Live Playground di browser dengan tampilan error compile bernomor baris.   
Teks

Catatan Keputusan Arsitektur (Tetap Berlaku)
Monorepo: Menggunakan npm workspaces (bukan pnpm).

Evaluasi Kondisi: state dan steps keduanya memakai text dan status. at bersifat inklusif (nilai >= at), urutan penulisan bebas, satu langkah tanpa at menjadi cadangan (fallback). Jika equal tidak ditulis, nilai tepat di threshold dihitung sebagai above.

Batasan Kondisi: state dan steps tidak boleh digunakan bersamaan pada satu widget, dan hanya didukung oleh widget status, gauge, dan stat. Logika gabungan (AND/OR, lintas-source) sengaja ditiadakan demi kesederhanaan sintaks.

Perilaku CLI: maera build memvalidasi file lebih dulu dan membatalkan proses jika ada error, sedangkan maera dev merender pesan error langsung di halaman browser agar file tetap bisa diedit secara langsung.