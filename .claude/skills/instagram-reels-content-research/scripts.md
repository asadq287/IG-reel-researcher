# TypeScript Source Files

All pipeline scripts for Instagram Reels Content Research. Each lives in `instagram/content-research/`.

The shared browser launcher at `scripts/browser.ts` is reused from the existing codebase — not modified.

---

## scripts/browser.ts (Shared — DO NOT MODIFY)

Spawns Chrome with the dedicated `~/.claude-browser` profile and connects Playwright via CDP. Tries to connect to an already-running Chrome first, falls back to spawning one.

```bash
# Used internally by collection scripts — not called directly
```

---

## instagram/content-research/collect-feed.ts

Scrolls the Instagram Reels feed with human-like timing. Captures URLs, detects ads, extracts creator usernames. Feed mode.

```bash
npx tsx instagram/content-research/collect-feed.ts [count]
```

- Default: 20 reels
- Input: none (scrolls `https://www.instagram.com/reels/`)
- Output: `instagram/content-research/collected-YYYY-MM-DD.json`
- Reuses `scripts/browser.ts` for Playwright CDP connection
- Human simulation: variable watch times (3-18s), distracted pauses (15-45s), quick skips (1.5-3s)

---

## instagram/content-research/collect-research.ts

Research mode collection. Three sub-modes: hashtag, username, keyword.

```bash
# By hashtag — yt-dlp only, no browser needed
npx tsx instagram/content-research/collect-research.ts --hashtag "ukproperty" --top 5

# By creator usernames — yt-dlp only, no browser needed
npx tsx instagram/content-research/collect-research.ts --usernames "user1,user2,user3" [count]

# By keyword search — requires Playwright browser
npx tsx instagram/content-research/collect-research.ts --keyword "UK property investing" [count]
```

- Default: 5 reels (hashtag), 20 reels (username/keyword)
- **Hashtag mode (no browser):** uses `yt-dlp --flat-playlist` to discover reels from the hashtag page, then `--dump-json` for full metadata on each. Sorts by like_count descending, keeps top N. Metadata is pre-attached — download step skips redundant metadata fetches.
- **Username mode (no browser):** uses `yt-dlp --flat-playlist` to discover reels from each creator's reels page, then `--dump-json` for metadata. Distributes target across creators.
- **Keyword mode (browser required):** Playwright navigates to Instagram search, types keyword, filters to Reels tab, scrolls and collects URLs. Human simulation timing applies.
- Output: `instagram/content-research/collected-YYYY-MM-DD.json`
- Playwright is only dynamically imported when keyword mode is used

---

## instagram/content-research/download-reels.ts

Downloads Instagram Reel videos and extracts metadata using yt-dlp.

```bash
npx tsx instagram/content-research/download-reels.ts [collected-file]
```

- Input: `instagram/content-research/collected-YYYY-MM-DD.json`
- Output: `instagram/content-research/downloaded-YYYY-MM-DD.json` + video files in `instagram/content-research/videos/YYYY-MM-DD/`
- Uses `yt-dlp --print-json` to download video AND capture metadata in one pass
- Extracted metadata: caption, likes, comments, views, duration, uploader, upload_date, thumbnail
- Uses `--cookies-from-browser chrome:~/.claude-browser` for auth
- Skips already-downloaded videos
- 1-3s delay between downloads to avoid rate limiting

---

## instagram/content-research/transcribe-reels.ts

Transcribes downloaded reel videos using ffmpeg (audio extraction) + whisper.cpp (speech-to-text).

```bash
npx tsx instagram/content-research/transcribe-reels.ts [downloaded-file]
```

- Input: `instagram/content-research/downloaded-YYYY-MM-DD.json`
- Output: `instagram/content-research/transcribed-YYYY-MM-DD.json`
- Extracts audio: video.mp4 → temp.wav (16kHz mono PCM via ffmpeg)
- Transcribes: temp.wav → text (via whisper-cli, base.en model)
- Marks `talking: true` if transcript >= 5 chars, `talking: false` otherwise
- Cleans up temp .wav files automatically
- Auto-downloads whisper model on first run if missing

**Dependencies:** `brew install ffmpeg whisper-cpp`

---

## instagram/content-research/generate-report.ts

Renders scored reels into a visual HTML content research report.

```bash
npx tsx instagram/content-research/generate-report.ts [scored-file] [--open]
```

- Input: `instagram/content-research/scored-YYYY-MM-DD.json`
- Output: `instagram/content-research/report-YYYY-MM-DD.html`
- Dark theme with reel cards sorted by relevance_score
- Floor-met reels are visually prominent; below-floor reels are subdued
- Sections: header, summary stats, trend patterns, reel cards
- Pass `--open` to auto-open in browser

---

## instagram/content-research/cleanup-videos.ts

Cleans up old video files to prevent disk bloat.

```bash
npx tsx instagram/content-research/cleanup-videos.ts
```

- Checks total files in `instagram/content-research/videos/`
- If > 50 files, deletes oldest date folders until under 50
- Logs what was cleaned up
