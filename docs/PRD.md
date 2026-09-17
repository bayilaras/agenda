# PRD — Pesan Agenda Pimpinan

**Versi:** 1.0 — MVP / draf acuan implementasi  
**Tanggal:** 17 September 2026  
**Platform:** aplikasi web responsif, satu halaman kerja `/pesan-agenda`  
**Pengguna utama:** admin agenda / sekretaris pimpinan  
**Sumber jadwal:** Google Calendar, akses baca-saja  
**Keluaran:** satu pesan agenda harian yang diperiksa dan disalin manual

> Prinsip produk: Google Calendar menyediakan jadwal, admin memastikan kelengkapan, dan aplikasi menyusun pesan dengan template tetap. Aplikasi tidak mengarang informasi dan tidak mengirim pesan secara otomatis.

Dokumen ini menetapkan rancangan versi pertama, bukan laporan aplikasi yang sudah dibangun atau diuji. Angka kinerja, batas data, dan pilihan implementasi di bawah merupakan target/usulan produk. Nama akun, kalender, dan stack produksi belum ditetapkan. Acuan gaya pesan berasal dari contoh pengguna; rujukan teknis resmi tercantum di bagian akhir.

**Panduan baca:** Bagian 1–5 membahas kebutuhan produk dan alur halaman; bagian 6–12 menjadi acuan pengembang; bagian 13–14 memuat UAT serta kriteria rilis; bagian 15 memuat rujukan teknis.

## 1. Ringkasan produk dan tujuan

Pesan Agenda membantu admin mengubah kegiatan Google Calendar menjadi pesan formal untuk seorang pimpinan pada satu tanggal. Seluruh pekerjaan rutin berlangsung pada satu halaman: memilih pimpinan dan tanggal, memilih kegiatan, melengkapi informasi, memeriksa masalah, membuat pratinjau, dan menyalin pesan.

Masalah yang diselesaikan adalah pengetikan berulang, format tidak konsisten, informasi rapat yang belum lengkap, dan penggunaan pesan lama setelah jadwal berubah. Versi pertama tidak menggantikan Google Calendar serta tidak menjadi sistem persetujuan atau pengiriman pesan.

### 1.1 Hasil yang dituju

| Sasaran | Target penerimaan awal |
|---|---|
| Mengurangi pekerjaan berulang | Median waktu dari kegiatan selesai dimuat sampai berhasil disalin maksimal 2 menit untuk 1–5 kegiatan dengan data lengkap, pada uji pilot operator. |
| Menjaga fakta | Tidak ada perubahan otomatis pada tanggal, waktu, nama resmi, ID rapat, dan kode sandi dalam fixture UAT. |
| Menjaga konsistensi | Input dan versi template yang sama menghasilkan teks identik. |
| Memperjelas kekurangan | Semua kesalahan wajib pada kegiatan terpilih menghalangi tombol Salin Pesan. |
| Memastikan perilaku aman | Semua UAT kritis lulus; tidak ada cacat terbuka berkeparahan kritis atau tinggi sebelum rilis. |

Pengukuran waktu tidak mencakup penyiapan akun, menunggu arahan pimpinan, atau mencari bahan rapat yang belum tersedia. Keberhasilan menyalin bukan ukuran pesan terkirim atau dibaca.

## 2. Ruang lingkup dan batas versi pertama

### 2.1 Wajib tersedia — P0

| Area | Cakupan versi pertama |
|---|---|
| Konteks pesan | Pilihan satu pimpinan, satu tanggal, serta zona waktu profil yang terlihat jelas. |
| Koneksi kalender | OAuth baca-saja dan pemetaan satu kalender acuan per pimpinan. |
| Daftar kegiatan | Ambil kegiatan yang beririsan dengan tanggal terpilih, tampilkan menurut waktu, pilih melalui kotak centang. |
| Informasi pelengkap | Formulir di dalam kartu kegiatan; simpan ke database aplikasi, tidak ke Google Calendar. |
| Pemeriksaan | Kesalahan wajib, peringatan, konflik sederhana waktu, dan pemeriksaan ulang setelah perubahan. |
| Pratinjau | Satu template formal lengkap, dengan bagian bersyarat sesuai data dan jumlah kegiatan. |
| Penyalinan | Teks biasa ke clipboard, notifikasi keberhasilan, dan alternatif salin manual saat izin browser ditolak. |
| Keandalan | Status pemuatan, kosong, gagal, draf berubah, dan data perlu diperbarui. |
| Keamanan minimum | Login, pembatasan per pimpinan, token aman di server, serta audit metadata. |

### 2.2 Tidak termasuk

Tidak ada pengeditan atau pembuatan acara Google Calendar dari aplikasi; tidak ada WhatsApp API, pengiriman email, pengingat otomatis, atau status terkirim/dibaca. Tidak ada OCR/PDF extraction, AI generatif, unggah dokumen, pemeriksaan izin Google Drive otomatis, persetujuan berjenjang, dashboard pimpinan terpisah, kalender bulanan, maupun laporan realisasi kegiatan.

Penggabungan beberapa kalender untuk satu pimpinan, webhook, sinkronisasi latar belakang, perhitungan rute perjalanan, editor template bebas, format ringkas, dan pesan khusus perubahan jadwal ditunda. Login dan persetujuan OAuth dapat membuka layar eksternal; pekerjaan agenda sehari-hari tetap satu halaman.

### 2.3 Asumsi implementasi

Satu akun operator dapat ditugaskan ke beberapa pimpinan, tetapi satu pesan hanya untuk satu pimpinan. Setiap pimpinan memakai satu kalender acuan pada V1. Zona waktu awal `Asia/Jakarta`; profil dapat dikonfigurasi dengan zona lain. Satu sumber acara yang sama tetap memiliki informasi pelengkap terpisah per pimpinan.

Stack tidak dipaksakan dan aplikasi ini tidak diasumsikan bagian dari SIMSA maupun PRIMAPTPP. Pengembang dapat menggunakan stack organisasi selama memenuhi kontrak produk dan uji penerimaan.

## 3. Pengguna dan akses

| Peran | Hak yang diberikan |
|---|---|
| Operator agenda / sekpri | Membaca kegiatan pimpinan yang ditugaskan, mengisi pelengkap, memilih kegiatan, membuat pratinjau, dan menyalin pesan. |
| Administrator konfigurasi | Mengelola koneksi, pemetaan kalender, profil sapaan, dan penugasan operator melalui konfigurasi awal atau modal terbatas. Hak baca agenda tidak otomatis diberikan tanpa penugasan. |

Pimpinan merupakan penerima pesan di luar aplikasi, bukan akun pengguna yang wajib dibuat pada V1. Setiap endpoint memeriksa akses objek di server; menyembunyikan pilihan pada antarmuka saja tidak cukup. Kalender pribadi atau agenda yang hanya dapat dilihat sebagai waktu sibuk tidak boleh diperkaya dengan dugaan isi.

Profil pimpinan minimal memuat ID internal, nama tampilan, jabatan, sapaan pembuka (`Bapak`/`Ibu`), sapaan penutup (`Pak`/`Bu`), zona waktu, serta kalender acuan. Sapaan dipilih saat konfigurasi, bukan ditebak dari nama.

