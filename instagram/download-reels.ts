/**
 * Downloads Instagram Reel videos locally using yt-dlp.
 *
 * yt-dlp handles Instagram's DASH streaming (separate video+audio segments)
 * and merges them into a complete MP4 with ffmpeg.
 *
 * Prerequisites: brew install yt-dlp ffmpeg
 *
 * Output: downloaded-YYYY-MM-DD.json with video_path added to each reel.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const inputFile = process.argv[2] || join(__dirname, `enriched-${date}.json`);

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

async function downloadReel(reelUrl: string, outputPath: string): Promise<void> {
  await execFileAsync('yt-dlp', [
    '--cookies-from-browser', `chrome:${COOKIES_DIR}`,
    '-o', outputPath,
    '--merge-output-format', 'mp4',
    '--no-warnings',
    '--quiet',
    reelUrl,
  ], { timeout: 120000 });
}

async function downloadReels() {
  await checkDependencies();

  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const reels = data.reels;

  const videosDir = join(__dirname, 'videos', date);
  mkdirSync(videosDir, { recursive: true });

  console.log(`Downloading videos for ${reels.length} reels...\n`);

  const results: any[] = [];
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];
    const videoPath = join(videosDir, `${reel.reel_id}.mp4`);

    // Skip if already downloaded and file is valid
    if (existsSync(videoPath) && statSync(videoPath).size > MIN_VIDEO_SIZE) {
      const sizeMB = (statSync(videoPath).size / 1024 / 1024).toFixed(1);
      console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — already downloaded (${sizeMB}MB), skipping`);
      results.push({ ...reel, video_path: videoPath });
      skippedCount++;
      continue;
    }

    console.log(`[${i + 1}/${reels.length}] ${reel.reel_id}...`);

    try {
      await downloadReel(reel.url, videoPath);

      if (existsSync(videoPath) && statSync(videoPath).size > MIN_VIDEO_SIZE) {
        const sizeMB = (statSync(videoPath).size / 1024 / 1024).toFixed(1);
        console.log(`  Downloaded (${sizeMB}MB)`);
        results.push({ ...reel, video_path: videoPath });
        downloadedCount++;
      } else {
        console.log(`  File too small or missing`);
        results.push({ ...reel, video_path: null, download_error: 'file_too_small' });
        failedCount++;
      }
    } catch (err: any) {
      const msg = err.stderr?.substring(0, 200) || err.message;
      console.log(`  Error: ${msg}`);
      results.push({ ...reel, video_path: null, download_error: msg });
      failedCount++;
    }

    // Small delay between downloads to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
  }

  const outPath = join(__dirname, `downloaded-${date}.json`);
  writeFileSync(outPath, JSON.stringify({
    collected_at: data.collected_at,
    enriched_at: data.enriched_at,
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
