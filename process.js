// AuraShot Backend Engine
// Runs every 5 min via GitHub Actions
// Flow: find queued users → grab photo → call Gemini → save wallpaper to Supabase

const SUPABASE_URL = 'https://huwwehnrbvercmsykmtv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1d3dlaG5yYnZlcmNtc3lrbXR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5MTE1ODUsImV4cCI6MjA5NTQ4NzU4NX0.309GgM6I7UH3lgd8m6RUWE1i7fFO5XWtdXSLtjUxiik';
const GEMINI_KEY = process.env.GEMINI_KEY;

// ── ART STYLES ──
const STYLES = [
  { name: 'Cyberpunk Neon',    prompt: 'Transform this portrait into cyberpunk style: neon purple and pink city lights, holographic overlays, rain-soaked street reflections, futuristic dystopian atmosphere, dramatic rim lighting, 9:16 portrait mobile wallpaper, ultra detailed' },
  { name: 'Neon Anime',        prompt: 'Transform this portrait into neon anime illustration: vibrant glowing cel-shading outlines, pastel color palette, starry night sky, floating sakura petals, dreamy soft-focus background, Studio Ghibli mood, 9:16 portrait mobile wallpaper' },
  { name: 'Oil Painting',      prompt: 'Transform this portrait into a classical oil painting: rich warm earth tones, visible impasto brushstrokes, Rembrandt chiaroscuro lighting, deep shadow vignette, old master museum quality, 9:16 portrait mobile wallpaper' },
  { name: 'Glitch Art',        prompt: 'Transform this portrait into glitch art: digital corruption aesthetic, RGB color channel splitting, horizontal scan lines, pixel displacement artifacts, neon data-stream noise, electronic dystopia, 9:16 portrait mobile wallpaper' },
  { name: 'Watercolor Dream',  prompt: 'Transform this portrait into soft watercolor illustration: delicate bleeding colors on wet paper, teal and indigo washes, loose expressive brushwork, ethereal dreamy mood, white paper texture showing through, 9:16 portrait mobile wallpaper' },
  { name: 'Vaporwave',         prompt: 'Transform this portrait into vaporwave aesthetic: pink and purple sunset gradient sky, retro perspective grid floor, chrome metallic text overlays, 80s synthwave nostalgia, VHS scan-line quality, 9:16 portrait mobile wallpaper' },
  { name: 'Dark Fantasy',      prompt: 'Transform this portrait into epic dark fantasy art: deep purples and midnight blacks, magical glowing particle effects, mystical rune overlays, moonlit dramatic atmosphere, painterly cinematic lighting, 9:16 portrait mobile wallpaper' },
  { name: 'Golden Hour',       prompt: 'Transform this portrait into golden hour photography: warm orange and amber backlight, sun flare bokeh circles, silhouette rim glow, cinematic film grain, moody sunset atmosphere, 9:16 portrait mobile wallpaper' },
  { name: 'Synthwave',         prompt: 'Transform this portrait into synthwave retro-futurism: hot pink and electric blue neon grid horizon, chrome reflections, laser grid geometric background, retro 80s arcade cabinet aesthetic, 9:16 portrait mobile wallpaper' },
  { name: 'Impressionist',     prompt: 'Transform this portrait into impressionist painting: loose expressive Monet-style brushstrokes, dappled sunlight, vibrant complementary colors, outdoor garden atmosphere, post-impressionist texture, 9:16 portrait mobile wallpaper' },
  { name: 'Neon Noir',         prompt: 'Transform this portrait into neon noir: rain-slicked city streets, high-contrast shadows, single neon sign reflection, film noir dramatic angle, teal and orange cinematic grade, detective mystery mood, 9:16 portrait mobile wallpaper' },
  { name: 'Cosmic Galaxy',     prompt: 'Transform this portrait blended into a cosmic galaxy scene: nebula colors of blue pink and gold, star clusters, swirling galactic dust, double exposure effect with universe, epic space scale, 9:16 portrait mobile wallpaper' },
];

// ── SUPABASE HELPERS ──
const H = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

async function sbGet(table, query = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: H });
  if (!r.ok) throw new Error(`DB read error [${r.status}]: ${await r.text()}`);
  return r.json();
}

async function sbPost(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...H, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`DB write error [${r.status}]: ${await r.text()}`);
}

async function sbPatch(table, query, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(data)
  });
}

async function sbDelete(table, query) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { method: 'DELETE', headers: H });
}

async function storageUpload(bucket, path, buffer, mime) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!r.ok) throw new Error(`Storage upload error [${r.status}]: ${await r.text()}`);
}

async function storageDelete(path) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/wallpapers/${path}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
}