## 4. Alur penggunaan utama

1. Operator login dan membuka halaman Pesan Agenda. Jika hanya satu pimpinan tersedia, pimpinan itu langsung dipilih; jika lebih dari satu, operator memilih secara eksplisit. Tanggal awal adalah hari ini menurut zona waktu profil.
2. Aplikasi mengambil kegiatan kalender untuk tanggal tersebut. Operator juga dapat memakai tombol Hari ini, Besok, atau pemilih tanggal.
3. Daftar muncul dengan waktu, judul, pelaksanaan, dan status kelengkapan. Semua kegiatan awalnya belum terpilih. Operator memilih satu atau beberapa kegiatan; tersedia Pilih semua yang dapat dipilih.
4. Operator membuka Lengkapi pada kartu yang bermasalah, memeriksa sumber, mengisi informasi yang kurang, lalu menekan Simpan. Tidak ada perubahan pada kalender sumber.
5. Aplikasi memeriksa kegiatan terpilih dan menampilkan jumlah kesalahan serta peringatan yang dapat diklik menuju kolom terkait.
6. Operator menekan Buat Pesan. Server mengambil ulang data terbaru, memeriksa versi pelengkap, memvalidasi, dan membentuk teks. Masalah wajib menghasilkan draf pemeriksaan, bukan pesan siap salin.
7. Operator membaca pratinjau, menyelesaikan atau mengakui peringatan yang relevan, lalu mencentang Saya telah memeriksa isi pesan. Pilihan dan konfirmasi terikat pada versi draf.
8. Operator menekan Salin Pesan. Setelah clipboard berhasil ditulis, aplikasi menampilkan Pesan berhasil disalin. Silakan tempel dan periksa kembali sebelum dikirim. Pengiriman dilakukan manual di luar aplikasi.

Ketika pimpinan atau tanggal berganti, pilihan kegiatan dan pratinjau konteks sebelumnya dibersihkan. Perubahan formulir yang belum tersimpan memunculkan pilihan Simpan, Buang perubahan, atau Tetap di sini. Respons jaringan dari konteks lama tidak boleh menggantikan konteks baru.

## 5. Rancangan satu halaman

### 5.1 Susunan antarmuka

| Bagian | Isi dan perilaku |
|---|---|
| Header | Judul Pesan Agenda, keterangan singkat, status koneksi, nama kalender, dan waktu terakhir pemeriksaan berhasil. |
| Filter konteks | Pimpinan, tanggal, Hari ini, Besok, zona waktu, serta tombol Muat Ulang. |
| Ringkasan | Contoh: 5 kegiatan tersedia · 3 dipilih · 1 kesalahan · 2 peringatan. Angka diperbarui mengikuti pilihan. |
| Daftar kegiatan | Kartu berurutan: kotak centang, waktu, judul, pelaksanaan, status, Lengkapi, dan Buka di Google Calendar. |
| Formulir pelengkap | Accordion pada kartu, agar operator tidak berpindah halaman. Sumber asli dan pelengkap dibedakan. |
| Pemeriksaan | Daftar masalah untuk kegiatan terpilih. Setiap masalah menyebut kegiatan, kolom, dan tindakan perbaikan. |
| Pratinjau | Teks final hanya-baca, jumlah kegiatan, jumlah karakter, waktu pemeriksaan, status draf, dan konfirmasi pemeriksaan. |
| Aksi utama | Buat/Perbarui Pesan dan Salin Pesan. Tombol yang tidak aktif memiliki alasan yang dapat dibaca. |

Pada desktop, daftar dan formulir menempati sekitar 55% lebar, pratinjau 45%. Pada layar kecil, semuanya menjadi satu kolom: filter, kegiatan, pemeriksaan, lalu pratinjau. Area tindakan tetap mudah dijangkau tanpa menutupi isi. Tidak dibutuhkan grafik atau statistik tambahan.

### 5.2 Keadaan halaman

| Keadaan | Pesan dan tindakan |
|---|---|
| Belum terhubung | Kalender belum dihubungkan. Operator diarahkan kepada administrator; hanya pihak berwenang melihat Hubungkan Google Calendar. |
| Memuat | Memuat kegiatan…; cegah pemuatan ganda dan jangan menampilkan data pimpinan sebelumnya. |
| Kosong setelah berhasil | Tidak ada kegiatan pada kalender terhubung untuk tanggal ini. Salin Pesan nonaktif. Tidak dibuat klaim bahwa pimpinan pasti tidak memiliki agenda lain. |
| Belum dipilih | Pilih kegiatan yang akan dimasukkan ke pesan. |
| Data tidak lengkap | Sebutkan kolom yang perlu dilengkapi; jangan hanya menampilkan persentase kelengkapan. |
| Gagal/parsial | Kalender belum berhasil diperiksa. Coba lagi. Data parsial tidak boleh menjadi pesan final. |
| Siap | Pratinjau tersedia; tombol salin aktif setelah konfirmasi pemeriksaan. |
| Kedaluwarsa/berubah | Pesan perlu diperbarui sebelum disalin. Sediakan Perbarui Pesan. |

## 6. Kebutuhan fungsional

### 6.1 Daftar persyaratan

| ID | Persyaratan dan kriteria penerimaan |
|---|---|
| FR-01 | Pilihan pimpinan hanya berisi profil yang diizinkan. Mengubah ID melalui request tetap ditolak oleh server. |
| FR-02 | Tanggal, Hari ini, dan Besok menggunakan zona profil, bukan zona server atau asumsi perangkat. Hari dalam pesan dihitung otomatis. |
| FR-03 | Seluruh halaman hasil Google untuk rentang tanggal selesai diambil sebelum daftar dianggap lengkap. Kegagalan salah satu halaman tidak diperlakukan sebagai sukses parsial. |
| FR-04 | Kegiatan dapat dipilih satuan/semua; kegiatan batal, tidak dapat dibaca detailnya, dan berstatus lokal tidak hadir tidak dapat dipilih. |
| FR-05 | Formulir menampilkan nilai sumber serta pelengkap, menyimpan dengan versi, dan mempertahankan isian ketika validasi gagal. |
| FR-06 | Parser deskripsi hanya mengenali label yang ditetapkan; teks bebas lain tetap ditampilkan sebagai sumber dan tidak ditebak. |
| FR-07 | Validasi dilakukan pada server dan ditampilkan segera pada antarmuka; kesalahan kegiatan yang tidak dipilih tidak memblokir kegiatan terpilih. |
| FR-08 | Generator menggunakan template versi tetap; satu kegiatan tanpa nomor, beberapa kegiatan bernomor dan urut kronologis. |
| FR-09 | Pratinjau final hanya-baca dan bersumber dari teks kanonis server. Revisi dilakukan melalui formulir, bukan mengedit hasil bebas. |
| FR-10 | Setiap perubahan pilihan, pelengkap, profil, template, atau data sumber yang terdeteksi membatalkan kesiapan dan konfirmasi draf lama. |
| FR-11 | Salin Pesan hanya menyalin teks pesan final; tidak menyertakan panel validasi, URL internal, tombol, atau catatan audit. |
| FR-12 | Kegagalan clipboard menampilkan teks siap dipilih dan petunjuk salin manual, tanpa notifikasi sukses palsu. |
| FR-13 | Pemeriksaan bentrok terbatas pada kegiatan terpilih dengan rentang waktu pasti; hasil merupakan peringatan, bukan keputusan penjadwalan. |
| FR-14 | Kegagalan Google tidak menghapus catatan pelengkap; pencabutan akses menghentikan pembacaan dan finalisasi pesan. |
| FR-15 | Audit mencatat perubahan, pembuatan draf, dan hasil upaya salin sebagai metadata, bukan isi pesan atau kata sandi. |

