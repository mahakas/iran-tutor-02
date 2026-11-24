# Phase 04B — پخش پایدار پادکست و یکپارچگی MediaSession

> تاریخ: ۲۰۲۶-۱۱-۲۴ · شاخهٔ کاری: `main` (working tree، بدون commit/push طبق محدودیت فاز)
> ## حکم نهایی: `PASS — PERSISTENT PLAYBACK & MEDIASESSION VERIFIED`
> با دو ثبت PARTIAL صادقانه: (۱) کنترل‌های رسانه‌ای سطح OS/صفحهٔ قفل روی دستگاه واقعی تست نشده، (۲) تکمیل خط لوله از مسیر UI به‌دلیل یک بن‌بست از پیش‌موجود بک‌اند روی PostgreSQL (یافتهٔ این فاز، خارج از scope، با شواهد کامل مستند شد).

---

## ۱) معماری قبل و بعد

**قبل (Audit):**
- `PodcastPlayerProvider` در ریشه (`app/layout.tsx:21-24`) فقط state حافظه داشت: `current/isPlaying/position/duration/speed/volume`. هیچ persistence و هیچ MediaSession وجود نداشت؛ پس از Refresh کامل همه‌چیز از دست می‌رفت.
- صوت فقط از `PodcastWorkspace.playEpisode` بار می‌شد: `authFetch(/api/v1/podcasts/{id}/audio)` → Blob → `URL.createObjectURL` → `player.load(track)`.Blob URL پس از reload مرده است و هیچ‌جا ذخیره نمی‌شد.
- کاربر/نشست: `AppProvider` (داخل `PodcastPlayerProvider`) با `useAppContext()` → `user.id`، `authFetch`، `authReady`. احراز هویت کوکی‌محور + CSRF؛ توکن فقط در `sessionStorage`.
- ایدiom ذخیره‌سازی موجود پروژه: `localStorage` در `lib/preferences.ts` — کلید مستقل از کاربر.
- تست‌ها: ۱۰۹ تست در ۱۳ فایل؛ `AppProvider` در تست‌ها mock می‌شود.

**بعد:**
- لایهٔ ذخیرهٔ جدید `lib/podcastPlaybackStore.ts`: کلید نسخه‌دار و user-scoped `darsyar:podcast:playback:v1:{user_id}`، فقط فیلدهای غیرحساس (`episodeId, position, speed, wasPlaying, updatedAt`). هیچ توکن/کوکی/URL امضاشده/blob ذخیره نمی‌شود.
- Provider: ذخیرهٔ throttle دار (حداکثر هر ۵ ثانیه در `timeupdate`) + ذخیرهٔ اجباری در pause/seek/تغییر سرعت/`pagehide`/`visibilitychange`؛ پایان اپیزود و close رکورد را پاک می‌کنند.
- Restore پس از reload: فقط وقتی کاربر شناسایی شد و چیزی در حال پخش نیست؛ GET اپیزود → اگر حذف/غیرمجاز بود (401/403/404) رکورد امن پاک می‌شود؛ اگر صوت هنوز آماده نیست، پیام مناسب + رکورد حفظ می‌شود؛ سپس GET صوت از همان endpoint احراز هویت‌شده؛ پس از `loadedmetadata` موقعیت با `min(saved, realDuration)` بازیابی و سرعت قبلی اعمال می‌شود.
- بنر RTL «ادامهٔ پخش از موقعیت قبلی» با «ادامه» و «از ابتدا» در پلیر کوچک؛ «از ابتدا» رکورد را پاک می‌کند.
- MediaSession: دقیقاً یک مجموعه handler برای lifetime صفحه (بدون ثبت تکراری در rerender) متصل به همان audio element سراسری؛ `metadata` (عنوان/گوینده/آلبوم؛ artwork فقط با URL معتبر http(s)/data:image)، `playbackState` پس از هر تغییر واقعی، `setPositionState` با duration واقعی و playbackRate صحیح؛ seekbackward/seekforward پیش‌فرض ۱۵ ثانیه؛ `seekto` از `details.seekTime`. `previoustrack/nexttrack` عمداً ثبت نشدند (مفهوم واقعی قسمت قبل/بعد وجود ندارد). همهٔ مسیرها با `'mediaSession' in navigator` و try/catch محافظت شده‌اند.
- تغییر حساب/خروج: گذار A→B یا A→خروج، رکورد حساب قبلی را پاک و پخش را متوقف می‌کند؛ گذار mount/login (null→A) هیچ‌چیز را پاک نمی‌کند (این نکته یک باگ واقعی بود که در QA مرورگر کشف و اصلاح شد — بخش ۶).

