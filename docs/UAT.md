# Catatan UAT — Pesan Agenda

Dokumen ini adalah daftar pemeriksaan penerimaan dari [PRD](PRD.md), bukan sertifikat kelulusan. **Seluruh 42 skenario di bawah belum dijalankan sebagai UAT operator.** Hasil tes otomatis dan pemeriksaan browser pengembang dicatat terpisah dengan bukti; keduanya tidak menggantikan pilot maupun pengujian Google Calendar nyata.

## Lingkungan dan bukti

Isi untuk setiap sesi: tanggal, penguji, commit/versi aplikasi, versi Node, sistem operasi, browser dan versinya, ukuran layar, zona profil, jenis koneksi (demo/Google uji), serta ID fixture sintetis. Jangan menaruh token, kode sandi rapat nyata, atau isi agenda rahasia pada bukti.

Gunakan status `Belum diuji`, `Lulus`, `Gagal`, atau `Terhalang`. Saat mengubah status, catat bukti dan cacat terkait. K = kritis; N = normal tetapi tetap wajib lulus sebelum rilis menurut PRD.

| ID | Level | Pemeriksaan dan hasil yang diharapkan | Status |
|---|---|---|---|
| UAT-01 | K | Operator A tidak melihat pimpinan B; request ID B ditolak server, termasuk untuk admin tanpa penugasan. | Belum diuji |
| UAT-02 | K | Berpindah konteks ketika request tertunda: respons lama diabaikan dan pratinjau lama dibersihkan. | Belum diuji |
| UAT-03 | K | Tanggal 2026-09-16 pada Asia/Jakarta menghasilkan Rabu, 16 September 2026, terlepas dari zona perangkat. | Belum diuji |
| UAT-04 | N | Kalender kosong setelah fetch berhasil: keterangan kosong tepat dan salin tidak aktif. | Belum diuji |
| UAT-05 | K | Halaman Google kedua gagal: snapshot tidak dinyatakan lengkap, salin diblokir, cache lengkap tidak ditimpa parsial. | Belum diuji |
| UAT-06 | K | Satu kemunculan berulang dipindah: hanya satu entri benar dan pelengkap tetap terikat pada kemunculannya. | Belum diuji |
| UAT-07 | K | Acara batal/pindah tanggal sebelum prepare: keluarkan dari kandidat dan minta tinjau ulang. | Belum diuji |
| UAT-08 | K | Acara 23.30–00.30 muncul pada kedua tanggal beririsan dengan rentang dan zona sebenarnya. | Belum diuji |
| UAT-09 | N | Acara seharian/multi-hari tidak diberi jam 00.00; akhir eksklusif diolah benar dan pengakuan diminta. | Belum diuji |
| UAT-10 | K | Akses Google dicabut dan refresh gagal: finalisasi berhenti serta administrator diarahkan menghubungkan ulang. | Belum diuji |
| UAT-11 | N | Dua acara berjudul sama pada jam berbeda tetap menjadi dua identitas. | Belum diuji |
| UAT-12 | K | Acara privat yang hanya menunjukkan sibuk tidak bisa dipilih dan detail tidak ditebak. | Belum diuji |
| UAT-13 | K | Satu rapat daring lengkap: tanpa nomor; satu pembuka dan satu penutup. | Belum diuji |
| UAT-14 | K | Tiga pilihan acak: nomor dan urutan mengikuti waktu, bukan urutan klik. | Belum diuji |
| UAT-15 | K | Kegiatan luring: tempat muncul; ID, sandi, dan tautan rapat daring dihilangkan. | Belum diuji |
| UAT-16 | K | Kegiatan hibrida tanpa tempat: E04 memblokir salin. | Belum diuji |
| UAT-17 | K | Tautan daring valid dan akses jelas: dapat siap tanpa ID/kode terpisah yang tidak diperlukan. | Belum diuji |
| UAT-18 | K | ID tersedia tetapi kode diwajibkan dan kosong: E05 memblokir. | Belum diuji |
| UAT-19 | K | ID `001 234 5678` dan kode `Contoh.2026.` tetap persis, termasuk spasi, kapitalisasi, angka awal, dan titik. | Belum diuji |
| UAT-20 | K | Sampai selesai yang dikonfirmasi mengalahkan end time teknis kalender dalam redaksi output. | Belum diuji |
| UAT-21 | K | Google confirmed dengan kehadiran belum diputuskan: judul netral dan keterangan menunggu arahan. | Belum diuji |
| UAT-22 | K | Diwakilkan tanpa nama diblokir; dengan nama lengkap tidak menyatakan pimpinan hadir. | Belum diuji |
| UAT-23 | N | Bahan belum tersedia dan bagian dihilangkan: tanpa label kosong atau janji pengiriman otomatis. | Belum diuji |
| UAT-24 | K | Kata terlampir meminta konfirmasi redaksi dan menjelaskan salin teks tidak menyertakan berkas. | Belum diuji |
| UAT-25 | K | Dua kode berbeda/label berulang ditandai konflik dan memerlukan pilihan operator. | Belum diuji |
| UAT-26 | N | Judul dan peran sama-sama Menghadiri: awalan hanya sekali tanpa mengubah nama resmi. | Belum diuji |
| UAT-27 | K | Acara tidak dipilih yang belum lengkap tidak memblokir pilihan yang valid. | Belum diuji |
| UAT-28 | N | Rentang bertumpang tindih diperingatkan; rentang berbatasan tepat tidak dianggap bentrok. | Belum diuji |
| UAT-29 | K | Wajib kosong/placeholder belum diganti: boleh ada draf pemeriksaan, tanpa salin final. | Belum diuji |
| UAT-30 | K | Ubah pelengkap/pilihan: kesiapan, pengakuan, dan pemeriksaan draf lama dibatalkan. | Belum diuji |
| UAT-31 | K | Jam berubah saat prepare: perubahan terlihat dan wajib diperiksa ulang. | Belum diuji |
| UAT-32 | K | Umur draf melewati 120 detik atau kembali dari tab lama: salin meminta pembaruan. | Belum diuji |
| UAT-33 | K | ID/kode sumber berubah sementara pelengkap manual lama: harus ditinjau ulang. | Belum diuji |
| UAT-34 | K | Dua operator menyimpan revisi sama: kedua ditolak 409; versi lokal dan terbaru tersedia untuk rekonsiliasi. | Belum diuji |
| UAT-35 | K | Salin draf siap melalui HTTPS menghasilkan string kanonis persis, termasuk baris dan kredensial sintetis. | Belum diuji |
| UAT-36 | K | Clipboard ditolak: textarea hanya-baca, pilihan teks, dan petunjuk manual; tanpa sukses palsu. | Belum diuji |
| UAT-37 | K | Clipboard sukses tetapi audit gagal: tetap tampil hasil clipboard sebenarnya, tanpa klaim terkirim. | Belum diuji |
| UAT-38 | K | HTML/script dan URL javascript di sumber tidak dieksekusi atau menjadi tautan berbahaya. | Belum diuji |
| UAT-39 | K | Bundle/log/URL/penyimpanan browser tidak membocorkan token Google atau kredensial agenda. | Belum diuji |
| UAT-40 | N | Lebih 20 acara/40.000 karakter ditolak tanpa pemotongan; 360 px, 200% teks, dan keyboard tetap dapat digunakan. | Belum diuji |
| UAT-41 | K | Acara baru sebelum prepare mengubah hash kumpulan dan meminta pemeriksaan ulang pilihan. | Belum diuji |
| UAT-42 | K | Tautan bahan gagal dibuka akun penerima uji: kebutuhan pemeriksaan jelas; aplikasi tidak menjamin izin. | Belum diuji |