### 6.2 Data acara dan formulir pelengkap

API Google menyediakan antara lain judul, waktu, deskripsi, lokasi, data konferensi opsional, dan metadata lampiran. `status` acara berbeda dari respons peserta; keberadaan data ini tidak membuktikan keputusan hadir internal. [R2]

| Kolom | Sumber dan aturan aplikasi |
|---|---|
| Judul sumber | `summary`; hanya-baca. Jika kosong, operator harus memperbaiki di Google lalu memuat ulang. |
| Judul pesan | Default sama dengan judul sumber; opsional penyesuaian redaksi manual, maksimum 500 karakter, dengan sumber tetap terlihat. Tidak boleh dibuat dari dugaan. |
| Tanggal/jam mulai | Waktu sumber; hanya-baca. Jam kalender yang salah diperbaiki di Google. |
| Format waktu | Jam mulai–selesai, Sampai selesai, atau Seharian sesuai tipe acara. Opsi Sampai selesai harus dikonfirmasi operator. |
| Rencana kehadiran | Belum diputuskan, Akan hadir, Diwakilkan, Tidak hadir. Default Belum diputuskan; tidak otomatis mengikuti `confirmed`. |
| Peran pimpinan | Tanpa awalan, Menghadiri, Memimpin, Memberikan Sambutan, atau Memberikan Arahan. Awalan afirmatif hanya untuk Akan hadir. |
| Perwakilan | Wajib ketika Diwakilkan; maksimum 300 karakter. |
| Mode pelaksanaan | Daring, Luring, atau Hibrida. Tidak menyimpulkan daring hanya dari kata Zoom dalam judul. |
| Tempat | Lokasi sumber jika ada; jika kosong dapat dilengkapi manual, maksimum 1.000 karakter. Perbedaan dengan lokasi sumber baru wajib diperiksa. |
| Platform | Zoom Meeting, Google Meet, atau nama lainnya; wajib untuk mode daring/hibrida. |
| Tautan rapat | Dari sumber atau manual, maksimum 2.048 karakter. Validasi URL HTTPS; tidak menjamin tautan masih aktif. |
| ID rapat | String maksimum 256 karakter; jangan ubah menjadi angka atau memakai ID acara Google. |
| Kode sandi | String maksimum 256 karakter; pertahankan kapitalisasi, tanda baca, angka awal, dan spasi. Tidak diubah oleh normalisasi teks. |
| Kebutuhan kode | Wajib, Tidak diperlukan, atau Belum diketahui. Jalur bergabung harus jelas sebelum finalisasi. |
| Pokok agenda | Wajib, maksimum 6.000 karakter. Diambil dari bagian Agenda atau diisi operator, bukan diringkas otomatis dari judul. |
| Bahan rapat | Status Belum diperiksa, Tersedia, Belum tersedia, atau Tidak diperlukan. Deskripsi maksimum 4.000 karakter. |
| Tautan bahan | Opsional, dapat lebih dari satu; maksimum 10 entri, masing-masing judul 300 dan URL 2.048 karakter. Tidak mengunggah atau mengubah izin file. |
| Keterangan pesan | Opsional, maksimum 4.000 karakter; hanya informasi yang memang boleh disampaikan. |
| Asal/verifikasi | Simpan asal nilai, waktu pemeriksaan, operator pemeriksa, serta versi sumber dan pelengkap. |

Catatan internal rahasia tidak disediakan sebagai kolom pada V1 agar tidak berisiko ikut tersalin. ID rapat/kode sandi disembunyikan dari ringkasan kartu, tetapi tersedia bagi operator berwenang dalam formulir dan pratinjau yang sedang ditinjau.

### 6.3 Pembacaan deskripsi dan prioritas nilai

Label yang dikenali: `Pelaksanaan`, `ID Rapat`, `Kode Sandi`, `Agenda`, `Bahan Rapat`, `Keterangan`, dan `Format Waktu`. Nama label tidak peka huruf besar-kecil; nilainya dipertahankan. Parser mendukung isi pada baris yang sama atau baris berikutnya sampai label berikutnya. HTML sumber diubah menjadi teks aman tanpa menjalankan HTML/script.

Data konferensi terstruktur dan deskripsi digunakan sebagai kandidat, bukan saling menimpa diam-diam. Jika ada dua tautan atau dua kode yang berbeda, operator memilih yang benar. ID/kode konferensi Google tidak selalu merupakan kredensial Zoom. Lampiran sumber hanya dijadikan kandidat judul/tautan bahan, bukan dibaca isinya. [R2]

Untuk pelengkap, nilai yang sudah diperiksa operator lebih diutamakan daripada kandidat parser selama sumbernya tidak berubah. Ketika sumber berubah dan berbeda, tandai Perlu diperiksa ulang. Jangan menimpa pelengkap manual atau membiarkannya diam-diam menutupi perubahan baru. Nilai jadwal aktual tetap selalu berasal dari Google.

## 7. Aturan validasi dan status

### 7.1 Kesalahan wajib — menghalangi Salin Pesan

| Kode | Kondisi | Perbaikan |
|---|---|---|
| E01 | Pimpinan/tanggal tidak valid atau tidak ada kegiatan terpilih. | Lengkapi konteks dan pilih kegiatan. |
| E02 | Akses ditolak, koneksi dicabut, atau pengambilan sumber belum berhasil lengkap. | Hubungkan kembali melalui pihak berwenang atau muat ulang. |
| E03 | Judul, pokok agenda, mode pelaksanaan, atau waktu yang diperlukan tidak tersedia. | Perbaiki sumber atau isi pelengkap yang diizinkan. |
| E04 | Mode luring/hibrida tanpa tempat fisik. | Lengkapi tempat. |
| E05 | Mode daring/hibrida tanpa jalur bergabung yang layak. | Isi tautan yang telah diperiksa, atau ID rapat beserta kode yang diperlukan. |
| E06 | Diwakilkan tanpa nama perwakilan; atau redaksi menyatakan hadir ketika belum diputuskan. | Lengkapi perwakilan atau gunakan judul netral. |
| E07 | Jam selesai pasti tidak sesudah mulai; tipe waktu tidak sesuai; atau nilai melewati batas panjang. | Koreksi sumber/isian; tidak boleh memotong otomatis. |
| E08 | Ada perubahan belum disimpan, konflik versi operator, atau perubahan sumber belum diperiksa. | Simpan/rekonsiliasi lalu buat ulang. |
| E09 | Variabel template belum terisi; bukan tanda kurung yang memang bagian dari data sumber. | Lengkapi data atau perbaiki generator. |
| E10 | Pratinjau tidak sesuai versi saat ini, lewat batas kesegaran, atau belum dikonfirmasi operator. | Perbarui pesan dan periksa lagi. |

