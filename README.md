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
placeholder secrets and a placeholder `MONGODB_URI`.

CI (`.github/workflows/container.yml`) builds the Docker image on every push and pull
request, runs the test suite inside it, starts the image and sends one request to each tool
family (`scripts/container-smoke.mjs`), measures the container's memory, and checks that
the server shuts down cleanly on SIGTERM.

## Configuration

Every environment variable the app reads is listed and explained in
[`.env.example`](.env.example). The app builds and starts without any of them; requests that
need a missing one fail with an error that names it. For production you need at least
`MONGODB_URI`, `JWT_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, the Google sign-in pair,
`BREVO_API_KEY` and `EMAIL_USER`, the storage settings (`STORAGE_DRIVER=s3` and the `S3_*`
variables for the R2 bucket; the local-disk default loses files on every redeploy) and
`CLIENT_IP_HEADER`.

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
job at a time between them.

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
     seconds covers Compress Video's 4-minute time budget (see Limits), the longest of any
     job, once its upload has arrived.
   - Do not set `CHROMIUM_DISABLE_SANDBOX` unless the first deployment shows it is needed.
2. **Healthcheck.** Set the service's healthcheck path to `/api/health`. Railway calls it
   only while starting a deployment, from the hostname `healthcheck.railway.app`
   ([Healthchecks](https://docs.railway.com/reference/healthchecks)).
3. **One replica.** Keep the service at a single instance. The rate limiter (`proxy.ts`),
   the worker slot counter (`lib/convert/worker-job.ts`), the image, video and render job
   counters (`lib/image/image-jobs.ts`, `lib/video/video-jobs.ts`,
   `lib/puppeteer/render-jobs.ts`) and the per-caller job
   claims (`lib/convert/caller-jobs.ts`) live in the process's memory. With more than one instance each instance would apply its own limits, so the
   real limits would multiply.
4. **Google OAuth.** In Google Cloud Console, add
   `<NEXTAUTH_URL>/api/auth/callback/google` as an authorised redirect URI of the OAuth
   client, and `<NEXTAUTH_URL>` as an authorised JavaScript origin if the Drive picker is
   used.
5. **Region.** Choose the region closest to the expected users.

### Instance size

Measured in CI (GitHub's `ubuntu-24.04` runner, 4 vCPU, 16 GB, container without a memory
limit, peak read from the container's cgroup `memory.peak`; ranges are over three runs):

| State | Container memory |
| --- | --- |
| Started, idle | 185-188 MB |
| After one request to each tool family | 345-348 MB peak |
| Two Image to PDF jobs, then two Compress Image jobs, each on a 49-megapixel PNG, two at a time | 764-1,064 MB peak |

That last row was measured before guests were limited to one job at a time and one slot of
each pool (see Heavy jobs per caller). CI has no signed-in user, so it now runs one job of
each at a time and reports a lower peak; two at once is still possible for signed-in users.

The CI images are flat-colour PNGs, which are cheap to compress. Earlier measurements on
Windows (in the PRs that set the image limits) put two Image to PDF or Compress Image jobs at
the pixel cap on photographic images at about 1.9 GB above the idle server. On top of that,
at the same time, the server can be running two PDF extraction workers (up to 256 MB of heap
each, plus decoded data outside the heap), a Chromium per HTML or DOCX to PDF request, two
ffmpeg encodes, and holding whole uploads in memory (each upload route reads its upload
into memory, up to the plan's cap: 500 MB at most).

Recommendation: **8 GB of memory and 4 vCPU**. Two video encodes alone take four cores
(`-threads 2` each, at most two at once), and the sum of the peaks above comes to about
5 GB with two large uploads in flight. 4 GB is enough for light traffic without large
video uploads. Watch the memory graph during the first weeks and adjust.

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
  and after 15 minutes in any case (same page). Compress Video returns nothing until the
  encode finishes, so until it runs as a background job (#115) every accepted video must
  be probed, encoded and ready within a **4-minute time budget**, for every plan
  (`VIDEO_TIME_BUDGET_MS` in `lib/convert/video-compress-limits.ts`):
  - It encodes with x264's `veryfast` preset, 2-2.7x as fast as the default at 1080p, with
    files of about the same size or smaller.
  - Before encoding, it estimates the encode time from the probe (frames, pixels decoded,
    pixels encoded at the chosen resolution) and the measured cost in `ENCODE_COST`, and
    refuses the video with a 400 if 1.5 times the estimate does not fit. The message says
    roughly how long a video at that resolution and frame rate can be, and suggests 720p or
    480p when that helps. Nothing is encoded for a refused video.
  - The plan length caps (5 / 15 / 30 / 60 minutes) still apply, but only bind for small
    videos, such as 480p30 for a guest.
  - If an estimate is wrong, the encode is killed when the budget runs out and the user is
    told the video could not be compressed in time.

  With the cost measured on a 4-core laptop, the longest video accepted is:

  | Source | fps | Original | 720p | 480p |
  | --- | --- | --- | --- | --- |
  | 4K | 30 | 16 s | 40 s | 45 s |
  | 1440p | 30 | 37 s | 1.2 min | 1.5 min |
  | 1080p | 30 | 1.1 min | 1.7 min | 2.4 min |
  | 1080p | 60 | 33 s | 52 s | 1.2 min |
  | 720p | 30 | 2.5 min | 2.5 min | 3.9 min |
  | 720p | 60 | 1.2 min | 1.2 min | 2.0 min |
  | 480p | 30 | 5.6 min (guests: 5) | same | same |

  These scale with the server's speed: **re-measure `ENCODE_COST` on Railway** (see the
  checklist).

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
   check that a clip just under the new limit finishes within 4 minutes while a second
   encode runs, and that one just over it is refused at once.
8. Redeploy while a conversion is running and check that it completes (draining time).
9. Check memory and CPU under real use against the sizing above.
10. Confirm files land in, and are served from, the R2 bucket.
