/**
 * Step 2: Extract reel data via Relevance AI (Apify) for all collected reels.
 * Outputs enriched data to enriched-YYYY-MM-DD.json for Claude to score.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = '2b6cddd8-70c3-4105-939e-9252f3478655';
const API_KEY = 'sk-NGMxN2EzZjgtYjVmYS00NDJhLTk3NWItZTg3ZDFjNDg1NDM0';
const REGION = 'f1db6c';
const STUDIO_ID = '3b3ae872-c8c9-40dd-8050-a88d83124b87';

function apiRequest(path_str, method, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var options = {
      hostname: 'api-' + REGION + '.stack.tryrelevance.com',
      path: '/latest' + path_str,
      method: method,
      headers: {
        'Authorization': PROJECT_ID + ':' + API_KEY,
        'Content-Type': 'application/json',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    var req = https.request(options, function(res) {
      var body = '';
      res.on('data', function(chunk) { body += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(body)); }
        catch(e) { resolve({ raw: body }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function main() {
  var date = new Date().toISOString().slice(0, 10);
  var inputFile = process.argv[2] || path.join(__dirname, 'collected-' + date + '.json');
  var data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  var reels = data.reels;

  console.log('Extracting data for ' + reels.length + ' reels via Relevance AI...\n');

  var enriched = [];
  for (var i = 0; i < reels.length; i++) {
    var reel = reels[i];
    console.log('[' + (i + 1) + '/' + reels.length + '] ' + reel.reel_id + '...');

    try {
      var result = await apiRequest('/studios/' + STUDIO_ID + '/trigger', 'POST', {
        params: { reel_url: reel.url }
      });

      if (result.output && result.output.answer && result.output.answer[0]) {
        var item = result.output.answer[0];
        enriched.push({
          url: reel.url,
          reel_id: reel.reel_id,
          is_ad: reel.is_ad,
          owner_username: item.ownerUsername || reel.author,
          caption: item.caption || '',
          likesCount: item.likesCount || 0,
          commentsCount: item.commentsCount || 0,
          videoPlayCount: item.videoPlayCount || item.videoViewCount || 0,
          hashtags: item.hashtags || [],
          timestamp: item.timestamp || '',
        });
        console.log('  @' + (item.ownerUsername || '?') + ' | ' + (item.likesCount || 0) + ' likes | ' + (item.caption || '').slice(0, 60));
      } else {
        console.log('  No data returned');
        enriched.push({
          url: reel.url,
          reel_id: reel.reel_id,
          is_ad: reel.is_ad,
          owner_username: reel.author,
          caption: '',
          likesCount: 0,
          commentsCount: 0,
          videoPlayCount: 0,
          hashtags: [],
          timestamp: '',
        });
      }
    } catch(err) {
      console.log('  Error: ' + err.message);
      enriched.push({
        url: reel.url,
        reel_id: reel.reel_id,
        is_ad: reel.is_ad,
        owner_username: reel.author,
        caption: '',
        likesCount: 0,
        commentsCount: 0,
        videoPlayCount: 0,
        hashtags: [],
        timestamp: '',
      });
    }

    // Rate limit: wait between calls
    if (i < reels.length - 1) {
      await sleep(2000);
    }
  }

  var outPath = path.join(__dirname, 'enriched-' + date + '.json');
  fs.writeFileSync(outPath, JSON.stringify({
    collected_at: data.collected_at,
    enriched_at: new Date().toISOString(),
    total: enriched.length,
    reels: enriched,
  }, null, 2));

  console.log('\nEnriched ' + enriched.length + ' reels.');
  console.log('Saved to ' + outPath);
}

main().catch(function(e) { console.error(e); process.exit(1); });