Jalur daring dianggap cukup jika ada tautan bergabung yang diperiksa operator, termasuk kejelasan kebutuhan kode; atau ID rapat dengan kode terisi jika diperlukan, atau pernyataan eksplisit Tidak diperlukan. Link yang mengandung akses tidak harus disertai kode terpisah. Status Belum diketahui pada akses rapat yang diperlukan tetap memblokir.

### 7.2 Peringatan — harus diselesaikan atau diakui

Peringatan meliputi bahan belum diperiksa/tersedia, kehadiran belum diputuskan, bentrok, kegiatan seharian, tanggal lampau, pemilihan sebagian kegiatan, serta tautan bahan yang akses penerimanya belum diperiksa. Peringatan tampil di antarmuka, tidak otomatis masuk ke pesan.

Operator dapat mengakui peringatan dengan pilihan yang jelas, misalnya Bahan tidak perlu dicantumkan, Akses bahan sudah saya periksa, atau Tetap sertakan sebagai agenda menunggu arahan. Pengakuan tidak mengubah status bahan menjadi tersedia dan tidak menyatakan akses benar-benar sudah diverifikasi sistem. Setelah input relevan berubah, pengakuan dibatalkan.

Untuk bahan rapat yang tidak tersedia, operator memilih menghilangkan bagian atau memasukkan keterangan yang sudah dikonfirmasi. Sistem tidak membuat janji Bahan akan disampaikan kemudian. Untuk kata terlampir, minta konfirmasi redaksi; jelaskan bahwa Salin Pesan tidak melampirkan file.

### 7.3 Status yang ditampilkan

Per kegiatan: Perlu dilengkapi, Perlu perhatian, Siap, atau Tidak dapat dipilih. Status hanya menjelaskan kesiapan pesan, bukan persetujuan pimpinan atau keberhasilan kegiatan.

Per draf: Belum dibuat, Draf belum lengkap, Perlu diperiksa, Siap disalin, Perlu diperbarui, atau Pernah disalin. Pernah disalin tidak mengalahkan Perlu diperbarui jika kemudian terjadi perubahan.

## 8. Aturan waktu, urutan, dan kehadiran

Hari dan tanggal selalu dihitung dari tanggal pilihan pada zona profil, misalnya Rabu, 16 September 2026. Label zona berasal dari konfigurasi yang benar: Asia/Jakarta menjadi WIB; jangan menempelkan WIB pada jam zona lain tanpa konversi.

Untuk acara berjam pasti, gunakan `Pukul 13.30–15.00 WIB`. Untuk sumber yang dikonfirmasi menyebut sampai selesai, gunakan `Pukul 13.30 WIB–selesai`. Google juga mempunyai `endTimeUnspecified`, yang dapat bernilai benar meskipun nilai akhir tetap tersedia; jadikan petunjuk untuk diperiksa, bukan mengganti fakta sumber secara otomatis. [R2]

Acara seharian tidak boleh diubah menjadi rapat pukul 00.00. Tampilkan `Seharian (jam tidak dicantumkan di kalender)` dan minta pengakuan operator. Untuk acara lintas hari, tampilkan tanggal mulai dan selesai aktual; jangan memotong rentang seolah kegiatan baru dimulai pada tanggal pilihan. Acara multi-hari hadir pada setiap tanggal yang beririsan, dengan catatan rentang yang jelas. Untuk acara seharian, tanggal sumber diperlakukan sebagai tanggal kalender, bukan diubah melalui UTC. Akhir `end.date` bersifat eksklusif; tanggal terakhir yang ditampilkan adalah sehari sebelumnya. [R2]

Urutan pesan: kegiatan seharian lebih dahulu, lalu kegiatan berjam menurut waktu mulai aktual; jika waktu sama, urutkan judul lalu ID internal secara stabil. Tidak ada drag-and-drop pada V1. Pemeriksaan bentrok memakai interval waktu `[mulai, selesai)`; acara yang berakhir tepat saat acara lain mulai tidak dianggap bertumpuk, tetapi aplikasi tidak menilai kecukupan perjalanan.

Kegiatan tanpa jam selesai pasti tidak dapat dinyatakan bebas bentrok. Sistem menampilkan Durasi belum pasti; bentrok belum dapat dipastikan. Acara seharian juga tidak otomatis dianggap menutup seluruh hari untuk keperluan keputusan hadir.

Jika kehadiran Belum diputuskan, gunakan judul netral dan tambahkan `Kehadiran menunggu arahan Bapak/Ibu.` pada Keterangan. Jika Diwakilkan, judul tidak menyatakan pimpinan hadir dan Keterangan memuat perwakilan. Jika judul sumber telah memuat Menghadiri/Memimpin sementara keputusan belum pasti, minta operator menetralkan judul pesan secara eksplisit. Jangan mengganti nama resmi atau menghapus kata secara sembarang.

## 9. Template pesan versi 1

### 9.1 Pembuka dan penutup

Pembuka tetap: `Izin {sapaan}, menyampaikan agenda {sapaan} pada hari {hari, tanggal}, sebagai berikut:`

Penutup tetap: `Demikian disampaikan sebagai pengingat {sapaan}. Terima kasih, {sapaan_penutup}.`

Satu kegiatan tidak memakai nomor. Dua atau lebih menggunakan nomor berurutan, tetapi pembuka dan penutup hanya satu kali. Awalan peran tidak ditambahkan dua kali apabila judul sudah memiliki awalan yang sama.

### 9.2 Struktur blok kegiatan

```text
{nomor_bila_jamak}{peran_bila_ada}{judul_pesan}

Waktu: {waktu_terformat}

Pelaksanaan: {pelaksanaan_terformat}

ID Rapat: {id_rapat_bila_relevan}

Kode Sandi: {kode_sandi_bila_relevan}

Tautan Rapat: {tautan_bila_disertakan}

Agenda:
{pokok_agenda}

Bahan Rapat:
{bahan_bila_dicantumkan}

Keterangan:
{keterangan_bila_ada}
```

Blok opsional yang kosong dihilangkan seluruhnya, termasuk label dan jarak yang tidak diperlukan. Untuk luring, hilangkan ID/kode/tautan rapat. Untuk hibrida, pelaksanaan menyebut tempat dan platform daring. Tidak ada label kosong, nilai null/undefined akibat kegagalan pemetaan, atau variabel template yang belum diisi. Pemeriksaan variabel dilakukan pada struktur template, bukan dengan menghapus karakter sah pada data sumber.

### 9.3 Kontrak pratinjau dan clipboard

V1 menghasilkan **teks biasa**, bukan dokumen HTML atau jaminan format tebal lintas aplikasi. Susunan, ejaan, jeda baris, dan nilai mengikuti template pengguna. Pratinjau isi pesan menampilkan string yang sama dengan clipboard; judul panel di luar pesan boleh memakai gaya tebal. Tidak ada tanda Markdown `**` yang ditambahkan otomatis. Dukungan pemformatan khusus WhatsApp dapat ditambahkan setelah V1.