// ── GEMINI IMAGE GENERATION ──
async function generateWallpaper(photoUrl, style, attempt = 0) {
  // Download source photo from Supabase Storage
  const photoResp = await fetch(photoUrl);
  if (!photoResp.ok) throw new Error(`Cannot download photo: ${photoResp.status}`);
  const photoBuffer = await photoResp.arrayBuffer();
  const base64Photo = Buffer.from(photoBuffer).toString('base64');
  const mime = photoResp.headers.get('content-type') || 'image/jpeg';

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: mime, data: base64Photo } },
            { text: style.prompt }
          ]
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          temperature: 1.0
        }
      })
    }
  );

  // Exponential backoff on rate limit (429)
  if (resp.status === 429) {
    if (attempt >= 3) throw new Error('RATE_LIMIT_EXCEEDED');
    const wait = [30000, 60000, 120000][attempt];
    console.log(`⏳ Rate limited. Waiting ${wait / 1000}s before retry ${attempt + 1}/3...`);
    await new Promise(r => setTimeout(r, wait));
    return generateWallpaper(photoUrl, style, attempt + 1);
  }

  if (!resp.ok) throw new Error(`Gemini error [${resp.status}]: ${await resp.text()}`);

  const data = await resp.json();
  const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!imgPart) throw new Error('Gemini returned no image. Response: ' + JSON.stringify(data).slice(0, 300));

  return { base64: imgPart.inlineData.data, mime: imgPart.inlineData.mimeType || 'image/png' };
}

// ── MAIN LOOP ──
async function main() {
  console.log(`\n🚀 AuraShot Engine — ${new Date().toISOString()}`);

  // ── STEP 1: Clean up dormant users (no activity for 14 days) ──
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const dormant = await sbGet('users', `?last_active=lt.${cutoff}&status=neq.dormant&select=id`);

  for (const u of dormant) {
    console.log(`🗑️  Cleaning dormant user ${u.id.slice(0, 8)}...`);
    const walls = await sbGet('wallpapers', `?user_id=eq.${u.id}&select=id,image_url`);
    for (const w of walls) {
      const path = w.image_url.split('/public/wallpapers/')[1];
      if (path) await storageDelete(path);
    }
    await sbDelete('wallpapers', `?user_id=eq.${u.id}`);
    await sbPatch('users', `?id=eq.${u.id}`, { status: 'dormant' });
  }
  if (dormant.length) console.log(`✅ Cleaned ${dormant.length} dormant user(s)`);

  // ── STEP 2: Find users who need wallpapers ──
  const users = await sbGet('users', `?status=in.(queued,active)&select=id`);
  console.log(`👥 ${users.length} active user(s) in queue`);

  let generated = 0;

  for (const user of users) {
    const uid = user.id;

    // Skip if user already has 15 wallpapers (recycle old ones first)
    const existing = await sbGet('wallpapers', `?user_id=eq.${uid}&select=id,image_url,created_at`);
    if (existing.length >= 15) {
      // Delete the oldest one to make room
      const oldest = existing.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
      const path = oldest.image_url.split('/public/wallpapers/')[1];
      if (path) await storageDelete(path);
      await sbDelete('wallpapers', `?id=eq.${oldest.id}`);
      console.log(`♻️  Recycled oldest wallpaper for ${uid.slice(0, 8)}`);
    }

    // Get source photos
    const photos = await sbGet('source_photos', `?user_id=eq.${uid}&select=*`);
    if (!photos.length) {
      console.log(`⚠️  No source photos for ${uid.slice(0, 8)}, skipping`);
      continue;
    }

    // Pick random photo + style
    const photo = photos[Math.floor(Math.random() * photos.length)];
    const style = STYLES[Math.floor(Math.random() * STYLES.length)];

    console.log(`🎨 Generating "${style.name}" for user ${uid.slice(0, 8)}...`);

    try {
      const { base64, mime } = await generateWallpaper(photo.photo_url, style);

      // Upload to Supabase Storage
      const ext = mime.includes('png') ? 'png' : 'jpg';
      const storagePath = `${uid}/${Date.now()}.${ext}`;
      await storageUpload('wallpapers', storagePath, Buffer.from(base64, 'base64'), mime);

      // Save record to DB
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/wallpapers/${storagePath}`;
      await sbPost('wallpapers', { user_id: uid, image_url: publicUrl, style: style.name });

      // Mark user as active
      await sbPatch('users', `?id=eq.${uid}`, {
        status: 'active',
        last_active: new Date().toISOString()
      });

      console.log(`✅ "${style.name}" saved (${(existing.length)} wallpapers total)`);
      generated++;

      // 3 second pause between generations to respect rate limits
      await new Promise(r => setTimeout(r, 3000));

    } catch (err) {
      if (err.message === 'RATE_LIMIT_EXCEEDED') {
        console.log('🛑 Daily quota reached. Halting until next cycle.');
        break;
      }
      console.error(`❌ Failed for ${uid.slice(0, 8)}: ${err.message}`);
    }
  }

  console.log(`\n🏁 Cycle done. Generated ${generated} wallpaper(s). Next run in ~5 min.`);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
