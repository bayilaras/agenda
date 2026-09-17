# Verifikasi pengembang — 17 September 2026

## Perbaikan koneksi Google pada browser

- API Calendar yang belum aktif kini dibedakan dari penolakan izin kalender berdasarkan `accessNotConfigured` / `SERVICE_DISABLED`. Halaman login memberi petunjuk dan tautan aktivasi resmi; payload, token, dan URL dari respons Google tidak ditampilkan.
- Fixture lokal `tests/browser-google-errors.html` menguji alur login lengkap dengan respons 403 sintetis; halaman menampilkan penyebab API belum aktif, tombol pengaturan, serta diagnosis HTTP 403.
- Kegagalan pengguna direproduksi di Chromium: `fetch` bawaan yang disimpan sebagai metode objek melempar `Illegal invocation` sebelum mengirim request. Pesan aplikasi sama dengan laporan pengguna.
- Pemanggilan bawaan sekarang terikat ke `globalThis`. Laporan penutupan popup setelah token diterima juga tidak lagi membatalkan pembacaan kalender yang sedang berjalan.
- Dua tes regresi gagal sebelum perbaikan dan lulus sesudahnya. Fixture `tests/browser-google.html` memakai native fetch dengan data lokal sintetis: sebelum perbaikan 0 request dan koneksi gagal; sesudah perbaikan 3 request, sesi terhubung, daftar kalender dan kegiatan berhasil dibaca.
- Jalankan fixture lewat `npm run dev:pages`, lalu buka `http://127.0.0.1:5174/agenda/tests/browser-google.html`. Fixture hanya untuk pengembangan dan tidak disertakan dalam build Pages.
- Akses kalender Google nyata tetap memerlukan percobaan ulang oleh pemilik akun. Pengujian ini tidak memakai token atau data akun sebenarnya.

Lingkungan: Windows, Node.js 25.5.0, npm 11.8.0. API lokal Express, SQLite lokal, data sintetis. Pemeriksaan UI memakai browser Chromium di dalam Codex; pemeriksaan ini bukan sertifikasi lintas browser.

## Hasil yang dijalankan

- `npm run build`: kompilasi TypeScript dan build Vite berhasil.
- `npm test`: **80 lulus, 0 gagal** — 16 tes domain, 7 tes integrasi API server, 2 tes clipboard, 7 tes konfigurasi pribadi, 18 tes gateway Google browser, 9 tes klasifikasi error Google, 16 tes runtime browser, dan 5 tes IndexedDB.
- `npm install` terakhir: audit dependensi melaporkan 0 kerentanan.
- Browser: masuk demo, memilih profil secara eksplisit, memuat lima kegiatan, dan memblokir pilihan kegiatan privat.
- Browser: satu kegiatan lengkap dapat dibuat, peringatan pilihan sebagian harus diakui, konfirmasi isi mengaktifkan tombol Salin Pesan, dan promise clipboard berhasil menampilkan notifikasi yang benar.
- Browser: Pilih semua memilih empat kegiatan yang dapat dipilih. Kegiatan belum lengkap menghasilkan draf pemeriksaan dengan tiga kesalahan; Salin Pesan tetap nonaktif.
- Browser: memilih kesalahan Pokok agenda membuka formulir terkait, menggulir ke kolom tersebut, dan memindahkan fokus keyboard.
- Browser: perubahan belum tersimpan memunculkan dialog saat mengganti tanggal; Tetap di sini mempertahankan isian. Menyimpan pelengkap berhasil dan membatalkan kesiapan pratinjau lama.
- Browser: Hari ini, Besok, dan navigasi tanggal bekerja; tanggal akhir pekan tanpa kegiatan menampilkan keadaan kosong dan membersihkan pilihan serta draf.
- Responsif: tidak ada luapan horizontal pada viewport 320, 360, 768, 1024, dan 1440 piksel. Formulir terbuka juga diperiksa pada 360 piksel. Navigasi samping tersembunyi dari akses keyboard saat tertutup pada layar kecil.
- Tidak ada kesalahan JavaScript aplikasi pada log browser yang diperiksa setelah alur demo.
- Penyesuaian pribadi: build terbaru berhasil; browser menampilkan ruang kerja pribadi, formulir Email pemilik, dan panduan koneksi satu akun. Keluar dan masuk kembali ke demo berhasil. Akun pemilik nyata belum dibuat dan OAuth nyata belum diuji.

Tes API menggunakan Google yang disimulasikan untuk memeriksa pagination lengkap, gagal pada halaman lanjutan, perubahan sumber, pencabutan akses, penugasan pimpinan, CSRF, pemilik draf, revisi atomik, kedaluwarsa, enkripsi payload, dan audit metadata. Tes domain membandingkan string template, waktu, pengulangan awalan, kredensial, batas panjang, konflik, dan aturan bahan/kehadiran.

