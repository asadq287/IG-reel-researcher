/**
 * Research Mode collection — three sub-modes:
 *
 *   --hashtag "ukproperty" --top 5    (yt-dlp only, no browser)
 *   --usernames "user1,user2" [count] (yt-dlp only, no browser)
 *   --keyword "UK property" [count]   (Playwright browser required)
 *
 * Hashtag & username modes use yt-dlp's built-in Instagram extractors
 * to discover reels, then fetch full metadata and rank by likes.
 * No Playwright, no scrolling, no DOM parsing.
 *
 * Keyword mode still needs Playwright because Instagram search is
 * interactive (type, filter, scroll).
 *
 * Output: instagram/content-research/collected-YYYY-MM-DD.json
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIES_DIR = join(process.env.HOME || '', '.claude-browser');

// ── Parse arguments ──────────────────────────────────────────────

let usernames: string[] = [];
let keyword = '';
let hashtag = '';
let count = 20;
let topN = 5;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--usernames' && process.argv[i + 1]) {
    usernames = process.argv[++i].split(',').map(u => u.trim().replace(/^@/, ''));
  } else if (arg === '--keyword' && process.argv[i + 1]) {
    keyword = process.argv[++i];
  } else if (arg === '--hashtag' && process.argv[i + 1]) {
    hashtag = process.argv[++i].replace(/^#/, '');
  } else if (arg === '--top' && process.argv[i + 1]) {
    topN = parseInt(process.argv[++i]);
  } else if (!arg.startsWith('--') && !isNaN(parseInt(arg))) {
    count = parseInt(arg);
  }
}

if (usernames.length === 0 && !keyword && !hashtag) {
  console.error('Usage:');
  console.error('  npx tsx collect-research.ts --usernames "user1,user2" [count]');
  console.error('  npx tsx collect-research.ts --keyword "search term" [count]');
  console.error('  npx tsx collect-research.ts --hashtag "tagname" --top 5');
  process.exit(1);
}

// ── Shared types ─────────────────────────────────────────────────

interface CollectedReel {
  url: string;
  reel_id: string;
  is_ad: boolean;
  author: string;
  description?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  thumbnail?: string;
}

// ── yt-dlp helpers ───────────────────────────────────────────────

async function checkYtDlp() {
  try {
    await execFileAsync('yt-dlp', ['--version'], { timeout: 5000 });
  } catch {
    console.error('yt-dlp not found. Install with: brew install yt-dlp');
    process.exit(1);
  }
}

/**
 * Use yt-dlp --flat-playlist to discover reel entries from a page URL.
 * Returns an array of { id, url } for each reel found.
 */
async function discoverReels(pageUrl: string): Promise<{ id: string; url: string }[]> {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--cookies-from-browser', `chrome:${COOKIES_DIR}`,
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      pageUrl,
    ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });

    const entries: { id: string; url: string }[] = [];
    for (const line of stdout.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      try {
        const json = JSON.parse(trimmed);
        const id = json.id || json.display_id || '';
        const url = json.url || json.webpage_url || `https://www.instagram.com/reel/${id}/`;
        if (id) entries.push({ id, url });
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch (err: any) {
    const msg = err.stderr?.substring(0, 300) || err.message;
    console.error(`  yt-dlp discovery failed: ${msg}`);
    return [];
  }
}

/**
 * Fetch full metadata for a single reel via yt-dlp --dump-json.
 */
async function fetchMetadata(reelUrl: string): Promise<{
  description: string;
  like_count: number | null;
  comment_count: number | null;
  view_count: number | null;
  duration: number | null;
  uploader: string;
  upload_date: string;
  thumbnail: string;
} | null> {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--cookies-from-browser', `chrome:${COOKIES_DIR}`,
      '--dump-json',
      '--no-warnings',
      reelUrl,
    ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });

    const json = JSON.parse(stdout.trim());
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
  } catch {
    return null;
  }
}

// ── Hashtag mode (yt-dlp only) ───────────────────────────────────

async function collectFromHashtag(tag: string, top: number): Promise<CollectedReel[]> {
  const tagUrl = `https://www.instagram.com/explore/tags/${tag}/`;
  console.log(`Discovering reels from #${tag} via yt-dlp...\n`);

  const entries = await discoverReels(tagUrl);

  if (entries.length === 0) {
    console.log('  No reels found. The hashtag may not exist or yt-dlp could not extract entries.');
    return [];
  }

  console.log(`Found ${entries.length} reel(s). Fetching metadata to rank by likes...\n`);

  const withMeta: CollectedReel[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const reelUrl = e.url.startsWith('http') ? e.url : `https://www.instagram.com/reel/${e.id}/`;
    console.log(`[${i + 1}/${entries.length}] ${e.id} — fetching metadata...`);

    const meta = await fetchMetadata(reelUrl);
    if (!meta) {
      console.log(`  Failed — skipping`);
      continue;
    }

    const likes = meta.like_count ?? 0;
    const views = meta.view_count ?? 0;
    console.log(`  @${meta.uploader || '?'} | ${likes.toLocaleString()} likes | ${views.toLocaleString()} views`);

    withMeta.push({
      url: reelUrl,
      reel_id: e.id,
      is_ad: false,
      author: meta.uploader || '',
      ...meta,
    });

    // Small delay between metadata fetches
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
  }

  // Sort by like_count descending, take top N
  withMeta.sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0));
  const topReels = withMeta.slice(0, top);

  console.log(`\n── Top ${top} reels by likes ──`);
  for (let i = 0; i < topReels.length; i++) {
    const r = topReels[i];
    console.log(`  ${i + 1}. @${r.author} — ${(r.like_count ?? 0).toLocaleString()} likes — ${r.reel_id}`);
  }

  return topReels;
}

