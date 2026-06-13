
const fsSync = require("fs");
const {formidable} = require("formidable");
const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const seed = require("./data/seed");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(PUBLIC_DIR, "uploads");
const BUNDLED_UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
}

if (UPLOAD_DIR !== BUNDLED_UPLOAD_DIR && fsSync.existsSync(BUNDLED_UPLOAD_DIR)) {
  for (const file of fsSync.readdirSync(BUNDLED_UPLOAD_DIR)) {
    const source = path.join(BUNDLED_UPLOAD_DIR, file);
    const target = path.join(UPLOAD_DIR, file);
    if (fsSync.statSync(source).isFile() && !fsSync.existsSync(target)) {
      fsSync.copyFileSync(source, target);
    }
  }
}
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const TOKEN_SECRET =
  process.env.APP_SECRET || "dev-only-secret-change-me-before-production";
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "iskd-anime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const SUPABASE_ANIME_TABLE = process.env.SUPABASE_ANIME_TABLE || "anime";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
   ".mp4": "video/mp4",
  ".ico": "image/x-icon"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function hlsProxyHeaders(contentType = "application/octet-stream") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Cache-Control": "public, max-age=60",
    "Content-Type": contentType
  };
}

function proxiedHlsLine(baseUrl, value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return value;
  try {
    const absolute = new URL(trimmed, baseUrl).toString();
    return `/api/hls-proxy?url=${encodeURIComponent(absolute)}`;
  } catch {
    return value;
  }
}

