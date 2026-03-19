/**
 * Cleans up old video files to prevent disk bloat.
 *
 * Checks total video files in instagram/content-research/videos/.
 * If more than 50 files, deletes the oldest date folders until under 50.
 *
 * Usage: npx tsx instagram/content-research/cleanup-videos.ts
 */
import { readdirSync, statSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videosDir = join(__dirname, 'videos');
const MAX_FILES = 50;

function cleanup() {
  if (!existsSync(videosDir)) {
    console.log('No videos directory found. Nothing to clean.');
    return;
  }

  // Get all date folders sorted oldest first
  const dateFolders = readdirSync(videosDir)
    .filter(d => {
      const fullPath = join(videosDir, d);
      return statSync(fullPath).isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d);
    })
    .sort(); // YYYY-MM-DD sorts lexicographically = chronologically

  // Count total video files across all folders
  let totalFiles = 0;
  const folderCounts: { name: string; count: number }[] = [];

  for (const folder of dateFolders) {
    const folderPath = join(videosDir, folder);
    const files = readdirSync(folderPath).filter(f => f.endsWith('.mp4'));
    totalFiles += files.length;
    folderCounts.push({ name: folder, count: files.length });
  }

  console.log(`Videos directory: ${videosDir}`);
  console.log(`Total folders: ${dateFolders.length}`);
  console.log(`Total video files: ${totalFiles}`);
  console.log(`Threshold: ${MAX_FILES}\n`);

  if (totalFiles <= MAX_FILES) {
    console.log('Under threshold — no cleanup needed.');
    return;
  }

  // Delete oldest folders until under threshold
  let filesRemaining = totalFiles;
  let foldersDeleted = 0;

  for (const folder of folderCounts) {
    if (filesRemaining <= MAX_FILES) break;

    const folderPath = join(videosDir, folder.name);
    console.log(`Deleting ${folder.name}/ (${folder.count} files)...`);
    rmSync(folderPath, { recursive: true, force: true });
    filesRemaining -= folder.count;
    foldersDeleted++;
  }

  console.log(`\nCleaned up ${foldersDeleted} folder(s).`);
  console.log(`Remaining: ~${filesRemaining} video files.`);
}

cleanup();
