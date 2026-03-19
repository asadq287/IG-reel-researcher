import { launchBrowser, closeBrowser } from '../scripts/browser.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputFile = process.argv[2] ||
  join(__dirname, `digest-${new Date().toISOString().slice(0, 10)}.json`);

function watchDelay() { return 5000 + Math.random() * Math.random() * 10000; }
function microDelay() { return 800 + Math.random() * 1700; }
function betweenReelDelay() {
  const base = 6000 + Math.random() * 8000;
  if (Math.random() < 0.15) return 20000 + Math.random() * 20000;
  return base;
}

async function humanType(page: any, text: string) {
  for (const char of text) {
    let delay = 40 + Math.random() * 80;
    if (Math.random() < 0.1) delay += 200 + Math.random() * 300;
    await page.keyboard.type(char, { delay });
  }
}

async function watchReel(page: any) {
  const duration = watchDelay();
  if (Math.random() < 0.3) {
    const scrollAfter = duration * (0.3 + Math.random() * 0.4);
    await page.waitForTimeout(scrollAfter);
    await page.mouse.wheel(0, 80 + Math.random() * 120);
    await page.waitForTimeout(duration - scrollAfter);
  } else {
    await page.waitForTimeout(duration);
  }
}

interface ScoredReel {
  url: string; reel_id: string; owner_username: string;
  score: number; is_ad: boolean;
  farm?: { keyword: string; reason: string };
}

async function actionReels() {
  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const reels: ScoredReel[] = data.reels;
  const toLike = reels.filter(r => r.score >= 8 && !r.is_ad);
  const toFarm = reels.filter(r => r.farm?.keyword);
  const ads = reels.filter(r => r.is_ad);

  console.log(`=== Actions ===`);
  console.log(`Like + follow (8+): ${toLike.length}`);
  console.log(`Farm (comment keyword): ${toFarm.length}`);
  console.log(`Ads to save: ${ads.length}\n`);

  const { browser, chrome } = await launchBrowser();
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  // --- Like + Follow ---
  for (const reel of toLike) {
    console.log(`\n@${reel.owner_username} (${reel.score}/10)`);
    await page.goto(reel.url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await watchReel(page);

    try {
      const alreadyLiked = await page.locator('[aria-label="Unlike"]')
        .first().isVisible({ timeout: 1000 }).catch(() => false);
      if (!alreadyLiked) {
        await page.locator('[aria-label="Like"]').first().click({ timeout: 3000 });
        await page.waitForTimeout(microDelay());
        console.log('  Liked!');
      }
    } catch { console.log('  Could not like.'); }

    try {
      await page.waitForTimeout(microDelay());
      const followBtn = page.locator(
        'button:has-text("Follow"), div[role="button"]:has-text("Follow")'
      ).first();
      if (await followBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const text = await followBtn.textContent().catch(() => '');
        if (text === 'Follow') {
          await followBtn.click({ timeout: 3000 });
          console.log(`  Followed @${reel.owner_username}`);
        }
      }
    } catch {}

    await page.waitForTimeout(betweenReelDelay());
  }

  // --- Save Ads ---
  for (const ad of ads) {
    console.log(`\nAD: @${ad.owner_username}`);
    await page.goto(ad.url, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await watchReel(page);
    try {
      const saved = await page.locator('[aria-label="Remove"]')
        .first().isVisible({ timeout: 1000 }).catch(() => false);
      if (!saved) {
        await page.locator('[aria-label="Save"]').first().click({ timeout: 3000 });
        console.log('  Saved!');
      }
    } catch {}
    await page.waitForTimeout(betweenReelDelay());
  }

  // --- Farm (comment keyword) ---
  for (const reel of toFarm) {
    const kw = reel.farm!.keyword;
    console.log(`\nFARM: @${reel.owner_username} — "${kw}"`);
    const postUrl = reel.url.replace('/reel/', '/p/');
    await page.goto(postUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000 + Math.random() * 2000);

    let commented = false;
    try {
      const ta = page.locator('textarea[placeholder="Add a comment…"]').first();
      if (await ta.isVisible({ timeout: 2000 }).catch(() => false)) {
        await ta.click({ timeout: 3000 });
        await page.waitForTimeout(600 + Math.random() * 800);
        await humanType(page, kw);
        await page.waitForTimeout(1000 + Math.random() * 1500);
        await page.locator('[role="button"]:has-text("Post")').first()
          .click({ timeout: 5000 });
        commented = true;
      }
      if (!commented) {
        const ce = page.locator('[contenteditable="true"][role="textbox"]').first();
        if (await ce.isVisible({ timeout: 2000 }).catch(() => false)) {
          await ce.click({ timeout: 3000 });
          await humanType(page, kw);
          await page.locator('[role="button"]:has-text("Post")').first()
            .click({ timeout: 5000 });
          commented = true;
        }
      }
      if (!commented) {
        const svg = page.locator('svg[aria-label="Comment"]').first();
        if (await svg.isVisible({ timeout: 2000 }).catch(() => false)) {
          await svg.click({ timeout: 3000 });
          await page.waitForTimeout(2000);
          const input = page.locator(
            'textarea, [contenteditable="true"][role="textbox"]'
          ).first();
          await input.click({ timeout: 3000 });
          await humanType(page, kw);
          await page.locator('[role="button"]:has-text("Post")').first()
            .click({ timeout: 5000 });
          commented = true;
        }
      }

      if (commented) {
        console.log(`  Commented "${kw}"!`);
        try {
          const fb = page.locator(
            'button:has-text("Follow"), div[role="button"]:has-text("Follow")'
          ).first();
          if (await fb.isVisible({ timeout: 2000 }).catch(() => false)) {
            if ((await fb.textContent().catch(() => '')) === 'Follow') {
              await fb.click({ timeout: 3000 });
              console.log(`  Followed (required for DM delivery)`);
            }
          }
        } catch {}
      }
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }

    await page.waitForTimeout(8000 + Math.random() * 12000);
  }

  console.log(`\n=== Done ===`);
  console.log(`Liked: ${toLike.length} | Farmed: ${toFarm.length} | Ads: ${ads.length}`);
  await closeBrowser(browser, chrome);
}

actionReels().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
