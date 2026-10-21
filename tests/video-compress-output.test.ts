import { NextRequest } from 'next/server';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { tmpdir } from 'os';
import type { AddressInfo } from 'net';
import {
  inspect,
  makeMedia,
  makeVideo,
  remux,
  topLevelBoxes,
  trackSpawnedProcesses,
} from './helpers/videoSamples';

let mockUserId: string | null = null;
let mockPlan = 'Free';
let mockResolvedFiles: unknown[] = [];

jest.mock('@/lib/auth/jwt', () => ({
  getAuthUserId: jest.fn().mockImplementation(() => Promise.resolve(mockUserId)),
}));

jest.mock('@/lib/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/models/user', () => ({
  __esModule: true,
  default: {
    findById: jest.fn().mockImplementation(() => Promise.resolve(mockUserId ? { plan: mockPlan } : null)),
  },
}));

jest.mock('@/models/conversion', () => ({
  __esModule: true,
  default: { create: jest.fn().mockResolvedValue(true) },
}));

jest.mock('@/lib/drive/resolveFiles', () => ({
  resolveFiles: jest.fn().mockImplementation(() => Promise.resolve(mockResolvedFiles)),
}));

import { POST as handleVideoCompress } from '../app/api/convert/video-compress/route';

jest.setTimeout(120_000);

