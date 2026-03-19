---
name: instagram-reels-content-research
description: Content research via Instagram Reels. Scrolls your feed or specific creator pages, downloads and transcribes reels, scores them for relevance and engagement, classifies by reel type and effort level, and generates a content research report. Use when asked to research reels, find content ideas, analyze what's trending on Instagram, or build a content schedule.
---

# Instagram Reels Content Research

Automates the "scroll and research" phase of content creation. Collects, downloads, transcribes, scores, and classifies Instagram Reels so you can build a weekly content schedule from pre-analyzed, high-performing reels.

This is a **research-only** tool. No liking, following, commenting, or DM harvesting.

## Prerequisites

Before first run, complete the one-time setup in [setup.md](setup.md).

- Node.js 18+
- Playwright installed (`npm install playwright && npx playwright install chromium`) — only needed for Feed and Keyword modes
- Dedicated Chrome profile at `~/.claude-browser` logged into Instagram
- yt-dlp + ffmpeg + whisper-cpp installed via Homebrew
- No paid APIs — everything runs locally

## Three Modes

### 1. Feed Mode
Scroll the logged-in user's Instagram Reels feed. Works best when the account's algorithm is already trained toward a niche.

### 2. Research Mode
Scroll specific creator profile pages or Instagram search results. For cold-start niches or targeted competitor research.

Input options:
- **Creator usernames** (e.g., `@deltaoneproperty`, `@supercarblondie`) — navigates to each creator's reels tab
- **Topic keywords** (e.g., "UK property investing") — navigates to Instagram search, filters to Reels

### 3. Hashtag Mode
Scrape a hashtag page, fetch metadata for all found reels, rank by like count, and keep only the top N. This is the most targeted mode — you get the highest-performing reels for a specific hashtag without scrolling blind.

Input: a hashtag (e.g., `#ukproperty`) and optionally how many to keep (default: 5).

How it works:
1. yt-dlp discovers all reel entries from `https://www.instagram.com/explore/tags/<hashtag>/` (no browser needed)
2. Fetches full metadata (likes, views, etc.) for each via `yt-dlp --dump-json`
3. Sorts by like count descending
4. Keeps only the top N reels
5. Outputs collected JSON with metadata already attached

**No Playwright required** for hashtag or username modes — they use yt-dlp's built-in Instagram extractors. Only keyword mode needs a browser (interactive search).

## The Pipeline

### Step 0: Setup / First Run

On first invocation:

1. Check dependencies are installed (yt-dlp, ffmpeg, whisper-cpp). If not, print install commands and stop.
2. Check Chrome profile at `~/.claude-browser`. If missing, launch Chrome for the user to log in.
3. Determine the mode. The user may specify it directly in their message (e.g., "research #ukproperty hashtag top 5", "scroll my feed for car content", "check what @supercarblondie is posting"). If the mode is clear from context, use it. If not, ask:
   - "What niche/topic are you creating content for?" (free text)
   - "Which mode? Feed / Research / Hashtag?"
   - If research: "Provide creator usernames (comma-separated) or a search keyword"
   - If hashtag: "Which hashtag? How many top reels?" (default: 5)

### Step 1: Collect Reels

Launch Chrome via CDP (reuses `scripts/browser.ts`), scroll and collect 20 reel URLs.

**Feed mode:**
```bash
npx tsx scripts/collect-feed.ts [count]
```
- Default: 20 reels
- URL: `https://www.instagram.com/reels/`
- Output: `collected-YYYY-MM-DD.json`

**Research mode:**
```bash
# By creator usernames
npx tsx scripts/collect-research.ts --usernames "deltaoneproperty,supercarblondie" [count]

# By keyword search
npx tsx scripts/collect-research.ts --keyword "UK property investing" [count]
```
- Default: 20 reels
- Distributes target across creators (e.g., 3 creators = ~7 reels each)
- Output: `collected-YYYY-MM-DD.json`

**Hashtag mode (no browser):**
```bash
npx tsx scripts/collect-research.ts --hashtag "ukproperty" --top 5
```
- Uses yt-dlp `--flat-playlist` to discover reels from the hashtag page (no Playwright)
- Fetches full metadata via `yt-dlp --dump-json` for each
- Sorts by like_count descending, keeps top N (default: 5)
- Output: `collected-YYYY-MM-DD.json` (with metadata pre-attached)
- Note: since metadata is fetched during collection, the download step skips redundant metadata fetches

**Username mode is also browser-free** — uses the same yt-dlp discovery approach.

Human simulation timing:
- 3-8s base watch time per reel
- 20% chance of lingering 8-18s
- 10% chance of quick 1.5-3s skip
- 8% chance of 15-45s distracted pause
- ArrowDown to advance

### Step 2: Download + Extract Metadata (yt-dlp)

```bash
npx tsx scripts/download-reels.ts [collected-file]
```

For each reel, uses `yt-dlp --print-json` to download the video AND capture metadata in one pass.