Teks final kanonis menggunakan UTF-8 dan pemisah baris LF. Nomor, paragraf, dan spasi antarbagiannya ditentukan generator. Nilai kredensial tidak dinormalisasi, dipotong, atau ditambahi titik penutup. Hitungan karakter merupakan informasi aplikasi, bukan klaim batas karakter WhatsApp. Batas total produk: 40.000 karakter; kelebihan memblokir finalisasi dan meminta operator membagi pilihan, bukan memotong isi.

### 9.4 Contoh hasil satu kegiatan

Contoh berikut mengikuti redaksi pengguna; ID dan kode diganti placeholder demonstrasi untuk menghindari penggunaan kredensial nyata. Dalam keluaran aplikasi final, placeholder harus sudah diganti nilai yang diperiksa. Keputusan Akan hadir dan peran Menghadiri diasumsikan telah dikonfirmasi khusus untuk contoh ini.

```text
Izin Bapak, menyampaikan agenda Bapak pada hari Rabu, 16 September 2026, sebagai berikut:

Menghadiri Rapat Pembahasan Inisiasi Kerja Sama antara Kementerian Pendidikan Dasar dan Menengah dan Kementerian ATR/BPN

Waktu: Pukul 13.30 WIB–selesai

Pelaksanaan: Secara daring melalui Zoom Meeting

ID Rapat: [ID rapat sesuai sumber]

Kode Sandi: [kode sandi persis sumber]

Agenda:
Pembahasan inisiasi kerja sama antara Kementerian Pendidikan Dasar dan Menengah dan Kementerian Agraria dan Tata Ruang/Badan Pertanahan Nasional.

Bahan Rapat:
Rancangan Nota Kesepahaman tentang Sinergi Tugas dan Fungsi Bidang Agraria/Pertanahan, Tata Ruang dan Pendidikan Dasar dan Menengah, sebagaimana dilampirkan dalam undangan.

Keterangan:
Para Sekretaris Direktorat Jenderal di lingkungan Kementerian ATR/BPN termasuk dalam daftar pejabat yang diundang.

Demikian disampaikan sebagai pengingat Bapak. Terima kasih, Pak.
```

Frasa mengenai bahan dalam undangan dan daftar pejabat dipertahankan hanya jika operator telah memeriksa sumbernya. Generator tidak membuat kedua pernyataan tersebut dari judul acara.

## 10. Integrasi dan kesegaran Google Calendar

### 10.1 Koneksi dan pengambilan

Gunakan OAuth server-side dengan scope `calendar.events.readonly` dan `calendar.calendarlist.readonly`; aplikasi tidak meminta izin menulis kalender. Persetujuan akses Google berbeda dari penugasan pimpinan pada aplikasi. Token dan pemetaan kalender disimpan di server. [R3][R4]

V1 menggunakan pengambilan sesuai kebutuhan: ketika konteks dipilih, Muat Ulang ditekan, dan Buat/Perbarui Pesan ditekan. Tidak ada klaim sinkronisasi real-time. Server mengambil satu rentang hari di zona pimpinan dan menyelesaikan paginasi sebelum menerbitkan hasil lengkap.

Contoh parameter untuk tanggal 16 September 2026 di Asia/Jakarta:

```text
calendarId = ID dari pemetaan server, bukan input bebas klien
singleEvents = true
orderBy = startTime
timeMin = 2026-09-16T00:00:00+07:00
timeMax = 2026-09-17T00:00:00+07:00
timeZone = Asia/Jakarta
showDeleted = false
pageToken = lanjutkan selama nextPageToken tersedia
```

`timeMin` membatasi akhir acara dan `timeMax` membatasi awal acara, sehingga acara yang beririsan dengan hari pilihan ikut terambil. `singleEvents` menguraikan kegiatan berulang; pengurutan `startTime` memerlukannya. V1 tidak mencampurkan query tanggal ini dengan `syncToken`. [R1]

Acara `default` dan `fromGmail` menjadi kandidat pesan; kegiatan dari email tetap diperiksa operator. Tipe lainnya seperti focus time, lokasi kerja, dan ulang tahun tidak dipilih sebagai agenda pesan V1. Filter tipe dilakukan setelah pengambilan; antarmuka menjelaskan bahwa item non-agenda telah dikecualikan. Kegiatan dengan detail privat yang tidak dapat dibaca tidak boleh diisi dengan perkiraan.

### 10.2 Identitas acara dan perubahan

Simpan kunci sumber `(connection_id, calendar_id, event_id)`. Untuk pengulangan, simpan juga `recurringEventId` dan `originalStartTime`; jangan menjadikan judul atau jam yang telah berpindah sebagai identitas. Perubahan satu kemunculan tidak boleh mengubah pelengkap kemunculan lain. [R6]

Setelah pemuatan rentang berhasil lengkap, acara yang tidak lagi muncul dalam hasil aktif dikeluarkan dari rentang tersebut. Jangan menyimpulkan pasti dibatalkan: acara bisa dipindah ke hari lain atau berubah keterlihatannya. Status eksplisit batal juga tidak masuk pesan. Pelengkap dipertahankan sesuai kebijakan retensi dan akses.

Setiap snapshot mencatat waktu mulai/selesai pengambilan, hasil lengkap/gagal, serta versi acara. Simpan hash kumpulan kandidat pada tanggal tersebut agar penambahan kegiatan baru juga dapat memicu pemeriksaan pemilihan ulang.

### 10.3 Masa berlaku pratinjau

Keputusan produk awal: `MAX_COPY_AGE_SECONDS = 120`, dapat dikonfigurasi. Buat/Perbarui Pesan selalu melakukan pembacaan terbaru. Jika ditemukan perubahan dari yang dilihat operator, tampilkan perbedaannya dan minta tinjau ulang sebelum menyatakan siap.

Pratinjau kedaluwarsa jika lebih dari 120 detik sejak pengambilan sumber berhasil, data relevan berubah, pilihan berganti, atau ada perubahan formulir. Setelah tab kembali aktif, periksa umur pratinjau sebelum mengaktifkan salin. Tampilkan Perbarui Pesan jika kedaluwarsa; jangan melakukan permintaan jaringan panjang di antara klik salin dan operasi clipboard.

Batas ini mengurangi risiko, bukan jaminan data tidak berubah setelah pemeriksaan terakhir. Perubahan di Google dalam jendela tersebut belum tentu diketahui. Data yang sudah ditempel/dikirim di aplikasi lain tidak dapat ditarik kembali oleh V1.

### 10.4 Kegagalan integrasi

Bedakan kesalahan akses dengan pembatasan laju melalui kode dan alasan respons. Refresh token dapat dipakai untuk memperbarui akses yang kedaluwarsa; apabila otorisasi tidak dapat dipulihkan, arahkan ke penyambungan ulang. Untuk rate limit dan kegagalan sementara, lakukan retry terbatas dengan jeda meningkat; jangan retry tanpa batas. [R4][R7]