## ۲) فایل‌های تغییرکرده

| فایل | تغییر |
|---|---|
| `frontend/lib/podcastPlaybackStore.ts` | **جدید** — ذخیره/خواندن/پاک‌کردن نسخه‌دار user-scoped + اعتبارسنجی سختگیرانه (رکورد خراب حذف می‌شود) |
| `frontend/components/PodcastPlayerProvider.tsx` | بازنویسی: persistence، restore، MediaSession، بنر ادامه؛ API عمومی (`load/toggle/seek/skip/setSpeed/setVolume/close`) بدون تغییر — بدون regression برای فراخوان‌ها |
| `frontend/app/globals.css` | کلاس‌های `.pc-restore*` هماهنگ با `.pc-mini` (RTL حفظ شد) |
| `frontend/tests/PodcastPlayerPersistence.test.tsx` | **جدید** — ۲۱ تست اجباری (persistent ۱۰ + MediaSession ۸ + integration ۳) |
| Backend / Worker / Job lifecycle | **دست نخورده** |

## ۳) جزئیات ذخیره‌سازی و بازیابی

- **کلید:** `darsyar:podcast:playback:v1:{user_id}` — شناسهٔ کاربر با الگوی `[^a-zA-Z0-9_-]` پاک‌سازی و تا ۶۴ نویسه محدود می‌شود؛ دو حساب هرگز کلید مشترک ندارند.
- **ذخیره:** در `timeupdate` با throttle ۵ ثانیه؛ در `pause`، `seek`، تغییر سرعت، `pagehide` و `visibilitychange(hidden)` ذخیرهٔ اجباری؛ `wasPlaying` واقعی لحظهٔ ذخیره ثبت می‌شود.
- **بازیابی:** پس از آماده‌شدن `user.id`؛ اپیزود باید `completed` و `has_audio` باشد؛ فایل صوت دوباره از `/api/v1/podcasts/{id}/audio` (احراز هویت‌شده) گرفته می‌شود؛ بعد از `loadedmetadata`، `currentTime = min(saved.position, duration)`؛ اگر `saved.position >= duration-1` یعنی اپیزود عملاً تمام شده → رکورد پاک و شروع از صفر. سرعت قبلی فقط از لیست مجاز ۰٫۷۵–۲ پذیرفته می‌شود؛ metadata نامعتبر/خراب → رکورد حذف و بازیابی امن رد می‌شود.
- **عدم autoplay پس از restore:** مرورگرها پخش خودکار را می‌بلاک کنند؛ کاربر با «ادامه» ادامه می‌دهد (رفتار واقعی مرورگر).
- **پاک‌سازی:** پایان اپیزود → پاک؛ «از ابتدا» → پاک؛ close پلیر → پاک (تصمیم مستندشده: close = بی‌میلی صریح کاربر).
- **امنیت:** هیچ توکن/کوکی/URL امضاشده/blob ذخیره نمی‌شود؛ کلید نسخه‌دار و user-scoped؛ تغییر حساب/خروج رکورد حساب قبلی را پاک می‌کند (گذار واقعی درون-session) و بازیابی فقط از کلید کاربر جاری خوانده می‌شود.

## ۴) نحوهٔ اتصال MediaSession