function rewriteHlsManifest(baseUrl, text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("#EXT-X-KEY") && line.includes("URI=")) {
        return line.replace(/URI="([^"]+)"/, (_, uri) => {
          try {
            const absolute = new URL(uri, baseUrl).toString();
            return `URI="/api/hls-proxy?url=${encodeURIComponent(absolute)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        });
      }
      return proxiedHlsLine(baseUrl, line);
    })
    .join("\n");
}

async function proxyHls(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, hlsProxyHeaders());
    res.end();
    return;
  }

  const target = String(url.searchParams.get("url") || "").trim();
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return sendError(res, 400, "Invalid HLS URL.");
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return sendError(res, 400, "Only http/https video URLs are allowed.");
  }

 const headers = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "*/*"
};
  if (req.headers.range) headers.Range = req.headers.range;
  console.log(
  "HLS URL:",
  targetUrl.toString()
);
console.log(
  "Upstream Status:",
  upstream.status
);
  const upstream = await fetch(targetUrl, { headers });
  const upstreamType = upstream.headers.get("content-type") || "";
  const isManifest = /\.m3u8(\?|#|$)/i.test(targetUrl.pathname) || upstreamType.includes("mpegurl");

  if (!upstream.ok) {
    return sendError(res, upstream.status, `Video proxy failed: ${upstream.status}`);
  }

  if (isManifest) {
    const manifest = rewriteHlsManifest(targetUrl.toString(), await upstream.text());
    send(res, 200, manifest, hlsProxyHeaders("application/vnd.apple.mpegurl; charset=utf-8"));
    return;
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    ...hlsProxyHeaders(upstreamType || "application/octet-stream"),
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Content-Length": body.length,
    ...(upstream.headers.get("content-range") ? { "Content-Range": upstream.headers.get("content-range") } : {})
  });
  res.end(body);
}

async function sendFile(req, res, filePath, extension, cacheControl = "no-store") {
  const contentType = MIME_TYPES[extension] || "application/octet-stream";
  const stat = await fs.stat(filePath);

  if (extension === ".mp4") {
    const range = req.headers.range;
    const fileSize = stat.size;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Accept-Ranges": "bytes"
        });
        res.end();
        return;
      }

      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : fileSize - 1;
      const safeEnd = Math.min(end, fileSize - 1);

      if (start >= fileSize || safeEnd < start) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Accept-Ranges": "bytes"
        });
        res.end();
        return;
      }

      res.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
        "Content-Length": safeEnd - start + 1,
        "Content-Range": `bytes ${start}-${safeEnd}/${fileSize}`,
        "Content-Type": contentType
      });
      fsSync.createReadStream(filePath, { start, end: safeEnd }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      "Content-Length": fileSize,
      "Content-Type": contentType
    });
    fsSync.createReadStream(filePath).pipe(res);
    return;
  }

  const content = await fs.readFile(filePath);
  send(res, 200, content, {
    "Content-Type": contentType,
    "Cache-Control": cacheControl
  });
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(value) {
  return base64Url(
    crypto.createHmac("sha256", TOKEN_SECRET).update(value).digest()
  );
}

function createToken(user) {
  const payload = base64Url(
    JSON.stringify({
      sub: user.id,
      username: user.username,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7
    })
  );
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;

  const [payload, signature] = token.split(".");
  if (sign(payload) !== signature) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    if (!decoded.exp || decoded.exp < Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function passwordMatches(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = passwordHash(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(test, "hex"), Buffer.from(hash, "hex"));
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    createdAt: user.createdAt
  };
}

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeDb(seed);
    return structuredClone(seed);
  }
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("Request body is too large.");
    }
  }

  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

async function getCurrentUser(req, db) {
  const token = getBearerToken(req);
  const decoded = verifyToken(token);
  if (!decoded) return null;
  return db.users.find((user) => user.id === decoded.sub) || null;
}

function publicAssetExists(assetPath) {
  if (!assetPath) return false;
  if (/^https?:\/\//i.test(assetPath)) {
    return !/res\.cloudinary\.com\/x{3,}\//i.test(assetPath) &&
      !/\/x{3,}\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(assetPath);
  }
  if (!assetPath.startsWith("/")) return true;
  if (assetPath.startsWith("/media/")) return true;

  const relativePath = assetPath.replace(/^\/+/, "");
  const publicPath = path.join(PUBLIC_DIR, relativePath);
  if (fsSync.existsSync(publicPath)) return true;

  if (assetPath.startsWith("/uploads/")) {
    const uploadPath = path.join(UPLOAD_DIR, path.basename(assetPath));
    return fsSync.existsSync(uploadPath);
  }

  return false;
}

function safePublicAsset(assetPath, fallback) {
  const value = typeof assetPath === "string" ? assetPath.trim() : "";
  if (!value) return fallback;
  return publicAssetExists(value) ? value : fallback;
}

function publicAnime(anime) {
  const generatedPoster = `/media/posters/${anime.slug}.svg`;
  const generatedBackdrop = `/media/backdrops/${anime.slug}.svg`;
  const poster = safePublicAsset(anime.poster, generatedPoster);
  const backdrop = safePublicAsset(
    anime.backdrop,
    poster || generatedBackdrop
  );

  return {
    ...anime,
    poster,
    backdrop
  };
}

function findAnime(db, slug) {
  return db.anime.find((item) => item.slug === slug);
}

function findEpisode(db, episodeId) {
  for (const anime of db.anime) {

    if (!Array.isArray(anime.episodes)) {
      continue;
    }

    const episode = anime.episodes.find(
      (item) => item.id === episodeId
    );

    if (episode) {
      return { anime, episode };
    }
  }

  return null;
}

function applyCloudStats(db, anime) {
  const stats = db.cloudStats?.[anime.slug] || {};
  return {
    ...anime,
    views: Number(stats.views ?? anime.views ?? 0),
    likes: Number(stats.likes ?? anime.likes ?? 0),
    likedBy: Array.isArray(stats.likedBy) ? stats.likedBy : (Array.isArray(anime.likedBy) ? anime.likedBy : [])
  };
}

function ensureCloudStats(db, slug, anime = {}) {
  db.cloudStats ||= {};
  db.cloudStats[slug] ||= {
    views: Number(anime.views || 0),
    likes: Number(anime.likes || 0),
    likedBy: Array.isArray(anime.likedBy) ? anime.likedBy : []
  };
  db.cloudStats[slug].likedBy = Array.isArray(db.cloudStats[slug].likedBy)
    ? db.cloudStats[slug].likedBy
    : [];
  return db.cloudStats[slug];
}

async function findAnimeAny(db, slug) {
  const local = findAnime(db, slug);
  if (local) return applyCloudStats(db, local);
  if (!hasSupabaseAnime()) return null;
  const anime = (await readSupabaseAnime()).find((item) => item.slug === slug);
  return anime ? applyCloudStats(db, anime) : null;
}

async function findEpisodeAny(db, episodeId) {
  const local = findEpisode(db, episodeId);
  if (local) {
    return {
      anime: applyCloudStats(db, local.anime),
      episode: local.episode
    };
  }
  if (!hasSupabaseAnime()) return null;
  for (const anime of await readSupabaseAnime()) {
    const episode = (anime.episodes || []).find((item) => item.id === episodeId);
    if (episode) return { anime: applyCloudStats(db, anime), episode };
  }
  return null;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
}

function slugify(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-anime";
}

function uniqueSlug(db, title) {
  const base = slugify(title);
  let slug = base;
  let count = 2;

  while (findAnime(db, slug)) {
    slug = `${base}-${count}`;
    count += 1;
  }

  return slug;
}

function cleanText(value, fallback = "", maxLength = 500) {
  return String(value || fallback)
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function cleanList(value, fallback = []) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());

  const cleaned = list
    .map((item) => cleanText(item, "", 32))
    .filter(Boolean);

  return cleaned.length ? Array.from(new Set(cleaned)).slice(0, 8) : fallback;
}

function cleanAssetPath(value) {

  const text = cleanText(value, "", 700);

  if (!text) return "";

  if (
    text.startsWith("/assets/") ||
    text.startsWith("/uploads/")
  ) {
    return text;
  }

  if (/^https?:\/\//i.test(text)) {
    return text;
  }

  return "";
}

function hasSupabaseAnime() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseRequest(pathname, options = {}) {

  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL missing");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${pathname}`,
    {
      method: options.method || "GET",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body || undefined
    }
  );

  const text = await response.text();

  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {

    const message =
      data?.message ||
      data?.error ||
      "Supabase request failed.";

    throw new Error(message);
  }

  return data;
}

function supabaseAnimeSlug(row) {
  return `supabase-${row.id}-${slugify(row.title || "anime")}`;
}