## Prosedur manual tambahan

1. Gunakan kalender dan akun uji. Buat acara tunggal, pengulangan dengan pengecualian, lintas tengah malam, seharian multi-hari, pembatalan, acara privat, dan lebih satu halaman hasil. Pisahkan pemeriksaan fixture otomatis dari respons Google nyata.
2. Uji Chrome, Edge, Firefox desktop, Chrome Android, dan Safari iOS; catat versi aktual. Uji 1280 px dan 360 px, perbesaran teks 200%, navigasi Tab/Shift+Tab/Enter/Space/Escape, label pembaca layar, fokus dialog, dan status selain warna.
3. Uji OAuth pada domain penerapan HTTPS: redirect tepat, state salah/kedaluwarsa ditolak, izin readonly, penyambungan ulang, kedaluwarsa token, pencabutan, serta pengguna non-admin tidak dapat mengelola koneksi. Periksa cookie dan respons no-store di lingkungan penerapan.
4. Siapkan dua operator dengan penugasan berbeda dan dua operator pada pimpinan sama. Uji seluruh endpoint objek melalui request langsung, pergantian penugasan, konflik revisi, logout, dan sesi kedaluwarsa.
5. Bandingkan string clipboard dengan draf server menggunakan data sintetis. Tempel manual ke aplikasi tujuan kerja. Simulasikan penolakan clipboard dan kegagalan pencatatan audit secara terpisah.
6. Ganggu koneksi Google, buat timeout/rate limit, gagalkan halaman lanjutan, dan uji respons konteks lama. Catat durasi nyata serta alasan kegagalan yang tampil kepada operator.
7. Ukur p95 cache untuk 100 kegiatan/hari (target ≤2 detik) dan render/validasi 20 kegiatan (target ≤500 ms, di luar Google), dengan spesifikasi mesin dan jumlah sampel.
8. Jalankan pilot operator untuk 1–5 kegiatan lengkap. Ukur median dari selesai memuat sampai berhasil disalin (target ≤2 menit); catat pekerjaan mencari informasi di luar pengukuran.

**Pilot, matriks lintas browser/perangkat, target performa, dan OAuth dengan kalender organisasi nyata belum dilaksanakan.** Produksi memerlukan hasil serta persetujuan pemilik produk terhadap template, akses, dan kebijakan retensi/backup.

## Format hasil sesi

```text
Tanggal/penguji:
Commit/versi aplikasi:
OS/Node/browser/ukuran layar:
Koneksi dan fixture:
Skenario UAT:
Langkah dan hasil aktual:
Status: Belum diuji | Lulus | Gagal | Terhalang
Bukti tersanitasi:
Cacat/tindak lanjut:
```
