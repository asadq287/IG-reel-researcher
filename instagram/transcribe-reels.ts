/**
 * Transcribes downloaded Instagram Reel videos using ffmpeg + whisper.cpp.
 *
 * Reads downloaded-YYYY-MM-DD.json, extracts audio from each video,
 * transcribes with whisper.cpp locally, and outputs transcribed-YYYY-MM-DD.json.
 *
 * Prerequisites:
 *   npm install fluent-ffmpeg ffmpeg-static
 *   brew install whisper-cpp
 *   Download model: curl -L -o ~/.local/share/whisper-cpp/ggml-base.en.bin \
 *     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
// Prefer system ffmpeg (brew install ffmpeg) for better codec support,
// fall back to ffmpeg-static npm package
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

let ffmpegPath: string;
try {
  ffmpegPath = execFileSync('which', ['ffmpeg'], { encoding: 'utf-8' }).trim();
} catch {
  const require = createRequire(import.meta.url);
  ffmpegPath = require('ffmpeg-static');
}

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const inputFile = process.argv[2] || join(__dirname, `downloaded-${date}.json`);
const shouldCleanup = process.argv.includes('--cleanup');

// whisper-cpp paths
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const MODEL_DIR = join(process.env.HOME || '', '.local/share/whisper-cpp');
const WHISPER_MODEL = join(MODEL_DIR, 'ggml-base.en.bin');
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

async function checkDependencies() {
  // Check ffmpeg
  try {
    await execFileAsync(ffmpegPath, ['-version'], { timeout: 5000 });
  } catch {
    console.error('ffmpeg-static not working. Run: npm install ffmpeg-static');
    process.exit(1);
  }

  // Check whisper-cpp
  if (!existsSync(WHISPER_BIN)) {
    console.error(`whisper-cpp not found at ${WHISPER_BIN}`);
    console.error('Install with: brew install whisper-cpp');
    process.exit(1);
  }

  // Check model file
  if (!existsSync(WHISPER_MODEL)) {
    console.log(`Whisper model not found. Downloading base.en model (~150MB)...`);
    mkdirSync(MODEL_DIR, { recursive: true });
    try {
      await execFileAsync('curl', [
        '-L', '-o', WHISPER_MODEL, MODEL_URL,
      ], { timeout: 300000 }); // 5 min timeout for download
      console.log('Model downloaded.\n');
    } catch (err: any) {
      console.error(`Failed to download model: ${err.message}`);
      console.error(`Manual download: curl -L -o ${WHISPER_MODEL} ${MODEL_URL}`);
      process.exit(1);
    }
  }
}

async function extractAudio(videoPath: string, wavPath: string): Promise<void> {
  await execFileAsync(ffmpegPath, [
    '-i', videoPath,
    '-ar', '16000',       // 16kHz sample rate (whisper requirement)
    '-ac', '1',           // mono
    '-c:a', 'pcm_s16le', // 16-bit PCM WAV
    '-y',                 // overwrite if exists
    wavPath,
  ], { timeout: 60000 });
}

async function transcribe(wavPath: string): Promise<string> {
  const { stdout } = await execFileAsync(WHISPER_BIN, [
    '-m', WHISPER_MODEL,
    '--no-timestamps',
    '-l', 'en',
    wavPath,
  ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.includes('[BLANK_AUDIO]'))
    .join(' ')
    .trim();
}

async function transcribeReels() {
  await checkDependencies();

  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const reels = data.reels;

  console.log(`Transcribing ${reels.length} reels...\n`);

  const results: any[] = [];
  let transcribedCount = 0;
  let noSpeechCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];

    if (!reel.video_path || !existsSync(reel.video_path)) {
      console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — no video, skipping`);
      results.push({ ...reel, transcript: null, transcript_error: 'no_video' });
      skippedCount++;
      continue;
    }

    const wavPath = reel.video_path.replace('.mp4', '.wav');

    try {
      // Step 1: Extract audio
      console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — extracting audio...`);
      await extractAudio(reel.video_path, wavPath);

      // Step 2: Transcribe
      console.log(`  transcribing...`);
      const transcript = await transcribe(wavPath);

      if (transcript.length < 5) {
        console.log(`  no speech detected`);
        results.push({ ...reel, transcript: '', transcript_note: 'no_speech' });
        noSpeechCount++;
      } else {
        console.log(`  "${transcript.slice(0, 80)}${transcript.length > 80 ? '...' : ''}"`);
        results.push({ ...reel, transcript });
        transcribedCount++;
      }
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
      results.push({ ...reel, transcript: null, transcript_error: err.message });
      failedCount++;
    } finally {
      // Clean up temp WAV file
      if (existsSync(wavPath)) {
        try { unlinkSync(wavPath); } catch {}
      }
      // Optionally clean up video file too
      if (shouldCleanup && reel.video_path && existsSync(reel.video_path)) {
        try { unlinkSync(reel.video_path); } catch {}
      }
    }
  }

  const outPath = join(__dirname, `transcribed-${date}.json`);
  writeFileSync(outPath, JSON.stringify({
    collected_at: data.collected_at,
    enriched_at: data.enriched_at,
    downloaded_at: data.downloaded_at,
    transcribed_at: new Date().toISOString(),
    total: results.length,
    transcribed: transcribedCount,
    no_speech: noSpeechCount,
    skipped: skippedCount,
    failed: failedCount,
    reels: results,
  }, null, 2));

  console.log(`\nTranscribed: ${transcribedCount} | No speech: ${noSpeechCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`);
  console.log(`Saved to ${outPath}`);
}

transcribeReels().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