Target penanganan: paling banyak tiga percobaan dalam satu tindakan, dengan jitter dan batas waktu total 20 detik. Di luar itu, tampilkan gagal dan Coba lagi. Snapshot parsial tidak menggantikan snapshot lengkap. Cache lama boleh terlihat dengan label belum diperbarui selama akses lokal masih sah, tetapi tidak boleh dipakai untuk salin final. Saat pencabutan akses terdeteksi, hentikan penyajian data yang tidak lagi boleh dibuka.

## 11. Penyimpanan, versi, dan API internal

### 11.1 Model data minimum

| Entitas | Kolom pokok |
|---|---|
| `leaders` | ID, nama, jabatan, sapaan, zona waktu, konfigurasi kalender. |
| `user_leader_access` | User ID, leader ID, peran, status aktif. |
| `google_connections` | Pemilik otorisasi, token terenkripsi, scope, status koneksi. |
| `calendar_bindings` | Leader ID, connection ID, calendar ID, status. |
| `event_cache` | Kunci sumber, versi/etag, waktu, judul, bidang sumber yang dibutuhkan, metadata pengulangan. |
| `date_snapshots` | Leader ID, tanggal, zona, daftar kunci kandidat, hash, waktu pengambilan, status lengkap. |
| `event_supplements` | Leader ID, kunci kemunculan sumber, kolom pelengkap, asal, pemeriksa, dan revision. |
| `message_drafts` | User/leader/date, pilihan ID, snapshot hash, revisi pelengkap, versi template, teks terenkripsi, content hash, waktu kedaluwarsa. |
| `audit_logs` | Actor, aksi, referensi objek, nama kolom berubah, waktu, hasil; tanpa nilai rahasia. |

Simpan kredensial rapat dan draf yang memuatnya dengan perlindungan enkripsi serta akses terbatas. Jangan menyimpan respons Google mentah yang tidak diperlukan. Cache kalender dan pelengkap dipisahkan sehingga refresh kalender tidak menghilangkan pekerjaan operator.

Draf kerja terpisah per operator; pelengkap per pimpinan-kemunculan dibagi kepada operator yang berwenang. Simpan memakai nomor revisi. Ketika dua operator mengedit revisi yang sama, penulisan kedua mendapat konflik; tampilkan versi terbaru dan perubahan lokal untuk dibandingkan. Tidak ada last-write-wins diam-diam.

### 11.2 Kontrak API usulan

Nama endpoint di bawah adalah rancangan API aplikasi, bukan endpoint Google.

| Endpoint | Tujuan |
|---|---|
| `GET /api/leaders` | Mengembalikan pimpinan yang boleh dikelola pengguna. |
| `POST /api/agenda/refresh` | Menerima leader ID dan tanggal; melakukan pembacaan Google, menghasilkan snapshot lengkap atau kesalahan. |
| `GET /api/agenda?leaderId=...&date=...` | Membaca snapshot terotorisasi dan pelengkap, beserta status kesegaran. |
| `PATCH /api/agenda/{instanceId}/supplement` | Menyimpan pelengkap dengan leader ID dan expected revision; konflik menghasilkan 409. |
| `POST /api/messages/prepare` | Menyimpan draf yang sudah valid secara struktur, menyegarkan sumber, memvalidasi, dan menghasilkan teks kanonis serta hash. |
| `POST /api/messages/{draftId}/review` | Mencatat pengakuan peringatan dan pemeriksaan untuk content hash/revisi yang masih berlaku; mengembalikan kesiapan dan waktu kedaluwarsa. |
| `POST /api/messages/{draftId}/copy-result` | Mencatat hasil operasi clipboard yang dilaporkan klien, bukan bukti pengiriman. |
| `GET /api/google/connect` dan callback | Alur OAuth yang hanya dapat dijalankan administrator berwenang; callback kembali ke halaman kerja. |

Respons prepare minimal berisi `draftId`, `plainText`, `contentHash`, `templateVersion`, `snapshotId`, `checkedAt`, `expiresAt`, `errors[]`, dan `warnings[]`. Respons review berisi `readyToCopy`, hash, dan kedaluwarsa. Semua ID divalidasi ulang terhadap user dan leader; klien tidak boleh menugaskan kalender arbitrer.

Kesalahan internal aplikasi yang perlu dibedakan: 401 belum login; 403 akses dilarang; 409 versi/sumber berubah; 422 isian tidak valid; 429 permintaan berlebih; dan 503 sumber kalender sementara tidak tersedia. Jangan meneruskan token, stack trace, atau respons rahasia Google ke pengguna.

## 12. Penyalinan, keamanan, dan kualitas

### 12.1 Kontrak penyalinan

Sesudah prepare dan review berhasil, teks siap disimpan di memori halaman. Saat pengguna menekan Salin Pesan dalam masa berlaku, panggil `navigator.clipboard.writeText()` langsung dari tindakan pengguna. Sukses hanya ditampilkan setelah promise berhasil. Clipboard membutuhkan konteks aman dan dapat menolak penulisan; beberapa browser juga mensyaratkan interaksi pengguna. [R8][R9]

Jika gagal, tampilkan textarea hanya-baca berisi teks kanonis, tombol Pilih teks, dan petunjuk Ctrl+C/Cmd+C atau salin melalui menu perangkat. Alternatif ini hanya berlaku untuk draf yang sudah lolos pemeriksaan, bukan jalan pintas melewati validasi. Jangan meminta akses membaca clipboard dan jangan menyalin otomatis ketika halaman dibuka.

Audit salin adalah laporan klien yang dapat gagal terkirim, bukan bukti mutlak clipboard atau pengiriman. Kegagalan mencatat audit tidak mengubah notifikasi clipboard yang memang berhasil, tetapi dicatat melalui pemantauan kesalahan tanpa isi pesan.

### 12.2 Keamanan dan privasi

Gunakan HTTPS, session aman dengan cookie HttpOnly/Secure/SameSite yang sesuai, perlindungan CSRF pada operasi perubahan, dan pemeriksaan OAuth state. Simpan token di server, bukan di frontend/localStorage, URL, repository, atau log. Enkripsi token saat tersimpan dan hapus/cabut ketika tidak diperlukan, sesuai praktik Google. [R4][R5]

Deskripsi, judul, dan tautan adalah input tidak tepercaya: tampilkan sebagai teks aman; larang `javascript:`/`data:` pada tautan yang dapat diklik. Jangan mengunduh otomatis URL pelengkap dari server. Gunakan pemisahan kredensial pengembangan dan produksi serta data sintetis untuk pengujian.

API dan halaman sensitif tidak boleh masuk cache publik atau service-worker offline. Saat logout, hapus draf dari memori klien dan hentikan akses. Pemilihan nama/tanggal saja dapat dipulihkan selama session; jangan menyimpan isi rapat atau kode sandi dalam penyimpanan browser persisten.

Retensi teknis awal yang diusulkan: cache acara dan pelengkap 30 hari setelah kegiatan berakhir; draf 7 hari; audit metadata 90 hari. Angka ini bukan ketentuan retensi arsip kedinasan. Sebelum produksi, pemilik sistem menetapkan kebijakan retensi/backup dan mekanisme penghapusan yang berlaku; V1 bukan repositori arsip resmi. Legal hold atau kebutuhan resmi tidak boleh dihapus otomatis tanpa kebijakan yang disetujui.

