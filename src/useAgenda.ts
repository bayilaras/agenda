import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgendaEvent,
  CompositionMode,
  Draft,
  Leader,
  Snapshot,
  Supplement,
} from "../shared/types";
import {
  formatEventTime,
  isSelectable,
  todayInZone,
  validateEvents,
} from "../shared/domain";
import { api, ApiError } from "./api";
import {
  isCalendarSelectable,
  validateCalendarEvents,
} from "../shared/calendar-message";
import { writeCanonicalText } from "./clipboard";

export function useAgenda(notify: (message: string) => void) {
  const [compositionMode, setCompositionMode] =
    useState<CompositionMode>("calendar");
  const modeRef = useRef(compositionMode);
  modeRef.current = compositionMode;
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [leaderId, setLeaderId] = useState("");
  const [date, setDate] = useState(todayInZone("Asia/Jakarta"));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Supplement>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stale, setStale] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [conflict, setConflict] = useState<{
    id: string;
    latest: AgendaEvent;
  } | null>(null);
  const [sourceChanges, setSourceChanges] = useState<string[]>([]);
  const [externalChange, setExternalChange] = useState(false);
  const seq = useRef(0);
  const generation = useRef(0);
  const reviewSequence = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const leader = leaders.find((l) => l.id === leaderId);
  const events = snapshot?.events || [];
  const dirtyIds = Object.keys(edits).filter(
    (id) =>
      events.find((e) => e.id === id) &&
      JSON.stringify(edits[id]) !==
        JSON.stringify(events.find((e) => e.id === id)!.supplement),
  );
  const dirty = dirtyIds.length > 0;
  const visibleEvents = events.map((e) =>
    edits[e.id] ? { ...e, supplement: edits[e.id] } : e,
  );
  const chosen = visibleEvents.filter((e) => selected.includes(e.id));
  const selectable = events.filter(
    compositionMode === "calendar" ? isCalendarSelectable : isSelectable,
  );
  const validation = useMemo(
    () =>
      leader
        ? (compositionMode === "calendar"
            ? validateCalendarEvents
            : validateEvents)(chosen, leader, date, selectable.length)
        : { errors: [], warnings: [] },
    [JSON.stringify(chosen), leader, date, selectable.length, compositionMode],
  );
  const invalidate = useCallback(() => {
    generation.current++;
    reviewSequence.current++;
    setStale(true);
    setReady(false);
    setConfirmed(false);
    setCopied(false);
    setAcknowledged([]);
    setCopyFallback(false);
  }, []);
  useEffect(() => {
    const changed = () => {
      invalidate();
      setExternalChange(true);
      setError(
        "Profil atau pelengkap berubah pada tab lain. Muat Ulang kegiatan untuk memakai versi terbaru; isian Anda tetap tersedia.",
      );
    };
    window.addEventListener("agenda:data-changed", changed);
    return () => window.removeEventListener("agenda:data-changed", changed);
  }, [invalidate]);
  useEffect(() => {
    let alive = true;
    api<{ leaders: Leader[] }>("/api/leaders")
      .then(({ leaders: list }) => {
        if (alive) {
          setLeaders(list);
          if (list.length === 1) {
            setLeaderId(list[0].id);
            setDate(todayInZone(list[0].timeZone));
          }
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  const refresh = useCallback(
    async (id: string, day: string, clear = false) => {
      const request = ++seq.current;
      invalidate();
      setLoading(true);
      setError("");
      if (clear) {
        setSnapshot(null);
        setSelected([]);
        setEdits({});
        setDraft(null);
        setExpanded(null);
      }
      try {
        const { leaders: latestLeaders } = await api<{ leaders: Leader[] }>(
          "/api/leaders",
        );
        if (request !== seq.current) return;
        setLeaders(latestLeaders);
        const next = await api<Snapshot>("/api/agenda/refresh", {
          leaderId: id,
          date: day,
        });
        if (request !== seq.current) return;
        setSnapshot(next);
        setExternalChange(false);
        setSelected((previous) =>
          previous.filter((key) =>
            next.events.some(
              (e) =>
                e.id === key &&
                (modeRef.current === "calendar"
                  ? isCalendarSelectable(e)
                  : isSelectable(e)),
            ),
          ),
        );
      } catch (e) {
        if (request === seq.current) {
          setError((e as Error).message);
          setSnapshot(null);
          setSelected([]);
          setDraft(null);
        }
      } finally {
        if (request === seq.current) setLoading(false);
      }
    },
    [invalidate],
  );
  useEffect(() => {
    setSourceChanges([]);
    if (leaderId) void refresh(leaderId, date, true);
    else {
      seq.current++;
      setSnapshot(null);
      setLoading(false);
      setSelected([]);
      setEdits({});
      setDraft(null);
      setExpanded(null);
    }
  }, [leaderId, date, refresh]);
  useEffect(() => {
    const check = () => {
      if (draft && Date.now() > Date.parse(draft.expiresAt)) {
        setStale(true);
        setReady(false);
        setConfirmed(false);
        setCopyFallback(false);
      }
    };
    const timer = window.setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [draft]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };
  function changeLeader(id: string) {
    guard(() => {
      setLeaderId(id);
      const next = leaders.find((l) => l.id === id);
      if (next) setDate(todayInZone(next.timeZone));
      invalidate();
    });
  }
  function changeDate(next: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    guard(() => {
      setDate(next);
      invalidate();
    });
  }
  function changeCompositionMode(next: CompositionMode) {
    guard(() => {
      setCompositionMode(next);
      setExpanded(null);
      setDraft(null);
      setSelected((previous) =>
        previous.filter((id) =>
          events.some(
            (event) =>
              event.id === id &&
              (next === "calendar"
                ? isCalendarSelectable(event)
                : isSelectable(event)),
          ),
        ),
      );
      invalidate();
    });
  }
  async function save(id: string) {
    const event = events.find((e) => e.id === id);
    if (!event) return;
    setSaving(true);
    setError("");
    const context = seq.current;
    try {
      const next = await api<AgendaEvent>(
        `/api/agenda/${encodeURIComponent(id)}/supplement`,
        {
          leaderId,
          date,
          expectedRevision: event.revision,
          supplement: edits[id] || event.supplement,
        },
        "PATCH",
      );
      if (context !== seq.current) return;
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              events: prev.events.map((e) => (e.id === id ? next : e)),
            }
          : prev,
      );
      setEdits((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      if (
        !(compositionMode === "calendar"
          ? isCalendarSelectable(next)
          : isSelectable(next))
      )
        setSelected((prev) => prev.filter((key) => key !== id));
      invalidate();
      notify("Informasi pelengkap berhasil disimpan.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.latest)
        setConflict({ id, latest: e.data.latest as AgendaEvent });
      setError((e as Error).message);
      throw e;
    } finally {
      setSaving(false);
    }
  }
  async function resolvePending(saveFirst: boolean) {
    if (saveFirst) {
      try {
        for (const id of dirtyIds) await save(id);
      } catch {
        return;
      }
    }
    setEdits({});
    const action = pending;
    setPending(null);
    action?.();
  }
  function toggle(id: string) {
    invalidate();
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((v) => v !== id)
        : prev.length >= 20
          ? (notify("Maksimal 20 kegiatan per pesan."), prev)
          : [...prev, id],
    );
  }
  function toggleAll() {
    invalidate();
    setSelected((prev) =>
      prev.length === Math.min(selectable.length, 20)
        ? []
        : selectable.slice(0, 20).map((e) => e.id),
    );
    if (selectable.length > 20)
      notify("20 kegiatan pertama dipilih. Maksimal 20 kegiatan per pesan.");
  }
  function edit(id: string, value: Supplement) {
    setEdits((prev) => ({ ...prev, [id]: value }));
    invalidate();
  }
  async function prepare() {
    if (!leader || !snapshot || !selected.length || dirty || externalChange)
      return;
    invalidate();
    setPreparing(true);
    setError("");
    const version = generation.current;
    const context = seq.current;
    try {
      const next = await api<Draft>("/api/messages/prepare", {
        compositionMode,
        leaderId,
        date,
        eventIds: selected,
        snapshotHash: snapshot.hash,
        revisions: Object.fromEntries(
          events
            .filter((e) => selected.includes(e.id))
            .map((e) => [e.id, e.revision]),
        ),
      });
      if (context !== seq.current || version !== generation.current) return;
      setDraft(next);
      setStale(false);
      setSourceChanges([]);
      setSnapshot((prev) =>
        prev ? { ...prev, checkedAt: next.checkedAt } : prev,
      );
    } catch (e) {
      if (context !== seq.current) return;
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        ([401, 403].includes(e.status) ||
          String(e.data.code || "").startsWith("GOOGLE_"))
      )
        setDraft(null);
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setSnapshot(null);
        setSelected([]);
        setEdits({});
        setExpanded(null);
      }
      if (e instanceof ApiError && e.status === 409 && e.data.snapshot) {
        const next = e.data.snapshot as Snapshot;
        const changes: string[] = [];
        for (const event of next.events) {
          const old = snapshot.events.find((item) => item.id === event.id);
          if (!old) {
            changes.push(
              `Kegiatan baru: ${event.sourceTitle}. Periksa kembali pilihan kegiatan.`,
            );
            continue;
          }
          if (old.sourceVersion !== event.sourceVersion) {
            if (old.start !== event.start || old.end !== event.end)
              changes.push(
                `${event.sourceTitle}: ${formatEventTime(old, leader.timeZone)} → ${formatEventTime(event, leader.timeZone)}.`,
              );
            if (old.sourceTitle !== event.sourceTitle)
              changes.push(
                `Judul berubah: ${old.sourceTitle} → ${event.sourceTitle}.`,
              );
            if (old.sourceLocation !== event.sourceLocation)
              changes.push(
                `${event.sourceTitle}: lokasi sumber berubah dari ${old.sourceLocation || "kosong"} menjadi ${event.sourceLocation || "kosong"}.`,
              );
            if (
              old.description !== event.description ||
              JSON.stringify(old.sourceCandidates) !==
                JSON.stringify(event.sourceCandidates)
            )
              changes.push(
                `${event.sourceTitle}: deskripsi atau akses rapat berubah. Buat ulang pesan untuk menggunakan sumber terbaru.`,
              );
          }
          if (old.revision !== event.revision)
            changes.push(
              `${event.sourceTitle}: pelengkap diperbarui pada sesi lain (revisi ${event.revision}).`,
            );
        }
        for (const old of snapshot.events)
          if (!next.events.some((item) => item.id === old.id))
            changes.push(
              `Tidak lagi muncul pada tanggal ini: ${old.sourceTitle}.`,
            );
        setSourceChanges(
          changes.length
            ? changes
            : [
                "Sumber kegiatan berubah. Periksa kembali pilihan dan detail kegiatan.",
              ],
        );
        setSnapshot(next);
        setSelected((prev) =>
          prev.filter((id) =>
            next.events.some(
              (e) =>
                e.id === id &&
                (modeRef.current === "calendar"
                  ? isCalendarSelectable(e)
                  : isSelectable(e)),
            ),
          ),
        );
      }
    } finally {
      setPreparing(false);
    }
  }
  async function review(nextConfirmed: boolean, nextAck: string[]) {
    const request = ++reviewSequence.current;
    setConfirmed(nextConfirmed);
    setAcknowledged(nextAck);
    setReady(false);
    if (
      !draft ||
      stale ||
      draft.errors.length ||
      !nextConfirmed ||
      draft.warnings.some((w) => !nextAck.includes(w.id))
    )
      return;
    setError("");
    try {
      const result = await api<{ readyToCopy: boolean }>(
        "/api/messages/" + draft.draftId + "/review",
        {
          contentHash: draft.contentHash,
          acknowledgedWarnings: nextAck,
          confirmed: nextConfirmed,
        },
      );
      if (request === reviewSequence.current) setReady(result.readyToCopy);
    } catch (e) {
      if (request !== reviewSequence.current) return;
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) invalidate();
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        invalidate();
        setSnapshot(null);
        setSelected([]);
        setDraft(null);
        setEdits({});
        setExpanded(null);
      }
    }
  }
  async function copy() {
    if (
      !draft ||
      !ready ||
      !confirmed ||
      draft.warnings.some((w) => !acknowledged.includes(w.id)) ||
      stale ||
      Date.now() > Date.parse(draft.expiresAt)
    ) {
      invalidate();
      return;
    }
    const version = generation.current;
    const outcome = await writeCanonicalText(
      draft.plainText,
      navigator.clipboard,
    );
    if (version === generation.current) {
      if (outcome === "success") {
        setCopied(true);
        setCopyFallback(false);
        notify(
          "Pesan berhasil disalin. Silakan tempel dan periksa kembali sebelum dikirim.",
        );
      } else {
        setCopyFallback(true);
        notify(
          "Clipboard tidak tersedia. Gunakan pilihan salin manual di bawah pratinjau.",
        );
      }
    }
    void api(`/api/messages/${draft.draftId}/copy-result`, { outcome }).catch(
      () => {
        console.warn("Hasil clipboard belum tercatat pada audit.");
      },
    );
  }
  const blockedReason = !leader
    ? "Pilih pimpinan untuk mulai menyusun pesan."
    : !selected.length
      ? "Pilih kegiatan yang akan dimasukkan ke pesan."
      : dirty
        ? "Simpan perubahan kegiatan sebelum membuat pesan."
        : !draft
          ? "Buat pesan untuk melihat hasil dan pemeriksaan."
          : stale
            ? "Perbarui pesan sebelum melanjutkan pemeriksaan."
            : draft.errors.length
              ? compositionMode === "calendar"
                ? "Periksa data sumber kalender sebelum menyalin pesan."
                : "Lengkapi kolom wajib sebelum menyalin pesan."
              : draft.warnings.some((w) => !acknowledged.includes(w.id))
                ? "Periksa dan akui setiap perhatian di atas."
                : !confirmed
                  ? "Centang konfirmasi setelah isi pesan diperiksa."
                  : !ready
                    ? "Menyimpan hasil pemeriksaan…"
                    : "";
  return {
    compositionMode,
    changeCompositionMode,
    leaders,
    leader,
    leaderId,
    date,
    snapshot,
    events,
    visibleEvents,
    selected,
    selectable,
    edits,
    expanded,
    setExpanded,
    draft,
    stale,
    confirmed,
    acknowledged,
    ready,
    copied,
    copyFallback,
    loading,
    preparing,
    saving,
    error,
    setError,
    pending,
    setPending,
    conflict,
    setConflict,
    dirty,
    dirtyIds,
    validation,
    blockedReason,
    sourceChanges,
    invalidate,
    changeLeader,
    changeDate,
    refresh: () => guard(() => void refresh(leaderId, date)),
    toggle,
    toggleAll,
    edit,
    save,
    prepare,
    copy,
    review,
    guard,
    resolvePending,
    cancelEdit: (id: string) => {
      setEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setExpanded(null);
    },
    reconcile: () => {
      if (conflict) {
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                events: prev.events.map((e) =>
                  e.id === conflict.id ? conflict.latest : e,
                ),
              }
            : prev,
        );
        setConflict(null);
        invalidate();
      }
    },
    canPrepare:
      !!leader &&
      !!snapshot?.complete &&
      selected.length > 0 &&
      !dirty &&
      !externalChange &&
      !loading,
  };
}
