"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownUp,
  AudioLines,
  Check,
  Download,
  Eye,
  FileText,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAppContext } from "@/components/AppProvider";
import SettingsShell from "@/components/SettingsShell";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/i18n";
import type {
  StorageSummary,
  UserFileItem,
  UserFilesListResponse,
} from "@/lib/types";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }
  return fallback;
}

function sourceLabel(src: string, lang: "fa" | "en"): string {
  if (lang === "en") {
    switch (src) {
      case "profile_avatar":
        return "Profile Avatar";
      case "tutor_image":
        return "Tutor Image Question";
      case "tutor_audio":
        return "Tutor Voice Question";
      default:
        return "Personal Upload";
    }
  }
  switch (src) {
    case "profile_avatar":
      return "تصویر پروفایل";
    case "tutor_image":
      return "پیوست تصویری معلم";
    case "tutor_audio":
      return "پیوست صوتی معلم";
    default:
      return "آپلود شخصی";
  }
}

export default function StorageSettingsPage() {
  const { preferences, authFetch, refreshAccount } = useAppContext();
  const lang = preferences.general.language === "en" ? "en" : "fa";
  const tz = preferences.general.timezone || "Asia/Tehran";

  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [files, setFiles] = useState<UserFileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<"all" | "image" | "audio" | "file">("all");
  const [sortBy, setSortBy] = useState<"date" | "size" | "name">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<UserFileItem | null>(null);

  const [previewFile, setPreviewFile] = useState<UserFileItem | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialQ = new URLSearchParams(window.location.search).get("q")?.trim();
    if (!initialQ) return;
    const t = window.setTimeout(() => {
      setSearchInput(initialQ);
      setDebouncedQuery(initialQ);
      setPage(1);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const fetchFilesData = useCallback(async (): Promise<UserFilesListResponse> => {
    const qs = new URLSearchParams({
      category,
      sort_by: sortBy,
      sort_dir: sortDir,
      page: String(page),
      page_size: "10",
    });
    if (debouncedQuery) qs.set("q", debouncedQuery);
    const res = await authFetch(`/api/v1/account/storage/files?${qs.toString()}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        errorMessage(
          payload,
          lang === "en" ? "Failed to load storage data." : "دریافت اطلاعات حافظه انجام نشد."
        )
      );
    }
    return payload as UserFilesListResponse;
  }, [authFetch, category, debouncedQuery, lang, page, sortBy, sortDir]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchFilesData();
      setSummary(data.storage);
      setFiles(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === "en"
          ? "Error loading storage."
          : "خطا در دریافت اطلاعات فضا"
      );
    } finally {
      setLoading(false);
    }
  }, [fetchFilesData, lang]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await fetchFilesData();
        if (!active) return;
        setSummary(data.storage);
        setFiles(data.items);
        setTotal(data.total);
        setTotalPages(data.total_pages);
        setError("");
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : lang === "en"
            ? "Error loading storage."
            : "خطا در دریافت اطلاعات فضا"
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchFilesData, lang]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    };
  }, [previewBlobUrl]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setFeedback("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await authFetch("/api/v1/account/storage/files", {
        method: "POST",
        body: form,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          errorMessage(
            payload,
            lang === "en" ? "Upload failed." : "بارگذاری فایل انجام نشد."
          )
        );
      }
      setFeedback(
        lang === "en"
          ? `Uploaded "${file.name}".`
          : `فایل «${file.name}» با موفقیت ذخیره شد.`
      );
      setPage(1);
      await loadFiles();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === "en"
          ? "File upload failed."
          : "خطا در آپلود فایل"
      );
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const handlePreview = async (item: UserFileItem) => {
    if (previewBlobUrl) {
      URL.revokeObjectURL(previewBlobUrl);
      setPreviewBlobUrl(null);
    }
    setPreviewFile(item);
    setPreviewText(null);
    setPreviewLoading(true);
    try {
      const res = await authFetch(`/api/v1/account/storage/files/${item.id}/content`);
      if (!res.ok) throw new Error("Failed");
      if (
        item.mime_type.startsWith("text/") ||
        item.mime_type === "application/json"
      ) {
        setPreviewText(await res.text());
      } else {
        const blob = await res.blob();
        setPreviewBlobUrl(URL.createObjectURL(blob));
      }
    } catch {
      setPreviewText(
        lang === "en" ? "Preview could not be loaded." : "پیش‌نمایش این فایل قابل بارگذاری نبود."
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (previewBlobUrl) URL.revokeObjectURL(previewBlobUrl);
    setPreviewBlobUrl(null);
    setPreviewText(null);
    setPreviewFile(null);
  };

  const handleDownload = async (item: UserFileItem) => {
    try {
      const res = await authFetch(
        `/api/v1/account/storage/files/${item.id}/content?download=1`
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(errorMessage(payload, "Download failed"));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === "en"
          ? "Download failed."
          : "دانلود فایل انجام نشد."
      );
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDeleteFile) return;
    const target = confirmDeleteFile;
    setDeletingId(target.id);
    setError("");
    setFeedback("");
    try {
      const res = await authFetch(`/api/v1/account/storage/files/${target.id}`, {
        method: "DELETE",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          errorMessage(
            payload,
            lang === "en" ? "Delete failed." : "حذف فایل انجام نشد."
          )
        );
      }
      setConfirmDeleteFile(null);
      setFeedback(
        lang === "en"
          ? `Deleted "${target.filename}".`
          : `فایل «${target.filename}» حذف و فضای آن آزاد شد.`
      );
      if (target.source_context === "profile_avatar") {
        await refreshAccount();
      }
      await loadFiles();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === "en"
          ? "Error deleting file."
          : "خطا در حذف فایل"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const quota = summary?.quota_bytes || 1;
  const imgBytes = summary?.categories?.images?.bytes ?? 0;
  const imgCount = summary?.categories?.images?.count ?? 0;
  const audioBytes = summary?.categories?.audio?.bytes ?? 0;
  const audioCount = summary?.categories?.audio?.count ?? 0;
  const fileBytes = summary?.categories?.files?.bytes ?? 0;
  const fileCount = summary?.categories?.files?.count ?? 0;
  const remainingBytes = summary?.remaining_bytes ?? 0;
  const imgPct = summary ? (imgBytes / quota) * 100 : 0;
  const audioPct = summary ? (audioBytes / quota) * 100 : 0;
  const filePct = summary ? (fileBytes / quota) * 100 : 0;

  return (
    <SettingsShell>
      <div className="settings-stack">
        {/* Quota & Breakdown Card */}
        <section className="account-card">
          <div className="account-card-head">
            <div>
              <h2>
                <HardDrive size={16} />{" "}
                {lang === "en" ? "Storage Usage & Quota" : "مصرف حافظه و سهمیه فایل‌ها"}
              </h2>
              <p>
                {lang === "en"
                  ? "Includes only your personal uploads, profile avatar, and saved tutor attachments. Official curriculum textbooks do not consume your storage."
                  : "تنها فایل‌های شخصی، تصویر پروفایل و پیوست‌های ذخیره‌شدهٔ شما محاسبه می‌شوند. کتاب‌های درسی رسمی از سهمیه شما کم نمی‌شوند."}
              </p>
            </div>
            <button
              type="button"
              className="primary-button"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
            >
              {uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
              <span>{lang === "en" ? "Upload File" : "آپلود فایل شخصی"}</span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
          </div>

          {summary && (
            <>
              <div className="storage-summary-numbers">
                <div>
                  <strong>{formatBytes(summary.used_bytes, lang)}</strong>{" "}
                  <span>
                    {lang === "en"
                      ? `used of ${formatBytes(summary.quota_bytes, lang)}`
                      : `استفاده‌شده از ${formatBytes(summary.quota_bytes, lang)}`}
                  </span>
                </div>
                <span className="storage-pct-pill" dir="ltr">
                  {summary.usage_percent}%
                </span>
              </div>

              <div className="storage-segmented-bar" aria-label="Storage breakdown">
                <span
                  className="seg-image"
                  style={{ width: `${Math.min(100, imgPct)}%` }}
                  title={lang === "en" ? "Images" : "تصاویر"}
                />
                <span
                  className="seg-audio"
                  style={{ width: `${Math.min(100 - imgPct, audioPct)}%` }}
                  title={lang === "en" ? "Audio" : "فایل‌های صوتی"}
                />
                <span
                  className="seg-file"
                  style={{
                    width: `${Math.min(Math.max(0, 100 - imgPct - audioPct), filePct)}%`,
                  }}
                  title={lang === "en" ? "Documents & Files" : "اسناد و فایل‌ها"}
                />
              </div>

              <div className="storage-breakdown-grid">
                <div className="breakdown-item">
                  <span className="dot seg-image" />
                  <div>
                    <b>{lang === "en" ? "Images" : "تصاویر"}</b>
                    <small>
                      {formatBytes(imgBytes, lang)} ·{" "}
                      {formatNumber(imgCount, lang)}{" "}
                      {lang === "en" ? "files" : "فایل"}
                    </small>
                  </div>
                </div>
                <div className="breakdown-item">
                  <span className="dot seg-audio" />
                  <div>
                    <b>{lang === "en" ? "Audio" : "صوت"}</b>
                    <small>
                      {formatBytes(audioBytes, lang)} ·{" "}
                      {formatNumber(audioCount, lang)}{" "}
                      {lang === "en" ? "files" : "فایل"}
                    </small>
                  </div>
                </div>
                <div className="breakdown-item">
                  <span className="dot seg-file" />
                  <div>
                    <b>{lang === "en" ? "Documents & Files" : "اسناد و فایل‌ها"}</b>
                    <small>
                      {formatBytes(fileBytes, lang)} ·{" "}
                      {formatNumber(fileCount, lang)}{" "}
                      {lang === "en" ? "files" : "فایل"}
                    </small>
                  </div>
                </div>
                <div className="breakdown-item">
                  <span className="dot seg-free" />
                  <div>
                    <b>{lang === "en" ? "Free Space" : "فضای آزاد"}</b>
                    <small>{formatBytes(remainingBytes, lang)}</small>
                  </div>
                </div>
              </div>

              {summary.status !== "normal" && (
                <div
                  className={`warning-banner ${
                    summary.status === "full" ? "critical" : ""
                  }`}
                >
                  <AlertTriangle size={16} />
                  <span>
                    {summary.status === "full"
                      ? lang === "en"
                        ? "You are nearly out of personal storage. Delete unused files or upgrade your plan to keep saving attachments."
                        : "فضای ذخیره‌سازی شما تقریباً پر شده است. برای ادامه ذخیره پیوست‌ها فایل‌های اضافی را حذف یا پلن خود را ارتقا دهید."
                      : lang === "en"
                      ? "You have used over 80% of your personal storage quota."
                      : "بیش از ۸۰٪ سهمیه فضای ذخیره‌سازی شما مصرف شده است."}
                  </span>
                  <Link href="/account/upgrade" className="outline-button">
                    {lang === "en" ? "Upgrade Plan" : "ارتقای پلن"}
                  </Link>
                </div>
              )}
            </>
          )}
        </section>

        {feedback && (
          <div className="success-note">
            <Check size={16} />
            <span>{feedback}</span>
          </div>
        )}
        {error && <div className="inline-error">{error}</div>}

        {/* Uploaded Files Table */}
        <section className="account-card">
          <div className="account-card-head">
            <div>
              <h2>{lang === "en" ? "Uploaded Files" : "فایل‌های ذخیره‌شده"}</h2>
              <small>
                {lang === "en"
                  ? `${formatNumber(total, lang)} matching files`
                  : `${formatNumber(total, lang)} فایل یافت شد`}
              </small>
            </div>
          </div>

          <div className="storage-toolbar">
            <div className="users-search">
              <Search size={15} />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={
                  lang === "en" ? "Search by filename..." : "جستجو بر اساس نام فایل..."
                }
              />
            </div>

            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as "all" | "image" | "audio" | "file");
                setPage(1);
              }}
            >
              <option value="all">{lang === "en" ? "All Types" : "همه نوع‌ها"}</option>
              <option value="image">{lang === "en" ? "Images" : "تصاویر"}</option>
              <option value="audio">{lang === "en" ? "Audio" : "صوت"}</option>
              <option value="file">{lang === "en" ? "Documents" : "اسناد و فایل‌ها"}</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as "date" | "size" | "name");
                setPage(1);
              }}
            >
              <option value="date">{lang === "en" ? "Sort: Date" : "مرتب‌سازی: تاریخ"}</option>
              <option value="size">{lang === "en" ? "Sort: Size" : "مرتب‌سازی: حجم"}</option>
              <option value="name">{lang === "en" ? "Sort: Name" : "مرتب‌سازی: نام"}</option>
            </select>

            <button
              type="button"
              className="outline-button"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              title={lang === "en" ? "Toggle sort order" : "تغییر ترتیب"}
            >
              <ArrowDownUp size={14} />
              <span>
                {sortDir === "desc"
                  ? lang === "en"
                    ? "Desc"
                    : "نزولی"
                  : lang === "en"
                  ? "Asc"
                  : "صعودی"}
              </span>
            </button>
          </div>

          {loading ? (
            <div className="account-loading-box">
              <LoaderCircle className="spin" size={20} />
              <span>{lang === "en" ? "Loading files..." : "در حال دریافت فایل‌ها..."}</span>
            </div>
          ) : files.length === 0 ? (
            <div className="history-empty">
              <HardDrive size={24} />
              <span>
                {lang === "en"
                  ? "No files match your filter yet."
                  : "فایلی مطابق جستجوی شما ثبت نشده است."}
              </span>
            </div>
          ) : (
            <div className="admin-users-table-wrap">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>{lang === "en" ? "File" : "نام فایل"}</th>
                    <th>{lang === "en" ? "Category" : "دسته"}</th>
                    <th>{lang === "en" ? "Size" : "حجم"}</th>
                    <th>{lang === "en" ? "Source" : "منبع"}</th>
                    <th>{lang === "en" ? "Date" : "تاریخ"}</th>
                    <th>{lang === "en" ? "Actions" : "عملیات"}</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="storage-file-cell">
                          {item.category === "image" ? (
                            <ImageIcon size={16} />
                          ) : item.category === "audio" ? (
                            <AudioLines size={16} />
                          ) : (
                            <FileText size={16} />
                          )}
                          <div>
                            <b>{item.filename}</b>
                            {item.dependencies.length > 0 && (
                              <small className="dependency-tag">
                                {item.dependencies
                                  .map((dep) =>
                                    dep.type === "profile_avatar"
                                      ? lang === "en"
                                        ? "Used as Profile Avatar"
                                        : "در حال استفاده به‌عنوان تصویر پروفایل"
                                      : lang === "en"
                                      ? `Chat: ${dep.title ?? dep.label ?? dep.id}`
                                      : `گفت‌وگو: ${dep.title ?? dep.label ?? dep.id}`
                                  )
                                  .join(" · ")}
                              </small>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="badge-pill">
                          {item.category === "image"
                            ? lang === "en"
                              ? "Image"
                              : "تصویر"
                            : item.category === "audio"
                            ? lang === "en"
                              ? "Audio"
                              : "صوت"
                            : lang === "en"
                            ? "Document"
                            : "سند"}
                        </span>
                      </td>
                      <td>{formatBytes(item.size_bytes, lang)}</td>
                      <td>{sourceLabel(item.source_context, lang)}</td>
                      <td>{formatDateTime(item.created_at, lang, tz)}</td>
                      <td>
                        <div className="user-row-actions">
                          <button
                            type="button"
                            className="outline-button"
                            onClick={() => void handlePreview(item)}
                            title={lang === "en" ? "Preview" : "پیش‌نمایش"}
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            className="outline-button"
                            onClick={() => void handleDownload(item)}
                            title={lang === "en" ? "Download" : "دانلود"}
                          >
                            <Download size={14} />
                          </button>
                          <button
                            type="button"
                            className="outline-button danger-outline"
                            onClick={() => setConfirmDeleteFile(item)}
                            title={lang === "en" ? "Delete" : "حذف"}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="pagination-row">
              <button
                type="button"
                className="outline-button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {lang === "en" ? "Previous" : "قبلی"}
              </button>
              <span>
                {lang === "en"
                  ? `Page ${formatNumber(page, lang)} of ${formatNumber(totalPages, lang)}`
                  : `صفحه ${formatNumber(page, lang)} از ${formatNumber(totalPages, lang)}`}
              </span>
              <button
                type="button"
                className="outline-button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {lang === "en" ? "Next" : "بعدی"}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Preview Modal */}
      {previewFile && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
        >
          <section className="exam-setup-modal preview-file-modal" role="dialog" aria-modal="true">
            <button
              className="modal-close icon-button"
              onClick={closePreview}
              aria-label={lang === "en" ? "Close" : "بستن"}
            >
              <X size={18} />
            </button>
            <h2>{previewFile.filename}</h2>
            <p>
              {formatBytes(previewFile.size_bytes, lang)} ·{" "}
              {formatDateTime(previewFile.created_at, lang, tz)}
            </p>
            <div className="file-preview-stage">
              {previewLoading ? (
                <LoaderCircle className="spin" size={24} />
              ) : previewText !== null ? (
                <pre dir="auto">{previewText}</pre>
              ) : previewBlobUrl && previewFile.category === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewBlobUrl} alt={previewFile.filename} />
              ) : previewBlobUrl && previewFile.category === "audio" ? (
                <audio controls src={previewBlobUrl} style={{ width: "100%" }} />
              ) : previewBlobUrl && previewFile.mime_type === "application/pdf" ? (
                <iframe src={previewBlobUrl} title={previewFile.filename} />
              ) : (
                <p>
                  {lang === "en"
                    ? "Preview is not available for this binary format. You can download the file instead."
                    : "پیش‌نمایش مستقیم برای این فرمت در دسترس نیست؛ می‌توانید فایل را دانلود کنید."}
                </p>
              )}
            </div>
            <div className="dialog-actions-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleDownload(previewFile)}
              >
                <Download size={15} />
                <span>{lang === "en" ? "Download" : "دانلود فایل"}</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteFile && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (!deletingId && e.target === e.currentTarget) setConfirmDeleteFile(null);
          }}
        >
          <section className="exam-setup-modal" role="dialog" aria-modal="true">
            <button
              className="modal-close icon-button"
              disabled={Boolean(deletingId)}
              onClick={() => setConfirmDeleteFile(null)}
              aria-label={lang === "en" ? "Close" : "بستن"}
            >
              <X size={18} />
            </button>
            <div className="modal-icon danger-icon">
              <Trash2 size={22} />
            </div>
            <h2>{lang === "en" ? "Delete File?" : "حذف فایل شخصی"}</h2>
            <p>
              {lang === "en"
                ? `Are you sure you want to permanently delete "${confirmDeleteFile.filename}" (${formatBytes(
                    confirmDeleteFile.size_bytes,
                    lang
                  )})?`
                : `آیا از حذف دائمی فایل «${confirmDeleteFile.filename}» (${formatBytes(
                    confirmDeleteFile.size_bytes,
                    lang
                  )}) مطمئن هستید؟`}
            </p>
            {confirmDeleteFile.dependencies.length > 0 && (
              <div className="warning-banner">
                <AlertTriangle size={16} />
                <span>
                  {lang === "en"
                    ? "This file is currently referenced by your profile avatar or a saved chat session. Deleting it will clear that reference."
                    : "این فایل به تصویر پروفایل یا یک گفت‌وگوی ذخیره‌شده متصل است و با حذف آن، مرجع مرتبط پاک می‌شود."}
                </span>
              </div>
            )}
            <div className="dialog-actions-row">
              <button
                type="button"
                className="outline-button"
                disabled={Boolean(deletingId)}
                onClick={() => setConfirmDeleteFile(null)}
              >
                {lang === "en" ? "Cancel" : "انصراف"}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={Boolean(deletingId)}
                onClick={() => void handleDeleteConfirmed()}
              >
                {deletingId ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
                <span>{lang === "en" ? "Delete Permanently" : "تأیید و حذف"}</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </SettingsShell>
  );
}