### 12.3 Target nonfungsional

| Area | Target terukur yang diusulkan |
|---|---|
| Daftar dari cache | p95 maksimal 2 detik untuk 100 kegiatan/hari pada lingkungan uji yang didokumentasikan. |
| Render/validasi pesan | p95 maksimal 500 ms untuk 20 kegiatan, di luar waktu API Google. |
| Pembacaan eksternal | Status memuat langsung terlihat; timeout total 20 detik lalu kesalahan yang dapat dipulihkan. |
| Ukuran | Uji 100 kegiatan/hari; maksimum 20 kegiatan dipilih dan 40.000 karakter per pesan. Tidak ada pemotongan diam-diam. |
| Responsif | Tidak ada gulir horizontal pada lebar 360 px; uji desktop 1.280 px dan perbesaran teks 200%. |
| Aksesibilitas | Semua aksi dapat dilakukan dengan keyboard, fokus terlihat, kolom berlabel, serta status tidak bergantung pada warna saja. |
| Ketahanan | Refresh idempotent, respons usang diabaikan, simpan pelengkap berversi, dan tidak ada duplikasi kemunculan. |
| Kompatibilitas | Uji Chrome/Edge/Firefox desktop, Chrome Android, dan Safari iOS; catat versi aktual ketika UAT, termasuk jalur clipboard ditolak. |

## 13. Use cases dan UAT

Seluruh skenario di bawah merupakan tes yang harus dijalankan pengembang/QA, bukan hasil pengujian yang sudah dilakukan. K = kritis untuk akurasi/akses/alur utama; N = normal tetapi tetap wajib lulus sebelum rilis.

### 13.1 Konteks, sumber, dan data

| ID | Level | Skenario | Hasil yang diharapkan |
|---|---|---|---|
| UAT-01 | K | Operator punya akses ke pimpinan A, mencoba membaca B melalui UI dan ID request. | B tidak ditampilkan dan server menolak akses. |
| UAT-02 | K | Berpindah pimpinan/tanggal saat request lama belum selesai. | Data lama tidak menggantikan konteks baru; pratinjau lama dibersihkan. |
| UAT-03 | K | Ambil kegiatan tanggal 16 September 2026 zona Jakarta. | Pembuka menyebut Rabu, 16 September 2026; tidak bergantung zona perangkat. |
| UAT-04 | N | Kalender berhasil diperiksa dan kosong. | Pesan kosong yang tepat, tombol salin nonaktif, tidak ada klaim jadwal di luar kalender. |
| UAT-05 | K | Daftar membutuhkan beberapa halaman; halaman kedua gagal. | Tidak dinyatakan lengkap dan finalisasi diblokir; cache lama tidak ditimpa parsial. |
| UAT-06 | K | Rapat berulang hanya satu kemunculannya dipindahkan. | Kemunculan yang benar tampil satu kali; pelengkap tidak berpindah ke kemunculan lain. |
| UAT-07 | K | Acara terpilih dibatalkan atau dipindah ke hari lain sebelum prepare. | Acara keluar dari kandidat aktif dan draf meminta tinjau ulang. |
| UAT-08 | K | Rapat mulai 23.30 dan berakhir 00.30 hari berikutnya. | Muncul pada tanggal yang beririsan dengan rentang asli dan zona jelas. |
| UAT-09 | N | Acara seharian dan multi-hari. | Tidak diberi jam 00.00 fiktif; rentang hari benar, perlu pengakuan. |
| UAT-10 | K | Izin Google dicabut; refresh token gagal dipulihkan. | Tidak ada salin final; arahkan administrator menghubungkan ulang. |
| UAT-11 | N | Dua acara judul sama pada jam berbeda. | Keduanya tetap berbeda berdasarkan identitas, bukan digabung karena judul. |
| UAT-12 | K | Acara privat hanya menampilkan waktu sibuk. | Tidak menebak detail dan tidak bisa dipilih sebagai pesan lengkap. |

### 13.2 Formulir dan aturan pesan

| ID | Level | Skenario | Hasil yang diharapkan |
|---|---|---|---|
| UAT-13 | K | Satu rapat daring lengkap dipilih. | Template lengkap tanpa nomor, pembuka/penutup masing-masing satu kali. |
| UAT-14 | K | Tiga kegiatan dipilih dari urutan input acak. | Pesan bernomor sesuai urutan waktu; tidak mengikuti urutan klik. |
| UAT-15 | K | Kegiatan luring dengan tempat lengkap. | ID rapat, kode sandi, dan tautan daring dihilangkan. |
| UAT-16 | K | Kegiatan hibrida tanpa tempat fisik. | E04 memblokir salin sampai tempat diisi. |
| UAT-17 | K | Tautan daring valid dengan akses sudah jelas, tanpa ID/kode terpisah. | Dapat siap tanpa mewajibkan ID/kode yang memang tidak diperlukan. |
| UAT-18 | K | ID rapat terisi; kode wajib belum ada. | E05 memblokir; kode tidak ditebak. |
| UAT-19 | K | Kode uji `Contoh.2026.` dan ID uji `001 234 5678`. | Tanda titik, kapitalisasi, spasi, dan angka awal tetap persis. |
| UAT-20 | K | Sumber dikonfirmasi menyebut sampai selesai meskipun kalender berisi end time. | Output menggunakan sampai selesai, tidak menganggap end time sebagai waktu resmi. |
| UAT-21 | K | Status Google confirmed, rencana lokal belum diputuskan. | Tidak otomatis menulis Menghadiri; gunakan judul netral dan keterangan menunggu arahan. |
| UAT-22 | K | Diwakilkan tanpa nama, lalu nama diisi. | Awalnya diblokir; setelah lengkap, judul tidak menyatakan pimpinan hadir dan perwakilan dicantumkan. |
| UAT-23 | N | Bahan belum tersedia dan operator memilih menghilangkan bagian. | Label bahan dihilangkan; tidak membuat janji pengiriman kemudian. |
| UAT-24 | K | Bahan memakai kata terlampir sementara hanya teks yang disalin. | Konfirmasi redaksi diminta dan aplikasi tidak mengklaim file ikut dikirim. |
| UAT-25 | K | Deskripsi berisi dua kode berbeda atau label berulang. | Konflik ditampilkan; operator memilih, tidak ditimpa otomatis. |
| UAT-26 | N | Judul sudah diawali Menghadiri dan peran juga Menghadiri. | Awalan tampil sekali; nama kegiatan tidak rusak. |
| UAT-27 | K | Kegiatan tidak dipilih masih memiliki data wajib kosong. | Tidak memblokir pesan kegiatan lain yang terpilih dan lengkap. |
| UAT-28 | N | Dua rentang pasti tumpang tindih; lalu hanya berbatasan tepat. | Kasus pertama diperingatkan, kasus kedua tidak dinyatakan bentrok waktu. |
| UAT-29 | K | Kolom wajib kosong atau placeholder masih tersisa. | Draf pemeriksaan boleh terlihat; salin final tidak tersedia. |