Extracted metadata: description (caption), like_count, comment_count, view_count, duration, uploader, upload_date, thumbnail URL.

- Input: `collected-YYYY-MM-DD.json`
- Output: `downloaded-YYYY-MM-DD.json` + video files in `videos/YYYY-MM-DD/`
- Uses `--cookies-from-browser chrome:~/.claude-browser` for authentication

### Step 3: Transcribe

```bash
npx tsx scripts/transcribe-reels.ts [downloaded-file]
```

For each downloaded video:
1. Extract audio with ffmpeg: video.mp4 → temp.wav (16kHz mono PCM)
2. Transcribe with whisper-cpp (base.en model)
3. Clean up temp .wav files

If transcript is empty or very short (<5 chars), mark `talking: false`. Otherwise `talking: true`.

- Input: `downloaded-YYYY-MM-DD.json`
- Output: `transcribed-YYYY-MM-DD.json`

### Step 4: Score & Classify (Claude — runs inside Claude Code)

**This step runs inside Claude Code itself.** No script needed.

1. Read `transcribed-YYYY-MM-DD.json`
2. For each reel, read the metadata + transcript and produce a full analysis
3. Save as `scored-YYYY-MM-DD.json`

See [scoring.md](scoring.md) for the complete scoring rubric, reel type taxonomy, and output format.

#### Scoring Summary

**Engagement Assessment:**
- likes, views, comments counts
- `engagement_floor_met`: true if likes >= 3000 AND views >= 40000 AND comments > 0
- Engagement floor thresholds are configurable — defaults: 3K likes, 40K views

**Content Classification:**
- `talking`: boolean — true if meaningful spoken content
- `effort_level`: "low" | "medium" | "high"
- `reel_types`: one or more tags from the taxonomy

**Reel Type Taxonomy:**
| Category | Types |
|----------|-------|
| Text/Caption | `text-on-screen`, `slideshow` |
| Narrative | `pov`, `story-time`, `day-in-my-life` |
| Educational | `tips-and-tricks`, `tutorial`, `did-you-know` |
| Trend | `audio-trend`, `transition`, `dance`, `duet-style` |
| Aesthetic | `montage`, `aesthetic-mood`, `behind-the-scenes` |
| Engagement | `this-or-that`, `hot-take`, `call-to-action` |
| Humour | `skit`, `relatable`, `reaction` |

**Relevance & Analysis:**
- `relevance_score`: 1-10 (how relevant to stated niche)
- `relevance_reason`, `hook`, `why_it_works`, `steal_this`, `key_topics`
- For non-talking reels: `visual_description`, `text_on_screen`

### Step 5: Generate Report

```bash
npx tsx scripts/generate-report.ts [scored-file] [--open]
```

Generates a visual HTML content research report.

- Input: `scored-YYYY-MM-DD.json`
- Output: `report-YYYY-MM-DD.html`
- Dark theme, reel cards sorted by relevance, engagement floor visual indicators
- Includes: summary stats, trend patterns, 20 reel cards with all analysis fields

### Step 6: Video Folder Cleanup

```bash
npx tsx scripts/cleanup-videos.ts
```

Checks total video files in `videos/`. If > 50 files, deletes oldest date folders until under 50.

## Output Files

| File | Purpose |
|------|---------|
| `collected-YYYY-MM-DD.json` | Raw reel URLs + ad detection + author |
| `downloaded-YYYY-MM-DD.json` | Download status + metadata + video paths |
| `videos/YYYY-MM-DD/*.mp4` | Downloaded reel video files |
| `transcribed-YYYY-MM-DD.json` | Reels with speech transcripts |
| `scored-YYYY-MM-DD.json` | Full scoring + classification (source of truth) |
| `report-YYYY-MM-DD.html` | Visual content research report |

## Key Technical Notes

- Use CDP (Chrome DevTools Protocol) — no automation flags
- Dedicated Chrome profile with persistent logins
- Pass string expressions to `page.evaluate()`, not arrow functions
- yt-dlp uses `--cookies-from-browser chrome:~/.claude-browser` for auth
- whisper-cpp binary at `/opt/homebrew/bin/whisper-cli`, model at `~/.local/share/whisper-cpp/ggml-base.en.bin`
- All output files go in the `scripts/` directory (alongside the TypeScript files)
- Use `execFile` (not `exec`) for shell commands to avoid injection

## Script Files

All TypeScript source files are in `scripts/` and documented in [scripts.md](scripts.md):
- `scripts/browser.ts` — Shared browser launcher (Feed + Keyword modes only)
- `scripts/collect-feed.ts` — Feed mode collection
- `scripts/collect-research.ts` — Research / Username / Hashtag mode collection
- `scripts/download-reels.ts` — yt-dlp download + metadata
- `scripts/transcribe-reels.ts` — ffmpeg + whisper.cpp transcription
- `scripts/generate-report.ts` — HTML report generator
- `scripts/cleanup-videos.ts` — Video folder cleanup
