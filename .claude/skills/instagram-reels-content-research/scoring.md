# Scoring & Classification Rubric

Detailed instructions for Step 4 of the pipeline — scoring and classifying transcribed reels inside Claude Code.

## Workflow

### 1. Load Transcribed Reels

Read `instagram/content-research/transcribed-YYYY-MM-DD.json`. Structure:

```json
{
  "collected_at": "2024-01-15T10:30:00Z",
  "downloaded_at": "2024-01-15T10:45:00Z",
  "transcribed_at": "2024-01-15T11:00:00Z",
  "total": 20,
  "reels": [
    {
      "url": "https://www.instagram.com/reel/ABC123/",
      "reel_id": "ABC123",
      "is_ad": false,
      "author": "username",
      "caption": "Full caption text from yt-dlp...",
      "like_count": 5000,
      "comment_count": 120,
      "view_count": 80000,
      "duration": 28,
      "uploader": "username",
      "upload_date": "20240115",
      "thumbnail": "https://...",
      "video_path": "/path/to/video.mp4",
      "transcript": "Hey everyone, today I want to show you...",
      "talking": true
    }
  ]
}
```

### 2. Score Each Reel

For each reel, produce ALL of the following fields.

#### Engagement Assessment

| Field | Type | Description |
|-------|------|-------------|
| `likes` | number | Like count from metadata |
| `views` | number | View count from metadata |
| `comments` | number | Comment count from metadata |
| `engagement_floor_met` | boolean | `true` if likes >= 3000 AND views >= 40000 AND comments > 0 |
| `engagement_note` | string | Brief assessment, e.g., "Very high engagement for account size" or "Below floor but interesting format" |

**Engagement floor defaults:** 3,000 likes, 40,000 views, >0 comments. These thresholds can be adjusted by the user at runtime.

#### Content Classification

| Field | Type | Description |
|-------|------|-------------|
| `talking` | boolean | `true` if the reel has meaningful spoken content, `false` if text-on-screen, montage, music-only, etc. |
| `effort_level` | `"low"` \| `"medium"` \| `"high"` | How much effort to recreate this reel |
| `reel_types` | string[] | One or more tags from the taxonomy below |

**Effort Level Rules:**

| Level | Criteria | Examples |
|-------|----------|----------|
| **Low** | Minimal production effort. Can be made in under 30 minutes with a phone. | Text on screen + trending audio, slideshow of images, simple montage with music, screenshot carousel |
| **Medium** | Moderate effort. Requires some planning, basic editing, or on-camera presence. | Talking to camera with basic cuts, POV with text overlay, screen recording with voiceover, simple tutorial |
| **High** | Significant production effort. Requires planning, multiple shoots, or heavy editing. | Complex transitions, multi-location shoots, professional lighting/audio, detailed animations, heavy post-production |

#### Reel Type Taxonomy

Assign one or more types from this taxonomy:

**Text/Caption:**
- `text-on-screen` — Primary content delivered via on-screen text (no talking or minimal talking)
- `slideshow` — Multiple images/slides with text, swiped or auto-played

**Narrative:**
- `pov` — Point-of-view format ("POV: you just..."), often with acting/scenarios
- `story-time` — Creator tells a personal story or experience
- `day-in-my-life` — Daily routine or lifestyle content

**Educational:**
- `tips-and-tricks` — Numbered tips, hacks, or advice ("5 things I wish I knew...")
- `tutorial` — Step-by-step how-to content
- `did-you-know` — Interesting fact or surprising information

**Trend:**
- `audio-trend` — Uses a trending audio/sound with custom visual content
- `transition` — Creative transitions between clips
- `dance` — Dance or choreography content
- `duet-style` — Side-by-side reaction or collaboration format

**Aesthetic:**
- `montage` — Visual montage of clips set to music, minimal text/talking
- `aesthetic-mood` — Aesthetic or cinematic content focused on visuals/vibes
- `behind-the-scenes` — Behind-the-scenes of a process, workspace, or event

**Engagement:**
- `this-or-that` — Comparison or choice content ("Would you rather...")
- `hot-take` — Controversial or polarizing opinion designed to spark debate
- `call-to-action` — Content with a strong CTA (save, share, comment, follow)

**Humour:**
- `skit` — Scripted comedy or scenario
- `relatable` — "So true" content that resonates with a specific audience
- `reaction` — Reacting to another video, screenshot, or situation

A reel can have multiple types (e.g., `["tips-and-tricks", "text-on-screen"]` for a tips reel delivered via on-screen text).

#### Relevance & Analysis

| Field | Type | Description |
|-------|------|-------------|
| `relevance_score` | integer 1-10 | How relevant to the user's stated niche |
| `relevance_reason` | string | 1-2 sentence explanation |
| `hook` | string | The opening hook/line that stops the scroll (first 1-2 seconds, from transcript or on-screen text) |
| `why_it_works` | string | What makes this reel perform well (format, hook, topic angle, CTA, timing, relatability) |
| `steal_this` | string | Specific, actionable takeaway the user can replicate. Be concrete. |
| `key_topics` | string[] | 2-5 topic tags |

