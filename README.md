# Pesan Agenda

Versi pribadi untuk **GitHub Pages** tersedia: hubungkan Google Calendar langsung dari browser, susun pesan, dan simpan profil/pelengkap di perangkat. Target penerbitan: `bayilaras/agenda`, dengan alamat `https://bayilaras.github.io/agenda/`. Tidak membutuhkan server, akun Pemilik dengan kata sandi, atau Client Secret pada situs Pages.

## Versi GitHub Pages

```powershell
npm install
npm run build:pages
npm run preview:pages
```

Buka `http://127.0.0.1:4301/agenda/`. Untuk pengembangan langsung gunakan `npm run dev:pages`, lalu buka `http://127.0.0.1:5174/agenda/`. Build statis ada di `dist-pages`, terpisah dari build server `dist`.

Client ID publik dibaca dari `pages.config.json`. Anda dapat menggantinya lewat `VITE_GOOGLE_CLIENT_ID` pada `.env.pages.local` atau repository variable GitHub Actions. **Client ID memang bersifat publik; Client Secret tidak digunakan dan tidak boleh dimasukkan ke konfigurasi Pages.** File `.env` server tetap lokal dan diabaikan Git.

Pengaturan OAuth Google untuk versi browser:

1. Aktifkan Google Calendar API dan gunakan OAuth client jenis **Web application**.
2. Tambahkan **Authorized JavaScript origins**: `https://bayilaras.github.io`. Untuk pengujian lokal tambahkan `http://127.0.0.1:4301` dan `http://127.0.0.1:5174`. Origin tidak memuat `/agenda/`.
3. Jika aplikasi OAuth masih berstatus Testing/External, tambahkan akun Google pemakai sebagai test user.
4. Di situs, pilih **Hubungkan Google Calendar** dan izinkan akses baca kegiatan serta daftar kalender. Model browser menggunakan popup Google; callback `/api/google/callback` hanya berlaku untuk versi server.
5. Buka **Profil & cadangan**, isi profil pimpinan dan pilih kalender. Tidak ada nama pimpinan atau kredensial pribadi yang disertakan dalam situs publik.

Token Google hanya berada di memori tab. Setelah halaman dimuat ulang atau token kedaluwarsa, hubungkan Google kembali. Profil dan pelengkap tetap tersimpan di IndexedDB browser, dipisahkan menurut akun Google; data demo menggunakan ruang terpisah. Acara dibaca ulang sebelum pesan dibuat dan draf berlaku 120 detik, tetapi validasi versi Pages berjalan di perangkat, bukan pada server otoritatif.

**Data lokal tidak otomatis mengikuti perangkat/browser lain.** Gunakan **Ekspor cadangan**, kemudian **Impor cadangan** pada akun Google yang sama untuk memindahkan profil dan pelengkap. Cadangan tidak berisi token OAuth, tetapi dapat berisi informasi rapat sensitif dan disimpan sebagai JSON biasa. Impor menambahkan data baru/identik; konflik tidak menimpa data lama. Profil/pelengkap lokal tidak memakai enkripsi server AES-GCM; orang yang dapat mengakses profil browser yang sama dapat membaca penyimpanan lokal. Menghapus data situs dapat menghapus pelengkap. Kalender asli tetap berada di Google dan tidak diubah aplikasi.

Workflow `.github/workflows/pages.yml` menjalankan tes, membangun versi browser, memeriksa build, lalu menerbitkan **hanya `dist-pages`**. Pada GitHub, pilih **Settings → Pages → Source: GitHub Actions**. Push ke `main` menjalankan deploy; workflow juga bisa dijalankan manual. Halaman utama menggunakan `/agenda/`; fallback `404.html` disertakan untuk tautan langsung lama. Aplikasi webnya dapat dibuka publik, sedangkan data kalender membutuhkan persetujuan akun Google masing-masing.

Panduan model OAuth: [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model). Panduan hosting: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## Versi server lokal (opsional)

Bagian berikut berlaku untuk `npm run dev` / `npm start`, bukan versi Pages. Konfigurasi akun Pemilik dengan kata sandi dan Client Secret hanya diperlukan jika memilih menjalankan server sendiri.

Aplikasi web berbahasa Indonesia untuk menyusun pesan agenda harian pimpinan dari Google Calendar, berdasarkan [PRD versi 1](docs/PRD.md). Untuk penggunaan pribadi, satu akun **Pemilik** menghubungkan kalender, memilih kegiatan, melengkapi informasi, memeriksa peringatan, lalu menyalin teks formal untuk dikirim manual.