- یک `useEffect` با `[]` فقط یک‌بار `play/pause/seekbackward/seekforward/seekto` را ثبت می‌کند (و در unmount با `null` پاک می‌کند) — rerender ها handler جدیدی ثبت نمی‌کنند (تست ۸ MediaSession این را اثبات می‌کند).
- Metadata در تغییر `current`؛ `playbackState` در تغییر `current/isPlaying` (none/paused/playing)؛ `setPositionState` بعد از `loadedmetadata`، seek/skip، تغییر سرعت و play/pause با duration واقعی، position کلمپ‌شده و playbackRate فعلی.
- همهٔ handlerها به همان `audioRef.current` سراسری وصل‌اند — هیچ audio element موازی ساخته نمی‌شود (تست: `el === audioInstances[0]`).

## ۵) نتایج تمام تست‌ها

| فرمان | نتیجه |
|---|---|
| `vitest run` | **130 passed (14 فایل)** — ۱۰۹ قبلی دست‌نخورده + ۲۱ جدید |
| `tsc --noEmit` | پاک |
| `eslint .` (شامل قانون `react-hooks/refs`) | پاک — نوشتن ref حین render در پیاده‌سازی اولیه اصلاح شد (همهٔ syncها به `useEffect` منتقل شدند) |
| `next build` (production) | موفق — `/podcast` در خروجی |
| Backend | بدون تغییر؛ نیازی به migration نبود |

تست‌های اجباری spec همه پوشش داده شدند: ذخیره در پخش/توقف، بازیابی بعد از reload، بازیابی سرعت، شروع از ابتدا، پاک‌سازی پس از پایان، جداسازی کاربر دیگر، اپیزود حذف/غیرمجاز (404 → پاک امن)، metadata نامعتبر (دو شکل)، شکست دریافت صوت (رکورد حفظ + toast)، ثبت metadata، play/pause، seekbackward/seekforward (۱۵ ثانیه)، seekto، playbackState، positionState، مرورگر بدون MediaSession، عدم ثبت تکراری handler، و سه integration (restore→continue→save→finish؛ ورود کاربر بعد از mount؛ close).

## ۶) نتایج QA واقعی مرورگر (Playwright/Chromium، production build)

محیط: `next build` + `next start :3100` → backend واقعی `:8002` روی PostgreSQL اختصاصی `darsyar_qa04b` (Alembic کامل) → Provider فیک OpenAI-compatible (`:8003`) برای script JSON و WAV واقعی ۱۸۰ ثانیه‌ای. اپیزود با کد واقعی سرویس ساخته شد: TTS واقعی از طریق HTTP، مونتاژ واقعی، duration واقعی اندازه‌گیری‌شده = **720.14s** — و از endpoint احراز هویت‌شدهٔ همان بک‌اند سرو شد (`GET /audio → 200, 8.6MB`).

| سناریو | نتیجه |
|---|---|
| پخش اپیزود و رسیدن به ثانیه ۱۲۰ با کنترل‌های واقعی UI (۸ بار «+۱۵ ثانیه») | PASS — `2:01 / 12:00` |
| ذخیرهٔ موقعیت هنگام توقف | PASS — `{"episodeId":6,"position":120.73,"wasPlaying":true}` در کلید user-scoped |
| Refresh کامل → بازیابی | PASS — پلیر کوچک ظاهر شد، بنر «ادامهٔ پخش از موقعیت قبلی»، زمان `2:01 / 12:00`، `currentTime=121` |
| ادامهٔ پخش از موقعیت بازیابی‌شده | PASS — playbackState playing |
| MediaSession در Chromium واقعی | PASS — `metadata.title`، `artist = فیزیک دهم (QA) · گفت‌وگوی عمیق (Deep Dive)`، `playbackState="playing"` |
| رفتن به صفحهٔ دیگر و بازگشت | PASS — پلیر کوچک باقی ماند |
| Refresh دوم → بازیابی مجدد | PASS |
| دو حساب کاربری | PASS — حساب B: هیچ پلیر و هیچ بازیابی؛ کلید B وجود ندارد؛ رکورد حساب A در کلید خودش باقی است (خصوصی و فقط برای A خوانا — جداسازی با کلید) |
| اسکرین‌شات‌ها | `/tmp/render_qa04b/01..05*.png` |

