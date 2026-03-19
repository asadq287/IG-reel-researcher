import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const digestFile = process.argv.find(a => a.endsWith('.json')) ||
  join(__dirname, `digest-${date}.json`);
const shouldOpen = process.argv.includes('--open');

interface DigestReel {
  url: string; reel_id: string; owner_username: string;
  score: number; score_reason: string; is_ad: boolean;
  key_topics: string[]; hook: string; steal_this: string;
  caption?: string; likesCount?: number; commentsCount?: number;
  videoPlayCount?: number; transcript?: string;
  farm?: { keyword: string; reason: string };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 5) return '#eab308';
  return '#ef4444';
}

function generateReport() {
  const data = JSON.parse(readFileSync(digestFile, 'utf-8'));
  const reels: DigestReel[] = data.reels || [];

  const high = reels.filter(r => r.score >= 8);
  const medium = reels.filter(r => r.score >= 5 && r.score < 8);
  const low = reels.filter(r => r.score < 5);
  const ads = reels.filter(r => r.is_ad);
  const farms = reels.filter(r => r.farm?.keyword);

  const topicMap = new Map<string, number>();
  for (const r of reels) {
    for (const t of (r.key_topics || [])) {
      topicMap.set(t, (topicMap.get(t) || 0) + 1);
    }
  }
  const topTopics = [...topicMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const reelCards = reels
    .sort((a, b) => b.score - a.score)
    .map(r => `
      <div style="border:1px solid #333;border-left:4px solid ${scoreColor(r.score)};
        border-radius:8px;padding:16px;margin:12px 0;background:#1a1a2e;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong style="color:#e0e0e0;">@${escapeHtml(r.owner_username)}</strong>
            ${r.is_ad ? '<span style="background:#ff6b35;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:8px;">AD</span>' : ''}
            ${r.farm ? '<span style="background:#8b5cf6;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;margin-left:8px;">FARM</span>' : ''}
          </div>
          <span style="font-size:24px;font-weight:bold;color:${scoreColor(r.score)};">${r.score}/10</span>
        </div>
        <p style="color:#999;font-size:13px;margin:8px 0 4px;">${escapeHtml(r.score_reason)}</p>
        <div style="margin:8px 0;">
          ${(r.key_topics || []).map(t =>
            `<span style="background:#16213e;color:#4fc3f7;padding:2px 8px;border-radius:12px;font-size:12px;margin-right:4px;">${escapeHtml(t)}</span>`
          ).join('')}
        </div>
        ${r.hook ? `<p style="color:#4fc3f7;font-size:13px;margin:4px 0;"><strong>Hook:</strong> "${escapeHtml(r.hook)}"</p>` : ''}
        ${r.steal_this ? `<p style="color:#81c784;font-size:13px;margin:4px 0;"><strong>Steal this:</strong> ${escapeHtml(r.steal_this)}</p>` : ''}
        ${r.farm ? `<p style="color:#ce93d8;font-size:13px;margin:4px 0;"><strong>Farm:</strong> Comment "${escapeHtml(r.farm.keyword)}" — ${escapeHtml(r.farm.reason)}</p>` : ''}
        ${r.transcript ? `<p style="color:#b0bec5;font-size:12px;margin:4px 0;"><strong>Transcript:</strong> ${escapeHtml(r.transcript.slice(0, 200))}${r.transcript.length > 200 ? '...' : ''}</p>` : ''}
        <div style="margin-top:8px;">
          <a href="${r.url}" style="color:#4fc3f7;font-size:12px;" target="_blank">View Reel</a>
          ${r.likesCount ? `<span style="color:#666;font-size:12px;margin-left:12px;">${r.likesCount.toLocaleString()} likes</span>` : ''}
          ${r.videoPlayCount ? `<span style="color:#666;font-size:12px;margin-left:8px;">${r.videoPlayCount.toLocaleString()} views</span>` : ''}
        </div>
      </div>
    `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>IG Reels Intelligence — ${date}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0d1117; color: #e0e0e0; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #4fc3f7; } h2 { color: #81c784; margin-top: 32px; }
    .stat { display: inline-block; text-align: center; padding: 12px 24px;
      margin: 8px; background: #1a1a2e; border-radius: 8px; }
    .stat-num { font-size: 28px; font-weight: bold; }
    .stat-label { font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <h1>Instagram Reels Intelligence</h1>
  <p style="color:#999;">${date} | ${reels.length} reels analyzed</p>

  <div style="margin:20px 0;">
    <div class="stat"><div class="stat-num" style="color:#22c55e;">${high.length}</div><div class="stat-label">High (8-10)</div></div>
    <div class="stat"><div class="stat-num" style="color:#eab308;">${medium.length}</div><div class="stat-label">Medium (5-7)</div></div>
    <div class="stat"><div class="stat-num" style="color:#ef4444;">${low.length}</div><div class="stat-label">Low (1-4)</div></div>
    <div class="stat"><div class="stat-num" style="color:#ff6b35;">${ads.length}</div><div class="stat-label">Ads</div></div>
    <div class="stat"><div class="stat-num" style="color:#8b5cf6;">${farms.length}</div><div class="stat-label">Farm</div></div>
  </div>

  <h2>Top Topics</h2>
  <div style="margin:12px 0;">
    ${topTopics.map(([topic, count]) =>
      `<span style="background:#16213e;color:#4fc3f7;padding:4px 12px;border-radius:16px;margin:4px;display:inline-block;">${escapeHtml(topic)} (${count})</span>`
    ).join('')}
  </div>

  <h2>All Reels (by score)</h2>
  ${reelCards}

  <p style="color:#666;margin-top:32px;font-size:12px;">Generated by Instagram Reels Intelligence</p>
</body>
</html>`;

  const outPath = join(__dirname, `report-${date}.html`);
  writeFileSync(outPath, html);
  console.log(`Report saved to ${outPath}`);

  if (shouldOpen) {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${cmd} "${outPath}"`);
  }
}

generateReport();
