# Instagram Reels Content Research

A Claude Code skill that automates Instagram Reels research for content creators. Collects, downloads, transcribes, scores, and classifies reels so you can build a content schedule from pre-analyzed, high-performing content.

**Research only** — no liking, following, commenting, or DM harvesting.

## Quick Start

### 1. Install system dependencies

```bash
brew install yt-dlp ffmpeg whisper-cpp
```

### 2. Install Node dependencies

```bash
cd instagram-reels-content-research
npm install
npx playwright install chromium
```

### 3. Set up Chrome profile

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.claude-browser" \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check
```

Log into Instagram in the Chrome window that opens. Close it when done. You only need to do this once — cookies persist.

### 4. Install the Claude Code skill

Copy the `skill/` folder contents into your project's Claude Code skill directory:

```bash
mkdir -p .claude/skills/instagram-reels-content-research
cp skill/* .claude/skills/instagram-reels-content-research/
```

### 5. Copy scripts to your project

```bash
mkdir -p instagram/content-research
cp scripts/* instagram/content-research/
```

Then update the import paths in `collect-feed.ts` and `collect-research.ts` to point to wherever your `browser.ts` lives (or keep `browser.ts` alongside the other scripts).

## Three Modes

### Hashtag Mode (no browser needed)
Scrapes a hashtag page via yt-dlp, ranks all reels by likes, keeps the top N.

```bash
npx tsx scripts/collect-research.ts --hashtag "ukproperty" --top 5
```

### Username Mode (no browser needed)
Pulls reels from specific creator profiles via yt-dlp.

```bash
npx tsx scripts/collect-research.ts --usernames "creator1,creator2" 20
```

### Feed Mode (browser needed)
Scrolls your logged-in Instagram Reels feed with human-like timing.

```bash
npx tsx scripts/collect-feed.ts 20
```

### Keyword Mode (browser needed)
Searches Instagram for a keyword and collects reels from results.

```bash
npx tsx scripts/collect-research.ts --keyword "UK property investing" 20
```

## The Pipeline

```
1. Collect    →  collected-YYYY-MM-DD.json     (reel URLs + metadata)
2. Download   →  downloaded-YYYY-MM-DD.json    (video files + metadata)
3. Transcribe →  transcribed-YYYY-MM-DD.json   (speech-to-text)
4. Score      →  scored-YYYY-MM-DD.json        (Claude scores inside Claude Code)
5. Report     →  report-YYYY-MM-DD.html        (visual HTML report)
6. Cleanup    →  deletes old video folders when >50 files
```

Steps 1-3 and 5-6 are scripts. Step 4 runs inside Claude Code itself — Claude reads the transcribed JSON, scores each reel using the rubric in `skill/scoring.md`, and writes the scored JSON.

## Running the full pipeline

```bash
# Step 1: Collect (pick your mode)
npx tsx scripts/collect-research.ts --hashtag "ukproperty" --top 5

# Step 2: Download videos + metadata
npx tsx scripts/download-reels.ts

# Step 3: Transcribe audio
npx tsx scripts/transcribe-reels.ts

# Step 4: Score (done by Claude in Claude Code — reads transcribed JSON, writes scored JSON)

# Step 5: Generate report
npx tsx scripts/generate-report.ts --open

# Step 6: Cleanup old videos
npx tsx scripts/cleanup-videos.ts
```

## Output Files

| File | Purpose |
|------|---------|
| `collected-YYYY-MM-DD.json` | Reel URLs + ad detection + author |
| `downloaded-YYYY-MM-DD.json` | Download status + metadata + video paths |
| `videos/YYYY-MM-DD/*.mp4` | Downloaded reel video files |
| `transcribed-YYYY-MM-DD.json` | Reels with speech transcripts |
| `scored-YYYY-MM-DD.json` | Full scoring + classification |
| `report-YYYY-MM-DD.html` | Visual content research report |

## Requirements

- macOS (tested on Apple Silicon)
- Node.js 18+
- yt-dlp, ffmpeg, whisper-cpp (all via Homebrew)
- Chrome with a profile logged into Instagram
- Claude Code (for the scoring step and skill integration)

## Troubleshooting

See `skill/setup.md` for detailed troubleshooting for Chrome connection issues, login problems, yt-dlp failures, and whisper-cpp setup.
