# Vellum

Vellum is a web app for converting and editing documents, images and video: Image to PDF,
Merge, Split, Lock and Compress PDF, Find in PDF, PDF to DOCX, DOCX to PDF, HTML to PDF,
JPEG to PNG, Compress Image and Compress Video. Guests can use the tools within guest
limits; signed-in users (Google or an emailed one-time code) get plan limits, a conversion
history and a document library.

It is a Next.js 16 (App Router) app in TypeScript with MongoDB (mongoose). The heavy work
runs on the server: sharp for images, a bundled Chromium (puppeteer) for HTML and DOCX to
PDF, a bundled ffmpeg (ffmpeg-static) for video and BMP decoding, and pdf.js / pdf-lib in
worker threads for PDF work.

## Running locally

Requires Node.js 22.3 or later (`process.getBuiltinModule` is used).

```bash
npm ci
cp .env.example .env.local   # then fill in the values
npm run dev
```

`npm ci` downloads Chromium for puppeteer and an ffmpeg binary for ffmpeg-static. Open
http://localhost:3000.

## Testing and checks

```bash
npm test                          # the Jest suite (not bare `jest`; it needs the VM-modules flag)
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run build                     # needs no database or other configuration
```

The tests generate their own inputs and need no database: `jest.setup.ts` supplies
placeholder secrets and a placeholder `MONGODB_URI`. The suites that need a real MongoDB
(`tests/*-mongo.test.ts`) are skipped unless `VELLUM_TEST_MONGODB_URI` names a server, for
example `mongodb://127.0.0.1:27017`. Each uses a database of its own and drops it afterwards.

CI (`.github/workflows/container.yml`) builds the Docker image on every push and pull
request, runs the test suite inside it, starts the image and sends one request to each tool
family (`scripts/container-smoke.mjs`; Compress Video's job goes through a MongoDB
container), measures the container's memory, and checks that the server shuts down cleanly
on SIGTERM.

## Configuration

Every environment variable the app reads is listed and explained in
[`.env.example`](.env.example). The app builds and starts without any of them; requests that
need a missing one fail with an error that names it. For production you need at least
`MONGODB_URI`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, the Google sign-in pair,
`BREVO_API_KEY`, `EMAIL_USER` and `SUPPORT_INBOX_EMAIL` (the inbox the contact and help forms
deliver to; they show an error without it), the storage settings (`STORAGE_DRIVER=s3` and
the `S3_*` variables for the R2 bucket) and `CLIENT_IP_HEADER`. Without `STORAGE_DRIVER`, production
refuses to store files (`STORAGE_DRIVER=local` is allowed, but a redeploy deletes them).

### Email-code sign-in

A code works only in the browser that requested it. A browser that has signed in with an
email is known for it for 90 days, which only gives it a send allowance of its own. The send
limits are sliding windows kept in MongoDB (`lib/auth/otpRequestLimit.ts`):

| Counted per | Known browser | Any other browser |
| --- | --- | --- |
| Device and email | 5 in 15 min, 20 in 24 h | - |
| Client address and email | - | 3 in 15 min, 10 in 24 h |
| Email | - | 50 in 24 h |
| Whole site | - | 220 in 24 h (the app's other emails need part of Brevo's 300 a day) |
| Client address | 40 in 24 h | 40 in 24 h |

The client address comes from `CLIENT_IP_HEADER`, with IPv6 counted by /64. Without a trusted
address the per-address limit is skipped and the address-and-email limit counts by email
alone, so everyone requesting a code for that email then shares it: set the header in
production. The server logs a warning once per window when the site-wide limit is reached.

### Client IP (`CLIENT_IP_HEADER`)

The per-IP rate limit (30 requests a minute on the convert, documents and OTP routes) and
the location recorded for a sign-in session need the caller's address, which only the
reverse proxy in front of the app knows. `CLIENT_IP_HEADER` names the one header to trust,
and `CLIENT_IP_HEADER_ENTRY` says which entry to use if it holds a list (`single`, the
default, refuses a list; `leftmost`; `rightmost`).