function supabaseRowToAnime(row) {
  const title = cleanText(row.title, "Untitled", 120);
  const synopsis = cleanText(row.description, "No description added yet.", 900);
  const genres = cleanList(row.genre, ["Action"]);
  const slug = supabaseAnimeSlug(row);
  const poster = cleanAssetPath(row.poster);
  const video = cleanAssetPath(row.video);
  const createdAt = row.created_at || new Date().toISOString();

  return publicAnime({
    id: `supabase_${row.id}`,
    supabaseId: row.id,
    slug,
    title,
    japaneseTitle: "",
    tagline: synopsis.slice(0, 150),
    synopsis,
    type: "Movie",
    year: new Date(createdAt).getFullYear() || new Date().getFullYear(),
    rating: Number(row.rating) || 4.5,
    maturity: "13+",
    status: "Supabase",
    studios: ["ISKD Cloud"],
    languages: ["Sub"],
    duration: "24m",
    genres,
    contentCategory: "Anime",
    mood: genres[0] || "Action",
    popularity: Number(row.id) || 1,
    views: 0,
    likes: 0,
    likedBy: [],
    accent: "#ff6518",
    secondary: "#16d8cb",
    ...(poster ? { poster, backdrop: poster } : {}),
    createdAt,
    episodes: [
      {
        id: `${slug}-01`,
        number: 1,
        title: "Episode 1",
        duration: 24 * 60,
        ...(video ? { video } : {}),
        synopsis
      }
    ]
  });
}

async function readSupabaseAnime() {
  const rows = await supabaseRequest(
    `${SUPABASE_ANIME_TABLE}?select=*&order=created_at.desc`
  );
  return Array.isArray(rows) ? rows.map(supabaseRowToAnime) : [];
}

async function insertSupabaseAnime(body) {
  const title = cleanText(body.title, "", 120);
  const description = cleanText(body.synopsis || body.description, "", 900);
  const poster = cleanAssetPath(body.poster || body.backdrop);
  const video = cleanAssetPath(body.episodeVideo || body.video);
  const genre = cleanList(body.genres || body.genre, ["Action"]).join(", ");
  const rating = cleanText(body.rating, "4.5", 12);

  const rows = await supabaseRequest(SUPABASE_ANIME_TABLE, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ title, description, poster, video, rating, genre }])
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  return supabaseRowToAnime(row);
}

function parseMultipart(req, options = {}) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      uploadDir: UPLOAD_DIR,
      keepExtensions: true,
      maxFileSize: 1024 * 1024 * 1024,
      ...options
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });
}

function firstUploadedFile(fileOrList) {
  return Array.isArray(fileOrList) ? fileOrList[0] : fileOrList;
}

function cloudinaryReady() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
}

function cloudinarySign(params) {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${payload}${CLOUDINARY_API_SECRET}`)
    .digest("hex");
}

async function removeFileIfExists(filePath) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}

async function uploadToCloudinary(file, resourceType) {
  if (!cloudinaryReady()) return null;

  const timestamp = Math.round(Date.now() / 1000);
  const folder = `${CLOUDINARY_FOLDER}/${resourceType === "video" ? "videos" : "images"}`;
  const params = { folder, timestamp };
  const signature = cloudinarySign(params);
  const bytes = await fs.readFile(file.filepath);
  const form = new FormData();

  form.append(
    "file",
    new Blob([bytes], { type: file.mimetype || "application/octet-stream" }),
    file.originalFilename || path.basename(file.filepath)
  );
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    { method: "POST", body: form }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error?.message || "Cloudinary upload failed.");
  }

  return {
    path: data.secure_url,
    publicId: data.public_id,
    storage: "cloudinary",
    resourceType,
    bytes: data.bytes || file.size || 0,
    duration: data.duration || 0
  };
}

async function deleteFromCloudinary(publicId, resourceType) {
  if (!cloudinaryReady() || !publicId) return null;

  const timestamp = Math.round(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  const form = new FormData();

  form.append("public_id", publicId);
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("signature", cloudinarySign(params));

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`,
    { method: "POST", body: form }
  );
  return response.json().catch(() => ({}));
}

async function deleteLocalUpload(assetPath) {
  if (!assetPath || !assetPath.startsWith("/uploads/")) return;

  const relativePath = assetPath.replace(/^\/uploads\/?/, "");
  const safePath = path
    .normalize(decodeURIComponent(relativePath))
    .replace(/^(\.\.[/\\])+/, "");
  const resolved = path.resolve(path.join(UPLOAD_DIR, safePath));

  if (resolved === UPLOAD_DIR || !resolved.startsWith(`${UPLOAD_DIR}${path.sep}`)) return;
  await removeFileIfExists(resolved);
}

async function deleteAnimeAssets(anime) {
  await deleteLocalUpload(anime.poster);
  await deleteLocalUpload(anime.backdrop);
  await deleteFromCloudinary(anime.posterPublicId, "image");
  await deleteFromCloudinary(anime.backdropPublicId, "image");

  for (const episode of anime.episodes || []) {
    await deleteLocalUpload(episode.video);
    await deleteFromCloudinary(episode.videoPublicId, "video");
  }
}

function colorPair(seedText) {
  const palettes = [
    ["#ff6b35", "#1ed3c6"],
    ["#f4b942", "#2f80ed"],
    ["#57cc99", "#ff8fab"],
    ["#9b5de5", "#00bbf9"],
    ["#ef476f", "#ffd166"],
    ["#06d6a0", "#8ecae6"]
  ];
  const index =
    Array.from(String(seedText || "anime")).reduce(
      (total, char) => total + char.charCodeAt(0),
      0
    ) % palettes.length;
  return palettes[index];
}

function minutesToSeconds(value, fallback = 24) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return fallback * 60;
  return Math.min(180, Math.max(1, Math.round(minutes))) * 60;
}