**Relevance Scale:**

| Score | Criteria |
|-------|----------|
| **9-10** | Directly about the user's niche. Actionable, specific content. Teaches something they can use today. |
| **7-8** | Adjacent topics. Good production value. Relevant to their audience but not exact niche. |
| **5-6** | Loosely related. Some value but not targeted. |
| **3-4** | Generic content. Not niche-specific. |
| **1-2** | Completely irrelevant to the stated niche. |

**"steal_this" guidance:** Be specific and actionable. NOT "Good hook". YES "Use a numbered list format with text on screen. Open with a contrarian statement like 'Stop doing X'. Keep under 15 seconds. End with a save CTA."

#### Non-Talking Reel Fields

For reels where `talking` is false, also include:

| Field | Type | Description |
|-------|------|-------------|
| `visual_description` | string | Brief description of what's shown visually (since there's no transcript) |
| `text_on_screen` | string | Any text that appears on screen (from caption or inferred from context) |

### 3. Using Transcripts vs Captions

**IMPORTANT:** If a `transcript` field is present and non-empty, use it as the **PRIMARY evidence** for scoring and classification. Many high-value reels have generic captions but specific spoken content. The transcript reveals what creators actually SAY, which is often more detailed and niche-specific than the caption alone. Weight transcript content heavily alongside caption and engagement data.

**IMPORTANT:** For non-talking reels, rely on caption, engagement metrics, reel type, and visual cues. Do NOT penalize non-talking reels — they are often lower effort and highly replicable, making them valuable content research targets.

### 4. Identify Trend Patterns

After scoring all reels, analyze the batch as a whole and write 3-5 bullet points identifying patterns across the 20 reels. Examples:
- "Tutorial format with text on screen dominates — 6 of top 10 reels use this"
- "Hooks with specific numbers perform best ('5 things...', '£200k in 3 months')"
- "Non-talking reels average higher views but lower comments"
- "Low-effort reels dominate the top 5 — all are text-on-screen or slideshows"
- "Most high-engagement reels are under 20 seconds"

Save these as `trend_patterns` in the output JSON.

### 5. Save Scored Output

Write `instagram/content-research/scored-YYYY-MM-DD.json`:

```json
{
  "date": "2024-01-15",
  "niche": "luxury property in the UK",
  "mode": "feed",
  "scored_at": "2024-01-15T12:00:00Z",
  "engagement_floor": {
    "min_likes": 3000,
    "min_views": 40000,
    "min_comments": 1
  },
  "total": 20,
  "floor_met": 12,
  "talking_count": 14,
  "non_talking_count": 6,
  "effort_distribution": { "low": 8, "medium": 9, "high": 3 },
  "trend_patterns": [
    "Tutorial format with text on screen dominates — 6 of top 10 reels use this",
    "Hooks with specific numbers perform best",
    "Non-talking reels average higher views but lower comments"
  ],
  "reels": [
    {
      "url": "https://www.instagram.com/reel/ABC123/",
      "reel_id": "ABC123",
      "is_ad": false,
      "author": "username",
      "caption": "Full caption...",
      "like_count": 5000,
      "comment_count": 120,
      "view_count": 80000,
      "duration": 28,
      "uploader": "username",
      "upload_date": "20240115",
      "thumbnail": "https://...",
      "video_path": "/path/to/video.mp4",
      "transcript": "Hey everyone...",
      "talking": true,
      "likes": 5000,
      "views": 80000,
      "comments": 120,
      "engagement_floor_met": true,
      "engagement_note": "Strong engagement — 2x floor on views",
      "effort_level": "medium",
      "reel_types": ["tutorial", "tips-and-tricks"],
      "relevance_score": 9,
      "relevance_reason": "Step-by-step property sourcing tutorial with specific UK market data.",
      "hook": "This one trick helped me find 3 BMV deals in a week",
      "why_it_works": "Specific number in hook creates curiosity. Tutorial format delivers value. Under 30 seconds keeps retention high.",
      "steal_this": "Use 'This one trick' hook formula + specific results number. Film talking to camera, overlay key points as text. Keep under 30s. End with 'Follow for more'.",
      "key_topics": ["property sourcing", "BMV deals", "UK property"]
    }
  ]
}
```

For non-talking reels, the object also includes:
```json
{
  "talking": false,
  "visual_description": "Montage of luxury property interiors with price tags overlaid",
  "text_on_screen": "5 properties you can buy for £200k in Manchester"
}
```

## Score Distribution Categories

- **High relevance (8-10)**: Directly actionable for the user's niche. Study these carefully.
- **Medium relevance (5-7)**: Adjacent content. Note the format and hooks.
- **Low relevance (1-4)**: Not relevant. Still useful for understanding what the algorithm serves.
