import { launchBrowser, closeBrowser } from '../scripts/browser.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const count = parseInt(process.argv[2] || '50');

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

interface CollectedReel {
  url: string;
  reel_id: string;
  is_ad: boolean;
  author: string;
}

async function collectReels() {
  const { browser, chrome } = await launchBrowser();
  const context = browser.contexts()[0];
  const page = await context.newPage();

  console.log(`Collecting ~${count} reels...\n`);
  await page.goto('https://www.instagram.com/reels/', {
    waitUntil: 'load', timeout: 30000
  }).catch(() => {});
  await page.waitForTimeout(4000 + Math.random() * 3000);

  if (page.url().includes('/accounts/login')) {
    console.error('Not logged in. Open ~/.claude-browser Chrome and log in.');
    await closeBrowser(browser, chrome);
    process.exit(1);
  }
  console.log('Logged in.\n');

  const reels: CollectedReel[] = [];
  const seen = new Set<string>();
  let staleCount = 0;

  for (let i = 0; i < count * 4 && reels.length < count; i++) {
    const match = page.url().match(/\/reels?\/([\w-]+)/);

    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      staleCount = 0;

      const meta = await page.evaluate(`(() => {
        const body = document.body.innerText;
        const isAd = body.includes('Sponsored');
        let author = '';
        const skip = ['explore','reels','search','messages',
                      'notifications','create','home','profile','more'];
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

      reels.push({
        url: `https://www.instagram.com/reel/${match[1]}/`,
        reel_id: match[1],
        is_ad: meta.isAd,
        author: meta.author,
      });

      const tag = meta.isAd ? ' [AD]' : '';
      console.log(`[${reels.length}/${count}] ${match[1]} — @${meta.author || '?'}${tag}`);
    } else {
      staleCount++;
      if (staleCount > 5) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500 + Math.random() * 500);
      }
    }

    if (reels.length >= count) break;

    const watch = watchTime();
    console.log(`  watching ${(watch / 1000).toFixed(1)}s...`);
    await page.waitForTimeout(watch);

    const pause = distractedPause();
    if (pause) {
      console.log(`  (pausing ${(pause / 1000).toFixed(0)}s...)`);
      await page.waitForTimeout(pause);
    }

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500 + Math.random() * 1000);
  }

  const date = new Date().toISOString().slice(0, 10);
  const outPath = join(__dirname, `collected-${date}.json`);
  writeFileSync(outPath, JSON.stringify({
    collected_at: new Date().toISOString(),
    total: reels.length,
    ads: reels.filter(r => r.is_ad).length,
    reels,
  }, null, 2));

  console.log(`\nCollected ${reels.length} reels (${reels.filter(r => r.is_ad).length} ads).`);
  console.log(`Saved to ${outPath}`);
  await closeBrowser(browser, chrome);
}

collectReels().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