// ── Username mode (yt-dlp only) ──────────────────────────────────

async function collectFromUsername(username: string, target: number): Promise<CollectedReel[]> {
  const reelsUrl = `https://www.instagram.com/${username}/reels/`;
  console.log(`\nDiscovering reels from @${username} via yt-dlp...`);

  const entries = await discoverReels(reelsUrl);

  if (entries.length === 0) {
    console.log(`  No reels found for @${username}. Profile may be private or not exist.`);
    return [];
  }

  console.log(`  Found ${entries.length} reel(s). Fetching metadata for top ${target}...\n`);

  const reels: CollectedReel[] = [];
  const toFetch = entries.slice(0, target);

  for (let i = 0; i < toFetch.length; i++) {
    const e = toFetch[i];
    const reelUrl = e.url.startsWith('http') ? e.url : `https://www.instagram.com/reel/${e.id}/`;
    console.log(`[${i + 1}/${toFetch.length}] ${e.id} — fetching metadata...`);

    const meta = await fetchMetadata(reelUrl);
    if (!meta) {
      console.log(`  Failed — skipping`);
      continue;
    }

    const likes = meta.like_count ?? 0;
    const views = meta.view_count ?? 0;
    console.log(`  @${meta.uploader || username} | ${likes.toLocaleString()} likes | ${views.toLocaleString()} views`);

    reels.push({
      url: reelUrl,
      reel_id: e.id,
      is_ad: false,
      author: meta.uploader || username,
      ...meta,
    });

    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
  }

  return reels;
}

// ── Keyword mode (Playwright required) ───────────────────────────

function watchTime(): number {
  const base = 3000 + Math.random() * 5000;
  if (Math.random() < 0.2) return 8000 + Math.random() * 10000;
  if (Math.random() < 0.1) return 1500 + Math.random() * 1500;
  return base;
}

function distractedPause(): number | null {
  if (Math.random() < 0.08) return 15000 + Math.random() * 30000;
  return null;
}

