/**
 * Downloads Instagram Reel videos and extracts metadata using yt-dlp.
 * Uses --print-json to get metadata + video in one pass.
 *
 * Prerequisites: brew install yt-dlp ffmpeg
 *
 * Usage: npx tsx instagram/content-research/download-reels.ts [collected-file]
 * Output: downloaded-YYYY-MM-DD.json + video files in videos/YYYY-MM-DD/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const inputFile = process.argv[2] || join(__dirname, `collected-${date}.json`);

const COOKIES_DIR = join(process.env.HOME || '', '.claude-browser');
const MIN_VIDEO_SIZE = 50000; // 50KB minimum for a valid video

async function checkDependencies() {
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
  } catch {
    console.error('yt-dlp not found. Install with: brew install yt-dlp');
    process.exit(1);
  }
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 5000 });
  } catch {
    console.error('ffmpeg not found. Install with: brew install ffmpeg');
    process.exit(1);
  }
}

interface ReelMetadata {
  description?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  thumbnail?: string;
}

function extractMetadata(json: any): ReelMetadata {
  return {
    description: json.description || json.title || '',
    like_count: json.like_count ?? null,
    comment_count: json.comment_count ?? null,
    view_count: json.view_count ?? null,
    duration: json.duration ?? null,
    uploader: json.uploader || json.uploader_id || '',
    upload_date: json.upload_date || '',
    thumbnail: json.thumbnail || '',
  };
}

async function downloadReelWithMetadata(
  reelUrl: string,
  outputPath: string
): Promise<{ metadata: ReelMetadata | null; error: string | null }> {
  try {
    // Use --print-json to get metadata while downloading
    const { stdout } = await execFileAsync('yt-dlp', [
      '--cookies-from-browser', `chrome:${COOKIES_DIR}`,
      '-f', 'worst*[ext=mp4]/worst*',
      '-S', '+size,+res',
      '-o', outputPath,
      '--merge-output-format', 'mp4',
      '--no-warnings',
      '--print-json',
      reelUrl,
    ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    // Parse the JSON metadata from stdout
    let metadata: ReelMetadata | null = null;
    try {
      // --print-json outputs one JSON object per line
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          const parsed = JSON.parse(trimmed);
          metadata = extractMetadata(parsed);
          break;
        }
      }
    } catch {
      // JSON parsing failed — still try metadata-only fallback
    }

    return { metadata, error: null };
  } catch (err: any) {
    const msg = err.stderr?.substring(0, 200) || err.message;
    return { metadata: null, error: msg };
  }
}

async function fetchMetadataOnly(reelUrl: string): Promise<ReelMetadata | null> {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--cookies-from-browser', `chrome:${COOKIES_DIR}`,
      '--dump-json',
      '--no-warnings',
      reelUrl,
    ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });

    const parsed = JSON.parse(stdout.trim());
    return extractMetadata(parsed);
  } catch {
    return null;
  }
}

async function downloadReels() {
  await checkDependencies();

  if (!existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const reels = data.reels;

  const videosDir = join(__dirname, 'videos', date);
  mkdirSync(videosDir, { recursive: true });

  console.log(`Downloading ${reels.length} reels with metadata...\n`);

  const results: any[] = [];
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];
    const videoPath = join(videosDir, `${reel.reel_id}.mp4`);

    // Check if metadata was already fetched during collection (hashtag mode)
    const hasMetadata = reel.like_count != null;

    // Skip if already downloaded and file is valid
    if (existsSync(videoPath) && statSync(videoPath).size > MIN_VIDEO_SIZE) {
      const sizeMB = (statSync(videoPath).size / 1024 / 1024).toFixed(1);

      if (hasMetadata) {
        console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — already downloaded (${sizeMB}MB), metadata present`);
        results.push({ ...reel, video_path: videoPath });
      } else {
        console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — already downloaded (${sizeMB}MB), fetching metadata...`);
        const metadata = await fetchMetadataOnly(reel.url);
        results.push({ ...reel, video_path: videoPath, ...(metadata || {}) });
      }
      skippedCount++;

      await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
      continue;
    }

    console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — downloading...`);

    const { metadata, error } = await downloadReelWithMetadata(reel.url, videoPath);

    // Merge: keep pre-existing metadata, overlay with fresh if available
    const mergedMeta = hasMetadata ? {} : (metadata || {});

    if (error) {
      console.log(`  Error: ${error}`);
      results.push({
        ...reel,
        video_path: null,
        download_error: error,
        ...mergedMeta,
      });
      failedCount++;
    } else if (existsSync(videoPath) && statSync(videoPath).size > MIN_VIDEO_SIZE) {
      const sizeMB = (statSync(videoPath).size / 1024 / 1024).toFixed(1);
      console.log(`  Downloaded (${sizeMB}MB)`);
      const displayMeta = hasMetadata ? reel : metadata;
      if (displayMeta) {
        const views = displayMeta.view_count ? ` | ${displayMeta.view_count.toLocaleString()} views` : '';
        const likes = displayMeta.like_count ? ` | ${displayMeta.like_count.toLocaleString()} likes` : '';
        console.log(`  Metadata: @${displayMeta.uploader || reel.author}${views}${likes}`);
      }
      results.push({
        ...reel,
        video_path: videoPath,
        ...mergedMeta,
      });
      downloadedCount++;
    } else {
      console.log(`  File too small or missing — trying metadata only...`);
      if (!hasMetadata) {
        const fallbackMeta = await fetchMetadataOnly(reel.url);
        results.push({ ...reel, video_path: null, download_error: 'file_too_small', ...(fallbackMeta || {}) });
      } else {
        results.push({ ...reel, video_path: null, download_error: 'file_too_small' });
      }
      failedCount++;
    }

    // Small delay between downloads to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  const outPath = join(__dirname, `downloaded-${date}.json`);
  writeFileSync(outPath, JSON.stringify({
    collected_at: data.collected_at,
    mode: data.mode,
    downloaded_at: new Date().toISOString(),
    total: results.length,
    downloaded: downloadedCount,
    skipped: skippedCount,
    failed: failedCount,
    videos_dir: videosDir,
    reels: results,
  }, null, 2));

  console.log(`\nDownloaded: ${downloadedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`);
  console.log(`Videos in: ${videosDir}`);
  console.log(`Saved to ${outPath}`);
}

downloadReels().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