Tes konfigurasi pribadi memeriksa satu akun pemilik untuk semua profil yang dikonfigurasi, kata sandi benar/salah, ID pemilik, demo tanpa membuat kredensial, kompatibilitas role dan penugasan lama, penolakan owner yang tidak valid atau bercampur akun tim, serta persyaratan akun/HTTPS di produksi.

## Versi GitHub Pages

Pengujian Google browser menggunakan GIS/fetch yang disimulasikan: popup, persetujuan scope, token kedaluwarsa, pembatalan, pencabutan akses, pagination lengkap, batas waktu, zona waktu/DST, kerahasiaan acara, identitas kejadian berulang, serta nilai kredensial rapat yang dipertahankan persis.

Tes runtime browser memeriksa pemisahan akun/demo, persistensi tanpa token, konflik revisi, perubahan sumber/profil, draf kanonis, konfirmasi peringatan, kedaluwarsa, gagal offline/izin dicabut, pergantian akun saat request berjalan, kegagalan penyimpanan, validasi cadangan dan impor atomik. IndexedDB diuji dengan implementasi uji `fake-indexeddb` untuk persistensi antarinstans, serialisasi transaksi, pembatalan atomik, kegagalan clone, dan penyimpanan tidak tersedia.

Mode Pages menyimpan pelengkap lokal tanpa enkripsi server dan tanpa sinkronisasi antarperangkat. Cadangan berisi data profil/pelengkap dalam JSON biasa, tanpa token OAuth. Hasil simulasi bukan bukti persetujuan OAuth pada akun Google sebenarnya; origin JavaScript pada Google Cloud dan koneksi kalender nyata tetap perlu diuji oleh pemilik akun.

## Pemeriksaan yang masih memerlukan lingkungan penerapan

- OAuth dan pengambilan kegiatan dari akun Google Calendar organisasi nyata: belum dijalankan karena client OAuth dan pemetaan kalender belum disediakan.
- Pilot operator, keseluruhan 42 skenario penerimaan, pengukuran p95, Firefox/Edge/Safari serta perangkat Android/iOS: belum dijalankan.
- Tempel ke aplikasi tujuan kerja serta perbandingan clipboard sistem secara penuh: masih perlu UAT manual. API clipboard virtual alat uji tidak memantulkan clipboard yang ditulis halaman; indikator UI keberhasilan diuji, sedangkan kesamaan string dan jalur penolakan diuji melalui penulis clipboard yang diinjeksi pada tes unit. Tidak ada klaim bahwa pesan sudah dikirim.
- HTTPS, reverse proxy, cookie produksi, backup/pemulihan dan kebijakan retensi harus diverifikasi pada lingkungan penerapan.

Gunakan [daftar UAT](UAT.md) untuk mencatat hasil penerimaan operator. Status UAT tidak dinaikkan hanya berdasarkan tes pengembang.

## Pemeriksaan tambahan preview statis GitHub Pages

Pada 17 September 2026, build statis diperiksa melalui preview lokal pada port **4301**, menggunakan data demo sintetis dan browser Chromium pengembang. Pemeriksaan berikut telah dilakukan:

- Masuk ke mode demo, memilih kegiatan, membuat pratinjau, mengakui peringatan, mengonfirmasi isi, dan menjalankan Salin Pesan. Aplikasi menampilkan hasil penyalinan; batas pemeriksaan clipboard sistem tetap berlaku sebagaimana dicatat di atas.
- Menyimpan perubahan profil melalui pengaturan browser; profil tetap tersedia setelah halaman dimuat ulang, menggunakan persistensi IndexedDB.
- Menjalankan ekspor cadangan; tindakan memulai unduhan JSON. Pemeriksaan ini tidak menjadi klaim bahwa pemulihan seluruh cadangan pada perangkat lain telah diuji.
- Memeriksa konsol setelah alur UI tersebut: tidak ditemukan kesalahan JavaScript aplikasi pada log yang diperiksa.
- Memeriksa viewport **320, 768, 1024, dan 1440 piksel**: tidak ditemukan luapan horizontal.
- `npm run build` dan `npm run build:pages` berhasil; keseluruhan **68 tes lulus, 0 gagal**. Pemeriksaan otomatis tetap menggunakan fixture dan layanan Google yang disimulasikan.

**OAuth Google dengan akun nyata dan pembacaan Google Calendar nyata belum diverifikasi.** Preview lokal, keberhasilan build, dan demo tidak membuktikan konfigurasi origin Google Cloud maupun izin kalender pada situs publik. Koneksi akun sebenarnya, pemulihan cadangan lintas perangkat, dan UAT operator masih memerlukan pemeriksaan tersendiri.
