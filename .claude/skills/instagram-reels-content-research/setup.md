# One-Time Setup

Complete these steps before running the pipeline for the first time.

## 1. Install System Dependencies

```bash
brew install yt-dlp ffmpeg whisper-cpp
```

Verify:
```bash
yt-dlp --version && ffmpeg -version | head -1 && whisper-cli --version
```

## 2. Install Node.js Dependencies

```bash
cd /path/to/instagram-reels-content-research
npm install
npx playwright install chromium
```

## 3. Create Dedicated Chrome Profile

All browser automation uses a SEPARATE Chrome profile — your personal Chrome stays untouched.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.claude-browser" \
  --remote-debugging-port=9222 \
  --no-first-run \
  --no-default-browser-check
```

A bare Chrome window opens. Log into Instagram. Done.
Session cookies persist — you only log in once.

## 4. Download Whisper Model

Auto-downloads on first run, or download manually:

```bash
mkdir -p ~/.local/share/whisper-cpp
curl -L -o ~/.local/share/whisper-cpp/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

**Model options:**
- `ggml-base.en.bin` — 148MB, fast (~2x realtime on M1), good for clear speech
- `ggml-small.en.bin` — 488MB, slower (~1x realtime), better for unclear audio

Start with `base.en`. Upgrade to `small.en` only if quality is poor.

## 5. Create Output Directories

```bash
mkdir -p instagram/content-research/videos
```

## Troubleshooting

### Chrome won't connect
- Check if another Chrome instance is using the same `--user-data-dir`
- Kill any existing Chrome processes: `pkill -f "claude-browser"`
- Delete the SingletonLock file: `rm "$HOME/.claude-browser/SingletonLock"`

### Not logged in
- Open Chrome manually with the `--user-data-dir` flag and log into Instagram
- The script will detect `/accounts/login` redirect and tell you

### yt-dlp fails with 401 or login required
- Your Chrome profile cookies may have expired — re-open Chrome and verify you're logged into Instagram
- Try updating yt-dlp: `brew upgrade yt-dlp`
- Verify cookies work: `yt-dlp --cookies-from-browser chrome:~/.claude-browser --dump-json https://www.instagram.com/reel/SOME_ID/`

### whisper-cpp not found
- Verify installation: `which whisper-cli`
- Expected path: `/opt/homebrew/bin/whisper-cli`
- If installed elsewhere, the script will try `which whisper-cli` as fallback

### ffmpeg codec errors
- Ensure system ffmpeg is installed (not just npm ffmpeg-static): `brew install ffmpeg`
- System ffmpeg has better codec support than the static npm package

### Videos downloading but 0 bytes
- yt-dlp may need ffmpeg for DASH merging: `brew install ffmpeg`
- Check if the reel is still available (may have been deleted)