Stack: React + TypeScript + Vite, API Express, serta SQLite melalui `node:sqlite`. Data sensitif disimpan server dengan enkripsi AES-256-GCM. Google Calendar digunakan baca-saja; tidak ada pengiriman WhatsApp/email otomatis.

Hasil build, tes otomatis, pemeriksaan browser, serta batas pengujian tercatat di [Verifikasi pengembang](docs/VERIFICATION.md).

## Menjalankan lokal

Prasyarat: **Node.js 24 atau lebih baru** dan npm. Dari direktori proyek:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Buka [http://localhost:5173/pesan-agenda](http://localhost:5173/pesan-agenda). Vite berjalan di port 5173 dan meneruskan `/api` ke Express port 3001. `npm run dev` menjalankan keduanya. Gunakan hostname yang sama secara konsisten ketika login/OAuth.

Pada pengembangan, klik **Jelajahi mode demo** untuk masuk secara eksplisit dengan data sintetis. Demo tidak terhubung ke kalender sebenarnya dan tidak membutuhkan kredensial Google. Pilih satu pimpinan dan hari kerja untuk melihat contoh rapat; akhir pekan merupakan contoh kalender kosong. Data demo dan data akun nyata dipisahkan. `NODE_ENV=production` selalu menonaktifkan demo, termasuk jika flag demo diaktifkan.

Perintah verifikasi dan build:

```powershell
npm test
npm run build
npm start
```

`npm run build` memeriksa TypeScript dan membangun frontend ke `dist`. `npm start` menjalankan API sekaligus frontend hasil build pada port 3001; jalankan build terlebih dahulu. Runtime `tsx` tetap diperlukan oleh perintah start, sehingga instalasi untuk model penerapan ini harus menyertakan devDependencies.

## Pengaturan pribadi: satu akun pemilik

Anda cukup menyiapkan satu akun pemilik; tidak perlu akun administrator dan operator terpisah atau pengaturan role. Pemilik dapat mengelola koneksi Google dan semua profil pimpinan yang Anda daftarkan. Login aplikasi tetap diperlukan, dan mode demo tetap memakai data sintetis.

Konfigurasi dibaca server dari `APP_CONFIG_FILE` (disarankan) atau `APP_CONFIG_JSON`. Keduanya memuat objek yang sama. Simpan file konfigurasi di lokasi berizin terbatas di luar repository, kemudian atur path di `.env`. Perubahan konfigurasi memerlukan restart server. Naikkan `revision` profil ketika pemetaan, zona, sapaan, atau data profil diubah.

Contoh bentuk `app-config.json` berikut memuat nilai contoh yang **harus diganti**, terutama `passwordHash` dan `calendarId`:

```json
{
  "owner": {
    "name": "Nama Anda",
    "email": "nama@example.com",
    "passwordHash": "HASIL_GENERATOR_HASH"
  },
  "leaders": [
    {
      "id": "pimpinan-1",
      "name": "Nama Pimpinan",
      "position": "Jabatan Pimpinan",
      "salutation": "Bapak",
      "closing": "Pak",
      "timeZone": "Asia/Jakarta",
      "calendarName": "Agenda Pimpinan",
      "calendarId": "ID_KALENDER_GOOGLE",
      "revision": 1
    }
  ]
}
```

Pada konfigurasi `owner`, tidak perlu mengisi `role` atau `leaderIds`. ID pemilik default adalah `owner`; opsional isi `owner.id` untuk memakai ID akun yang sudah ada. Gunakan `Ibu`/`Bu` jika sesuai; sapaan tidak ditebak dari nama. Setiap pimpinan memiliki satu kalender acuan, dan akun Google penghubung harus berhak membaca kalender itu. Untuk kalender utama akun Google yang dihubungkan, `calendarId` dapat diisi `primary`.

Konfigurasi tim lama dengan `users` tetap didukung, dengan field `id`, `name`, `email`, `role`, `passwordHash`, dan `leaderIds` pada setiap akun. Pada format lama, akun `admin` tetap membutuhkan `leaderIds` eksplisit untuk membaca agenda. Jangan gabungkan `owner` dengan `users` yang berisi akun. Saat beralih dari format lama, gunakan ID akun lama pada `owner.id` jika ingin mempertahankan identitas akun tersebut.

Hash kata sandi menggunakan format `scrypt:salt:digest`; jangan menyimpan kata sandi biasa di konfigurasi. Gunakan utilitas generator kata sandi yang disertakan:

```powershell
npx tsx server/password.ts
```

Masukkan kata sandi pada prompt utilitas dan tempel hanya hash hasilnya ke `passwordHash`. Jangan memasukkan kata sandi sebagai argumen shell atau menyimpan kredensial nyata pada contoh repository.

## Konfigurasi lingkungan

Lihat [.env.example](.env.example) untuk nilai awal. Variabel utama:

| Variabel               | Kegunaan                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | Isi `production` pada penerapan; demo otomatis nonaktif.                                                               |
| `PORT` / `HOST`        | Default `3001` / `127.0.0.1`; sesuaikan dengan reverse proxy.                                                          |
| `APP_BASE_URL`         | Origin aplikasi, default `http://localhost:3001`; wajib HTTPS di produksi. Untuk Vite gunakan `http://localhost:5173`. |
| `APP_CONFIG_FILE`      | Path file JSON akun pemilik, profil pimpinan, dan calendar ID.                                                         |
| `APP_CONFIG_JSON`      | Alternatif JSON langsung jika `APP_CONFIG_FILE` tidak disetel.                                                         |
| `DATA_DIR`             | Direktori database; default `data`.                                                                                    |
| `ENCRYPTION_KEY`       | Kunci base64 dari tepat 32 byte; wajib diberikan di produksi.                                                          |
| `DEMO_MODE`            | `false` untuk menonaktifkan demo pada pengembangan.                                                                    |
| `GOOGLE_CLIENT_ID`     | OAuth client ID jenis Web application.                                                                                 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret, hanya di server.                                                                                  |
| `GOOGLE_REDIRECT_URI`  | Callback OAuth; default `${APP_BASE_URL}/api/google/callback`.                                                         |

Buat kunci enkripsi sekali dan simpan pada secret manager/konfigurasi host, bukan repository:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Jangan mengganti kunci pada database berisi data tanpa prosedur migrasi: kunci berbeda tidak dapat membaca payload lama. Dalam pengembangan tanpa `ENCRYPTION_KEY`, kunci dibuat di direktori home pengguna, `.pesan-agenda/development.key`, di luar repository. File `.env`, data SQLite, dan konfigurasi berisi rahasia tidak untuk dibagikan.

## Menghubungkan Google Calendar

1. Siapkan proyek Google Cloud dan aktifkan **Google Calendar API**. Atur layar persetujuan OAuth dan akun penguji sesuai jenis organisasi/penerapan.
2. Buat OAuth client jenis **Web application**. Daftarkan authorized redirect URI yang persis sama dengan `GOOGLE_REDIRECT_URI`; contoh pengembangan Vite: `http://localhost:5173/api/google/callback`. Produksi: `https://agenda.instansi.example/api/google/callback`. Aturan ini mengikuti [dokumentasi OAuth web server Google](https://developers.google.com/identity/protocols/oauth2/web-server).
3. Isi ID/secret, `APP_BASE_URL`, redirect, dan `APP_CONFIG_FILE` pada lingkungan server, kemudian restart.
4. Masuk dengan akun **Pemilik**, lalu gunakan aksi **Hubungkan Google Calendar**. Pilih akun Google yang mempunyai akses ke kalender pada konfigurasi.
5. Berikan scope `https://www.googleapis.com/auth/calendar.events.readonly` dan `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Keduanya untuk membaca data; daftar scope tersedia pada [dokumentasi Google Calendar](https://developers.google.com/workspace/calendar/api/auth).
6. Tetap gunakan akun pemilik yang sama. Pilih pimpinan/tanggal, muat kalender, dan periksa contoh acara sebelum memakai data operasional.

Login aplikasi dan OAuth Google adalah dua izin berbeda. Akun Google pembuat OAuth client boleh berbeda dari akun Google yang kalendernya dihubungkan, selama pengaturan audience/pengguna penguji OAuth mengizinkannya. Implementasi ini memakai satu koneksi OAuth Google untuk kalender yang dipetakan pada server; akun penghubung perlu dapat membaca semua kalender tersebut. Integrasi nyata memerlukan client Google, izin kalender, serta konfigurasi yang benar; demo tidak membuktikan koneksi Google berhasil.

Pemilik dapat memutus koneksi melalui aksi koneksi aplikasi. Endpoint `POST /api/google/disconnect` memerlukan sesi berizin dan token CSRF, mencabut otorisasi serta menghapus token yang tersimpan. Secara internal akun pemilik memiliki izin administrator. Setelah pencabutan, finalisasi memerlukan sambungan ulang. Hak pada akun Google juga dapat dicabut melalui pengaturan akun Google.

## Alur penggunaan

Mode awal **Dari Google Calendar** menyusun pesan langsung dari judul, waktu, lokasi, seluruh keterangan, akses rapat, dan tautan lampiran kalender. Tidak perlu mengisi ulang pokok agenda, pelaksanaan, kehadiran, kode sandi, atau bahan pada formulir. Keterangan bebas tanpa label khusus tetap dicantumkan; informasi opsional yang tidak tersedia dilewati. Judul dan waktu yang tidak valid tetap perlu diperbaiki pada kalender. Tautan PDF dicantumkan, tetapi isi PDF tidak diekstrak.

Pilih pimpinan/tanggal dan kegiatan → **Buat Pesan** → periksa pratinjau → **Salin Pesan**. Hanya satu konfirmasi isi pada pratinjau; tidak ada pemeriksaan wajib per kolom. Kalender dibaca ulang untuk menjaga sumber tetap terbaru. Isian pelengkap lama tetap tersimpan dan tersedia melalui mode **Dengan penyesuaian**, tetapi tidak menggantikan informasi sumber pada mode otomatis.

Alur **Dengan penyesuaian** jika membutuhkan isian tambahan:

1. Masuk, pilih pimpinan dan tanggal; perhatikan zona waktu profil serta status koneksi.
2. Pilih kegiatan yang akan dicantumkan. Acara privat/batal/tidak hadir tidak layak dipilih. Pilihan awal kosong.
3. Buka **Lengkapi**, bandingkan sumber dengan informasi pesan, isi kehadiran, pelaksanaan, pokok agenda, akses rapat, dan bahan yang telah diperiksa; simpan. Data tambahan disimpan aplikasi dan tidak mengubah Google Calendar.
4. Buka masalah yang ditampilkan dan perbaiki semua kesalahan wajib. Peringatan memerlukan pengakuan operator yang sesuai.
5. Klik **Buat Pesan**. Aplikasi membaca ulang sumber. Jika sumber atau kumpulan kegiatan berubah, tinjau ulang dan perbarui pesan.
6. Baca teks pratinjau, akui peringatan relevan, dan konfirmasikan pemeriksaan. Draf hanya siap untuk waktu terbatas (default 120 detik sejak pemeriksaan sumber).
7. Klik **Salin Pesan**. Setelah berhasil, tempel dan periksa kembali di aplikasi tujuan sebelum mengirim manual. Jika clipboard ditolak, gunakan pilihan teks dan salin manual yang tersedia untuk draf valid.

Jam/tanggal/judul sumber yang salah diperbaiki di Google, lalu dimuat ulang. `confirmed` dari Google tidak berarti pimpinan pasti hadir. Tautan bahan tidak membuktikan penerima mempunyai izin membuka; periksa dengan akun penerima uji. Salin teks tidak melampirkan dokumen.

### Mengambil isian dari keterangan kalender

Bagian ini berlaku pada formulir opsional mode **Dengan penyesuaian**. Mode otomatis menggunakan seluruh keterangan tanpa memerlukan tombol pengisian.

Keterangan acara dapat mengisi tautan rapat Teams/Zoom/Google Meet, platform, `Meeting ID`, dan `Passcode`/`Password`. Label dapat diikuti nilai pada baris yang sama atau baris berikutnya. Tautan di balik teks HTML seperti **Join the meeting** juga dikenali. Label Indonesia seperti `Agenda:`, `Bahan Rapat:`, dan `Keterangan:` tetap didukung. Kredensial dipertahankan persis; shortlink tidak dibuka atau ditebak tujuannya.

Acara yang belum mempunyai pelengkap menggunakan nilai yang dikenali sebagai isian awal. Untuk pelengkap yang sudah disimpan, buka **Lengkapi → Isi dari keterangan**. Tombol ini hanya melengkapi kolom kosong, mempertahankan isian manual, dan meminta pemeriksaan sebelum **Simpan**. Jika tautan atau platform manual berbeda, bandingkan kandidat akses rapat terlebih dahulu. Beberapa nilai atau platform yang bertentangan memerlukan pemilihan dan pemeriksaan sumber.

Pengembangan ini mengikuti pilihan pengguna untuk mendahulukan keterangan kalender, memperluas format parser pada PRD awal. Isi PDF lampiran belum diekstrak. Pokok agenda yang tidak tersedia pada label sumber dan keputusan kehadiran tetap perlu diisi sendiri.

## Pemulihan masalah

| Kondisi                                  | Tindakan                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tidak ada pimpinan setelah login         | Periksa daftar `leaders`, lalu restart setelah perubahan konfigurasi. Untuk konfigurasi tim lama, periksa juga `leaderIds` akun. |
| Kalender belum terhubung / akses dicabut | Pemilik menyambungkan ulang dan memeriksa hak akun Google terhadap calendar ID.                                                  |
| `redirect_uri_mismatch`                  | Samakan scheme, host, port, dan path callback antara Google Cloud, `.env`, dan browser.                                          |
| Fetch gagal / rate limit                 | Tunggu dan pilih Muat Ulang; data gagal/parsial tidak dapat difinalisasi.                                                        |
| Sumber berubah / versi konflik 409       | Bandingkan isian lokal dengan sumber/versi terbaru, rekonsiliasi, simpan, lalu buat ulang pesan.                                 |
| Draf kedaluwarsa                         | Perbarui Pesan, baca lagi, dan lakukan konfirmasi pada versi baru.                                                               |
| Clipboard ditolak                        | Gunakan fallback salin manual; pastikan HTTPS untuk penerapan dan dukungan browser.                                              |
| Payload database tidak terbaca           | Pastikan kunci enkripsi yang benar tersedia; jangan menghapus database operasional untuk mencoba ulang.                          |

## Penerapan dan penyimpanan

Jalankan satu instance server dengan volume SQLite persisten. Pasang reverse proxy HTTPS ke Express, atur `NODE_ENV=production`, URL publik, key, akun, dan OAuth sesuai lingkungan. Gunakan kredensial pengembangan dan produksi terpisah. Uji cookie sesi, callback, header cache, batas akses, dan clipboard pada domain penerapan yang sebenarnya.

Backup harus mencakup database yang konsisten beserta kunci enkripsi yang disimpan terpisah, konfigurasi, dan versi aplikasi. SQLite menggunakan WAL; lakukan backup SQLite yang konsisten atau hentikan aplikasi sebelum menyalin database dan berkas pendampingnya. Uji pemulihan ke lingkungan terisolasi sebelum menetapkan prosedur operasional. Metadata audit tidak berisi isi pesan atau nilai kredensial.

**Tidak ada penghapusan retensi otomatis.** PRD mengusulkan cache/pelengkap 30 hari, draf 7 hari, dan audit 90 hari; angka tersebut belum menjadi kebijakan arsip yang disetujui. Pemilik sistem perlu menetapkan kebijakan retensi, backup, legal hold, serta prosedur penghapusan sebelum produksi. Implementasi V1 bukan repositori arsip resmi.

## Cakupan terhadap PRD dan verifikasi

| Area PRD                     | Lokasi implementasi / pemeriksaan                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| FR-01, FR-14, keamanan akses | Konfigurasi akun/pimpinan, sesi, otorisasi objek server, dan koneksi Google.                       |
| FR-02–FR-06                  | Filter zona/tanggal, pengambilan kalender, identitas acara, parser sumber, dan formulir pelengkap. |
| FR-07–FR-10, FR-13           | Domain validasi/template, snapshot, revisi, prepare/review, dan batas umur draf.                   |
| FR-11–FR-12                  | Pratinjau kanonis, clipboard, dan fallback salin manual pada frontend.                             |
| FR-15                        | Audit metadata server untuk perubahan, draf, dan hasil salin yang dilaporkan klien.                |
| UAT-01–UAT-42                | Daftar lengkap, status, dan prosedur bukti di [docs/UAT.md](docs/UAT.md).                          |

Jalankan `npm test` untuk tes otomatis dan `npm run build` untuk pemeriksaan kompilasi. Daftar di atas adalah pemetaan implementasi; bukan klaim bahwa seluruh kriteria telah diterima pengguna. UAT lengkap 42 skenario, integrasi OAuth organisasi nyata, matriks browser/perangkat, pengukuran performa, dan pilot operator harus dilaksanakan dengan bukti. Hasil pengujian yang benar-benar dijalankan dicatat terpisah pada dokumentasi UAT.
