"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import SiteImporter from "@/components/SiteImporter";
import ImageViewer, { type ViewerImage } from "@/components/ImageViewer";
import RefinementModal, {
  type RefinementJobInfo,
} from "@/components/RefinementModal";
import {
  estimateBatchCostUSD,
  estimateCostPerImageUSD,
  fmtUSD,
  fmtILS,
  usdToIls,
} from "@/lib/pricing";
import {
  type ImageSource,
  getConnection,
  uploadProductImage,
} from "@/lib/shopify-client";
import { slugifyProductName } from "@/lib/seo-slug";

type JobStatus = "queued" | "processing" | "done" | "error";

type Job = {
  id: string;
  file: File;
  previewUrl: string;
  status: JobStatus;
  resultDataUrl?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  costUSD?: number;
  source?: ImageSource;
  uploadedToSource?: {
    status: "idle" | "uploading" | "done" | "error";
    error?: string;
    newImageId?: number;
    replaceOriginal?: boolean;
  };
};

type Size = "1024x1024" | "1024x1536" | "1536x1024";
type Quality = "low" | "medium" | "high" | "auto";
type Mode = "single" | "group";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE_MB = 20;

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function bytesToHuman(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * מחזיר slug ידידותי-SEO לתמונה. אם המקור הוא Shopify – מבוסס על שם המוצר.
 * אחרת – משתמש בשם הקובץ המקורי (ללא הסיומת).
 */
function jobSeoSlug(job: Job): string {
  if (job.source?.type === "shopify" && job.source.productTitle) {
    return slugifyProductName(job.source.productTitle);
  }
  const base = job.file.name.replace(/\.[^.]+$/, "");
  return slugifyProductName(base);
}

function StatusChip({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; cls: string; dot: string }> = {
    queued: {
      label: "בתור",
      cls: "bg-slate-100 text-slate-700",
      dot: "bg-slate-400",
    },
    processing: {
      label: "מעבד...",
      cls: "bg-amber-100 text-amber-800",
      dot: "bg-amber-500 animate-pulse",
    },
    done: {
      label: "מוכן",
      cls: "bg-emerald-100 text-emerald-800",
      dot: "bg-emerald-500",
    },
    error: {
      label: "שגיאה",
      cls: "bg-rose-100 text-rose-800",
      dot: "bg-rose-500",
    },
  };
  const s = map[status];
  return (
    <span className={clsx("chip", s.cls)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [concurrency, setConcurrency] = useState(3);
  const [size, setSize] = useState<Size>("1024x1024");
  const [quality, setQuality] = useState<Quality>("high");
  const [prompt, setPrompt] = useState<string>("");
  const [padding, setPadding] = useState<number>(20);
  const [mode, setMode] = useState<Mode>("single");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null);
  const [refineJobId, setRefineJobId] = useState<string | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkOp, setBulkOp] = useState<{
    running: boolean;
    label: string;
    done: number;
    total: number;
    errors: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // נקה ObjectURLs כשהקומפוננטה יורדת
  useEffect(() => {
    return () => {
      jobs.forEach((j) => URL.revokeObjectURL(j.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const total = jobs.length;
    const done = jobs.filter((j) => j.status === "done").length;
    const err = jobs.filter((j) => j.status === "error").length;
    const proc = jobs.filter((j) => j.status === "processing").length;
    const queued = jobs.filter((j) => j.status === "queued").length;
    return { total, done, err, proc, queued };
  }, [jobs]);

  const costInfo = useMemo(() => {
    const pendingCount = jobs.filter(
      (j) => j.status === "queued" || j.status === "error" || j.status === "processing"
    ).length;
    const estimatePending = estimateBatchCostUSD(pendingCount, size, quality);
    const perImage = estimateCostPerImageUSD(size, quality);
    const actualSpent = jobs.reduce(
      (sum, j) => sum + (j.status === "done" && j.costUSD ? j.costUSD : 0),
      0
    );
    return { pendingCount, estimatePending, perImage, actualSpent };
  }, [jobs, size, quality]);

  const addItems = useCallback(
    (items: Array<{ file: File; source?: ImageSource }>) => {
      const accepted: Job[] = [];
      const rejected: string[] = [];
      for (const it of items) {
        const f = it.file;
        if (!ACCEPTED.includes(f.type)) {
          rejected.push(`${f.name} (פורמט לא נתמך)`);
          continue;
        }
        if (f.size > MAX_SIZE_MB * 1024 * 1024) {
          rejected.push(`${f.name} (מעל ${MAX_SIZE_MB}MB)`);
          continue;
        }
        accepted.push({
          id: uid(),
          file: f,
          previewUrl: URL.createObjectURL(f),
          status: "queued",
          source: it.source,
        });
      }
      if (accepted.length > 0) {
        setJobs((prev) => [...prev, ...accepted]);
      }
      if (rejected.length > 0) {
        alert(`חלק מהקבצים לא נוספו:\n\n${rejected.join("\n")}`);
      }
    },
    []
  );

  // wrapper לתאימות לאחור – לhandle של drag&drop/בחירת קבצים שמעבירים File[]
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      addItems(Array.from(files).map((file) => ({ file })));
    },
    [addItems]
  );

  const onPick = () => inputRef.current?.click();

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeJob = (id: string) => {
    setJobs((prev) => {
      const target = prev.find((j) => j.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((j) => j.id !== id);
    });
    setSelectedJobIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const clearAll = () => {
    if (jobs.length === 0) return;
    if (!confirm("למחוק את כל התמונות מהרשימה?")) return;
    jobs.forEach((j) => URL.revokeObjectURL(j.previewUrl));
    setJobs([]);
    setSelectedJobIds(new Set());
  };

  const clearCompleted = () => {
    setJobs((prev) => {
      prev
        .filter((j) => j.status === "done")
        .forEach((j) => URL.revokeObjectURL(j.previewUrl));
      return prev.filter((j) => j.status !== "done");
    });
    setSelectedJobIds(new Set());
  };

  const processOne = useCallback(
    async (job: Job) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? { ...j, status: "processing", startedAt: Date.now(), error: undefined }
            : j
        )
      );

      try {
        const fd = new FormData();
        fd.append("image", job.file);
        fd.append("size", size);
        fd.append("quality", quality);
        fd.append("padding", String(padding));
        fd.append("mode", mode);
        if (prompt.trim()) fd.append("prompt", prompt.trim());

        const res = await fetch("/api/process", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `שגיאה ${res.status}`);
        }

        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: "done",
                  resultDataUrl: data.image,
                  finishedAt: Date.now(),
                  costUSD: typeof data.costUSD === "number" ? data.costUSD : undefined,
                }
              : j
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "error", error: message, finishedAt: Date.now() }
              : j
          )
        );
      }
    },
    [size, quality, prompt, padding, mode]
  );

  const runAll = async () => {
    if (isRunning) return;
    const pending = jobs.filter((j) => j.status === "queued" || j.status === "error");
    if (pending.length === 0) return;

    setIsRunning(true);
    // אפס שגיאות לתור
    setJobs((prev) =>
      prev.map((j) =>
        j.status === "error" ? { ...j, status: "queued", error: undefined } : j
      )
    );

    const queue = [...pending];
    const workers: Promise<void>[] = [];
    const limit = Math.max(1, Math.min(8, concurrency));

    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        await processOne(next);
      }
    };

    for (let i = 0; i < limit; i++) workers.push(worker());
    await Promise.all(workers);
    setIsRunning(false);
  };

  const retryJob = (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    processOne({ ...job, status: "queued" });
  };

  const refineJob = useCallback(
    async (
      jobId: string,
      args: { refinement: string; quality: Quality; mask?: Blob | null }
    ): Promise<void> => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job || !job.resultDataUrl) {
        throw new Error("התמונה לא מוכנה לתיקון.");
      }
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                status: "processing",
                startedAt: Date.now(),
                error: undefined,
              }
            : j
        )
      );
      try {
        const prevB64 = job.resultDataUrl.split(",")[1];
        const prevBytes = atob(prevB64);
        const prevArr = new Uint8Array(prevBytes.length);
        for (let i = 0; i < prevBytes.length; i++)
          prevArr[i] = prevBytes.charCodeAt(i);
        const prevBlob = new Blob([prevArr], { type: "image/png" });

        const fd = new FormData();
        fd.append("image", job.file);
        fd.append("previousResult", prevBlob, "previous_result.png");
        fd.append("refinement", args.refinement);
        fd.append("quality", args.quality);
        fd.append("size", size);
        fd.append("mode", mode);
        if (args.mask) {
          fd.append("mask", args.mask, "mask.png");
        }

        const res = await fetch("/api/process", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `שגיאה ${res.status}`);
        }

        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: "done",
                  resultDataUrl: data.image,
                  finishedAt: Date.now(),
                  // מצטברים: עלות התיקון נוספת לעלות המצטברת של הג'וב
                  costUSD:
                    (j.costUSD || 0) +
                    (typeof data.costUSD === "number" ? data.costUSD : 0),
                  // איפוס סטטוס העלאה ל-Shopify – צריך להעלות מחדש את התוצאה החדשה
                  uploadedToSource: undefined,
                }
              : j
          )
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId
              ? {
                  ...j,
                  status: "done", // נשאר מוכן (עם התוצאה הקודמת)
                  error: `תיקון נכשל: ${message}`,
                  finishedAt: Date.now(),
                }
              : j
          )
        );
        throw err; // כדי שהמודאל יראה את השגיאה
      }
    },
    [jobs, size, mode]
  );

  const refineJobInfo: RefinementJobInfo | null = useMemo(() => {
    if (!refineJobId) return null;
    const j = jobs.find((x) => x.id === refineJobId);
    if (!j || !j.resultDataUrl) return null;
    return {
      id: j.id,
      fileName: j.file.name,
      originalUrl: j.previewUrl,
      resultDataUrl: j.resultDataUrl,
    };
  }, [refineJobId, jobs]);

  const downloadOne = (job: Job) => {
    if (!job.resultDataUrl) return;
    const a = document.createElement("a");
    a.href = job.resultDataUrl;
    a.download = `${jobSeoSlug(job)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const uploadToShopify = async (
    jobId: string,
    opts: { replaceOriginal: boolean }
  ) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job || !job.source || job.source.type !== "shopify" || !job.resultDataUrl)
      return;
    const conn = getConnection();
    if (!conn) {
      alert("נראה שהתנתקת מ-Shopify. פתח את 'ייבוא תמונות מאתר' והתחבר מחדש.");
      return;
    }
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              uploadedToSource: {
                status: "uploading",
                replaceOriginal: opts.replaceOriginal,
              },
            }
          : j
      )
    );
    try {
      const b64 = job.resultDataUrl.split(",")[1];
      const slug = jobSeoSlug(job);
      const res = await uploadProductImage(conn, {
        productId: job.source.productId,
        base64: b64,
        filename: `${slug}.png`,
        alt: job.source.productTitle,
        replaceOriginal: opts.replaceOriginal,
      });
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                uploadedToSource: {
                  status: "done",
                  newImageId: res.image?.id,
                  replaceOriginal: opts.replaceOriginal,
                },
              }
            : j
        )
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה לא ידועה";
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId
            ? {
                ...j,
                uploadedToSource: {
                  status: "error",
                  error: msg,
                  replaceOriginal: opts.replaceOriginal,
                },
              }
            : j
        )
      );
    }
  };

  const downloadAllZip = async () => {
    const done = jobs.filter((j) => j.status === "done" && j.resultDataUrl);
    if (done.length === 0) return;
    const zip = new JSZip();
    const used = new Map<string, number>();
    for (const j of done) {
      const base64 = j.resultDataUrl!.split(",")[1];
      const slug = jobSeoSlug(j);
      // הימנעות מהתנגשויות שם בתוך ה-ZIP (לדוגמה כשבחרת כמה תמונות לאותו מוצר)
      const n = (used.get(slug) || 0) + 1;
      used.set(slug, n);
      const name = n === 1 ? `${slug}.png` : `${slug}-${n}.png`;
      zip.file(name, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `photospro_${new Date().toISOString().slice(0, 10)}.zip`);
  };

  // --- בחירה מרובה ופעולות בכמות ---

  const doneJobs = useMemo(
    () => jobs.filter((j) => j.status === "done" && j.resultDataUrl),
    [jobs]
  );

  const selectedJobs = useMemo(
    () => doneJobs.filter((j) => selectedJobIds.has(j.id)),
    [doneJobs, selectedJobIds]
  );

  const selectedShopifyJobs = useMemo(
    () => selectedJobs.filter((j) => j.source?.type === "shopify"),
    [selectedJobs]
  );

  const toggleJobSelected = (id: string) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllDone = () => {
    setSelectedJobIds(new Set(doneJobs.map((j) => j.id)));
  };

  const clearSelection = () => setSelectedJobIds(new Set());

  // האם הסלקציה נקבעת אוטומטית כש"בחר הכל" יבחר בכל המוכנים?
  const allDoneSelected =
    doneJobs.length > 0 && selectedJobIds.size === doneJobs.length;

  const downloadSelectedZip = async () => {
    if (selectedJobs.length === 0) return;
    if (selectedJobs.length === 1) {
      downloadOne(selectedJobs[0]);
      return;
    }
    const zip = new JSZip();
    const used = new Map<string, number>();
    for (const j of selectedJobs) {
      const base64 = j.resultDataUrl!.split(",")[1];
      const slug = jobSeoSlug(j);
      const n = (used.get(slug) || 0) + 1;
      used.set(slug, n);
      const name = n === 1 ? `${slug}.png` : `${slug}-${n}.png`;
      zip.file(name, base64, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(
      blob,
      `photospro_selected_${new Date().toISOString().slice(0, 10)}.zip`
    );
  };

  const bulkUploadToShopify = async (replaceOriginal: boolean) => {
    if (selectedShopifyJobs.length === 0 || bulkOp?.running) return;
    if (replaceOriginal) {
      const ok = confirm(
        `להחליף את התמונה הראשית הקיימת בכל ${selectedShopifyJobs.length} המוצרים הנבחרים? התמונות הישנות יימחקו לצמיתות מ-Shopify.`
      );
      if (!ok) return;
    }
    const conn = getConnection();
    if (!conn) {
      alert("נראה שהתנתקת מ-Shopify. פתח את 'ייבוא תמונות מאתר' והתחבר מחדש.");
      return;
    }
    const total = selectedShopifyJobs.length;
    setBulkOp({
      running: true,
      label: replaceOriginal
        ? "מעלה ל-Shopify ומוחק ראשיות ישנות..."
        : "מעלה ל-Shopify (שומר ישנות כמשניות)...",
      done: 0,
      total,
      errors: [],
    });
    // נסמן את כולן כ-uploading מראש
    setJobs((prev) =>
      prev.map((j) =>
        selectedJobIds.has(j.id) && j.source?.type === "shopify"
          ? {
              ...j,
              uploadedToSource: {
                status: "uploading",
                replaceOriginal,
              },
            }
          : j
      )
    );

    const errors: string[] = [];
    let doneCount = 0;
    // ריצה רציפה כדי לא לחנוק את Shopify (יש להם rate limit של 2/s לרוב החנויות)
    for (const job of selectedShopifyJobs) {
      if (!job.source || job.source.type !== "shopify" || !job.resultDataUrl)
        continue;
      try {
        const b64 = job.resultDataUrl.split(",")[1];
        const slug = jobSeoSlug(job);
        const res = await uploadProductImage(conn, {
          productId: job.source.productId,
          base64: b64,
          filename: `${slug}.png`,
          alt: job.source.productTitle,
          replaceOriginal,
        });
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  uploadedToSource: {
                    status: "done",
                    newImageId: res.image?.id,
                    replaceOriginal,
                  },
                }
              : j
          )
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "שגיאה לא ידועה";
        errors.push(`${job.source.productTitle}: ${msg}`);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  uploadedToSource: {
                    status: "error",
                    error: msg,
                    replaceOriginal,
                  },
                }
              : j
          )
        );
      }
      doneCount++;
      setBulkOp((prev) =>
        prev ? { ...prev, done: doneCount, errors: [...errors] } : prev
      );
    }

    setBulkOp((prev) =>
      prev
        ? {
            ...prev,
            running: false,
            done: doneCount,
            errors,
          }
        : prev
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              PhotosPro
            </h1>
            <p className="text-sm text-slate-500">
              רקע לבן מקצועי לתמונות מוצר • 1:1 • מבוסס GPT Image 2
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-ghost"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            הגדרות מתקדמות
          </button>
          <button
            className="btn-secondary"
            onClick={downloadAllZip}
            disabled={stats.done === 0}
            title="הורדת כל התוצאות כ-ZIP"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            הורד הכל ({stats.done})
          </button>
          {costInfo.pendingCount > 0 && !isRunning && (
            <div
              className="chip bg-amber-50 text-amber-900 ring-1 ring-amber-200"
              title={`הערכה לפי איכות ${quality} וגודל ${size}. העלות הסופית עלולה להשתנות מעט.`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5"
              >
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              עלות משוערת: {fmtUSD(costInfo.estimatePending)} (
              {fmtILS(usdToIls(costInfo.estimatePending))})
            </div>
          )}
          <button
            className="btn-primary"
            onClick={runAll}
            disabled={isRunning || stats.queued + stats.err === 0}
          >
            {isRunning ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                מעבד...
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                התחל עיבוד
              </>
            )}
          </button>
        </div>
      </header>

      {/* ייבוא תמונות מאתר */}
      <SiteImporter onImport={addItems} size={size} quality={quality} />

      {/* בורר מצב עיבוד */}
      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          מצב עיבוד
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={clsx(
              "group relative overflow-hidden rounded-2xl p-4 text-right ring-2 transition",
              mode === "single"
                ? "bg-white ring-brand-600 shadow-soft"
                : "bg-white/70 ring-slate-200 hover:ring-slate-300"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={clsx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white",
                  mode === "single"
                    ? "bg-gradient-to-br from-brand-500 to-brand-700"
                    : "bg-slate-300"
                )}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">
                    מוצר בודד – רקע לבן
                  </h3>
                  {mode === "single" && (
                    <span className="chip bg-brand-100 text-brand-700">
                      ✓ פעיל
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  כל תמונה היא מוצר אחד. שומר עליו זהה לחלוטין ושם אותו על רקע
                  לבן נקי, ממורכז, עם מרווח – לכרטיסי מוצר באתר.
                </p>
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("group")}
            className={clsx(
              "group relative overflow-hidden rounded-2xl p-4 text-right ring-2 transition",
              mode === "group"
                ? "bg-white ring-purple-600 shadow-soft"
                : "bg-white/70 ring-slate-200 hover:ring-slate-300"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={clsx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white",
                  mode === "group"
                    ? "bg-gradient-to-br from-purple-500 to-purple-700"
                    : "bg-slate-300"
                )}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <path d="M3 3h7v7H3z" />
                  <path d="M14 3h7v7h-7z" />
                  <path d="M14 14h7v7h-7z" />
                  <path d="M3 14h7v7H3z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">
                    סידור קבוצתי – תמונת קולקציה
                  </h3>
                  {mode === "group" && (
                    <span className="chip bg-purple-100 text-purple-700">
                      ✓ פעיל
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  כל תמונה יכולה להכיל כמה פריטים. המערכת תסדר אותם יחד
                  בקומפוזיציה מקצועית של "סט/קיט" – נשענים, ערומים, יפה
                  למכירה.
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* בקרת מרווח (תמיד נראית – הגדרה חשובה) */}
      <div className="card mb-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="padding"
                className="text-sm font-semibold text-slate-700"
              >
                {mode === "group"
                  ? "גודל הסידור בתמונה"
                  : "גודל המוצר בתמונה"}
              </label>
              <span
                className={clsx(
                  "chip",
                  mode === "group"
                    ? "bg-purple-100 text-purple-800"
                    : "bg-brand-100 text-brand-800"
                )}
              >
                מרווח לבן {padding}% מכל צד •{" "}
                {mode === "group" ? "סידור" : "מוצר"} ~{100 - padding * 2}%
              </span>
            </div>
            <input
              id="padding"
              type="range"
              min={0}
              max={35}
              step={1}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
              className={clsx(
                "mt-3 w-full",
                mode === "group" ? "accent-purple-600" : "accent-brand-600"
              )}
            />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>גדול (ממלא את הפריים)</span>
              <span>בינוני (מומלץ לכרטיסי מוצר)</span>
              <span>קטן מאוד (הרבה רקע)</span>
            </div>
          </div>
        </div>
      </div>

      {/* הגדרות מתקדמות */}
      {showAdvanced && (
        <div className="card mb-6 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                גודל פלט
              </label>
              <select
                className="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={size}
                onChange={(e) => setSize(e.target.value as Size)}
              >
                <option value="1024x1024">ריבוע 1:1 (1024×1024)</option>
                <option value="1024x1536">לאורך 2:3 (1024×1536)</option>
                <option value="1536x1024">לרוחב 3:2 (1536×1024)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                איכות
              </label>
              <select
                className="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={quality}
                onChange={(e) => setQuality(e.target.value as Quality)}
              >
                <option value="high">גבוהה (הכי מקצועי)</option>
                <option value="medium">בינונית</option>
                <option value="low">נמוכה (מהיר וזול)</option>
                <option value="auto">אוטומטי</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                מקבילות (במקביל)
              </label>
              <input
                type="number"
                min={1}
                max={8}
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(
                    Math.max(1, Math.min(8, Number(e.target.value) || 1))
                  )
                }
                className="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              פרומפט מותאם (אופציונלי – ריק = ברירת מחדל מקצועית עם המרווח שבחרת)
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="לדוגמה: רקע לבן נקי, צל רך מתחת, תאורת סטודיו, תמונה מתאימה לאמזון..."
              className="w-full rounded-xl border-slate-200 bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      )}

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={onPick}
        className={clsx(
          "card flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center transition-all",
          isDragging
            ? "ring-2 ring-brand-500 bg-brand-50/50 scale-[1.01]"
            : "hover:bg-slate-50"
        )}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div>
          <p className="text-base font-semibold">
            גרור לכאן תמונות מוצר, או לחץ לבחירה
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PNG / JPG / WEBP • עד {MAX_SIZE_MB}MB לקובץ • אפשר הרבה ביחד
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* סרגל סטטוס */}
      {jobs.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/70 px-4 py-3 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="chip bg-slate-100 text-slate-700">
              סה״כ: <b>{stats.total}</b>
            </span>
            <span className="chip bg-amber-100 text-amber-800">
              בעיבוד: <b>{stats.proc}</b>
            </span>
            <span className="chip bg-emerald-100 text-emerald-800">
              מוכן: <b>{stats.done}</b>
            </span>
            {stats.err > 0 && (
              <span className="chip bg-rose-100 text-rose-800">
                שגיאות: <b>{stats.err}</b>
              </span>
            )}
            <span className="chip bg-slate-100 text-slate-700">
              בתור: <b>{stats.queued}</b>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {doneJobs.length > 0 && (
              <button
                className="btn-ghost"
                onClick={allDoneSelected ? clearSelection : selectAllDone}
                title={
                  allDoneSelected
                    ? "בטל בחירת הכל"
                    : "בחר את כל התמונות המוכנות"
                }
              >
                {allDoneSelected
                  ? "בטל בחירה"
                  : `בחר את כל המוכנים (${doneJobs.length})`}
              </button>
            )}
            <button className="btn-ghost" onClick={clearCompleted}>
              נקה מוכנים
            </button>
            <button className="btn-ghost text-rose-600" onClick={clearAll}>
              נקה הכל
            </button>
          </div>
        </div>
      )}

      {/* פס פעולות מרובות – מופיע כשיש בחירה או כשפעולה רצה */}
      {(selectedJobIds.size > 0 || bulkOp) && (
        <div className="sticky top-2 z-20 mt-3 rounded-2xl bg-emerald-600 px-4 py-3 text-white shadow-soft ring-1 ring-emerald-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">
                  {bulkOp
                    ? bulkOp.label
                    : `נבחרו ${selectedJobIds.size} תמונות מוכנות`}
                </p>
                <p className="text-[11px] text-emerald-100">
                  {bulkOp
                    ? `${bulkOp.done} / ${bulkOp.total} הושלמו${
                        bulkOp.errors.length
                          ? ` • ${bulkOp.errors.length} שגיאות`
                          : ""
                      }`
                    : selectedShopifyJobs.length > 0
                      ? `מתוכן ${selectedShopifyJobs.length} מקושרות ל-Shopify`
                      : "תמונות אלו לא מקושרות ל-Shopify – אפשר להוריד בלבד"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!bulkOp?.running && (
                <>
                  <button
                    onClick={downloadSelectedZip}
                    disabled={selectedJobs.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                    title="הורד את כל התמונות הנבחרות (ZIP אם יותר מאחת)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    הורד את הנבחרות ({selectedJobs.length})
                  </button>
                  {selectedShopifyJobs.length > 0 && (
                    <>
                      <button
                        onClick={() => bulkUploadToShopify(false)}
                        disabled={selectedShopifyJobs.length === 0}
                        className="inline-flex flex-col items-start rounded-lg bg-white px-3 py-1.5 text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                        title="התמונות החדשות יהפכו לראשיות. הראשיות הקיימות יישמרו כתמונות משניות."
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                          >
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                          הגדר כראשיות + שמור ישנות ({selectedShopifyJobs.length})
                        </span>
                        <span className="text-[9px] font-normal text-emerald-500">
                          מומלץ – לא מוחק כלום
                        </span>
                      </button>
                      <button
                        onClick={() => bulkUploadToShopify(true)}
                        disabled={selectedShopifyJobs.length === 0}
                        className="inline-flex flex-col items-start rounded-lg bg-white px-3 py-1.5 text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:opacity-50"
                        title="מחיקת הראשיות הישנות והחלפתן בחדשות."
                      >
                        <span className="flex items-center gap-1.5 text-xs font-semibold">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                          הגדר כראשיות + מחק ישנות ({selectedShopifyJobs.length})
                        </span>
                        <span className="text-[9px] font-normal text-rose-400">
                          פעולה הרסנית
                        </span>
                      </button>
                    </>
                  )}
                  <button
                    onClick={clearSelection}
                    className="rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25"
                  >
                    בטל בחירה
                  </button>
                </>
              )}
              {bulkOp?.running && (
                <div className="flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-xs">
                  <svg
                    className="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {bulkOp.done}/{bulkOp.total}
                </div>
              )}
              {bulkOp && !bulkOp.running && (
                <button
                  onClick={() => setBulkOp(null)}
                  className="rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25"
                >
                  סגור
                </button>
              )}
            </div>
          </div>
          {bulkOp?.running && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full bg-white transition-all"
                style={{
                  width: `${
                    bulkOp.total > 0 ? (bulkOp.done / bulkOp.total) * 100 : 0
                  }%`,
                }}
              />
            </div>
          )}
          {bulkOp && !bulkOp.running && bulkOp.errors.length > 0 && (
            <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-white/10 p-2 text-[11px]">
              {bulkOp.errors.map((e, i) => (
                <p key={i} className="text-rose-100">
                  • {e}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* מחשבון עלויות */}
      {jobs.length > 0 && (
        <div className="mt-3 rounded-2xl bg-gradient-to-l from-amber-50 to-white p-4 ring-1 ring-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  מחשבון עלויות OpenAI
                </p>
                <p className="text-xs text-slate-500">
                  לפי איכות <b>{quality}</b> וגודל <b>{size}</b> • ~
                  {fmtUSD(costInfo.perImage)} לכל תמונה
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {costInfo.pendingCount > 0 && (
                <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-amber-200">
                  <p className="text-[11px] text-slate-500">
                    לעיבוד ({costInfo.pendingCount} תמונות)
                  </p>
                  <p className="text-sm font-bold text-amber-700">
                    ~{fmtUSD(costInfo.estimatePending)}{" "}
                    <span className="font-normal text-slate-500">
                      ({fmtILS(usdToIls(costInfo.estimatePending))})
                    </span>
                  </p>
                </div>
              )}
              {costInfo.actualSpent > 0 && (
                <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-emerald-200">
                  <p className="text-[11px] text-slate-500">
                    נצרך בפועל ({stats.done} תמונות)
                  </p>
                  <p className="text-sm font-bold text-emerald-700">
                    {fmtUSD(costInfo.actualSpent)}{" "}
                    <span className="font-normal text-slate-500">
                      ({fmtILS(usdToIls(costInfo.actualSpent))})
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* גריד תמונות */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {jobs.map((job) => {
          const isSelected = selectedJobIds.has(job.id);
          const isSelectable = job.status === "done" && !!job.resultDataUrl;
          return (
          <div
            key={job.id}
            className={clsx(
              "card overflow-hidden transition",
              isSelected && "ring-2 ring-emerald-500"
            )}
          >
            <div
              className="group/img relative aspect-square w-full cursor-zoom-in bg-slate-100"
              onClick={() =>
                setViewerImage({
                  originalUrl: job.previewUrl,
                  resultUrl: job.resultDataUrl,
                  fileName: job.file.name,
                  costUSD: job.costUSD,
                  durationMs:
                    job.startedAt && job.finishedAt
                      ? job.finishedAt - job.startedAt
                      : undefined,
                })
              }
            >
              {/* תמונת מקור (תמיד) */}
              <img
                src={job.previewUrl}
                alt={job.file.name}
                className={clsx(
                  "absolute inset-0 h-full w-full object-contain transition-opacity duration-300",
                  job.status === "done" && job.resultDataUrl
                    ? "opacity-0"
                    : "opacity-100"
                )}
              />
              {/* תוצאה (כשמוכן) */}
              {job.resultDataUrl && (
                <img
                  src={job.resultDataUrl}
                  alt={job.file.name}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              )}
              {/* אוברליי הגדלה - מופיע ב-hover */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/0 opacity-0 transition group-hover/img:bg-slate-900/30 group-hover/img:opacity-100">
                <div className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-soft">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="11" y1="8" x2="11" y2="14" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                  צפה בהגדלה
                </div>
              </div>
              {/* אוברליי בעיבוד */}
              {job.status === "processing" && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2">
                    <svg
                      className="h-8 w-8 animate-spin text-brand-600"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span className="text-xs font-medium text-brand-700">
                      מעבד...
                    </span>
                  </div>
                </div>
              )}
              {/* פס סטטוס למעלה */}
              <div className="pointer-events-none absolute right-2 top-2">
                <StatusChip status={job.status} />
              </div>
              {/* Checkbox לבחירה מרובה – רק לכרטיסים מוכנים */}
              {isSelectable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleJobSelected(job.id);
                  }}
                  className={clsx(
                    "absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full shadow ring-1 transition",
                    isSelected
                      ? "bg-emerald-600 text-white ring-emerald-700"
                      : "bg-white/95 text-slate-400 ring-slate-200 hover:bg-emerald-50 hover:text-emerald-600"
                  )}
                  title={isSelected ? "בטל בחירה" : "בחר תמונה זו"}
                >
                  {isSelected ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                    </svg>
                  )}
                </button>
              )}
              {/* כפתור הסרה */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeJob(job.id);
                }}
                className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow ring-1 ring-slate-200 transition hover:bg-rose-50 hover:text-rose-600"
                title="הסר"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-3">
              <p
                className="truncate text-sm font-medium text-slate-800"
                title={job.file.name}
              >
                {job.file.name}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {bytesToHuman(job.file.size)}
                {job.startedAt && job.finishedAt && (
                  <>
                    {" • "}
                    {((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s
                  </>
                )}
                {typeof job.costUSD === "number" && job.costUSD > 0 && (
                  <>
                    {" • "}
                    <span className="font-medium text-emerald-700">
                      {fmtUSD(job.costUSD)}
                    </span>
                  </>
                )}
              </p>
              {job.error && (
                <p className="mt-2 line-clamp-2 text-xs text-rose-600">
                  {job.error}
                </p>
              )}

              {/* תווית מקור Shopify */}
              {job.source?.type === "shopify" && (
                <div className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-200">
                  <p className="truncate text-[11px] text-emerald-900">
                    <span className="font-semibold">
                      Shopify · {job.source.shopName || job.source.shop}
                    </span>
                    <br />
                    <span className="text-emerald-700">
                      {job.source.productTitle}
                    </span>
                  </p>
                </div>
              )}

              {/* פאנל "החזר ל-Shopify" – רק לתמונות מוכנות שהגיעו מחיבור ישיר */}
              {job.status === "done" &&
                job.source?.type === "shopify" &&
                job.resultDataUrl && (
                  <div className="mt-2 rounded-lg bg-white p-2 ring-1 ring-emerald-200">
                    {job.uploadedToSource?.status === "done" ? (
                      <div className="flex items-start gap-1.5 text-[11px] font-semibold text-emerald-700">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="mt-[1px] h-3.5 w-3.5 shrink-0"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>
                          הוגדרה כתמונה ראשית באתר!
                          <span className="mr-1 font-normal text-emerald-600">
                            {job.uploadedToSource.replaceOriginal
                              ? "הישנה נמחקה."
                              : "הישנה נשמרה כתמונה משנית."}
                          </span>
                        </span>
                      </div>
                    ) : job.uploadedToSource?.status === "uploading" ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                        <svg
                          className="h-3.5 w-3.5 animate-spin"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        מעלה ל-Shopify...
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-semibold text-emerald-900">
                          הגדר כתמונה ראשית באתר:
                        </p>
                        <button
                          onClick={() =>
                            uploadToShopify(job.id, { replaceOriginal: false })
                          }
                          className="group flex w-full flex-col items-start rounded-lg bg-emerald-600 px-2.5 py-1.5 text-right text-white transition hover:bg-emerald-700"
                          title="התמונה החדשה תהפוך לראשית. הראשית הקיימת תיווסף כתמונה משנית במוצר."
                        >
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-3.5 w-3.5"
                            >
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            </svg>
                            הגדר כראשית + שמור את הישנה כמשנית
                          </span>
                          <span className="text-[9px] font-normal text-emerald-50">
                            מומלץ – לא מוחק כלום, התמונה הקיימת עוברת לגלריה
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                "להחליף את התמונה הראשית הקיימת? התמונה הישנה תימחק לצמיתות מהמוצר ב-Shopify ולא תופיע בגלריה."
                              )
                            ) {
                              uploadToShopify(job.id, {
                                replaceOriginal: true,
                              });
                            }
                          }}
                          className="flex w-full flex-col items-start rounded-lg bg-white px-2.5 py-1.5 text-right text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50"
                          title="מוחק את הראשית הישנה לחלוטין ומעלה את החדשה במקומה."
                        >
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-3.5 w-3.5"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            </svg>
                            הגדר כראשית + מחק את הישנה
                          </span>
                          <span className="text-[9px] font-normal text-rose-500">
                            פעולה הרסנית – לא ניתן לשחזר
                          </span>
                        </button>
                        {job.uploadedToSource?.status === "error" && (
                          <p className="text-[10px] text-rose-600">
                            {job.uploadedToSource.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() =>
                    setViewerImage({
                      originalUrl: job.previewUrl,
                      resultUrl: job.resultDataUrl,
                      fileName: job.file.name,
                      costUSD: job.costUSD,
                      durationMs:
                        job.startedAt && job.finishedAt
                          ? job.finishedAt - job.startedAt
                          : undefined,
                    })
                  }
                  className="btn-secondary flex-1 !py-1.5 text-xs"
                  title={job.status === "done" ? "תוצאה / מקור / השוואה" : "הצג מקור"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  צפה
                </button>
                {job.status === "done" && (
                  <button
                    onClick={() => downloadOne(job)}
                    className="btn-secondary !py-1.5 text-xs"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    הורד
                  </button>
                )}
                {job.status === "done" && job.resultDataUrl && (
                  <button
                    onClick={() => setRefineJobId(job.id)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 transition hover:bg-amber-100"
                    title="פתח חלון תיקון – כתוב הוראות מותאמות וייצר תוצאה משופרת"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                    תקן
                  </button>
                )}
                {(job.status === "error" || job.status === "done") && (
                  <button
                    onClick={() => retryJob(job.id)}
                    className="btn-ghost !py-1.5 text-xs"
                    title="עבד מחדש מאפס (זורק את התוצאה הנוכחית)"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                    </svg>
                    {job.status === "error" ? "נסה שוב" : "מחדש"}
                  </button>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {jobs.length === 0 && (
        <div className="mt-10 text-center text-sm text-slate-500">
          עדיין לא נוספו תמונות. גרור תמונות לתיבה למעלה כדי להתחיל ✨
        </div>
      )}

      <footer className="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
        מופעל על <b>OpenAI gpt-image-2</b> (אפריל 2026) • נבנה ב-Next.js +
        Tailwind
      </footer>

      <ImageViewer
        image={viewerImage}
        onClose={() => setViewerImage(null)}
      />

      <RefinementModal
        job={refineJobInfo}
        defaultQuality={quality}
        onClose={() => setRefineJobId(null)}
        onSubmit={async ({ refinement, quality: q, mask }) => {
          if (!refineJobId) return;
          await refineJob(refineJobId, {
            refinement,
            quality: q,
            mask: mask ?? undefined,
          });
        }}
      />
    </div>
  );
}