### 13.3 Perubahan, clipboard, dan keamanan

| ID | Level | Skenario | Hasil yang diharapkan |
|---|---|---|---|
| UAT-30 | K | Ubah pelengkap atau pilihan setelah pratinjau diperiksa. | Kesiapan, pengakuan relevan, dan konfirmasi draf lama dibatalkan. |
| UAT-31 | K | Jam sumber berubah ketika prepare dilakukan. | Perubahan ditampilkan dan harus ditinjau ulang; waktu lama tidak diam-diam dipertahankan. |
| UAT-32 | K | Draf melewati 120 detik atau tab kembali setelah lama tidak aktif. | Tombol salin meminta Perbarui Pesan. |
| UAT-33 | K | ID/kode sumber berubah tetapi pelengkap manual masih lama. | Konflik menuntut pemeriksaan ulang sebelum finalisasi. |
| UAT-34 | K | Dua operator menyimpan revisi pelengkap yang sama. | Simpan kedua ditolak 409; kedua versi tersedia untuk rekonsiliasi. |
| UAT-35 | K | Klik salin pada draf siap di HTTPS. | Teks yang disalin sama dengan teks kanonis, termasuk baris dan kredensial. |
| UAT-36 | K | Browser menolak clipboard. | Muncul alternatif salin manual; tidak ada notifikasi berhasil palsu. |
| UAT-37 | K | Clipboard berhasil tetapi endpoint audit gagal. | UI tetap menyatakan hasil clipboard sebenarnya; tidak menulis status terkirim. |
| UAT-38 | K | Judul/deskripsi berisi HTML/script dan tautan javascript. | Tidak ada eksekusi; tautan berbahaya tidak dapat diklik. |
| UAT-39 | K | Periksa bundle klien, log, URL, dan penyimpanan browser. | Tidak ditemukan token Google/kode rapat dalam log atau penyimpanan persisten tak diizinkan. |
| UAT-40 | N | Teks melebihi batas, 21 kegiatan dipilih, layar 360 px, dan operasi keyboard. | Batas dijelaskan tanpa pemotongan; antarmuka tetap dapat digunakan dan fokus tidak hilang. |
| UAT-41 | K | Acara baru ditambahkan sebelum prepare pada tanggal yang sama. | Hash kumpulan berubah; operator diberi tahu untuk memeriksa pilihan, bukan diam-diam mengabaikan acara baru. |
| UAT-42 | K | Buka tautan bahan dari akun penerima uji yang tidak punya izin. | Operator melihat kebutuhan pemeriksaan; aplikasi tidak menyatakan akses sudah terjamin hanya karena tautan tersedia. |

Uji salin perlu mencakup pembandingan string clipboard, serta uji tempel manual ke tujuan kerja yang digunakan operator. Kesesuaian tampilan aplikasi lain dinilai melalui UAT, tidak diasumsikan dari pratinjau browser saja.

## 14. Rencana implementasi dan kriteria rilis

### 14.1 Urutan pengerjaan

| Tahap | Keluaran dan gerbang penyelesaian |
|---|---|
| 1 — Fondasi | Login, profil/akses, OAuth, kalender acuan, pengambilan rentang tanggal, dan keadaan gagal/kosong benar. |
| 2 — Halaman kerja | Filter, daftar, pilihan, formulir pelengkap berversi, dan validasi kondisional. |
| 3 — Pesan | Generator deterministik, template, penomoran, pratinjau, konfirmasi, kedaluwarsa, dan clipboard/fallback. |
| 4 — Pengerasan | Uji pengulangan, perubahan, paginasi gagal, keamanan objek, konflik operator, serta audit tanpa rahasia. |
| 5 — Pilot | Operator menjalankan skenario nyata pada kalender uji; hasil waktu kerja dan masalah dicatat sebelum produksi. |

Tidak ada estimasi durasi atau biaya tanpa kapasitas tim, lingkungan, dan integrasi yang ditetapkan. Ketergantungan penyiapan adalah akun Google Cloud, Calendar API aktif, OAuth client/redirect yang benar, izin kalender, daftar pimpinan/operator, serta lingkungan HTTPS. Status publik/internal dan kebutuhan verifikasi OAuth diperiksa pada penyiapan sesuai konfigurasi penerapan. [R4]

### 14.2 Definition of Done

Seluruh FR-01 sampai FR-15 tersedia dan semua UAT wajib telah dijalankan dengan bukti. Tidak ada cacat kritis/tinggi terbuka. Jadwal dapat diambil dari kalender uji nyata, termasuk pengulangan dan pembatalan, tanpa operasi tulis Google. String hasil generator/clipboard sesuai fixture dan tidak mengarang nilai kosong.

Dokumentasi pengaturan OAuth, pemetaan pimpinan, pencabutan koneksi, konfigurasi retensi, pemulihan error, serta langkah penggunaan operator tersedia. Target performa diukur pada lingkungan yang dicatat. Akses, penyimpanan rahasia, dan log diperiksa. Pemilik produk menyetujui template, kebijakan akses, serta retensi sebelum produksi.

Keluaran MVP dianggap selesai ketika operator dapat menyusun dan menyalin satu pesan yang benar melalui satu halaman, termasuk ketika data tidak lengkap atau sumber berubah. Penambahan fitur di luar cakupan tidak menggantikan kegagalan alur inti.

## 15. Rujukan teknis

Rujukan berikut diperiksa pada 17 September 2026. Rujukan menjelaskan perilaku platform; pilihan produk seperti batas 120 detik, jumlah kegiatan, retensi usulan, dan validasi merupakan keputusan rancangan PRD ini.

[R1] Google Calendar API — Events: list. Parameter rentang, urutan, paginasi, pengulangan, dan batas penggunaan syncToken.  
https://developers.google.com/workspace/calendar/api/v3/reference/events/list

[R2] Google Calendar API — Events resource. Bentuk data sumber, konferensi, lampiran, status, dan endTimeUnspecified.  
https://developers.google.com/workspace/calendar/api/v3/reference/events

[R3] Google Calendar API — Choose scopes. Izin baca acara dan daftar kalender.  
https://developers.google.com/workspace/calendar/api/auth

[R4] Google Identity — OAuth 2.0 for Web Server Applications. Persetujuan, redirect, state, refresh token, dan prasyarat penerapan.  
https://developers.google.com/identity/protocols/oauth2/web-server

[R5] Google Identity — OAuth best practices. Penyimpanan, enkripsi, dan pencabutan token.  
https://developers.google.com/identity/protocols/oauth2/resources/best-practices

[R6] Google Calendar API — Recurring events. Identitas rangkaian, kemunculan, dan pengecualian.  
https://developers.google.com/workspace/calendar/api/guides/recurringevents

[R7] Google Calendar API — Handle API errors. Error akses, rate limit, dan backoff.  
https://developers.google.com/workspace/calendar/api/guides/errors

[R8] MDN — Clipboard.writeText(). Penulisan teks, promise, konteks aman, dan penolakan izin.  
https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText

[R9] MDN — Clipboard API. Syarat keamanan dan perbedaan kebutuhan aktivasi pengguna antarbrowser.  
https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