Only name a header that the proxy overwrites on every request; any other header can be sent
by the client to choose its own rate-limit key. With `CLIENT_IP_HEADER` unset, no header is
trusted. Next.js does not give the app the connection's own address, so then every caller
shares one rate-limit bucket: the limit becomes 30 requests a minute for the whole site.
That is safe but will refuse legitimate traffic, so set it in production. It also makes every
guest one caller for the per-caller job limit below, so guests can then run only one heavy
job at a time between them. The contact and help forms have their own limit on the same key
(5 submissions per 10 minutes), which is then site-wide too. Their daily limit of 5 tickets
per address is skipped then, leaving 5 per account and the site-wide 12 from guests and 8
from accounts in any 24 hours (`lib/email/daily-limits.ts`, counted in MongoDB).

### Heavy jobs per caller

PDF to Word, Find in PDF, Image to PDF, Compress Image, JPEG to PNG, Compress Video, HTML
to PDF and DOCX to PDF run their work in small process-wide pools of two slots each (PDF
workers, sharp image jobs, video encodes, Chromium renders), so they cannot exhaust the
server's cores or memory. HTML to PDF and DOCX to PDF share the render pool, and each render
still gets its own Chromium: HTML to PDF renders pages users choose, so no two users' pages
share a browser process. So that one caller cannot keep those tools busy for everyone (#106):

- **One job per caller.** A caller may run one of these jobs at a time, across all eight
  tools. A second request while one runs is refused at once, before its upload is read, with
  429, `Retry-After` and "You already have a conversion in progress. Please wait for it to
  finish." Image to PDF, which uses an image slot and then a PDF worker slot, is one job.
  A Compress Video request counts only while its upload is read and probed: its encode then
  runs as a background job (see below), which has its own one-per-caller rule.
  A request refused because a pool is full gets the tool's 503 "busy" answer with
  `Retry-After`.
- **Who is a caller.** A signed-in user is one caller by user id. A guest is one caller by
  the address `CLIENT_IP_HEADER` gives; without it, all guests are counted as one caller
  under the same shared key the rate limit uses.
- **The guests' share.** Guests together may hold one of the two slots of each pool, so a
  signed-in user can always get the other one. A guest takes the share only once their upload
  has been read and checked, for as long as the work runs, so a slow upload holds nothing
  that other guests need. A guest who then finds the guests' slot taken gets the tool's usual
  503 "busy" answer. Image to PDF holds the guests' share of both its pools while it works.

These limits live in the process's memory, like the slot counts themselves
(`lib/convert/caller-jobs.ts`).

### Compress Video background jobs

An encode can take up to an hour, far longer than a request may stay open on Railway, so
Compress Video runs as a background job (#115). Its state is in MongoDB (the `VideoJob`
model) and its files in the configured storage, so Compress Video needs `MONGODB_URI` and a
working storage driver. Without either, the server still starts and every other tool works:
the log says "Compress Video jobs will not run: <reason>", and a video upload is refused with
503 and the storage error, before it is read.

- **Upload.** `POST /api/convert/video-compress` checks the size cap, then probes the video
  in the request and refuses at once, with the same messages as before, a file that is not
  a video, one over the plan's length cap, or one whose estimated encode would not fit in
  the plan's encode budget (see Limits). An accepted upload is stored under
  `video-jobs/<jobId>/`, its job is queued, and the answer is `202 {jobId, status}`. A guest
  also gets a `token`, sent back as `X-Job-Token`; only its SHA-256 is stored.
- **Following it.** `GET /api/convert/video-compress/jobs/<id>` gives the status (with
  the position in the queue while queued), `.../download` the result, and `DELETE` cancels
  the job, killing its ffmpeg if it is running. A signed-in owner is known by their session,
  so the link in their notification works; anyone else gets 404, as for a job that does not
  exist. The upload drawer polls every 2 seconds and downloads the result when it is done.
- **Limits.** One active (queued or running) job per caller, refused with the 429 above.
  At most 20 jobs wait in the queue (`MAX_QUEUED_VIDEO_JOBS`); with a full queue the upload
  is refused with 503 "busy" and `Retry-After`, before it is read. A running job does not
  stop its caller from using the other tools.
- **The worker.** Each server process starts one from `instrumentation.ts`. It runs at most
  two encodes at once, of which guests may hold one, and claims the oldest queued job first.
  A running job holds a 60-second lease, renewed every 20 seconds. A job whose lease runs
  out (its process died) is queued again; one that has been started twice is failed with
  a message saying the server restarted. On SIGTERM the worker stops claiming and leaves
  the shutdown to Next; encodes still running when the process exits are requeued that way.
- **Results.** A compressed video is kept for 24 hours, then the worker's sweep deletes it
  and the download answers 410. It does not count towards the storage quota. The input is
  deleted as soon as the job ends, however it ends. Signed-in users get a Recent Activity
  row (not re-downloadable, as before) and a notification: done, with a download link, or
  failed, with the reason. Guests get neither, and a guest who closes the page loses the job.

### File retention and account deletion

A stored document or conversion is kept 3, 5 or 7 days by plan (`lib/storage-limits.ts`).
From its `expiresAt` it is gone to its owner: lists, downloads, exports and the quota ignore
the row at once. With the auto-delete preference a conversion stores no file and its history
row expires after a second, so it doesn't stay in Recent Activity.

- **The sweep.** Each server process starts one from `instrumentation.ts`
  (`lib/retention-sweep.ts`): once at startup, then every 10 minutes, on either storage
  driver. In batches, it deletes each expired file and then its row. A delete that fails
  keeps the row, and later sweeps retry it. Two processes sweeping at once is safe. Without
  `MONGODB_URI` or a working storage driver it logs "Expired files will not be deleted:
  <reason>" and the server serves as usual.
- **The index.** `expiresAt` has a plain index on `Conversion` and `UserDocument`. Before
  #158 it was a TTL index, which deleted the row, and with it the key, while the file was
  still stored. Each sweep first drops such an index if it finds one and creates the plain
  one, so the database user must be allowed to drop and create indexes (Atlas's `readWrite`
  is enough). Code from before #158 has no sweep and cannot turn the index back into a TTL
  one, so **after a rollback nothing expires**. Roll forward.
- **Account deletion.** It cancels the user's active video jobs and deletes their
  conversions, documents and video jobs with the files. What can't be deleted yet stays as
  an expired record, or for a video as a discarded job that the job TTL skips, until a sweep
  has deleted it. The response then has `filesPending: true`.

### Chromium sandbox (`CHROMIUM_DISABLE_SANDBOX`)

HTML to PDF and DOCX to PDF launch Chromium with its sandbox on. HTML to PDF renders pages
users choose (fetched under the policy in `lib/html/url-policy.ts`), and the sandbox is what
confines a renderer that a hostile page has compromised. If Chromium cannot start sandboxed
on the host, both tools fail with `No usable sandbox!` in the server log. Setting
`CHROMIUM_DISABLE_SANDBOX=true` then makes them work, at the cost that a Chromium exploit
runs with the app's own user, its environment variables (database and storage credentials)
and its network access. Use it only after checking that the sandbox cannot be made to work,
and treat it as a known risk.

In CI, Chromium does not start sandboxed inside a Docker container on GitHub's Ubuntu 24.04
runners (the host refuses the unprivileged user namespaces it needs), so CI runs the
smoke test with the sandbox off and reports the sandboxed result separately. Whether it
starts sandboxed on Railway is unknown until a real deployment.

### Renderer network access

Each HTML to PDF render starts its own egress proxy (`lib/puppeteer/egress-proxy.ts`) on a
random 127.0.0.1 port and launches Chromium with all its traffic sent through it, loopback
and WebRTC included. The proxy resolves each destination once, refuses it with 403 if any of
its addresses is private, loopback, link-local or otherwise non-public (the ranges in
`lib/html/url-policy.ts`), and connects to the address it checked, so Chromium's own DNS
never decides where a render connects. It accepts only the per-launch credential Chromium is
given, and logs each refusal (`[render-egress] refused …`, without the query string). A
refused URL answers 400 "That URL can't be converted. It must be a public http or https
address." DOCX to PDF renders have no network at all: JavaScript is off and every request
other than `data:`, `blob:` and `about:` is refused.

## Building and running the container

```bash
docker build -t vellum .
docker run -p 3000:3000 --env-file .env.local vellum
```

The image runs `next start` as the non-root `node` user under `tini`, listening on `$PORT`
(3000 by default). It ships the full production `node_modules` rather than Next's
`standalone` output: the worker threads, Chromium and ffmpeg are all found at runtime by
path, and the working directory keeps them where the code looks. The runtime image is about
1.8 GB, most of it Chromium and `node_modules`.

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_API_KEY` are compiled into the
browser bundle, so they must be given at build time (`docker build --build-arg ...`). Never
pass a server-side secret as a build argument.

The ffmpeg that ffmpeg-static installs differs by platform: FFmpeg 6.1.1 on Windows,
FFmpeg 7.0.2 on Linux (the Dockerfile checks the Linux binary's checksum). CI runs the
whole test suite against the Linux one.

`GET /api/health` answers `{"status":"ok"}` when the process is serving. It does not touch
the database, so a database outage cannot block or roll back a deployment.

On SIGTERM, `next start` stops accepting connections, lets requests in progress finish
(including their conversions), then exits. Worker threads end with the process; ffmpeg and
Chromium child processes are stopped when the container stops.

## Deploying on Railway

The app runs as one container built from the `Dockerfile` at the repository root, which
Railway uses automatically. Files are stored in Cloudflare R2.

1. **Variables.** Set everything from `.env.example` that production needs (see
   Configuration), plus:
   - `NEXTAUTH_URL` = the public `https://` URL of the service (its Railway domain or a
     custom domain), with no trailing slash.
   - `CLIENT_IP_HEADER=x-real-ip` (leave `CLIENT_IP_HEADER_ENTRY` unset). Railway's
     [Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)
     page lists `X-Real-IP` as the header carrying the client's address, and a Railway
     employee stated on 2026-10-05 that the edge overwrites any caller-supplied
     `X-Real-IP` and `X-Forwarded-For`
     ([Central Station](https://station.railway.com/questions/need-authoritative-client-ip-proxy-tru-090eac86)),
     while noting this is current behaviour, not a guarantee. Requests over Railway's
     private network (`*.railway.internal`) bypass the edge, and a CDN in front of Railway
     changes what `X-Real-IP` holds. **Unverified until a real deployment.**
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_API_KEY` if the Drive picker is
     used: the Dockerfile declares them as build arguments, which is how Railway passes a
     variable to the build.
   - `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=300`. Railway's default is 0: the old deployment
     is killed as soon as it gets SIGTERM, which cuts off conversions in progress
     ([Deployments reference](https://docs.railway.com/deployments/reference)). 300
     seconds lets the synchronous tools' requests finish. It does not keep Compress Video
     encodes alive: the old process exits once its requests are done, and an encode still
     running there starts again from the beginning on the new deployment, about a minute
     later (its lease runs out; see Compress Video background jobs).
   - Do not set `CHROMIUM_DISABLE_SANDBOX` unless the first deployment shows it is needed.
2. **Healthcheck.** Set the service's healthcheck path to `/api/health`. Railway calls it
   only while starting a deployment, from the hostname `healthcheck.railway.app`
   ([Healthchecks](https://docs.railway.com/reference/healthchecks)).
3. **One replica.** Keep the service at a single instance. The rate limiter (`proxy.ts`),
   the worker slot counter (`lib/convert/worker-job.ts`), the image and render job
   counters (`lib/image/image-jobs.ts`, `lib/puppeteer/render-jobs.ts`), Compress Video's
   encode slots (`lib/video/video-job-worker.ts`; its queue is in MongoDB) and the
   per-caller job claims (`lib/convert/caller-jobs.ts`) live in the process's memory. With more than one instance each instance would apply its own limits, so the
   real limits would multiply.
4. **Google OAuth.** In Google Cloud Console, add
   `<NEXTAUTH_URL>/api/auth/callback/google` as an authorised redirect URI of the OAuth
   client, and `<NEXTAUTH_URL>` as an authorised JavaScript origin if the Drive picker is
   used.
5. **Region.** Choose the region closest to the expected users.
6. **R2 lifecycle rule (owner step), a backstop.** The app deletes expired files from R2
   itself (see File retention and account deletion), so the R2 API token needs permission
   to delete objects. The rule catches what the app has no record of: a file stored just
   before a crash or a database failure. It also catches what the app can't delete while it
   is down or its deletes keep failing. The local-disk cleanup of such orphans
   (`cleanupStorage` in `lib/conversions.ts`) does not run with `STORAGE_DRIVER=s3`, so
   **without a lifecycle rule those files stay in the bucket forever.** In the Cloudflare
   dashboard, open the bucket's Settings, Object lifecycle rules, and add a rule that
   deletes objects 8 days after upload: the longest retention
   (7 days on Enterprise, `lib/storage-limits.ts`) plus a day of margin. It must cover the
   conversion outputs at the bucket root (`<uuid>.<ext>`) and the documents under `docs/`.
   Root keys share no prefix, so the rule applies to the whole bucket (no prefix). Raise it
   if the longest retention grows.
7. **R2 lifecycle rule for video jobs (owner step), a backstop.** Add a second rule, for the
   prefix `video-jobs/`, that deletes objects 2 days after upload. The worker deletes each
   job's input when the job ends and its result after 24 hours, and retries a failed delete.
   For a deleted account it retries until it succeeds. For others the job's row expires a
   day after the result, so the rule catches what was still failing then, or what a crash
   left behind; 2 days is the 24-hour result plus a day of margin.
   Both rules match these keys. S3 applies the earlier of two matching expirations; check
   that R2 does too (checklist item 12).

### Instance size

Measured in CI (GitHub's `ubuntu-24.04` runner, 4 vCPU, 16 GB, container without a memory
limit, peak read from the container's cgroup `memory.peak`; ranges are over three runs):

| State | Container memory |
| --- | --- |
| Started, idle | 185-188 MB |
| After one request to each tool family | 345-348 MB peak |
| Two Image to PDF jobs, then two Compress Image jobs, each on a 49-megapixel PNG, two at a time | 764-1,064 MB peak |
| One HTML to PDF render of a 22 MB page (5000-row table, inline photos) | 749 MiB above the level before it |
| One DOCX to PDF render of a 20 MB document of photos | 662 MiB above the level before it |

The two render rows are one run, from `memory.current` sampled about every 0.2 s while the
render ran (`scripts/container-smoke.mjs --heavy-render`), so a shorter spike can be missed.

That last row was measured before guests were limited to one job at a time and one slot of
each pool (see Heavy jobs per caller). CI has no signed-in user, so it now runs one job of
each at a time and reports a lower peak; two at once is still possible for signed-in users.

The CI images are flat-colour PNGs, which are cheap to compress. Earlier measurements on
Windows (in the PRs that set the image limits) put two Image to PDF or Compress Image jobs at
the pixel cap on photographic images at about 1.9 GB above the idle server. On top of that,
at the same time, the server can be running two PDF extraction workers (up to 256 MB of heap
each, plus decoded data outside the heap), two Chromium renders (HTML and DOCX to PDF
together), two ffmpeg encodes, and holding whole uploads in memory (each upload route reads
its upload into memory, up to the plan's cap: 500 MB at most). On Windows one render near
the guest cap peaked at 1.06 GB in Chromium, and an 88 MB page (under the Pro cap) at 1.7 GB
before the 30-second render deadline stopped it, so two renders take about 1.5-2.1 GB at
guest sizes and up to about 3.4 GB for two large pages (`lib/puppeteer/render-jobs.ts`).

Recommendation: **8 GB of memory and 4 vCPU**. Two video encodes alone take four cores
(`-threads 2` each, at most two at once), and the sum of the peaks above, without the
renders, comes to about 5 GB with two large uploads in flight; two heavy renders at the
same moment add 1.5-3.4 GB. 4 GB is enough for light traffic without large video uploads.
Watch the memory graph during the first weeks and adjust.

### Limits

- **Request body.** Each upload route reads its own body, up to the caller's plan cap for
  that tool plus 1 MB of multipart framing, and refuses it as soon as it passes that: before
  reading any of it when its `Content-Length` already says so (`lib/http/read-upload.ts`).
  The upload routes are left out of `proxy.ts`'s matcher, so Next does not buffer their
  bodies first. The largest cap is 500 MB. Railway documents no body size limit, but a
  request body must finish uploading within 5 minutes
  ([Specs & Limits](https://docs.railway.com/networking/public-networking/specs-and-limits)),
  which a 500 MB upload meets only above about 14 Mbit/s. The video size caps (50 / 100 /
  500 / 500 MB) are unchanged, so on a slower connection a large Pro or Enterprise upload
  can be cut off before the app sees it.
- **Request duration.** Railway closes a request after 5 minutes without data transferred,
  and after 15 minutes in any case (same page). Compress Video's request only uploads and
  probes the video; the encode runs in the background, so no request waits on it.
- **Compress Video encode time.** Each job may spend, by plan, **5 / 15 / 30 / 60 minutes**
  probing and encoding (guest / Basic / Pro / Enterprise; `VIDEO_ENCODE_BUDGET_MS` in
  `lib/convert/video-compress-limits.ts`):
  - It encodes with x264's `veryfast` preset, 2-2.7x as fast as the default at 1080p, with
    files of about the same size or smaller.
  - At upload, it estimates the encode time from the probe (frames, pixels decoded, pixels
    encoded at the chosen resolution) and the measured cost in `ENCODE_COST`, and refuses
    the video with a 400 if 1.5 times the estimate does not fit. The message says roughly
    how long a video at that resolution and frame rate can be, and suggests 720p or 480p
    when that helps. Nothing is queued for a refused video.
  - The plan length caps (5 / 15 / 30 / 60 minutes of video) still apply on top.
  - If an estimate is wrong, the encode is killed when the budget runs out and the job fails
    with "This video could not be compressed in time."

  With the cost measured on a 4-core laptop, the longest video accepted at Original
  resolution is (720p and 480p allow up to about twice as long):

  | Source | fps | Guest | Basic | Pro | Enterprise |
  | --- | --- | --- | --- | --- | --- |
  | 4K | 30 | 21 s | 1.0 min | 2.1 min | 4.1 min |
  | 1440p | 30 | 46 s | 2.3 min | 4.6 min | 9.3 min |
  | 1080p | 30 | 1.4 min | 4.1 min | 8.2 min | 16.5 min |
  | 1080p | 60 | 41 s | 2.1 min | 4.1 min | 8.2 min |
  | 720p | 30 | 3.1 min | 9.3 min | 18.5 min | 37.1 min |
  | 720p | 60 | 1.5 min | 4.6 min | 9.3 min | 18.5 min |
  | 480p | 30 | 5 min (cap) | 15 min (cap) | 30 min (cap) | 60 min (cap) |

  These scale with the server's speed: **re-measure `ENCODE_COST` on Railway** (see the
  checklist).
- **Compress Video results.** Kept 24 hours under `video-jobs/` (see step 7 above), outside
  the storage quota. With at most 20 queued jobs, waiting uploads take at most 10 GB of
  storage (20 at the 500 MB cap), and in practice far less.

### First deployment checklist

1. `GET /api/health` returns 200, and the deployment became active.
2. Sign in with Google and with an emailed code; check the redirect URI.
3. HTML to PDF and DOCX to PDF produce a PDF with the sandbox on. If the log shows
   `No usable sandbox!`, decide on `CHROMIUM_DISABLE_SANDBOX` (see above).
4. Run one conversion per tool family: an image tool, PDF to DOCX, HTML or DOCX to PDF,
   Compress Video, and Image to PDF with a BMP.
5. Confirm the client IP: send 31 convert requests in a minute and check that the 31st gets
   429, then repeat with a different `X-Real-IP` and `X-Forwarded-For` header sent by the
   client and check that it does not reset the limit.
6. Upload a large file (for example a 400 MB video on a Pro account) and see whether it
   completes inside Railway's 5-minute upload window.
7. Re-measure Compress Video's cost on Railway's CPU and update `ENCODE_COST` in
   `lib/convert/video-compress-limits.ts`: as a guest, time two 1080p30 uploads at once
   (Original, High quality) and divide each encode's seconds by its megapixel-frames. Then
   check that a guest's clip just under the new limit finishes within 5 minutes while a
   second encode runs, and that one just over it is refused at once.
8. Redeploy while a conversion is running and check that it completes (draining time).
   Redeploy while a video is being compressed and check that the job starts again on the
   new deployment and completes, and that its owner is notified.
9. Check memory and CPU under real use against the sizing above.
10. Confirm files land in, and are served from, the R2 bucket, and that the retention sweep
    deletes them: `expiresAt_1` on `conversions` and `userdocuments` has no
    `expireAfterSeconds`, and a document whose `expiresAt` you set to the past is gone from
    R2, and then from MongoDB, within 15 minutes.
11. Confirm the bucket's 8-day lifecycle rule exists (step 6 above).
12. Confirm the 2-day lifecycle rule for the `video-jobs/` prefix exists (step 7 above),
    that a `video-jobs/` object left behind is gone after 2 days rather than 8, and that a
    compressed video can be downloaded from R2 through its job.
13. With `SUPPORT_INBOX_EMAIL` set, send a message from the contact form and from the help
    form. Check that both arrive in that inbox and that replying goes to the visitor (for
    the help form, to the account's email).