function posterSvg(anime) {
  const a = sanitizeColor(anime.accent, "#ff6b35");
  const b = sanitizeColor(anime.secondary, "#1ed3c6");
  const title = escapeXml(anime.title);
  const type = escapeXml(anime.type);
  const year = escapeXml(anime.year);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1040" viewBox="0 0 720 1040" role="img" aria-label="${title} poster">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111318"/>
      <stop offset="0.48" stop-color="${a}"/>
      <stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <radialGradient id="glow" cx="60%" cy="28%" r="55%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.52"/>
      <stop offset="0.38" stop-color="${b}" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="18" flood-color="#000000" flood-opacity="0.38"/>
    </filter>
  </defs>
  <rect width="720" height="1040" fill="url(#bg)"/>
  <rect width="720" height="1040" fill="url(#glow)"/>
  <path d="M0 750 C140 660 260 720 380 650 C520 570 620 620 720 530 L720 1040 L0 1040 Z" fill="#07080d" opacity="0.74"/>
  <g filter="url(#softShadow)" transform="translate(360 480)">
    <circle cx="0" cy="-190" r="92" fill="#fff7e6" opacity="0.96"/>
    <path d="M-112 -94 C-62 -152 70 -156 118 -94 C80 -48 51 8 38 116 L-36 116 C-52 10 -82 -48 -112 -94 Z" fill="#171923"/>
    <path d="M-26 -246 C-74 -222 -96 -170 -80 -108 C-30 -142 34 -144 88 -112 C114 -180 70 -244 -26 -246 Z" fill="#101116"/>
    <path d="M-160 148 C-70 88 70 88 160 148 L126 398 L-126 398 Z" fill="#f8f3e8"/>
    <path d="M-132 180 C-72 128 78 128 132 180" fill="none" stroke="${a}" stroke-width="26" stroke-linecap="round"/>
    <path d="M-84 248 L84 248" stroke="${b}" stroke-width="18" stroke-linecap="round"/>
  </g>
  <g opacity="0.5">
    <circle cx="110" cy="138" r="6" fill="#ffffff"/>
    <circle cx="565" cy="190" r="5" fill="#ffffff"/>
    <circle cx="610" cy="360" r="4" fill="#ffffff"/>
    <circle cx="92" cy="430" r="5" fill="#ffffff"/>
    <circle cx="505" cy="82" r="3" fill="#ffffff"/>
  </g>
  <rect x="42" y="42" width="156" height="42" rx="21" fill="#000000" opacity="0.38"/>
  <text x="120" y="70" text-anchor="middle" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800">${type}</text>
  <text x="52" y="875" fill="#ffffff" font-family="Inter, Arial, sans-serif" font-size="56" font-weight="900">${title}</text>
  <text x="54" y="925" fill="#ffffff" opacity="0.82" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700">${year} Original</text>
</svg>`;
}

function backdropSvg(anime) {
  const a = sanitizeColor(anime.accent, "#ff6b35");
  const b = sanitizeColor(anime.secondary, "#1ed3c6");
  const title = escapeXml(anime.title);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img" aria-label="${title} backdrop">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#111318"/>
      <stop offset="0.45" stop-color="${a}"/>
      <stop offset="1" stop-color="${b}"/>
    </linearGradient>
    <radialGradient id="sun" cx="70%" cy="28%" r="42%">
      <stop offset="0" stop-color="#fff2c7" stop-opacity="0.84"/>
      <stop offset="0.35" stop-color="${b}" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>
  <rect width="1920" height="1080" fill="url(#sky)"/>
  <rect width="1920" height="1080" fill="url(#sun)"/>
  <g opacity="0.28" fill="#ffffff" filter="url(#blur)">
    <ellipse cx="390" cy="230" rx="210" ry="38"/>
    <ellipse cx="1380" cy="180" rx="250" ry="44"/>
    <ellipse cx="1120" cy="430" rx="180" ry="32"/>
  </g>
  <path d="M0 730 C260 610 480 690 720 590 C940 500 1120 550 1320 460 C1530 365 1710 420 1920 320 L1920 1080 L0 1080 Z" fill="#111318" opacity="0.72"/>
  <path d="M0 820 C310 720 520 770 760 690 C1040 595 1280 650 1500 560 C1670 492 1800 530 1920 470 L1920 1080 L0 1080 Z" fill="#05070b" opacity="0.8"/>
  <g transform="translate(1280 520)" opacity="0.95">
    <circle cx="0" cy="-150" r="72" fill="#fff8e7"/>
    <path d="M-120 -18 C-80 -120 92 -120 130 -16 C92 36 68 84 54 190 L-48 190 C-62 82 -88 34 -120 -18 Z" fill="#171923"/>
    <path d="M-180 230 C-70 150 92 150 200 230 L168 510 L-148 510 Z" fill="#f8f3e8"/>
    <path d="M-132 270 C-66 218 86 218 152 270" fill="none" stroke="${a}" stroke-width="32" stroke-linecap="round"/>
    <path d="M-74 350 L104 350" stroke="${b}" stroke-width="22" stroke-linecap="round"/>
  </g>
  <g opacity="0.55" fill="#ffffff">
    <circle cx="210" cy="140" r="5"/>
    <circle cx="370" cy="350" r="4"/>
    <circle cx="870" cy="160" r="5"/>
    <circle cx="1540" cy="310" r="4"/>
    <circle cx="1700" cy="120" r="6"/>
  </g>
</svg>`;
}

async function serveMedia(req, res, pathname) {
  const [, , kind, filename] = pathname.split("/");
  const slug = filename ? filename.replace(/\.svg$/i, "") : "";
  const db = await readDb();
  const anime = filename?.endsWith(".svg") && (kind === "posters" || kind === "backdrops")
    ? await findAnimeAny(db, slug)
    : null;

  if (!anime) {
    sendError(res, 404, "Media not found.");
    return true;
  }

  const svg = kind === "posters" ? posterSvg(anime) : backdropSvg(anime);
  send(res, 200, svg, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600"
  });
  return true;
}