**کشف مهم در QA واقعی (باگ Production و اصلاح):** پس از reload رکورد پاک و بازیابی نمی‌شد. ردیابی `Storage.prototype.removeItem` با playwright نشان داد effect «تغییر حساب» گذار `null→user` هنگام mount را به‌عنوان تغییر حساب می‌گرفت و `close()` رکورد را پاک می‌کرد — چون در تست‌ها کاربر قبل از mount آماده بود، vitest این را نمی‌گرفت. اصلاح شد (فقط A→B یا A→خروج پاک می‌کند) + تست رگرسیون دقیقاً برای همین توالی اضافه شد («user arrives after mount»). این دقیقاً همان چیزی است که «Refresh کامل + ورود دوباره» را در محصول واقعی کار می‌کند.

## ۷) محدودیت‌های باقی‌مانده (صادقانه)

1. **کنترل‌های رسانه‌ای سطح OS / صفحهٔ قفل:** headless Chromium وجود API، metadata و playbackState را اثبات می‌کند و wiring handlerها در vitest اثبات شده، اما عملکرد واقعی صفحهٔ قفل/notification media روی دستگاه (اندروید/iOS) تست نشده — نیاز به دستگاه واقعی.
2. **بن‌بست پیش‌موجود بک‌اند (یافتهٔ این فاز، خارج از scope):** کار پس‌زمینهٔ پادکست روی PostgreSQL در مسیر gateway/quota قفل می‌شود: session کارگر ردیف `user_quotas` را uncommitted نگه می‌دارد و session دومِ gateway روی همان ردیف منتظر می‌ماند (`pg_locks`: pid worker `idle in transaction` با RowExclusiveLock روی `user_quotas/ai_audit_logs`؛ pid دوم منتظر transactionid). بازتولید: ساخت اپیزود از UI روی QA-Postgres؛ suite روی SQLite نمی‌گیرد (۵۰۹ تست سبز). تا رفع، تولید از مسیر UI کارگر به completion نمی‌رسد (episodes 4/5 گیر کردند). توصیه: commit/quota-bookkeeping در مسیر worker بررسی شود؛ تصمیم با مالک.
3. بازیابی پس از reload فقط در مرورگر یک دستگاه؛ همگام‌سازی بین دستگاه‌ها وجود ندارد (خارج از scope).
4. artwork جلد هنوز منبعی ندارد؛ کد فقط با URL معتبر آن را می‌پذیرد.

## ۸) دستور Rollback دقیق

```bash
# در working tree (هیچ commit/push انجام نشده):
cd frontend
git checkout -- components/PodcastPlayerProvider.tsx app/globals.css
rm -f lib/podcastPlaybackStore.ts tests/PodcastPlayerPersistence.test.tsx
# بازسازی و اطمینان از سبز بودن:
npm ci && npx vitest run && npx tsc --noEmit && npx eslint . && npx next build
```
دو فایل جدید حذف و دو فایل قبلی به HEAD برمی‌گردند؛ هیچ فایل دیگر (backend، worker، layout) تغییر نکرده است.

## ۹) حکم نهایی

**`PASS — PERSISTENT PLAYBACK & MEDIASESSION VERIFIED`** (روی production build، مرورگر واقعی Chromium، صوت واقعی سرو‌شده از endpoint احراز هویت‌شدهٔ بک‌اند) — با دو ثبت PARTIAL شفاف: کنترل‌های رسانه‌ای OS روی دستگاه واقعی تست‌نشده؛ و تکمیل UI-driven خط لولهٔ تولید به‌دلیل بن‌بست از پیش‌موجود worker روی PostgreSQL که با شواهد کامل برای تصمیم مالک مستند شد.