async function collectFromKeyword(searchKeyword: string, target: number): Promise<CollectedReel[]> {
  // Dynamic import — only loads Playwright when keyword mode is used
  const { launchBrowser, closeBrowser } = await import('../../scripts/browser.js');

  const { browser, chrome } = await launchBrowser();
  const context = browser.contexts()[0];
  const page = await context.newPage();

  const reels: CollectedReel[] = [];
  console.log(`\nSearching Instagram for "${searchKeyword}"...`);

  // 1. Navigate to Instagram
  await page.goto('https://www.instagram.com/', {
    waitUntil: 'load', timeout: 30000
  }).catch(() => {});
  await page.waitForTimeout(3000 + Math.random() * 2000);

  if (page.url().includes('/accounts/login')) {
    console.error('Not logged in. Open ~/.claude-browser Chrome and log in.');
    await closeBrowser(browser, chrome);
    return reels;
  }

  // 2. Open search
  try {
    const searchNav = page.locator('a[href="/explore/"], svg[aria-label="Search"]').first();
    await searchNav.click({ timeout: 5000 });
    await page.waitForTimeout(2000 + Math.random() * 1000);
  } catch {
    await page.goto('https://www.instagram.com/explore/', {
      waitUntil: 'load', timeout: 20000
    }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  // 3. Type keyword character-by-character
  try {
    const searchInput = page.locator('input[placeholder="Search"], input[aria-label="Search input"]').first();
    await searchInput.click({ timeout: 5000 });
    await page.waitForTimeout(500 + Math.random() * 500);

    for (const char of searchKeyword) {
      await page.keyboard.type(char, { delay: 40 + Math.random() * 80 });
    }
    await page.waitForTimeout(2000 + Math.random() * 1000);
  } catch (err: any) {
    console.error(`  Could not type in search: ${err.message}`);
    await closeBrowser(browser, chrome);
    return reels;
  }

  // 4. Click top suggestion from dropdown
  try {
    // Wait for dropdown suggestions to appear
    const suggestion = page.locator([
      'div[role="listbox"] a',
      'a[href*="/explore/tags/"]',
      '[role="option"]',
      '[role="link"]',
    ].join(', ')).first();

    await suggestion.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(500 + Math.random() * 500);
    await suggestion.click({ timeout: 5000 });
    console.log('  Clicked top search suggestion');
    await page.waitForTimeout(3000 + Math.random() * 2000);
  } catch {
    // Fallback: press Enter to submit search
    console.log('  No dropdown suggestion found — pressing Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000 + Math.random() * 2000);
  }

  // 5. Click "Reels" filter tab if available
  try {
    const reelsTab = page.locator('span:has-text("Reels"), a:has-text("Reels")').first();
    await reelsTab.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500 + Math.random() * 500);
    await reelsTab.click({ timeout: 3000 });
    await page.waitForTimeout(2000 + Math.random() * 1000);
    console.log('  Switched to Reels filter');
  } catch {
    console.log('  No Reels filter found — collecting from general search results');
  }

  // 6. Find and click the first reel link to enter full-screen viewer
  try {
    const firstReel = page.locator('a[href*="/reel/"]').first();
    await firstReel.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500 + Math.random() * 500);
    await firstReel.click({ timeout: 5000 });
    console.log('  Clicked first reel — entering reel viewer');
    await page.waitForTimeout(3000 + Math.random() * 2000);
  } catch {
    console.error('  No reel links found on results page');
    await closeBrowser(browser, chrome);
    return reels;
  }

  // 7. Scroll with ArrowDown like feed mode — detect reels from URL
  const seen = new Set<string>();
  let staleCount = 0;

  for (let i = 0; i < target * 4 && reels.length < target; i++) {
    const match = page.url().match(/\/reels?\/([\w-]+)/);

    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      staleCount = 0;

      // Extract metadata from the DOM
      const meta = await page.evaluate(`(() => {
        const body = document.body.innerText;
        const isAd = body.includes('Sponsored');
        let author = '';
        const skip = ['explore','reels','search','messages','notifications','create','home','profile','more'];
        const links = document.querySelectorAll('a[href^="/"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const text = (link.textContent || '').trim();
          if (href.match(/^\\/[\\w._]+\\/$/) && text.length > 0 && text.length < 30) {
            const slug = href.replace(/\\//g, '').toLowerCase();
            if (skip.some(w => slug.includes(w))) continue;
            if (text.toLowerCase() === slug || text.startsWith('@')) {
              author = text.replace('@', '');
              break;
            }
            if (!author) author = text;
          }
        }
        return { isAd, author };
      })()`) as { isAd: boolean; author: string };

      const tag = meta.isAd ? ' [AD]' : '';
      reels.push({
        url: `https://www.instagram.com/reel/${match[1]}/`,
        reel_id: match[1],
        is_ad: meta.isAd,
        author: meta.author,
      });
      console.log(`[${reels.length}/${target}] ${match[1]} — @${meta.author || '?'}${tag}`);
    } else {
      staleCount++;
      if (staleCount > 5) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500 + Math.random() * 500);
      }
    }

    if (reels.length >= target) break;

    // Human-like watch time
    const watch = watchTime();
    console.log(`  watching ${(watch / 1000).toFixed(1)}s...`);
    await page.waitForTimeout(watch);

    const pause = distractedPause();
    if (pause) {
      console.log(`  (pausing ${(pause / 1000).toFixed(0)}s...)`);
      await page.waitForTimeout(pause);
    }

    // Scroll to next reel
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500 + Math.random() * 1000);
  }

  await closeBrowser(browser, chrome);
  return reels;
}

// ── Main ─────────────────────────────────────────────────────────

async function collectResearch() {
  let allReels: CollectedReel[] = [];
  let mode = '';

  if (hashtag) {
    await checkYtDlp();
    console.log(`[Hashtag Mode] Scraping #${hashtag}, keeping top ${topN} by likes\n`);
    mode = `hashtag:${hashtag}:top${topN}`;
    allReels = await collectFromHashtag(hashtag, topN);

  } else if (usernames.length > 0) {
    await checkYtDlp();
    const perUser = Math.ceil(count / usernames.length);
    console.log(`[Username Mode] Collecting ~${count} reels from ${usernames.length} creator(s) (~${perUser} each)\n`);
    mode = `research:usernames:${usernames.join(',')}`;

    for (const username of usernames) {
      const remaining = count - allReels.length;
      if (remaining <= 0) break;
      const target = Math.min(perUser, remaining);
      const collected = await collectFromUsername(username, target);
      allReels = allReels.concat(collected);
    }

  } else {
    console.log(`[Keyword Mode] Collecting ~${count} reels for keyword "${keyword}" (requires browser)\n`);
    mode = `research:keyword:${keyword}`;
    allReels = await collectFromKeyword(keyword, count);
  }

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(__dirname, { recursive: true });
  const outPath = join(__dirname, `collected-${date}.json`);

  writeFileSync(outPath, JSON.stringify({
    collected_at: new Date().toISOString(),
    mode,
    total: allReels.length,
    ads: allReels.filter(r => r.is_ad).length,
    reels: allReels,
  }, null, 2));

  console.log(`\nCollected ${allReels.length} reels.`);
  console.log(`Saved to ${outPath}`);
}

collectResearch().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