async function serveStatic(req, res, pathname) {
  const safePath = path
    .normalize(decodeURIComponent(pathname))
    .replace(/^(\.\.[/\\])+/, "");
  const requested = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);
  const resolved = path.resolve(requested);

  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    const filePath = stat.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const extension = path.extname(filePath).toLowerCase();
    await sendFile(req, res, filePath, extension, "no-store");
  } catch {
    if (path.extname(pathname) || pathname.startsWith("/assets/")) {
      sendError(res, 404, "File not found.");
      return;
    }

    const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    send(res, 200, index, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
  }
}

async function serveUpload(req, res, pathname) {
  const relativePath = pathname.replace(/^\/uploads\/?/, "");
  const safePath = path
    .normalize(decodeURIComponent(relativePath))
    .replace(/^(\.\.[/\\])+/, "");
  const requested = path.join(UPLOAD_DIR, safePath);
  const resolved = path.resolve(requested);

  if (resolved !== UPLOAD_DIR && !resolved.startsWith(`${UPLOAD_DIR}${path.sep}`)) {
    sendError(res, 403, "Forbidden.");
    return true;
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      sendError(res, 404, "Upload not found.");
      return true;
    }

    const extension = path.extname(resolved).toLowerCase();
    await sendFile(req, res, resolved, extension, "public, max-age=3600");
  } catch {
    sendError(res, 404, "Upload not found.");
  }

  return true;
}

