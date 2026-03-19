import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { launchBrowser, closeBrowser } from '../scripts/browser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const magnetsPath = join(__dirname, 'lead-magnets.json');

interface LeadMagnet {
  id: string; date: string; creator: string;
  keyword: string; reason: string; reel_url: string;
  urls: string[]; text_preview: string;
  status: 'pending' | 'received' | 'consumed';
}

function loadMagnets(): LeadMagnet[] {
  if (existsSync(magnetsPath))
    return JSON.parse(readFileSync(magnetsPath, 'utf-8'));
  return [];
}

function saveMagnets(magnets: LeadMagnet[]) {
  writeFileSync(magnetsPath, JSON.stringify(magnets, null, 2));
}

function getFarmTargets(digestFile: string) {
  const data = JSON.parse(readFileSync(digestFile, 'utf-8'));
  return (data.reels || []).filter((r: any) => r.farm?.keyword)
    .map((r: any) => ({
      creator: r.owner_username,
      keyword: r.farm.keyword,
      reason: r.farm.reason,
      reel_url: r.url,
    }));
}

async function harvest() {
  const digestFile = process.argv.find(a =>
    a.endsWith('.json') && !a.startsWith('--')
  ) || join(__dirname,
    `digest-${new Date().toISOString().slice(0, 10)}.json`);

  let farmTargets: any[] = [];
  try { farmTargets = getFarmTargets(digestFile); } catch {}

  const magnets = loadMagnets();
  const { browser, chrome } = await launchBrowser();
  const page = await browser.contexts()[0].newPage();

  console.log('Opening Instagram DMs...\n');
  await page.goto('https://www.instagram.com/direct/inbox/', {
    waitUntil: 'load', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(6000);

  try {
    const notNow = page.locator('button:has-text("Not Now")').first();
    if (await notNow.isVisible({ timeout: 2000 })) await notNow.click();
  } catch {}
  await page.waitForTimeout(3000);

  const convoNames: string[] = await page.evaluate(`(() => {
    var lines = (document.body.innerText || '').split('\\n')
      .map(l => l.trim()).filter(l => l.length > 0);
    var names = [];
    for (var i = 0; i < lines.length; i++) {
      var next = (i + 1 < lines.length) ? lines[i + 1] : '';
      if (next.includes('sent an attachment') ||
          next.includes('Sent ') || next.includes('Active')) {
        if (lines[i].length > 2 && lines[i].length < 60 &&
            !lines[i].includes('Messages') &&
            !lines[i].includes('Requests'))
          names.push(lines[i]);
      }
    }
    return names;
  })()`);

  console.log(`Found ${convoNames.length} conversations.\n`);

  for (const name of convoNames) {
    const cleanName = name.toLowerCase().replace(/[._\s]/g, '');
    const target = farmTargets.find((t: any) => {
      const clean = t.creator.toLowerCase().replace(/[._]/g, '');
      return cleanName.includes(clean) ||
             clean.includes(cleanName.slice(0, 8));
    });
    if (!target) continue;

    const existing = magnets.find(m =>
      m.creator === target.creator && m.keyword === target.keyword
    );
    if (existing && existing.status !== 'pending') continue;

    console.log(`@${target.creator} ("${target.keyword}")`);

    if (!page.url().includes('/direct/inbox'))
      await page.goto('https://www.instagram.com/direct/inbox/',
        { waitUntil: 'load', timeout: 15000 }).catch(() => {});

    const clicked = await page.evaluate(`(() => {
      var spans = document.querySelectorAll('span, div');
      for (var el of spans) {
        if ((el.textContent || '').trim() === '${name.replace(/'/g, "\\'")}' &&
            el.getBoundingClientRect().width > 0) {
          var target = el.closest('[role=button]') ||
            el.closest('[role=listitem]') || el;
          target.click();
          return true;
        }
      }
      return false;
    })()`);

    if (!clicked) { console.log('  Not found.'); continue; }
    await page.waitForTimeout(4000);

    const msgData = await page.evaluate(`(() => {
      var urls = new Set();
      var texts = [];
      for (var a of document.querySelectorAll('a[href]')) {
        var href = a.getAttribute('href') || '';
        if (href.startsWith('http') &&
            !href.includes('instagram.com/direct') &&
            !href.includes('instagram.com/accounts'))
          urls.add(href);
        if (href.includes('l.instagram.com/')) {
          var m = href.match(/u=([^&]+)/);
          if (m) try { urls.add(decodeURIComponent(m[1])); } catch {}
        }
      }
      for (var el of document.querySelectorAll('[dir=auto]')) {
        var t = (el.textContent || '').trim();
        var r = el.getBoundingClientRect();
        if (t.length > 10 && t.length < 1000 && r.width > 100)
          texts.push(t.slice(0, 500));
      }
      return { urls: Array.from(urls), texts: texts.slice(-10) };
    })()`) as { urls: string[]; texts: string[] };

    const magnet: LeadMagnet = {
      id: `${target.creator}-${target.keyword}`.toLowerCase()
        .replace(/\s+/g, '-'),
      date: new Date().toISOString().slice(0, 10),
      creator: target.creator,
      keyword: target.keyword,
      reason: target.reason,
      reel_url: target.reel_url,
      urls: msgData.urls,
      text_preview: msgData.texts.slice(-3).join(' | ').slice(0, 500),
      status: msgData.urls.length > 0 ? 'received' : 'pending',
    };

    const idx = magnets.findIndex(m => m.id === magnet.id);
    if (idx >= 0) magnets[idx] = magnet;
    else magnets.push(magnet);

    if (magnet.urls.length > 0) {
      console.log('  URLs:');
      magnet.urls.forEach(u => console.log(`    ${u}`));
    } else {
      console.log('  No content yet — DM automation may not have triggered.');
    }
    await page.waitForTimeout(2000 + Math.random() * 2000);
  }

  saveMagnets(magnets);
  const received = magnets.filter(m => m.status === 'received');
  const pending = magnets.filter(m => m.status === 'pending');
  console.log(`\nTotal: ${magnets.length} | Received: ${received.length} | Pending: ${pending.length}`);
  await closeBrowser(browser, chrome);
}

harvest().catch(e => { console.error(e.message); process.exit(1); });
