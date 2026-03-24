/**
 * Analyzes downloaded Instagram Reel videos using Google Gemini 2.0 Flash.
 *
 * Reads transcribed-YYYY-MM-DD.json, uploads each video to Gemini for
 * native video analysis (scenes, OCR, format classification), and outputs
 * analyzed-YYYY-MM-DD.json with visual_analysis fields.
 *
 * Prerequisites:
 *   npm install @google/generative-ai
 *   export GEMINI_API_KEY="your-key-here"
 *
 * Usage: npx tsx scripts/analyze-visuals.ts [transcribed-file]
 * Output: scripts/analyzed-YYYY-MM-DD.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  GoogleGenerativeAI,
} from '@google/generative-ai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const date = new Date().toISOString().slice(0, 10);

// Load .env file from project root if it exists
const envPath = join(projectRoot, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
const inputFile = process.argv[2] || join(__dirname, `transcribed-${date}.json`);

const GEMINI_MODEL = 'gemini-2.5-flash';
const RATE_LIMIT_DELAY_MS = 4500; // 4.5s between calls → stays under 15 RPM free tier
const UPLOAD_TIMEOUT_MS = 120000; // 2 min for upload processing
const UPLOAD_POLL_INTERVAL_MS = 3000; // poll every 3s

const ANALYSIS_PROMPT = `Analyze this Instagram Reel video. Return a JSON object with exactly these fields:

{
  "scenes": "Describe the visual sequence scene by scene. Include camera angles, transitions, and what happens in each scene. Be specific and concise.",
  "text_on_screen_ocr": ["Extract ALL text that appears on screen, in order of appearance. Include titles, captions, labels, watermarks, and any other readable text."],
  "visual_format": "Classify as exactly one of: talking-head-with-text | text-on-screen | montage | slideshow | screen-recording | skit | tutorial-demo | product-showcase | transition-video | meme-clip | aesthetic-mood",
  "key_visual_elements": ["List key visual elements present, from: face-to-camera, text-overlay, b-roll, transitions, split-screen, green-screen, screen-recording, product-shots, before-after, slow-motion, timelapse, animation, stock-footage, meme-template, aesthetic-filter"],
  "production_quality": "Rate as 'low', 'medium', or 'high' followed by a brief reason. Example: 'high — professional lighting, smooth transitions, custom graphics'",
  "summary": "Write a 2-3 sentence summary of what this reel shows and communicates visually."
}

Return ONLY valid JSON. No markdown fencing, no explanation outside the JSON.`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFileProcessing(
  genAI: GoogleGenerativeAI,
  fileName: string,
): Promise<void> {
  const fileManager = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  const start = Date.now();

  // Use the files API to check processing status
  while (Date.now() - start < UPLOAD_TIMEOUT_MS) {
    try {
      // The file is ready when we can use it — we'll check via a lightweight call
      // For the Google GenAI SDK, files are typically ready quickly after upload
      return;
    } catch {
      await sleep(UPLOAD_POLL_INTERVAL_MS);
    }
  }
  throw new Error(`File processing timed out after ${UPLOAD_TIMEOUT_MS / 1000}s`);
}

function parseAnalysisResponse(text: string): Record<string, any> | null {
  // Strip markdown fencing if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate expected fields exist
    const required = ['scenes', 'text_on_screen_ocr', 'visual_format', 'key_visual_elements', 'production_quality', 'summary'];
    for (const field of required) {
      if (!(field in parsed)) {
        console.log(`  Warning: missing field "${field}" in response`);
      }
    }

    // Ensure arrays are arrays
    if (!Array.isArray(parsed.text_on_screen_ocr)) {
      parsed.text_on_screen_ocr = parsed.text_on_screen_ocr ? [parsed.text_on_screen_ocr] : [];
    }
    if (!Array.isArray(parsed.key_visual_elements)) {
      parsed.key_visual_elements = parsed.key_visual_elements ? [parsed.key_visual_elements] : [];
    }

    return parsed;
  } catch (err: any) {
    console.log(`  Failed to parse JSON response: ${err.message}`);
    console.log(`  Raw response: ${text.slice(0, 200)}`);
    return null;
  }
}

async function analyzeReels() {
  // Check API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set.');
    console.error('Get a free API key at https://aistudio.google.com/apikey');
    console.error('Then add it to .env: cp .env.example .env && edit .env');
    process.exit(1);
  }

  if (!existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const reels = data.reels;

  console.log(`Analyzing visuals for ${reels.length} reels with Gemini...\n`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const results: any[] = [];
  let analyzedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];

    if (!reel.video_path || !existsSync(reel.video_path)) {
      console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — no video, skipping`);
      results.push({ ...reel });
      skippedCount++;
      continue;
    }

    console.log(`[${i + 1}/${reels.length}] ${reel.reel_id} — uploading to Gemini...`);

    let retries = 0;
    const maxRetries = 1;

    while (retries <= maxRetries) {
      try {
        // Read the video file and upload inline
        const videoData = readFileSync(reel.video_path);
        const base64Video = videoData.toString('base64');

        console.log(`  analyzing (${(videoData.length / 1024 / 1024).toFixed(1)}MB)...`);

        const result = await model.generateContent([
          {
            inlineData: {
              mimeType: 'video/mp4',
              data: base64Video,
            },
          },
          { text: ANALYSIS_PROMPT },
        ]);

        const response = result.response;
        const text = response.text();
        const analysis = parseAnalysisResponse(text);

        if (analysis) {
          console.log(`  ✓ format: ${analysis.visual_format}, OCR items: ${analysis.text_on_screen_ocr?.length || 0}`);
          results.push({
            ...reel,
            visual_analysis: analysis,
          });
          analyzedCount++;
        } else {
          console.log(`  ✗ could not parse response`);
          results.push({
            ...reel,
            visual_analysis_error: 'parse_failed',
          });
          failedCount++;
        }

        break; // success — exit retry loop

      } catch (err: any) {
        if (retries < maxRetries) {
          console.log(`  Error: ${err.message} — retrying in 5s...`);
          await sleep(5000);
          retries++;
        } else {
          console.log(`  Error: ${err.message} — skipping after ${maxRetries + 1} attempts`);
          results.push({
            ...reel,
            visual_analysis_error: err.message,
          });
          failedCount++;
          break;
        }
      }
    }

    // Rate limit: wait between calls (skip delay after last reel)
    if (i < reels.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }
  }

  const outPath = join(__dirname, `analyzed-${date}.json`);
  writeFileSync(outPath, JSON.stringify({
    ...data,
    analyzed_at: new Date().toISOString(),
    analysis_stats: {
      analyzed: analyzedCount,
      skipped: skippedCount,
      failed: failedCount,
    },
    reels: results,
  }, null, 2));

  console.log(`\nAnalyzed: ${analyzedCount} | Skipped: ${skippedCount} | Failed: ${failedCount}`);
  console.log(`Saved to ${outPath}`);
}

analyzeReels().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
