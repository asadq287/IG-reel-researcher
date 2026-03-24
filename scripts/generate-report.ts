/**
 * Generates an HTML content research report from scored reels.
 *
 * Usage: npx tsx instagram/content-research/generate-report.ts [scored-file] [--open]
 * Input: instagram/content-research/scored-YYYY-MM-DD.json
 * Output: instagram/content-research/report-YYYY-MM-DD.html
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const date = new Date().toISOString().slice(0, 10);
const scoredFile = process.argv.find(a => a.endsWith('.json')) ||
  join(__dirname, `scored-${date}.json`);
const shouldOpen = process.argv.includes('--open');

interface ScoredReel {
  url: string;
  reel_id: string;
  is_ad: boolean;
  author: string;
  caption?: string;
  description?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  video_path?: string;
  transcript?: string;
  talking: boolean;
  likes: number;
  views: number;
  comments: number;
  engagement_floor_met: boolean;
  engagement_note: string;
  effort_level: 'low' | 'medium' | 'high';
  reel_types: string[];
  relevance_score: number;
  relevance_reason: string;
  hook: string;
  why_it_works: string;
  steal_this: string;
  key_topics: string[];
  visual_description?: string;
  text_on_screen?: string;
  visual_analysis?: {
    scenes: string;
    text_on_screen_ocr: string[];
    visual_format: string;
    key_visual_elements: string[];
    production_quality: string;
    summary: string;
  };
  visual_analysis_error?: string;
}

function escapeHtml(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relevanceColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 5) return '#eab308';
  return '#ef4444';
}

function effortColor(level: string): string {
  if (level === 'low') return '#22c55e';
  if (level === 'medium') return '#eab308';
  return '#ef4444';
}

function effortLabel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function typeColor(type: string): string {
  const colors: Record<string, string> = {
    'text-on-screen': '#4fc3f7', 'slideshow': '#4fc3f7',
    'pov': '#ce93d8', 'story-time': '#ce93d8', 'day-in-my-life': '#ce93d8',
    'tips-and-tricks': '#81c784', 'tutorial': '#81c784', 'did-you-know': '#81c784',
    'audio-trend': '#ffb74d', 'transition': '#ffb74d', 'dance': '#ffb74d', 'duet-style': '#ffb74d',
    'montage': '#90caf9', 'aesthetic-mood': '#90caf9', 'behind-the-scenes': '#90caf9',
    'this-or-that': '#f48fb1', 'hot-take': '#f48fb1', 'call-to-action': '#f48fb1',
    'skit': '#fff176', 'relatable': '#fff176', 'reaction': '#fff176',
  };
  return colors[type] || '#b0bec5';
}

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function generateReport() {
  const data = JSON.parse(readFileSync(scoredFile, 'utf-8'));
  const reels: ScoredReel[] = data.reels || [];
  const niche: string = data.niche || 'Unknown';
  const mode: string = data.mode || 'unknown';
  const engagementFloor = data.engagement_floor || { min_likes: 3000, min_views: 40000, min_comments: 1 };
  const trendPatterns: string[] = data.trend_patterns || [];

  // Stats
  const floorMet = reels.filter(r => r.engagement_floor_met);
  const talkingReels = reels.filter(r => r.talking);
  const nonTalkingReels = reels.filter(r => !r.talking);
  const effortLow = reels.filter(r => r.effort_level === 'low');
  const effortMedium = reels.filter(r => r.effort_level === 'medium');
  const effortHigh = reels.filter(r => r.effort_level === 'high');

  // Reel type frequency
  const typeMap = new Map<string, number>();
  for (const r of reels) {
    for (const t of (r.reel_types || [])) {
      typeMap.set(t, (typeMap.get(t) || 0) + 1);
    }
  }
  const topTypes = [...typeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Topic frequency
  const topicMap = new Map<string, number>();
  for (const r of reels) {
    for (const t of (r.key_topics || [])) {
      topicMap.set(t, (topicMap.get(t) || 0) + 1);
    }
  }
  const topTopics = [...topicMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Build reel cards
  const reelCards = reels
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .map(r => {
      const floorClass = r.engagement_floor_met ? 'card-floor-met' : 'card-floor-missed';
      const videoLink = r.video_path
        ? `<a href="${escapeHtml(relative(__dirname, r.video_path))}" style="color:#90caf9;font-size:12px;margin-left:12px;">Local Video</a>`
        : '';

      return `
      <div class="reel-card ${floorClass}">
        <div class="card-header">
          <div class="card-author">
            <a href="https://www.instagram.com/${escapeHtml(r.author || r.uploader || '')}" target="_blank" style="color:#e0e0e0;text-decoration:none;">
              <strong>@${escapeHtml(r.author || r.uploader || 'unknown')}</strong>
            </a>
            ${r.is_ad ? '<span class="badge badge-ad">AD</span>' : ''}
            <span class="badge ${r.talking ? 'badge-talking' : 'badge-non-talking'}">${r.talking ? 'Talking' : 'Non-talking'}</span>
            <span class="badge badge-effort-${r.effort_level}">${effortLabel(r.effort_level)} Effort</span>
          </div>
          <div class="card-score" style="color:${relevanceColor(r.relevance_score)};">${r.relevance_score}/10</div>
        </div>

        <p class="card-reason">${escapeHtml(r.relevance_reason)}</p>

        <div class="card-engagement">
          <span>${formatNumber(r.likes)} likes</span>
          <span>${formatNumber(r.views)} views</span>
          <span>${formatNumber(r.comments)} comments</span>
          <span class="floor-indicator ${r.engagement_floor_met ? 'floor-met' : 'floor-missed'}">${r.engagement_floor_met ? 'Floor Met' : 'Below Floor'}</span>
          ${r.duration ? `<span>${r.duration}s</span>` : ''}
        </div>

        <div class="card-types">
          ${(r.reel_types || []).map(t =>
            `<span class="type-pill" style="color:${typeColor(t)};">${escapeHtml(t)}</span>`
          ).join('')}
        </div>

        ${r.hook ? `<div class="card-field"><span class="field-label">Hook:</span> <span class="field-hook">"${escapeHtml(r.hook)}"</span></div>` : ''}
        ${r.why_it_works ? `<div class="card-field"><span class="field-label">Why it works:</span> ${escapeHtml(r.why_it_works)}</div>` : ''}
        ${r.steal_this ? `<div class="steal-this-box"><span class="field-label">Steal this:</span> ${escapeHtml(r.steal_this)}</div>` : ''}

        ${r.visual_analysis ? `
        <div class="card-visual-analysis">
          <div class="card-field"><span class="field-label">Visual:</span> ${escapeHtml(r.visual_analysis.summary)}</div>
          ${r.visual_analysis.text_on_screen_ocr?.length ? `<div class="card-field"><span class="field-label">Text on screen:</span> ${escapeHtml(r.visual_analysis.text_on_screen_ocr.join(' | '))}</div>` : ''}
          <span class="type-pill" style="color:#ce93d8;">format: ${escapeHtml(r.visual_analysis.visual_format)}</span>
        </div>` : `
        ${!r.talking && r.visual_description ? `<div class="card-field"><span class="field-label">Visual:</span> ${escapeHtml(r.visual_description)}</div>` : ''}
        ${!r.talking && r.text_on_screen ? `<div class="card-field"><span class="field-label">Text on screen:</span> ${escapeHtml(r.text_on_screen)}</div>` : ''}`}

        ${r.transcript ? `<div class="card-transcript"><span class="field-label">Transcript:</span> ${escapeHtml(r.transcript.slice(0, 250))}${r.transcript.length > 250 ? '...' : ''}</div>` : ''}

        <div class="card-topics">
          ${(r.key_topics || []).map(t =>
            `<span class="topic-pill">${escapeHtml(t)}</span>`
          ).join('')}
        </div>

        <div class="card-links">
          <a href="${escapeHtml(r.url)}" target="_blank">View on Instagram</a>
          ${videoLink}
          ${r.engagement_note ? `<span class="engagement-note">${escapeHtml(r.engagement_note)}</span>` : ''}
        </div>
      </div>`;
    }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Research — ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1117; color: #e0e0e0;
      max-width: 900px; margin: 0 auto; padding: 24px;
      line-height: 1.5;
    }
    h1 { color: #4fc3f7; font-size: 28px; margin-bottom: 4px; }
    h2 { color: #81c784; margin-top: 36px; margin-bottom: 16px; font-size: 20px; }
    .subtitle { color: #999; font-size: 14px; margin-bottom: 24px; }
    .meta-row { color: #777; font-size: 13px; margin-bottom: 4px; }

    /* Stats grid */
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 12px; margin: 20px 0;
    }
    .stat-card {
      background: #1a1a2e; border-radius: 8px; padding: 16px; text-align: center;
    }
    .stat-num { font-size: 28px; font-weight: bold; }
    .stat-label { font-size: 12px; color: #999; margin-top: 4px; }

    /* Trend patterns */
    .trend-list { list-style: none; padding: 0; }
    .trend-list li {
      background: #1a1a2e; border-left: 3px solid #4fc3f7;
      padding: 10px 16px; margin: 8px 0; border-radius: 4px;
      font-size: 14px; color: #ccc;
    }

    /* Type and topic pills */
    .pills-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .type-count-pill {
      background: #16213e; padding: 4px 12px; border-radius: 16px;
      font-size: 13px; display: inline-block;
    }
    .topic-pill {
      background: #16213e; color: #4fc3f7; padding: 2px 10px;
      border-radius: 12px; font-size: 12px;
    }

    /* Reel cards */
    .reel-card {
      border: 1px solid #333; border-radius: 10px;
      padding: 20px; margin: 16px 0; background: #1a1a2e;
      transition: border-color 0.2s;
    }
    .reel-card:hover { border-color: #555; }
    .card-floor-met { border-left: 4px solid #22c55e; }
    .card-floor-missed { border-left: 4px solid #444; opacity: 0.75; }
    .card-floor-missed:hover { opacity: 1; }

    .card-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px;
    }
    .card-author { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .card-score { font-size: 28px; font-weight: bold; }

    .badge {
      padding: 2px 8px; border-radius: 4px; font-size: 11px;
      font-weight: 600; text-transform: uppercase;
    }
    .badge-ad { background: #ff6b35; color: #fff; }
    .badge-talking { background: #1b5e20; color: #81c784; }
    .badge-non-talking { background: #1a237e; color: #90caf9; }
    .badge-effort-low { background: #1b5e20; color: #81c784; }
    .badge-effort-medium { background: #4a3800; color: #eab308; }
    .badge-effort-high { background: #5c1010; color: #ef4444; }

    .card-reason { color: #999; font-size: 13px; margin-bottom: 10px; }

    .card-engagement {
      display: flex; gap: 16px; font-size: 13px; color: #888;
      margin-bottom: 10px; flex-wrap: wrap; align-items: center;
    }
    .floor-indicator {
      padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
    }
    .floor-met { background: #1b5e20; color: #81c784; }
    .floor-missed { background: #333; color: #888; }

    .card-types { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .type-pill {
      background: #16213e; padding: 2px 10px; border-radius: 12px; font-size: 12px;
    }

    .card-field { font-size: 13px; margin: 6px 0; color: #ccc; }
    .field-label { color: #81c784; font-weight: 600; }
    .field-hook { color: #4fc3f7; font-style: italic; }

    .steal-this-box {
      background: #1b2838; border: 1px solid #2d4a3e; border-radius: 6px;
      padding: 10px 14px; margin: 10px 0; font-size: 13px; color: #a5d6a7;
    }

    .card-transcript {
      font-size: 12px; color: #888; margin: 8px 0;
      background: #111827; padding: 8px 12px; border-radius: 4px;
    }

    .card-topics { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }

    .card-links { margin-top: 10px; font-size: 12px; }
    .card-links a { color: #4fc3f7; margin-right: 12px; }
    .engagement-note { color: #666; margin-left: 8px; }

    .footer { color: #555; margin-top: 40px; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <h1>Instagram Reels Content Research</h1>
  <p class="subtitle">${escapeHtml(niche)}</p>
  <div class="meta-row">${date} | ${reels.length} reels analyzed | Mode: ${escapeHtml(mode)}</div>
  <div class="meta-row">Engagement floor: ${formatNumber(engagementFloor.min_likes)} likes, ${formatNumber(engagementFloor.min_views)} views, ${engagementFloor.min_comments}+ comments</div>

  <h2>Summary</h2>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-num" style="color:#4fc3f7;">${reels.length}</div>
      <div class="stat-label">Total Reels</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#22c55e;">${floorMet.length}</div>
      <div class="stat-label">Floor Met</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#81c784;">${talkingReels.length}</div>
      <div class="stat-label">Talking</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#90caf9;">${nonTalkingReels.length}</div>
      <div class="stat-label">Non-talking</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#22c55e;">${effortLow.length}</div>
      <div class="stat-label">Low Effort</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#eab308;">${effortMedium.length}</div>
      <div class="stat-label">Medium Effort</div>
    </div>
    <div class="stat-card">
      <div class="stat-num" style="color:#ef4444;">${effortHigh.length}</div>
      <div class="stat-label">High Effort</div>
    </div>
  </div>

  <h2>Top Reel Types</h2>
  <div class="pills-row">
    ${topTypes.map(([type, cnt]) =>
      `<span class="type-count-pill" style="color:${typeColor(type)};">${escapeHtml(type)} &times; ${cnt}</span>`
    ).join('')}
  </div>

  <h2>Top Topics</h2>
  <div class="pills-row">
    ${topTopics.map(([topic, cnt]) =>
      `<span class="type-count-pill" style="color:#4fc3f7;">${escapeHtml(topic)} &times; ${cnt}</span>`
    ).join('')}
  </div>

  ${trendPatterns.length > 0 ? `
  <h2>Trend Patterns</h2>
  <ul class="trend-list">
    ${trendPatterns.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
  </ul>
  ` : ''}

  <h2>All Reels (by relevance)</h2>
  ${reelCards}

  <p class="footer">Generated by Instagram Reels Content Research</p>
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