async function handleApi(req, res, url) {
  const db = await readDb();
  const pathname = url.pathname;
  const parts = pathname.split("/").filter(Boolean);
  if (req.method === "POST" && pathname === "/api/upload-video") {

    try {
      const { files } = await parseMultipart(req);
      const file = firstUploadedFile(files.video);

      if (!file) {
        return sendError(res, 400, "No video uploaded");
      }

      const cloudUpload = await uploadToCloudinary(file, "video");
      if (cloudUpload) {
        await removeFileIfExists(file.filepath);
        return sendJson(res, 200, cloudUpload);
      }

      const filename = path.basename(file.filepath);
      return sendJson(res, 200, {
        path: `/uploads/${filename}`,
        storage: "local",
        resourceType: "video"
      });
    } catch (error) {
      return sendError(res, 500, error.message || "Upload failed");
    }
}
// IMAGE UPLOAD
  if (req.method === "POST" && pathname === "/api/upload-image") {

    try {
      const { files } = await parseMultipart(req);
      const file = firstUploadedFile(files.image);

      if (!file) {
        return sendError(res, 400, "No image uploaded");
      }

      const cloudUpload = await uploadToCloudinary(file, "image");
      if (cloudUpload) {
        await removeFileIfExists(file.filepath);
        return sendJson(res, 200, cloudUpload);
      }

      const filename = path.basename(file.filepath);
      return sendJson(res, 200, {
        path: `/uploads/${filename}`,
        storage: "local",
        resourceType: "image"
      });
    } catch (error) {
      return sendError(res, 500, error.message || "Image upload failed");
    }
  }

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, name: "ISKD Anime API" });
  }

  if (
  req.method === "GET" &&
  pathname === "/api/genres"
) {

  try {

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/anime?select=genre`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!response.ok) {

      const err =
        await response.text();

      console.error(err);

      return sendError(
        res,
        500,
        err
      );
    }

    const data =
      await response.json();

    const genres =
      [...new Set(

        data
          .map(x => x.genre)
          .filter(Boolean)

      )];

    return sendJson(
      res,
      200,
      genres
    );

  } catch (error) {

    console.error(
      "Genres API Error:",
      error
    );

    return sendError(
      res,
      500,
      error.message
    );
  }
}
  if (req.method === "GET" && pathname === "/api/anime") {
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const genre = (url.searchParams.get("genre") || "All").trim();
    const type = (url.searchParams.get("type") || "All").trim();

   let anime;

try {

  const dbAnime = Array.isArray(db.anime)
    ? db.anime
    : [];

  const supabaseAnime = hasSupabaseAnime()
    ? await readSupabaseAnime()
    : [];

  console.log("DB Anime:", dbAnime.length);
  console.log("Supabase Anime:", supabaseAnime.length);

  console.log(
    "DB Titles:",
    dbAnime.map(x => x.title)
  );

  console.log(
    "Supabase Titles:",
    supabaseAnime.map(x => x.title)
  );

  anime = [
    ...dbAnime,
    ...supabaseAnime
  ];

  console.log(
    "Merged Anime:",
    anime.length
  );

} catch (error) {

  console.error(error);

  anime = db.anime || [];

}

    if (search) {
      anime = anime.filter((item) => {
        const text = [
          item.title,
          item.japaneseTitle,
          item.synopsis,
          item.tagline,
          item.status,
          item.mood,
          ...item.genres
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(search);
      });
    }
    if (genre !== "All") {
      anime = anime.filter((item) => item.genres.includes(genre));
    }
    if (type !== "All") {
      anime = anime.filter((item) => item.type === type);
    }
anime = anime
  .filter(
    (item) =>
      item &&
      item.id &&
      item.slug &&
      item.title &&
      Array.isArray(item.episodes)
  )
  .slice()
  .sort(
    (left, right) =>
      (right.popularity || 0) -
      (left.popularity || 0)
  )
  .map((item) => publicAnime(applyCloudStats(db, item)));

    return sendJson(res, 200, { anime });
  }

  if (req.method === "POST" && pathname === "/api/anime") {
    const user = await getCurrentUser(req, db);
    if (!user) return sendError(res, 401, "Sign in required.");

    const body = await readJsonBody(req);
    const title = cleanText(body.title, "", 90);
    const synopsis = cleanText(body.synopsis, "", 900);
    const episodeTitle = cleanText(body.episodeTitle, "Episode 1", 100);

    if (title.length < 2) {
      return sendError(res, 400, "Anime title is required.");
    }
    if (synopsis.length < 10) {
      return sendError(res, 400, "Synopsis must be at least 10 characters.");
    }

    if (hasSupabaseAnime()) {
      try {
        const anime = await insertSupabaseAnime(body);
        return sendJson(res, 201, { anime });
      } catch (error) {
        return sendError(res, 502, `Supabase upload failed: ${error.message}`);
      }
    }

    const slug = uniqueSlug(db, title);
    const [accent, secondary] = colorPair(`${title}${user.id}`);
    const type = cleanText(body.type, "Series", 20) === "Movie" ? "Movie" : "Series";
    const year = Math.min(
      2100,
      Math.max(1950, Number.parseInt(body.year, 10) || new Date().getFullYear())
    );
    const genres = cleanList(body.genres, ["Original"]);
    const studios = cleanList(body.studios || body.studio, [`${user.username} Studio`]);
    const languages = cleanList(body.languages, ["Sub"]);
    const episodeDuration = minutesToSeconds(body.episodeDurationMinutes, 24);
    const poster = cleanAssetPath(body.poster);
    const backdrop = cleanAssetPath(body.backdrop);
    const video = cleanAssetPath(
  body.episodeVideo || body.video
);
    const episodeVideoQualities = Array.isArray(body.episodeVideoQualities)
      ? body.episodeVideoQualities
          .map((item) => ({
            label: cleanText(item.label || item.quality, "", 20),
            url: cleanAssetPath(item.url || item.src)
          }))
          .filter((item) => item.label && item.url)
      : [];
    const anime = {
      id: `ani_${crypto.randomUUID()}`,
      slug,
      title,
      ...(poster ? { poster } : {}),
      ...(backdrop ? { backdrop } : {}),
      ...(body.posterPublicId ? { posterPublicId: cleanText(body.posterPublicId, "", 180) } : {}),
      ...(body.backdropPublicId ? { backdropPublicId: cleanText(body.backdropPublicId, "", 180) } : {}),
      ...(body.posterStorage ? { posterStorage: cleanText(body.posterStorage, "", 32) } : {}),
      ...(body.backdropStorage ? { backdropStorage: cleanText(body.backdropStorage, "", 32) } : {}),
      japaneseTitle: cleanText(body.japaneseTitle, "", 90),
      tagline: cleanText(body.tagline, "An original story added by the creator.", 160),
      synopsis,
      type,
      year,
      rating: 4.2,
      maturity: cleanText(body.maturity, "13+", 12),
      status: cleanText(body.status, "Creator Upload", 32),
      studios,
      languages,
      duration: `${Math.round(episodeDuration / 60)}m`,
      genres,
      contentCategory: cleanText(body.contentCategory, "Anime", 40),
      mood: cleanText(body.mood, "Original", 32),
      popularity: 70,
      views: 0,
      likes: 0,
      likedBy: [],
      accent,
      secondary,
      createdBy: user.id,
      createdByName: user.username,
      createdAt: new Date().toISOString(),
      episodes: [
        {
          id: `${slug}-01`,
          number: 1,
          title: episodeTitle,
          duration: episodeDuration,
          ...(video ? { video } : {}),
          ...(episodeVideoQualities.length ? { qualities: episodeVideoQualities } : {}),
          ...(body.episodeVideo1080 ? { video1080: cleanAssetPath(body.episodeVideo1080) } : {}),
          ...(body.episodeVideo720 ? { video720: cleanAssetPath(body.episodeVideo720) } : {}),
          ...(body.episodeVideo480 ? { video480: cleanAssetPath(body.episodeVideo480) } : {}),
          ...(body.episodeVideoPublicId ? { videoPublicId: cleanText(body.episodeVideoPublicId, "", 180) } : {}),
          ...(body.episodeVideoStorage ? { videoStorage: cleanText(body.episodeVideoStorage, "", 32) } : {}),
          synopsis: cleanText(
            body.episodeSynopsis,
            "The opening episode introduces the world, cast, and first conflict.",
            400
          )
        }
      ]
    };

    db.anime.unshift(anime);

if (anime.episodes?.length) {

  db.comments[
    anime.episodes[0].id
  ] = [];

}

await writeDb(db);

    return sendJson(res, 201, { anime: publicAnime(anime) });
  }

  
 // SINGLE ANIME
if (
  req.method === "GET" &&
  parts[0] === "api" &&
  parts[1] === "anime" &&
  parts[2]
) {
 console.log("PARTS:", parts);
  console.log("SLUG:", parts[2]);
  console.log("FOUND:", findAnime(db, parts[2]));
   let anime;

  anime = findAnime(db, parts[2]);

  if (!anime && hasSupabaseAnime()) {
    try {
      anime = (await readSupabaseAnime()).find(
        item => item.slug === parts[2]
      );
    } catch (error) {
      console.error(error);
    }
  }

  if (!anime) {
    return sendError(res, 404, "Anime not found.");
  }

  return sendJson(res, 200, {
    anime: publicAnime(applyCloudStats(db, anime))
  });
}

// VIEW COUNT
if (
  req.method === "POST" &&
  parts[0] === "api" &&
  parts[1] === "anime" &&
  parts[2] &&
  parts[3] === "view"
) {

  const anime =
    await findAnimeAny(db, parts[2]);

  if (!anime) {

    return sendError(
      res,
     404,
      "Anime not found."
    );

  }

  const stats = ensureCloudStats(db, anime.slug, anime);
  stats.views = Number(stats.views || 0) + 1;

  await writeDb(db);

  return sendJson(res, 200, {
    views: stats.views
  });

}

// LIKE / UNLIKE
if (
  req.method === "POST" &&
  parts[0] === "api" &&
  parts[1] === "anime" &&
  parts[2] &&
  parts[3] === "like"
) {

  const animeSlug = parts[2];

  const body = await readJsonBody(req);

  const clientId = cleanText(body.clientId, "guest", 120);

  const existing = await supabaseRequest(
    `likes?anime_id=eq.${animeSlug}&user_id=eq.${clientId}`
  );

  let liked = false;

  if (existing.length > 0) {

    await supabaseRequest(
      `likes?anime_id=eq.${animeSlug}&user_id=eq.${clientId}`,
      {
        method: "DELETE"
      }
    );

    liked = false;

  } else {

    await supabaseRequest("likes", {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: JSON.stringify([
        {
          anime_id: animeSlug,
          user_id: clientId
        }
      ])
    });

    liked = true;
  }

  const allLikes = await supabaseRequest(
    `likes?anime_id=eq.${animeSlug}`
  );

  return sendJson(res, 200, {
    liked,
    likes: allLikes.length,
    likedBy: allLikes.map((x) => x.user_id)
  });
}

// DELETE ANIME
if (
  req.method === "DELETE" &&
  parts[0] === "api" &&
  parts[1] === "anime" &&
  parts[2]
) {

  const slug = parts[2];

  const index =
    db.anime.findIndex(
      (item) => item.slug === slug
    );

  if (index === -1) {

    return sendError(
      res,
      404,
      "Anime not found."
    );

  }

  const [removedAnime] = db.anime.splice(index, 1);

  await deleteAnimeAssets(removedAnime);

  await writeDb(db);

  return sendJson(res, 200, {
    success: true
  });

}

  if (req.method === "POST" && pathname === "/api/auth/firebase") {
    const body = await readJsonBody(req);
    const uid = String(body.uid || "").trim();
    const email = String(body.email || "").trim();
    const phoneNumber = String(body.phoneNumber || "").trim();
    const displayName = String(body.displayName || "").trim();
    const photoURL = String(body.photoURL || "").trim();
    const username = email || phoneNumber || displayName || uid;

    if (!uid || !username) {
      return sendError(res, 400, "Firebase user is required.");
    }

    let user = db.users.find((item) => item.firebaseUid === uid);
    if (!user && email) {
      user = db.users.find((item) => String(item.email || item.username || "").toLowerCase() === email.toLowerCase());
    }

    if (!user) {
      user = {
        id: `usr_${crypto.randomUUID()}`,
        firebaseUid: uid,
        username,
        email,
        phoneNumber,
        displayName,
        photoURL,
        passwordHash: "",
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
    } else {
      user.firebaseUid = uid;
      user.username = user.username || username;
      user.email = email || user.email || "";
      user.phoneNumber = phoneNumber || user.phoneNumber || "";
      user.displayName = displayName || user.displayName || "";
      user.photoURL = photoURL || user.photoURL || "";
    }

    db.watchlists ||= {};
    db.progress ||= {};
    db.watchlists[user.id] ||= [];
    db.progress[user.id] ||= {};
    await writeDb(db);

    return sendJson(res, 200, {
      token: createToken(user),
      user: sanitizeUser(user)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (username.length < 3) {
      return sendError(res, 400, "Username must be at least 3 characters.");
    }
    if (password.length < 6) {
      return sendError(res, 400, "Password must be at least 6 characters.");
    }
    if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      return sendError(res, 409, "Username already exists.");
    }

    const user = {
      id: `usr_${crypto.randomUUID()}`,
      username,
      passwordHash: passwordHash(password),
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    db.watchlists[user.id] = [];
    db.progress[user.id] = {};
    await writeDb(db);

    return sendJson(res, 201, {
      token: createToken(user),
      user: sanitizeUser(user)
    });
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJsonBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const user = db.users.find(
      (item) => item.username.toLowerCase() === username.toLowerCase()
    );

    if (!user || !passwordMatches(password, user.passwordHash)) {
      return sendJson(res, 200, {
        authError: true,
        error: "Invalid username or password."
      });
    }

    return sendJson(res, 200, {
      token: createToken(user),
      user: sanitizeUser(user)
    });
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const user = await getCurrentUser(req, db);
    if (!user) return sendError(res, 401, "Sign in required.");
    return sendJson(res, 200, { user: sanitizeUser(user) });
  }

  if (req.method === "GET" && pathname === "/api/admin/overview") {
    const adminUsername = String(process.env.ADMIN_USERNAME || "").trim().toLowerCase();
    const user = await getCurrentUser(req, db);

    const watchlists = db.watchlists || {};
    const progress = db.progress || {};
    const comments = db.comments || {};
    const anime = db.anime || [];
    const canSeeUsers = Boolean(user && (!adminUsername || user.username.toLowerCase() === adminUsername));

    return sendJson(res, 200, {
      storage: {
        mode: "server-json",
        dataDir: DATA_DIR,
        dbPath: DB_PATH,
        uploadDir: UPLOAD_DIR,
        note: "Live server data is saved in data/db.json unless DATA_DIR is set."
      },
      users: canSeeUsers
        ? (db.users || []).map((item) => ({
            ...sanitizeUser(item),
            watchlistCount: (watchlists[item.id] || []).length,
            progressCount: Object.keys(progress[item.id] || {}).length
          }))
        : [],
      totals: {
        users: (db.users || []).length,
        anime: anime.length,
        views: anime.reduce((sum, item) => sum + Number(item.views || 0), 0),
        likes: anime.reduce((sum, item) => sum + Number(item.likes || 0), 0),
        comments: Object.values(comments).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
        progressEntries: Object.values(progress).reduce((sum, item) => sum + Object.keys(item || {}).length, 0),
        watchlistItems: Object.values(watchlists).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
      },
      recentComments: Object.entries(comments)
        .flatMap(([episodeId, list]) => (Array.isArray(list) ? list.map((comment) => ({ episodeId, ...comment })) : []))
        .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
        .slice(0, 8),
      topAnime: anime
        .slice()
        .sort((left, right) => Number(right.views || 0) - Number(left.views || 0))
        .slice(0, 8)
        .map((item) => ({
          slug: item.slug,
          title: item.title,
          views: Number(item.views || 0),
          likes: Number(item.likes || 0),
          createdByName: item.createdByName || ""
        }))
    });
  }

  if (parts[0] === "api" && parts[1] === "watchlist") {
    const user = await getCurrentUser(req, db);
    if (!user) return sendError(res, 401, "Sign in required.");
    db.watchlists[user.id] ||= [];

    if (req.method === "GET") {
      const slugs = db.watchlists[user.id];
      const anime = [];
      for (const slug of slugs) {
        const item = await findAnimeAny(db, slug);
        if (item) anime.push(publicAnime(item));
      }
      return sendJson(res, 200, { slugs, anime });
    }

    const slug = parts[2];
    const anime = slug ? await findAnimeAny(db, slug) : null;
    if (!anime) return sendError(res, 404, "Anime not found.");

    if (req.method === "POST") {
      if (!db.watchlists[user.id].includes(slug)) {
        db.watchlists[user.id].push(slug);
      }
      await writeDb(db);
      return sendJson(res, 200, { slugs: db.watchlists[user.id] });
    }

    if (req.method === "DELETE") {
      db.watchlists[user.id] = db.watchlists[user.id].filter((item) => item !== slug);
      await writeDb(db);
      return sendJson(res, 200, { slugs: db.watchlists[user.id] });
    }
  }

  if (parts[0] === "api" && parts[1] === "progress") {
    const user = await getCurrentUser(req, db);
    if (!user) return sendError(res, 401, "Sign in required.");
    db.progress[user.id] ||= {};

    if (req.method === "GET") {
      return sendJson(res, 200, { progress: db.progress[user.id] });
    }

    if (req.method === "POST" && parts[2]) {
      const match = await findEpisodeAny(db, parts[2]);
      if (!match) return sendError(res, 404, "Episode not found.");
      const body = await readJsonBody(req);
      const duration = Math.max(1, Number(body.duration || match.episode.duration));
      const position = Math.min(duration, Math.max(0, Number(body.position || 0)));
      db.progress[user.id][parts[2]] = {
        animeSlug: match.anime.slug,
        episodeId: parts[2],
        position,
        duration,
        updatedAt: new Date().toISOString()
      };
      await writeDb(db);
      return sendJson(res, 200, { progress: db.progress[user.id] });
    }
  }

  if (parts[0] === "api" && parts[1] === "comments" && parts[2]) {
    const episodeId = parts[2];
    if (!(await findEpisodeAny(db, episodeId))) return sendError(res, 404, "Episode not found.");
    db.comments[episodeId] ||= [];

    if (req.method === "GET") {
      return sendJson(res, 200, { comments: db.comments[episodeId] });
    }

    if (req.method === "POST") {
      const user = await getCurrentUser(req, db);
      if (!user) return sendError(res, 401, "Sign in required.");
      const body = await readJsonBody(req);
      const comment = String(body.body || "").trim();
      if (comment.length < 2) return sendError(res, 400, "Comment is too short.");
      if (comment.length > 280) return sendError(res, 400, "Comment is too long.");

      const entry = {
        id: `cmt_${crypto.randomUUID()}`,
        user: user.username,
        body: comment,
        createdAt: new Date().toISOString()
      };
      db.comments[episodeId].unshift(entry);
      await writeDb(db);
      return sendJson(res, 201, { comment: entry, comments: db.comments[episodeId] });
    }
  }

  return sendError(res, 404, "API route not found.");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname === "/api/hls-proxy") {
      await proxyHls(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/media/")) {
      await serveMedia(req, res, url.pathname);
      return;
    }

    if (url.pathname.startsWith("/uploads/")) {
      await serveUpload(req, res, url.pathname);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    sendError(res, 500, error.message || "Unexpected server error.");
  }
});

server.listen(PORT, () => {
  console.log(`ISKD Anime is running at http://localhost:${PORT}`);
});
