import { DateTime } from "luxon";
import { emptySupplement } from "../shared/domain.ts";
import type { AgendaEvent, Leader } from "../shared/types.ts";
import { hash } from "./storage.ts";

export const demoLeaders: Leader[] = [
  {
    id: "kepala-kantor",
    name: "Dr. Arif Pratama, S.H., M.H.",
    position: "Kepala Kantor Wilayah",
    salutation: "Bapak",
    closing: "Pak",
    timeZone: "Asia/Jakarta",
    calendarName: "Agenda Kepala Kantor Wilayah",
    revision: 1,
  },
  {
    id: "kepala-bagian",
    name: "Dra. Ratna Puspitasari, M.Si.",
    position: "Kepala Bagian Tata Usaha",
    salutation: "Ibu",
    closing: "Bu",
    timeZone: "Asia/Jakarta",
    calendarName: "Agenda Kepala Bagian Tata Usaha",
    revision: 1,
  },
];

export function demoEvents(leader: Leader, date: string): AgendaEvent[] {
  if (DateTime.fromISO(date, { zone: leader.timeZone }).weekday > 5) return [];
  const rows = [
    {
      time: "08:30",
      end: "09:15",
      title: "Briefing dan arahan pelaksanaan tugas",
      location: "Ruang Rapat Utama, Lantai 2",
      description:
        "Pelaksanaan: Luring\nAgenda:\nEvaluasi layanan pertanahan dan penetapan prioritas kerja hari ini.\nBahan Rapat:\nRingkasan capaian layanan dan tindak lanjut pekan berjalan.",
    },
    {
      time: "10:00",
      end: "11:00",
      title: "Rapat pembahasan kerja sama antarinstansi",
      location: "",
      description:
        "Pelaksanaan: Daring\nKeterangan:\nUndangan koordinasi melalui Zoom Meeting. Pokok agenda dan akses rapat perlu dikonfirmasi kepada penyelenggara.",
    },
    {
      time: "13:30",
      end: "14:30",
      title: "Koordinasi Gugus Tugas Reforma Agraria",
      location: "Ruang Rapat Reforma Agraria, Lantai 3",
      description:
        "Pelaksanaan: Hibrida\nID Rapat: 001 234 5678\nKode Sandi: Contoh.2026.\nAgenda:\nPembahasan progres penataan aset dan akses serta tindak lanjut usulan lokasi prioritas.\nBahan Rapat:\nMatriks pelaksanaan reforma agraria triwulan III.",
    },
    {
      time: "15:00",
      end: "15:45",
      title: "Penelaahan dokumen dan laporan kinerja",
      location: "Ruang Kerja Pimpinan",
      description:
        "Pelaksanaan: Luring\nAgenda:\nPenelaahan konsep laporan kinerja dan dokumen yang memerlukan arahan pimpinan.",
    },
    {
      time: "16:00",
      end: "17:00",
      title: "Waktu sibuk — kegiatan privat",
      location: "",
      description: "",
    },
  ];
  return rows.map((row, index) => {
    const event: AgendaEvent = {
      id: hash(`demo:${leader.id}:${date}:${index}`).slice(0, 32),
      sourceTitle: row.title,
      description: row.description,
      start: DateTime.fromISO(`${date}T${row.time}`, {
        zone: leader.timeZone,
      }).toISO()!,
      end: DateTime.fromISO(`${date}T${row.end}`, {
        zone: leader.timeZone,
      }).toISO()!,
      allDay: false,
      sourceLocation: row.location,
      htmlLink: "",
      sourceVersion: hash({ date, row, version: 1 }),
      status: "confirmed",
      readable: index !== 4,
      supplement: {} as AgendaEvent["supplement"],
      revision: 0,
      reviewedSourceVersion: "",
      conflicts: [],
    };
    event.supplement = emptySupplement(event);
    if (index === 0 || index === 2) {
      Object.assign(event.supplement, {
        attendance: "attending",
        role: index === 0 ? "Memimpin" : "Menghadiri",
        materialsStatus: "available",
        includeMaterials: true,
        sourceReviewed: true,
      });
      event.reviewedSourceVersion = event.sourceVersion;
    }
    if (index === 1)
      Object.assign(event.supplement, {
        mode: "online",
        platform: "Zoom Meeting",
        agenda: "",
        accessCode: "unknown",
      });
    if (index === 2)
      Object.assign(event.supplement, {
        mode: "hybrid",
        platform: "Zoom Meeting",
        meetingId: "001 234 5678",
        passcode: "Contoh.2026.",
        accessCode: "required",
        accessVerified: true,
      });
    if (index === 3)
      Object.assign(event.supplement, {
        mode: "offline",
        materialsStatus: "unavailable",
        includeMaterials: false,
      });
    return event;
  });
}