function uploadedFile(bytes: Buffer, name: string, type = 'video/mp4') {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

async function compress(bytes: Buffer, name: string, fields: Record<string, string> = {}) {
  mockResolvedFiles = [uploadedFile(bytes, name)];
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  const res = await handleVideoCompress(
    new NextRequest('http://localhost:3000/api/convert/video-compress', { method: 'POST', body: formData }),
  );
  return { res, body: Buffer.from(await res.arrayBuffer()) };
}

async function compressOk(bytes: Buffer, name: string, fields: Record<string, string> = {}) {
  const { res, body } = await compress(bytes, name, fields);
  if (res.status !== 200) {
    throw new Error(`expected 200, got ${res.status}: ${body.toString('utf8')}`);
  }
  return { res, body, info: inspect(body) };
}

let processes: ReturnType<typeof trackSpawnedProcesses>;

beforeEach(() => {
  mockUserId = null;
  mockPlan = 'Free';
  mockResolvedFiles = [];
  processes = trackSpawnedProcesses();
});

afterEach(() => {
  processes.restore();
  expect(processes.stillRunning()).toEqual([]);
  expect(processes.leftoverTempFiles()).toEqual([]);
});

describe('video-compress never returns a larger file', () => {
  it('returns an already-small upload unchanged, with its own type and name and truthful sizes', async () => {
    const small = makeVideo({ size: '640x360', seconds: 4, crf: 40, extra: ['-preset', 'veryslow'], extension: 'mov' });

    const { res, body } = await compressOk(small, 'holiday.mov', { quality: 'High' });

    expect(body.equals(small)).toBe(true);
    expect(res.headers.get('Content-Type')).toBe('video/quicktime');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_holiday.mov"; filename*=UTF-8''compressed_holiday.mov`);
    expect(res.headers.get('X-Original-Size')).toBe(String(small.length));
    expect(res.headers.get('X-Compressed-Size')).toBe(String(small.length));
    expect(res.headers.get('X-Saved-Percent')).toBe('0');
  });

  it('returns an unchanged Matroska upload as Matroska', async () => {
    const small = makeVideo({ size: '640x360', seconds: 4, crf: 40, extra: ['-preset', 'veryslow'], extension: 'mkv' });

    const { res, body } = await compressOk(small, 'clip.mkv', { quality: 'High' });

    expect(body.equals(small)).toBe(true);
    expect(res.headers.get('Content-Type')).toBe('video/x-matroska');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_clip.mkv"; filename*=UTF-8''compressed_clip.mkv`);
  });

  it('shrinks a compressible upload and reports what it saved', async () => {
    const large = makeVideo({ size: '640x360', seconds: 2, crf: 0 });

    const { res, body } = await compressOk(large, 'master.mp4', { quality: 'Medium' });

    expect(body.length).toBeLessThan(large.length);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="compressed_master.mp4"; filename*=UTF-8''compressed_master.mp4`);
    expect(res.headers.get('X-Original-Size')).toBe(String(large.length));
    expect(res.headers.get('X-Compressed-Size')).toBe(String(body.length));
    expect(res.headers.get('X-Saved-Percent')).toBe(String(Math.round((1 - body.length / large.length) * 100)));
  });
});

describe('video-compress resolution is a ceiling on the short edge', () => {
  // crf 0 makes every input large enough that the re-encode, not the upload, comes back.
  it.each([
    ['a 320x240 clip at 720p keeps its size', '320x240', '720p', 320, 240],
    ['a 1280x720 landscape clip at 480p', '1280x720', '480p', 854, 480],
    ['a 720x1280 portrait clip at 480p', '720x1280', '480p', 480, 854],
    ['a 1920x1080 clip at 720p', '1920x1080', '720p', 1280, 720],
    ['a 1000x750 clip at 480p', '1000x750', '480p', 640, 480],
    ['an odd-sized 321x241 clip at Original', '321x241', 'Original', 320, 240],
  ])('%s', async (_label, size, resolution, width, height) => {
    const input = makeVideo({ size, seconds: 1, crf: 0, pixFmt: 'yuv444p' });

    const { info } = await compressOk(input, 'clip.mp4', { resolution });

    expect(info.video).toMatchObject({ width, height });
  });

  it('keeps the display shape of non-square pixels', async () => {
    const anamorphic = makeVideo({ size: '720x576', seconds: 1, crf: 0, extra: ['-vf', 'setsar=16/11'] });

    const { info } = await compressOk(anamorphic, 'pal.mp4', { resolution: '480p' });

    expect(info.video).toMatchObject({ width: 600, height: 480 });
    const [darWidth, darHeight] = info.video!.dar.split(':').map(Number);
    expect(darWidth / darHeight).toBeCloseTo((720 * 16) / (576 * 11), 2);
  });
});

describe('video-compress output plays everywhere', () => {
  it.each([
    ['10-bit', 'yuv420p10le'],
    ['4:2:2', 'yuv422p'],
    ['4:4:4', 'yuv444p'],
  ])('turns a %s input into 8-bit yuv420p H.264 with moov before mdat', async (_label, pixFmt) => {
    const input = makeVideo({ seconds: 1, crf: 0, pixFmt });

    const { body, info } = await compressOk(input, 'clip.mp4');

    expect(info.video).toMatchObject({ codec: 'h264', profile: 'High', pixFmt: 'yuv420p' });
    const boxes = topLevelBoxes(body);
    expect(boxes.indexOf('moov')).toBeGreaterThanOrEqual(0);
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
  });

  it('turns an animated GIF into a playable video', async () => {
    const gif = makeMedia(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10:duration=2'], 'gif');

    const { res, info } = await compressOk(gif, 'loop.gif');

    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(info.video).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p' });
  });
});

describe('video-compress strips metadata', () => {
  it('drops GPS location, title, artist and creation time', async () => {
    const tagged = makeVideo({
      seconds: 1,
      crf: 0,
      extra: [
        '-metadata', 'location=+40.7128-074.0060/',
        '-metadata', 'title=Home video',
        '-metadata', 'artist=Alice Example',
        '-metadata', 'creation_time=2024-05-01T10:00:00Z',
      ],
    });
    expect(inspect(tagged).log).toMatch(/location/);

    const { info } = await compressOk(tagged, 'home.mp4');

    expect(info.log).not.toMatch(/location|\+40\.7128|Home video|Alice Example|creation_time/i);
  });

  it('turns a rotated phone clip upright without keeping the rotation flag', async () => {
    const stored = makeVideo({ size: '320x240', seconds: 1, crf: 0 });
    const phone = remux(stored, ['-display_rotation', '90'], ['-c', 'copy']);
    expect(inspect(phone).rotation).toBe(90);

    const { info } = await compressOk(phone, 'phone.mp4');

    expect(info.video).toMatchObject({ width: 240, height: 320 });
    expect(info.rotation).toBeNull();
  });
});

describe('video-compress streams', () => {
  it('keeps every audio track and drops subtitles', async () => {
    const subtitles = path.join(tmpdir(), `vc-subs-${process.pid}.srt`);
    fs.writeFileSync(subtitles, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
    let input: Buffer;
    try {
      input = makeMedia(
        [
          '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
          '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
          '-i', subtitles,
          '-map', '0', '-map', '1', '-map', '2', '-map', '3',
          '-c:v', 'libx264', '-crf', '0', '-c:a', 'pcm_s16le', '-c:s', 'srt',
        ],
        'mkv',
      );
    } finally {
      fs.rmSync(subtitles, { force: true });
    }
    const source = inspect(input, 'mkv');
    expect(source.audioStreams).toBe(2);
    expect(source.subtitleStreams).toBe(1);

    const { info } = await compressOk(input, 'two-languages.mkv');

    expect(info.audioStreams).toBe(2);
    expect(info.log).toMatch(/Audio: aac/);
    expect(info.subtitleStreams).toBe(0);
  });

  it.each([
    ['an mp3', () => makeMedia(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'], 'mp3'), 'song.mp3'],
    ['a PNG', () => makeMedia(['-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-frames:v', '1'], 'png'), 'photo.png'],
    ['a one-frame MP4', () => makeVideo({ seconds: 1, extra: ['-frames:v', '1'] }), 'frame.mp4'],
  ])('refuses %s as having no moving video', async (_label, make, name) => {
    const { res, body } = await compress(make(), name);

    expect(res.status).toBe(400);
    expect(JSON.parse(body.toString('utf8')).error).toMatch(/no moving video/i);
    expect(processes.encodes()).toEqual([]);
  });

  it('still refuses a text file as unreadable', async () => {
    const { res, body } = await compress(Buffer.from('just some notes, not a video'), 'notes.txt');

    expect(res.status).toBe(400);
    expect(JSON.parse(body.toString('utf8')).error).toMatch(/could not be read as a video/i);
  });
});

describe('video-compress length caps, checked before encoding', () => {
  // 16x16 at one frame a second keeps an hour-long sample to a few kilobytes.
  const longVideo = (seconds: number) => makeVideo({ size: '16x16', rate: 1, seconds, crf: 51, extra: ['-g', '600'] });

  it.each([
    ['a guest', null, 'Free', 5],
    ['a Basic user', 'basic-user', 'Basic', 15],
    ['a Pro user', 'pro-user', 'Pro', 30],
    ['an Enterprise user', 'enterprise-user', 'Enterprise', 60],
  ])('lets %s compress a video just under the cap and refuses one just over it', async (_label, userId, plan, minutes) => {
    mockUserId = userId;
    mockPlan = plan;

    await compressOk(longVideo(minutes * 60 - 1), 'under.mp4');

    const encodesBefore = processes.encodes().length;
    const { res, body } = await compress(longVideo(minutes * 60 + 1), 'over.mp4');
    expect(res.status).toBe(400);
    expect(JSON.parse(body.toString('utf8')).error).toContain(`up to ${minutes} minutes long`);
    expect(processes.encodes().length).toBe(encodesBefore);
  });

  it('gives an unknown plan the guest cap', async () => {
    mockUserId = 'odd-user';
    mockPlan = 'Platinum';

    const { res, body } = await compress(longVideo(5 * 60 + 1), 'over.mp4');

    expect(res.status).toBe(400);
    expect(JSON.parse(body.toString('utf8')).error).toContain('up to 5 minutes long');
  });
});

describe('video-compress never reads or fetches what an uploaded playlist names', () => {
  let server: http.Server;
  let requests: string[];
  let baseUrl: string;
  let marker: string;
  const MARKER_TEXT = 'VC_MARKER_7f3a9e1b_DO_NOT_LEAK';

  beforeAll(async () => {
    requests = [];
    server = http.createServer((req, res) => {
      requests.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end(Buffer.alloc(188 * 10, 0x47));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    marker = path.join(tmpdir(), `vc-marker-${process.pid}.txt`);
    fs.writeFileSync(marker, MARKER_TEXT);
  });

  afterAll(async () => {
    fs.rmSync(marker, { force: true });
    await new Promise((resolve) => server.close(resolve));
  });

  const markerPath = () => marker.replace(/\\/g, '/');
  const playlists: [string, () => string, string][] = [
    ['an m3u8 naming a local file', () => `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${markerPath()}\n#EXT-X-ENDLIST\n`, 'playlist.m3u8'],
    ['an m3u8 naming a file: URL', () => `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///${markerPath()}\n#EXT-X-ENDLIST\n`, 'playlist.mp4'],
    ['an m3u8 naming a loopback URL', () => `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${baseUrl}/segment.ts\n#EXT-X-ENDLIST\n`, 'playlist.m3u8'],
    ['an ffconcat naming a local file', () => `ffconcat version 1.0\nfile '${markerPath()}'\n`, 'list.mp4'],
    ['an ffconcat naming a loopback URL', () => `ffconcat version 1.0\nfile '${baseUrl}/segment.ts'\n`, 'list.ffconcat'],
  ];

  it.each(playlists)('refuses %s as a 400 and touches nothing', async (_label, content, name) => {
    const { res, body } = await compress(Buffer.from(content()), name);

    expect(res.status).toBe(400);
    expect(JSON.parse(body.toString('utf8')).error).toMatch(/could not be read as a video/i);
    expect(body.includes(Buffer.from(MARKER_TEXT))).toBe(false);
    expect(requests).toEqual([]);
  });
});
