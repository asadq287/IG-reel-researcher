/**
 * Extracts reel data (caption, likes, author, etc.) from Instagram
 * using the existing Chrome CDP connection.
 *
 * Reads collected-YYYY-MM-DD.json and enriches each reel with metadata.
 * Outputs enriched-YYYY-MM-DD.json
 */
import { launchBrowser, closeBrowser } from '../scripts/browser.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const inputFile = process.argv[2] || join(__dirname, `collected-${date}.json`);

async function extractReelData() {
  const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
  const reels = data.reels;

  console.log(`Extracting data for ${reels.length} reels...\n`);

  const { browser, chrome } = await launchBrowser();
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const enriched: any[] = [];

  for (let i = 0; i < reels.length; i++) {
    const reel = reels[i];
    console.log(`[${i + 1}/${reels.length}] ${reel.reel_id}...`);

    try {
      // Navigate to the reel as a post (better metadata in /p/ view)
      const postUrl = reel.url.replace('/reel/', '/p/');
      await page.goto(postUrl, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(3000 + Math.random() * 2000);

      const meta = await page.evaluate(`(() => {
        var result = {
          caption: '',
          ownerUsername: '',
          likesCount: 0,
          commentsCount: 0,
          videoPlayCount: 0,
          hashtags: [],
          timestamp: '',
        };

        // Extract caption from meta tags or page content
        var metaDesc = document.querySelector('meta[property="og:description"]');
        if (metaDesc) {
          var content = metaDesc.getAttribute('content') || '';
          // Format: "123 likes, 45 comments - username on Instagram: \\"caption\\""
          var likesMatch = content.match(/([\\d,.]+[KMkm]?)\\s*likes?/i);
          var commentsMatch = content.match(/([\\d,.]+[KMkm]?)\\s*comments?/i);
          var usernameMatch = content.match(/- (.+?) on Instagram/);
          var captionMatch = content.match(/:\\s*["\u201C](.+?)["\u201D]\\s*$/s);

          if (likesMatch) {
            var n = likesMatch[1].replace(/,/g, '');
            if (n.match(/[KkMm]/)) {
              var mult = n.match(/[Mm]/) ? 1000000 : 1000;
              result.likesCount = Math.round(parseFloat(n) * mult);
            } else {
              result.likesCount = parseInt(n) || 0;
            }
          }
          if (commentsMatch) {
            var n2 = commentsMatch[1].replace(/,/g, '');
            result.commentsCount = parseInt(n2) || 0;
          }
          if (usernameMatch) result.ownerUsername = usernameMatch[1].trim();
          if (captionMatch) result.caption = captionMatch[1].trim();
        }

        // Try to get caption from the page itself
        if (!result.caption) {
          var h1 = document.querySelector('h1');
          if (h1) result.caption = h1.textContent || '';
          if (!result.caption) {
            var spans = document.querySelectorAll('span');
            for (var s of spans) {
              var t = (s.textContent || '').trim();
              if (t.length > 30 && t.length < 2000 && !t.includes('likes') && !t.includes('Log in')) {
                result.caption = t;
                break;
              }
            }
          }
        }

        // Extract username from page if not from meta
        if (!result.ownerUsername) {
          var links = document.querySelectorAll('a[href^="/"]');
          var skip = ['explore','reels','search','messages','notifications','create','home','profile','more','p','accounts','reel'];
          for (var link of links) {
            var href = link.getAttribute('href') || '';
            var text = (link.textContent || '').trim();
            if (href.match(/^\\/[\\w._]+\\/$/) && text.length > 0 && text.length < 30) {
              var slug = href.replace(/\\//g, '').toLowerCase();
              if (skip.some(function(w) { return slug === w; })) continue;
              result.ownerUsername = slug;
              break;
            }
          }
        }

        // Extract hashtags from caption
        var hashMatches = result.caption.match(/#[\\w]+/g);
        if (hashMatches) result.hashtags = hashMatches.map(function(h) { return h.replace('#', ''); });

        // Try to get views from the page
        var viewsEls = document.querySelectorAll('span');
        for (var v of viewsEls) {
          var vt = (v.textContent || '').trim();
          var viewMatch = vt.match(/^([\\d,.]+[KMkm]?)\\s*(views?|plays?)$/i);
          if (viewMatch) {
            var vn = viewMatch[1].replace(/,/g, '');
            if (vn.match(/[Mm]/)) result.videoPlayCount = Math.round(parseFloat(vn) * 1000000);
            else if (vn.match(/[Kk]/)) result.videoPlayCount = Math.round(parseFloat(vn) * 1000);
            else result.videoPlayCount = parseInt(vn) || 0;
            break;
          }
        }

        // Get timestamp
        var timeEl = document.querySelector('time[datetime]');
        if (timeEl) result.timestamp = timeEl.getAttribute('datetime') || '';

        return result;
      })()`);

      enriched.push({
        ...reel,
        ...meta,
        author: meta.ownerUsername || reel.author,
      });

      console.log(`  @${meta.ownerUsername || '?'} | ${meta.likesCount} likes | caption: ${(meta.caption || '').slice(0, 60)}...`);

    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
      enriched.push({ ...reel, caption: '', ownerUsername: reel.author, likesCount: 0, commentsCount: 0 });
    }

    // Human-like delay between page visits
    await page.waitForTimeout(2000 + Math.random() * 3000);
  }

  const outPath = join(__dirname, `enriched-${date}.json`);
  writeFileSync(outPath, JSON.stringify({
    collected_at: data.collected_at,
    enriched_at: new Date().toISOString(),
    total: enriched.length,
    reels: enriched,
  }, null, 2));

  console.log(`\nEnriched ${enriched.length} reels.`);
  console.log(`Saved to ${outPath}`);
  await closeBrowser(browser, chrome);
}

extractReelData().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
