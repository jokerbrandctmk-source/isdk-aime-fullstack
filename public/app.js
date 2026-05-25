import { fetchAnime } from "./api.js";
const app = document.querySelector("#app");
const modalRoot = document.querySelector("#modalRoot");
const searchInput = document.querySelector("#searchInput");
const authButton = document.querySelector("#authButton");
const accountMenu = document.querySelector("#accountMenu");

function showFatalError(error) {
  const target = document.querySelector("#app");
  if (!target) return;
  const message = error?.message || String(error || "Unknown error");
  target.innerHTML = `
    <section class="content-band">
      <div class="empty-state">
        <p>App error: ${message}</p>
      </div>
    </section>
  `;
}

window.addEventListener("error", (event) => showFatalError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => showFatalError(event.reason));

const state = {
  anime: [],
  genres: [],
  selectedGenre: "All",
  selectedType: "All",
  search: "",
  token: localStorage.getItem("isdk_aime_token") || "",
  user: null,
  watchlist: [],
  progress: {},
  authMode: "login",
  currentTimer: null,
  viewedSlugs: new Set(),
  heroIndex: 0,
  heroTimer: null,
  aiQuery: "",
  authFeature: "cloud",
  accountMenuOpen: false,
  animeDbQuery: "",
  animeDbResults: [],
  animeDbLoading: false,
  animeDbError: ""
};

const LOCAL_DB_KEY = "isdk_aime_mobile_db";
const LOCAL_USER_KEY = "isdk_aime_mobile_user";
const CLIENT_ID_KEY = "isdk_aime_client_id";
const SUBSCRIBE_KEY = "isdk_aime_subscribed";
const MONETIZATION_STATUS_KEY = "isdk_aime_monetization_status";
const SUBSCRIBER_COUNT_KEY = "isdk_aime_subscriber_count";
const PROFILE_PHOTO_KEY = "isdk_aime_profile_photo";

const MONETIZATION_REQUIREMENTS = {
  subscribers: 1000,
  views: 2000000
};

const SAMPLE_STREAM_URL =
  "https://vz-7431961c-422.b-cdn.net/cb58d715-af27-4b6d-b41d-32e3e01e02b9/playlist.m3u8";
const MISSING_LOCAL_VIDEO = "/uploads/d2cf6r4o5jxp6kosfzf1qjw6e.mp4";
const MISSING_LOCAL_BACKDROP = "/uploads/efacel4ylzkum8kskl73wb6ea.jpg";

function getAppConfig() {
  return window.ISKD_CONFIG || {};
}

function getApiBaseUrl() {
  const queryBase = new URLSearchParams(window.location.search).get("apiBase");
  if (queryBase) {
    localStorage.setItem("isdk_api_base_url", queryBase);
  }
  const savedBase = localStorage.getItem("isdk_api_base_url");
  const configuredBase = getAppConfig().apiBaseUrl;
  return String(queryBase || savedBase || configuredBase || "").trim().replace(/\/+$/, "");
}

function apiUrl(path) {
  const baseUrl = getApiBaseUrl();
  return baseUrl && path.startsWith("/") ? `${baseUrl}${path}` : path;
}

function isAbsoluteAsset(value) {
  return /^(https?:|data:|blob:|capacitor:|file:)/i.test(String(value || ""));
}

function assetUrl(value, fallback = "/assets/anime/ff-image.jpg") {
  const source = String(value || fallback || "").trim();
  if (!source) return fallback;
  if (isAbsoluteAsset(source)) return source;

  const baseUrl = getApiBaseUrl();
  const shouldUseApiBase = /^\/(?:uploads|media)\//i.test(source);
  return baseUrl && shouldUseApiBase ? `${baseUrl}${source}` : source;
}

const AUTH_FEATURES = {
  cloud: {
    title: "Cloud ready",
    body: "Login ke baad watchlist, comments, likes aur progress ek account ke saath sync flow me aa jate hain. Firebase config ready hai, localhost/APK ke liye Node fallback bhi active hai.",
    action: "Sign in now",
    href: "#login"
  },
  tracking: {
    title: "Episode tracking",
    body: "Player ka progress save button, continue watching rail, views, likes aur episode position sab local/API state me update hote hain.",
    action: "Open player",
    href: "#watch/neon-ronin/neon-ronin-01"
  },
  ai: {
    title: "AI recommendations",
    body: "Mood ya title likho, app catalog me se matching anime pick karta hai. Example: Recommend anime like Solo Leveling.",
    action: "Try AI finder",
    href: "#home"
  }
};
const DEFAULT_ANIME = await fetchAnime();



function readLocalDb() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_DB_KEY) || "null");
    if (saved && Array.isArray(saved.anime) && saved.anime.length) {
      saved.watchlist = asArray(saved.watchlist);
      saved.progress = asObject(saved.progress);
      saved.comments = asObject(saved.comments);
      if (repairMissingUploadReferences(saved)) {
        writeLocalDb(saved);
      }
      return saved;
    }
  } catch {
    // Fall through to defaults.
  }

  const db = {
   anime: state.anime,
    watchlist: [],
    progress: {},
    comments: {}
  };
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  return db;
}

function writeLocalDb(db) {
  localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeRuntimeState() {
  state.anime = asArray(state.anime);
  repairMissingUploadReferences({ anime: state.anime });
  state.genres = asArray(state.genres);
  state.watchlist = asArray(state.watchlist);
  state.progress = asObject(state.progress);
  if (!Number.isFinite(Number(state.heroIndex))) state.heroIndex = 0;
}

function repairMissingUploadReferences(db) {
  if (!db || !Array.isArray(db.anime)) return false;
  let changed = false;

  db.anime.forEach((anime) => {
    if (anime.backdrop === MISSING_LOCAL_BACKDROP) {
      anime.backdrop = anime.poster || "/assets/anime/ff-image.jpg";
      changed = true;
    }

    (anime.episodes || []).forEach((episode) => {
      if (episode.video === MISSING_LOCAL_VIDEO) {
        episode.video = SAMPLE_STREAM_URL;
        episode.videoStorage = "bunny-hls";
        changed = true;
      }
    });
  });

  return changed;
}

function getClientId() {
  let clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    clientId = `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, clientId);
  }
  return clientId;
}

function userLiked(anime) {
  return Array.isArray(anime?.likedBy) && anime.likedBy.includes(getClientId());
}

function isSubscribed() {
  return localStorage.getItem(SUBSCRIBE_KEY) === "yes";
}

function toggleSubscribe() {
  return setChannelSubscribed(!isSubscribed());
}

function setChannelSubscribed(next) {
  const wasSubscribed = isSubscribed();
  const currentCount = Math.max(0, Number(localStorage.getItem(SUBSCRIBER_COUNT_KEY) || 0));
  let count = currentCount;
  if (next && !wasSubscribed) count += 1;
  if (!next && wasSubscribed) count = Math.max(0, count - 1);
  localStorage.setItem(SUBSCRIBER_COUNT_KEY, String(count));
  localStorage.setItem(SUBSCRIBE_KEY, next ? "yes" : "no");
  toast(next ? "Channel subscribed." : "Channel unsubscribed.");
  return next;
}

function monetizationStatus() {
  return localStorage.getItem(MONETIZATION_STATUS_KEY) || "Draft";
}

function setMonetizationStatus(status) {
  localStorage.setItem(MONETIZATION_STATUS_KEY, status);
  toast(`Monetization status: ${status}.`);
  return status;
}

function effectiveMonetizationStatus(stats) {
  const savedStatus = monetizationStatus();
  if ((savedStatus === "Monetized" || savedStatus === "Live") && !stats.meetsAudienceRequirements) {
    return "Requirements pending";
  }
  return savedStatus;
}

function subscriptionStats() {
  const db = readLocalDb();
  const anime = asArray(db.anime);
  const progressEntries = Object.values(asObject(db.progress));
  const watchedSeconds = progressEntries.reduce((sum, item) => sum + Number(item.position || 0), 0);
  const views = anime.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const likes = anime.reduce((sum, item) => sum + Number(item.likes || 0), 0);
  const uploadedTitles = anime.filter((item) => item.createdBy || item.owner || item.custom).length;
  const savedSubscribers = Number(localStorage.getItem(SUBSCRIBER_COUNT_KEY) || 0);
  const subscribers = Math.max(savedSubscribers, isSubscribed() ? 1 : 0);
  const meetsAudienceRequirements =
    subscribers >= MONETIZATION_REQUIREMENTS.subscribers &&
    views >= MONETIZATION_REQUIREMENTS.views;
  const estimate = Math.round(views * 0.018 + subscribers * 0.35 + watchedSeconds / 220);

  return {
    views,
    likes,
    uploadedTitles,
    subscribers,
    watchHours: Math.round((watchedSeconds / 3600) * 10) / 10,
    estimate,
    meetsAudienceRequirements,
    subscriberGoal: MONETIZATION_REQUIREMENTS.subscribers,
    viewGoal: MONETIZATION_REQUIREMENTS.views
  };
}

function localStudioOverview() {
  const db = readLocalDb();
  const comments = asObject(db.comments);
  const progress = asObject(db.progress);
  const anime = asArray(db.anime);
  const user = currentLocalUser();

  return {
    storage: {
      mode: "browser-localStorage",
      dataDir: "Phone/browser storage",
      dbPath: `localStorage:${LOCAL_DB_KEY}`,
      uploadDir: "Uploaded files are stored as server uploads or browser data URLs.",
      note: "APK/offline fallback data is stored inside this device/browser localStorage."
    },
    users: user
      ? [{
          id: user.id,
          username: user.username,
          createdAt: user.createdAt,
          watchlistCount: asArray(db.watchlist).length,
          progressCount: Object.keys(progress).length
        }]
      : [],
    totals: {
      users: user ? 1 : 0,
      anime: anime.length,
      views: anime.reduce((sum, item) => sum + Number(item.views || 0), 0),
      likes: anime.reduce((sum, item) => sum + Number(item.likes || 0), 0),
      comments: Object.values(comments).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
      progressEntries: Object.keys(progress).length,
      watchlistItems: asArray(db.watchlist).length
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
  };
}

async function loadStudioOverview() {
  try {
    return await api.get("/api/admin/overview");
  } catch {
    return localStudioOverview();
  }
}

function currentLocalUser() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_USER_KEY) || "null");
  } catch {
    return null;
  }
}

function localTokenUser() {
  return state.token ? currentLocalUser() : null;
}

function slugify(value) {
  return String(value || "custom-anime")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "custom-anime";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadCreatorFile(endpoint, fieldName, file) {
  if (!file) return null;

  const uploadData = new FormData();
  uploadData.append(fieldName, file);

  const config = getAppConfig();
  const cloudName = String(config.cloudinaryCloudName || "").trim();
  const uploadPreset = String(config.cloudinaryUploadPreset || "").trim();
  const resourceType = endpoint.includes("video") ? "video" : "image";

  if (cloudName && uploadPreset) {
    const folder = String(config.cloudinaryFolder || "iskd-anime").replace(/^\/+|\/+$/g, "");
    const cloudData = new FormData();
    cloudData.append("file", file);
    cloudData.append("upload_preset", uploadPreset);
    if (folder) {
      cloudData.append("folder", `${folder}/${resourceType === "video" ? "videos" : "images"}`);
    }

    const cloudResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
      { method: "POST", body: cloudData }
    );
    const cloudUploaded = await cloudResponse.json().catch(() => ({}));

    if (!cloudResponse.ok) {
      throw new Error(cloudUploaded.error?.message || "Cloudinary upload failed.");
    }

    return {
      path: cloudUploaded.secure_url,
      publicId: cloudUploaded.public_id,
      storage: "cloudinary",
      resourceType,
      bytes: cloudUploaded.bytes || file.size || 0,
      duration: cloudUploaded.duration || 0
    };
  }

  const response = await fetch(apiUrl(endpoint), {
    method: "POST",
    body: uploadData
  });
  const uploaded = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(uploaded.error || "Upload failed.");
  }

  return uploaded;
}

function isHlsUrl(value) {
  return /\.m3u8(\?|#|$)/i.test(String(value || ""));
}

function youtubeEmbedUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    let id = "";
    if (url.hostname.includes("youtu.be")) {
      id = url.pathname.replace("/", "");
    } else if (url.hostname.includes("youtube.com")) {
      id = url.searchParams.get("v") || "";
      if (!id && url.pathname.includes("/embed/")) id = url.pathname.split("/embed/")[1]?.split("/")[0] || "";
      if (!id && url.pathname.includes("/shorts/")) id = url.pathname.split("/shorts/")[1]?.split("/")[0] || "";
    }
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=0&rel=0&playsinline=1` : "";
  } catch {
    return "";
  }
}

function googleDriveEmbedUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!url.hostname.includes("drive.google.com")) return "";
    const fileId = url.pathname.includes("/file/d/")
      ? url.pathname.split("/file/d/")[1]?.split("/")[0]
      : url.searchParams.get("id");
    return fileId ? `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview` : "";
  } catch {
    return "";
  }
}

function embedVideoUrl(value) {
  return youtubeEmbedUrl(value) || googleDriveEmbedUrl(value);
}

function absoluteUrlFrom(base, value) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

async function hlsManifestQualities(sourceUrl) {
  try {
    const response = await fetch(sourceUrl);
    const text = await response.text();
    const lines = text.split(/\r?\n/);
    const variants = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
      const next = lines.slice(index + 1).find((item) => item && !item.startsWith("#"));
      if (!next) continue;
      const resolution = line.match(/RESOLUTION=\d+x(\d+)/i)?.[1];
      const bandwidth = line.match(/BANDWIDTH=(\d+)/i)?.[1];
      const label = resolution ? `${resolution}p` : bandwidth ? `${Math.round(Number(bandwidth) / 1000)} kbps` : "Quality";
      variants.push({ label, url: absoluteUrlFrom(sourceUrl, next.trim()) });
    }
    const seen = new Set();
    return variants
      .filter((item) => {
        const key = `${item.label}:${item.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number.parseInt(b.label, 10) - Number.parseInt(a.label, 10));
  } catch {
    return [];
  }
}

async function populateHlsQualitySelect(sourceUrl) {
  const select = document.querySelector("#qualitySelect");
  if (!select) return;
  const variants = await hlsManifestQualities(sourceUrl);
  if (!variants.length) return;
  window.__iskdHlsVariants = variants;
  select.dataset.mode = "manual-hls";
  select.innerHTML = [
    '<option value="manual-hls-auto">Auto</option>',
    ...variants.map((item, index) => `<option value="manual-hls-${index}">${escapeHtml(item.label)}</option>`)
  ].join("");
}

function loadHlsLibrary() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (window.__iskdHlsPromise) return window.__iskdHlsPromise;

  window.__iskdHlsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
    script.async = true;
    script.onload = () => resolve(window.Hls);
    script.onerror = () => reject(new Error("HLS player could not load."));
    document.head.appendChild(script);
  });

  return window.__iskdHlsPromise;
}

async function setupVideoSource(video, source) {
  if (!video || !source) return;
  const sourceUrl = assetUrl(source, "");
  if (!sourceUrl) return;

  window.__iskdHls?.destroy?.();
  window.__iskdHls = null;
  video.src = sourceUrl;

  if (!isHlsUrl(sourceUrl)) {
    return;
  }

  await populateHlsQualitySelect(sourceUrl);

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    return;
  }

  let Hls = null;
  try {
    Hls = await loadHlsLibrary();
  } catch {
    return;
  }
  if (Hls?.isSupported?.()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: 30
    });
    hls.loadSource(sourceUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const select = document.querySelector("#qualitySelect");
      if (!select) return;
      const levels = asArray(hls.levels)
        .map((level, index) => ({
          index,
          height: Number(level.height || 0),
          bitrate: Number(level.bitrate || 0)
        }))
        .filter((level) => level.height || level.bitrate)
        .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
      if (!levels.length) return;
      select.dataset.mode = "hls";
      select.innerHTML = [
        '<option value="hls-auto">Auto</option>',
        ...levels.map((level) => {
          const label = level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)} kbps`;
          return `<option value="hls-${level.index}">${label}</option>`;
        })
      ].join("");
    });
    window.__iskdHls = hls;
  }
}

function episodeQualityOptions(episode) {
  const manual = asArray(episode?.qualities)
    .map((item) => ({
      label: String(item.label || item.quality || "").trim(),
      url: String(item.url || item.src || "").trim()
    }))
    .filter((item) => item.label && item.url);

  const named = [
    ["1080p", episode?.video1080 || episode?.quality1080],
    ["720p", episode?.video720 || episode?.quality720],
    ["480p", episode?.video480 || episode?.quality480]
  ]
    .map(([label, url]) => ({ label, url: String(url || "").trim() }))
    .filter((item) => item.url);

  const seen = new Set();
  const merged = [...manual, ...named].filter((item) => {
    const key = `${item.label}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const base = String(episode?.video || "").trim();
  if (base) {
    merged.unshift({ label: isHlsUrl(base) ? "Auto" : "Original", url: base });
  }

  return merged.length ? merged : [];
}

function filterLocalAnime(path) {
  const db = readLocalDb();
  const url = new URL(path, location.origin);
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const genre = url.searchParams.get("genre") || "All";
  const type = url.searchParams.get("type") || "All";

  let anime = db.anime || [];
  if (search) {
    anime = anime.filter((item) =>
      [
        item.title,
        item.japaneseTitle,
        item.synopsis,
        item.tagline,
        item.status,
        item.mood,
        ...(item.genres || [])
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }
  if (genre !== "All") anime = anime.filter((item) => (item.genres || []).includes(genre));
  if (type !== "All") anime = anime.filter((item) => item.type === type);

  return anime.slice().sort((left, right) => (right.popularity || 0) - (left.popularity || 0));
}

function isValidApiPayload(path, data) {
  if (!data || typeof data !== "object") return false;
  if (path.startsWith("/api/genres")) return Array.isArray(data.genres);
  if (path === "/api/anime" || path.startsWith("/api/anime?")) return Array.isArray(data.anime);
  if (path.startsWith("/api/anime/")) return Boolean(data.anime);
  return true;
}

async function localApi(path, options = {}) {
  const method = options.method || "GET";
  const db = readLocalDb();

  if (path.startsWith("/api/genres")) {
    return {
      genres: Array.from(new Set((db.anime || []).flatMap((anime) => anime.genres || []))).sort()
    };
  }

  if (path === "/api/admin/overview") {
    return localStudioOverview();
  }

  if (method === "GET" && (path === "/api/anime" || path.startsWith("/api/anime?"))) {
    return { anime: filterLocalAnime(path) };
  }

  if (method === "GET" && path.startsWith("/api/anime/")) {
    const slug = path.split("/").pop();
    return { anime: (db.anime || []).find((item) => item.slug === slug) };
  }

  if (method === "DELETE" && path.startsWith("/api/anime/")) {
    const slug = path.split("/").pop();
    db.anime = (db.anime || []).filter((item) => item.slug !== slug);
    writeLocalDb(db);
    return { success: true };
  }

  if (method === "POST" && path.startsWith("/api/anime/") && path.endsWith("/view")) {
    const slug = path.split("/")[3];
    const anime = (db.anime || []).find((item) => item.slug === slug);
    if (!anime) throw new Error("Anime not found.");
    anime.views = (anime.views || 0) + 1;
    writeLocalDb(db);
    return { views: anime.views };
  }

  if (method === "POST" && path.startsWith("/api/anime/") && path.endsWith("/like")) {
    const slug = path.split("/")[3];
    const anime = (db.anime || []).find((item) => item.slug === slug);
    if (!anime) throw new Error("Anime not found.");
    const body = JSON.parse(options.body || "{}");
    const clientId = body.clientId || getClientId();
    anime.likedBy = Array.isArray(anime.likedBy) ? anime.likedBy : [];
    const liked = !anime.likedBy.includes(clientId);
    anime.likedBy = liked
      ? [...anime.likedBy, clientId]
      : anime.likedBy.filter((id) => id !== clientId);
    anime.likes = anime.likedBy.length;
    writeLocalDb(db);
    return { liked, likes: anime.likes, likedBy: anime.likedBy };
  }

  if (method === "POST" && path === "/api/anime") {
    const body = JSON.parse(options.body || "{}");
    const baseSlug = slugify(body.title);
    let slug = baseSlug;
    let count = 2;
    while ((db.anime || []).some((item) => item.slug === slug)) {
      slug = `${baseSlug}-${count}`;
      count += 1;
    }

    const duration = Math.max(1, Number(body.episodeDurationMinutes || 24)) * 60;
    const anime = {
      id: `local_${Date.now()}`,
      slug,
      title: body.title || "Untitled Anime",
      poster: body.poster || "/assets/anime/ff-image.jpg",
      backdrop: body.backdrop || body.poster || "/assets/anime/ff-image.jpg",
      japaneseTitle: body.japaneseTitle || "",
      tagline: body.tagline || "Original anime added on mobile.",
      synopsis: body.synopsis || "No synopsis yet.",
      type: body.type || "Series",
      year: Number(body.year || new Date().getFullYear()),
      rating: 4.2,
      maturity: body.maturity || "13+",
      status: "Creator Upload",
      studios: [body.studio || "Creator Studio"],
      languages: String(body.languages || "Sub").split(",").map((item) => item.trim()).filter(Boolean),
      duration: `${Math.round(duration / 60)}m`,
      genres: String(body.genres || "Original").split(",").map((item) => item.trim()).filter(Boolean),
      contentCategory: body.contentCategory || "Anime",
      mood: "Original",
      popularity: 70,
      views: 0,
      likes: 0,
      likedBy: [],
      custom: true,
      createdBy: state.user?.id || currentLocalUser()?.id || getClientId(),
      createdByName: state.user?.username || currentLocalUser()?.username || "Creator",
      episodes: [
        {
          id: `${slug}-01`,
          number: 1,
          title: body.episodeTitle || "Episode 1",
          duration,
          video: body.episodeVideo || body.video || "",
          qualities: asArray(body.episodeVideoQualities).filter((item) => item?.url),
          video1080: body.episodeVideo1080 || "",
          video720: body.episodeVideo720 || "",
          video480: body.episodeVideo480 || "",
          synopsis: body.episodeSynopsis || "Opening episode."
        }
      ]
    };

    db.anime = [anime, ...(db.anime || [])];
    writeLocalDb(db);
    return { anime };
  }

  if (path === "/api/me") {
    const user = localTokenUser();
    if (!user) throw new Error("Sign in required.");
    return { user };
  }

  if (path.startsWith("/api/auth/")) {
    const body = JSON.parse(options.body || "{}");
    const user = {
      id: `local_user_${body.username || "creator"}`,
      username: body.username || "creator",
      createdAt: new Date().toISOString()
    };
    state.token = `local_${Date.now()}`;
    localStorage.setItem("isdk_aime_token", state.token);
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
    return { token: state.token, user };
  }

  if (path === "/api/watchlist") return { slugs: db.watchlist || [], anime: [] };
  if (path.startsWith("/api/watchlist/")) {
    const slug = path.split("/").pop();
    db.watchlist ||= [];
    if (method === "POST" && !db.watchlist.includes(slug)) db.watchlist.push(slug);
    if (method === "DELETE") db.watchlist = db.watchlist.filter((item) => item !== slug);
    writeLocalDb(db);
    return { slugs: db.watchlist };
  }

  if (path === "/api/progress") return { progress: db.progress || {} };
  if (path.startsWith("/api/progress/")) {
    const episodeId = path.split("/").pop();
    const body = JSON.parse(options.body || "{}");
    const anime = (db.anime || []).find((item) => (item.episodes || []).some((ep) => ep.id === episodeId));
    db.progress ||= {};
    db.progress[episodeId] = {
      animeSlug: anime?.slug || "",
      episodeId,
      position: Number(body.position || 0),
      duration: Number(body.duration || 1),
      updatedAt: new Date().toISOString()
    };
    writeLocalDb(db);
    return { progress: db.progress };
  }

  if (path.startsWith("/api/comments/")) {
    const episodeId = path.split("/").pop();
    db.comments ||= {};
    db.comments[episodeId] ||= [];
    if (method === "POST") {
      const body = JSON.parse(options.body || "{}");
      const user = currentLocalUser();
      db.comments[episodeId].unshift({
        id: `comment_${Date.now()}`,
        user: user?.username || "Guest",
        body: body.body || "",
        createdAt: new Date().toISOString()
      });
      writeLocalDb(db);
    }
    return { comments: db.comments[episodeId] };
  }

  throw new Error("Offline route not available.");
}

const api = {
  async request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(apiUrl(path), {
        ...options,
        headers
      });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;

      if (!response.ok) {
        throw new Error(data?.error || "Something went wrong.");
      }
      if (!isValidApiPayload(path, data)) {
        return localApi(path, options);
      }
      return data;
    } catch (error) {
      return localApi(path, options);
    }
  },
  get(path) {
    return this.request(path);
  },
  post(path, body = {}) {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  
  delete(path) {
    return this.request(path, { method: "DELETE" });
  }
};
async function deleteAnime(slug) {

  try {
    await api.delete(`/api/anime/${slug}`);
    alert("Anime deleted");
    await loadAnime();
    location.hash = "#home";
    await route();
  } catch (error) {
    alert(error.message || "Delete failed");
  }
}

window.deleteAnime = deleteAnime;

function icon(name) {
  return `<svg class="icon"><use href="#icon-${name}"></use></svg>`;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function progressPercent(episodeId) {
  const item = state.progress[episodeId];
  if (!item) return 0;
  return Math.min(100, Math.round((item.position / item.duration) * 100));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toast(message) {
  const oldToast = document.querySelector(".toast");
  oldToast?.remove();

  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3200);
}

function displayNameFromUser(user = state.user) {
  const value = String(user?.username || "Guest").trim();
  return value.includes("@") ? value.split("@")[0] : value;
}

function userInitial(user = state.user) {
  return displayNameFromUser(user).slice(0, 1).toUpperCase() || "U";
}

function avatarColor(user = state.user) {
  const seed = String(user?.username || "guest");
  let total = 0;
  for (const letter of seed) total += letter.charCodeAt(0);
  const colors = ["#f4b942", "#1ed3c6", "#ff6b35", "#57cc99", "#8ecae6"];
  return colors[total % colors.length];
}

function getProfilePhoto() {
  return localStorage.getItem(PROFILE_PHOTO_KEY) || "";
}

function setProfilePhoto(value) {
  if (value) {
    localStorage.setItem(PROFILE_PHOTO_KEY, value);
  } else {
    localStorage.removeItem(PROFILE_PHOTO_KEY);
  }
}

function renderAvatar(className = "account-avatar", user = state.user) {
  const photo = getProfilePhoto();
  if (photo) {
    return `<span class="${className} photo-avatar"><img src="${photo}" alt="${escapeHtml(displayNameFromUser(user))} profile photo" /></span>`;
  }
  return `<span class="${className}" style="--avatar-color: ${avatarColor(user)}">${escapeHtml(userInitial(user))}</span>`;
}

function updateAccountButton() {
  if (!authButton) return;
  const mobileAccountLabel = document.querySelector("#mobileAccountLabel");
  if (state.user) {
    document.body.classList.add("is-logged-in");
    if (mobileAccountLabel) mobileAccountLabel.textContent = "Account";
    authButton.classList.add("user-avatar-button");
    const photo = getProfilePhoto();
    authButton.innerHTML = photo
      ? `<span class="button-photo-avatar"><img src="${photo}" alt="${escapeHtml(displayNameFromUser())}" /></span>`
      : `<span style="--avatar-color: ${avatarColor()}">${escapeHtml(userInitial())}</span>`;
    authButton.setAttribute("aria-label", `Open account menu for ${displayNameFromUser()}`);
    authButton.title = displayNameFromUser();
    return;
  }

  document.body.classList.remove("is-logged-in");
  if (mobileAccountLabel) mobileAccountLabel.textContent = "Login";
  authButton.classList.remove("user-avatar-button");
  authButton.innerHTML = icon("user");
  authButton.setAttribute("aria-label", "Login");
  authButton.title = "Login";
}

function renderAccountMenu() {
  if (!accountMenu) return;
  if (!state.user || !state.accountMenuOpen) {
    accountMenu.hidden = true;
    accountMenu.innerHTML = "";
    return;
  }

  accountMenu.hidden = false;
  accountMenu.innerHTML = `
    <div class="account-card">
      <div class="account-head">
        ${renderAvatar("account-avatar")}
        <div>
          <strong>${escapeHtml(displayNameFromUser())}</strong>
          <small>${escapeHtml(state.user.username || "")}</small>
          <a href="#subscribe/audience" data-account-route>View channel</a>
        </div>
      </div>
      <div class="account-actions">
        <a href="#subscribe/content" data-account-route>Your videos</a>
        <a href="#subscribe/earn" data-account-route>ISKD Studio</a>
        <a href="#subscribe/analytics" data-account-route>Analytics</a>
        <a href="#subscribe/settings" data-account-route>Settings</a>
        <button type="button" data-logout-account>Logout</button>
      </div>
    </div>
  `;
}

function closeAccountMenu() {
  state.accountMenuOpen = false;
  renderAccountMenu();
}

function isHomeRoute() {
  const view = location.hash.replace(/^#\/?/, "").split("/")[0];
  return !view || view === "home";
}

function currentRouteView() {
  return location.hash.replace(/^#\/?/, "").split("/")[0] || "home";
}

function updateMobileTabs() {
  const view = currentRouteView();
  const active = view === "details" || view === "watch" ? "browse" : view;
  document.querySelectorAll("[data-tab-route]").forEach((link) => {
    link.classList.toggle("active", link.dataset.tabRoute === active);
  });
}

function selectedAnime() {
  normalizeRuntimeState();
  if (!state.anime.length) {
    return null;
  }

  const index = Math.abs(state.heroIndex) % state.anime.length;
  return state.anime[index];
}

function startHeroSlider() {
  normalizeRuntimeState();
  window.clearInterval(state.heroTimer);
  state.heroTimer = null;

  if (!state.anime || state.anime.length < 2 || !isHomeRoute()) return;

  state.heroTimer = window.setInterval(() => {
    if (!isHomeRoute()) {
      window.clearInterval(state.heroTimer);
      state.heroTimer = null;
      return;
    }

    state.heroIndex = (state.heroIndex + 1) % state.anime.length;
    renderHome();
  }, 6500);
}

function renderSkeletonShell() {
  return `
    <section class="app-splash">
      <div class="splash-bg"></div>
      <div class="splash-center">
        <img src="/assets/logo.svg" alt="ISKD Anime" />
        <span class="splash-loader"></span>
        <p>Loading your anime world...</p>
      </div>
    </section>
  `;
}

function recommendAnime(query) {
  normalizeRuntimeState();
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return state.anime.slice(0, 4);

  const moodMap = {
    action: ["action", "battle", "solo leveling", "fight", "power"],
    fantasy: ["fantasy", "magic", "king", "isekai", "adventure"],
    comedy: ["comedy", "funny", "light", "happy"],
    drama: ["drama", "sad", "emotional", "serious"],
    mystery: ["mystery", "dark", "thriller", "secret"],
    music: ["music", "idol", "song"]
  };

  return state.anime
    .map((anime) => {
      const haystack = [
        anime.title,
        anime.japaneseTitle,
        anime.tagline,
        anime.synopsis,
        anime.status,
        anime.mood,
        ...(anime.genres || [])
      ].join(" ").toLowerCase();
      let score = haystack.includes(clean) ? 8 : 0;

      for (const [genre, words] of Object.entries(moodMap)) {
        if (words.some((word) => clean.includes(word))) {
          score += (anime.genres || []).map((item) => item.toLowerCase()).includes(genre) ? 6 : 0;
        }
      }

      score += Math.min(5, Number(anime.rating || 0));
      score += Math.min(4, Number(anime.popularity || 0) / 25);
      return { anime, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.anime);
}

function renderAiFinder() {
  const picks = recommendAnime(state.aiQuery);
  return `
    <section class="ai-finder" id="ai-finder">
      <div>
        <p class="eyebrow">ISKD Anime Sense</p>
        <h2>Mood based anime finder</h2>
        <p class="muted">Action, comfort shows, dark fantasy, music arcs, and creator uploads.</p>
      </div>
      <form class="ai-search" id="aiFinderForm">
        <input name="query" value="${escapeHtml(state.aiQuery)}" placeholder="Recommend anime like Solo Leveling" />
        <button class="primary-button glow-button" type="submit">${icon("search")} Find</button>
      </form>
      <div class="ai-results">
        ${picks
          .map(
            (anime) => `
              <a class="ai-result" href="#details/${anime.slug}">
                <img src="${anime.poster}" alt="${escapeHtml(anime.title)} poster" loading="lazy" decoding="async" />
                <span>
                  <strong>${escapeHtml(anime.title)}</strong>
                  <small>${(anime.genres || []).slice(0, 2).join(" / ")} / ${anime.rating}</small>
                </span>
              </a>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function buildAnimeParams() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.selectedGenre !== "All") params.set("genre", state.selectedGenre);
  if (state.selectedType !== "All") params.set("type", state.selectedType);
  return params.toString();
}

async function loadAnime() {
  try {

    const params = buildAnimeParams();

    const data = await api.get(
      `/api/anime${params ? `?${params}` : ""}`
    );

    state.anime = asArray(data.anime);
    writeLocalDb({
  anime: state.anime,
  watchlist: state.watchlist,
  progress: state.progress,
  comments: {}
});

  } catch (error) {

    console.error("Anime load error:", error);

    state.anime = [];
  }
}

async function loadUserState() {
  if (!state.token) return;

  
  try {
    const [me, watchlist, progress] = await Promise.all([
      api.get("/api/me"),
      api.get("/api/watchlist"),
      api.get("/api/progress")
    ]);
    state.user = me.user || null;
    state.watchlist = asArray(watchlist.slugs);
    state.progress = asObject(progress.progress);
  } catch {
    state.token = "";
    state.user = null;
    state.watchlist = [];
    state.progress = {};
   localStorage.removeItem(
      "isdk_aime_token"
    );
  }
}

function renderMetaLegacy(anime) {
  return `
    <span class="meta-item">${icon("star")} ${anime.rating}</span>
    <span>👁 ${anime.views || 0}</span>
    <span>${anime.year}</span>
    <span>${anime.maturity}</span>
    <span>${anime.status}</span>
    <span>${(anime.languages || []).join(" / ")}</span>
  `;
}

function renderMeta(anime) {
  return `
    <span class="meta-item">${icon("star")} ${anime.rating}</span>
    <span>${anime.views || 0} Views</span>
    <span>${anime.likes || 0} Likes</span>
    <span>${anime.year}</span>
    <span>${anime.maturity}</span>
    <span>${anime.status}</span>
    <span>${(anime.languages || []).join(" / ")}</span>
  `;
}

async function incrementAnimeView(slug) {
  if (state.viewedSlugs.has(slug)) return;
  state.viewedSlugs.add(slug);

  try {
    const data = await api.post(`/api/anime/${slug}/view`, {});
    const anime = state.anime.find((item) => item.slug === slug);
    if (anime && Number.isFinite(Number(data.views))) {
      anime.views = Number(data.views);
    }
  } catch {
    // Keep the page usable if counting fails.
  }
}

async function toggleAnimeLike(slug) {
  try {
    const data = await api.post(`/api/anime/${slug}/like`, {
      clientId: getClientId()
    });
    const anime = state.anime.find((item) => item.slug === slug);
    if (anime) {
      anime.likes = data.likes || 0;
      anime.likedBy = data.likedBy || [];
    }
    toast(data.liked ? "Liked." : "Unliked.");
    await route();
  } catch (error) {
    toast(error.message || "Like failed.");
  }
}

function renderHero(anime) {
  if (!anime) {
    return `
      <section class="content-band">
        <div class="empty-state">
          <p>No anime found. Try a different search or filter.</p>
        </div>
      </section>
    `;
  }

  const firstEpisode = anime?.episodes?.[0];

if (!firstEpisode) {
  return `
    <section class="content-band">
      <div class="empty-state">
        <p>No episodes found.</p>
      </div>
    </section>
  `;
}
  const saved = state.watchlist.includes(anime.slug);
  const posterImage = assetUrl(anime.poster);
  const backdropImage = assetUrl(anime.backdrop, posterImage);
  const heroIndex = state.anime.findIndex((item) => item.slug === anime.slug);
  const heroDots = state.anime
    .slice(0, 6)
    .map(
      (item, index) => `
        <button class="hero-dot ${index === heroIndex ? "active" : ""}" type="button" data-hero-slide="${index}" aria-label="Show ${escapeHtml(item.title)}"></button>
      `
    )
    .join("");

  return `
    <section class="hero" style="--hero-image: url('${escapeHtml(backdropImage)}')">
      <div class="hero-inner">
        <div class="hero-copy">
          <p class="eyebrow">ISKD Anime / ${anime.status} / ${(anime.genres || []).slice(0, 2).join(" / ")}</p>
          <h1>${escapeHtml(anime.title)}</h1>
          <p class="hero-tagline">${escapeHtml(anime.tagline)}</p>
          <p class="hero-synopsis">${escapeHtml(anime.synopsis)}</p>
          <div class="meta-row">${renderMeta(anime)}</div>
          <div class="action-row">
            <a class="primary-button glow-button" href="#watch/${anime.slug}/${firstEpisode.id}">
              ${icon("play")} Start watching
            </a>
            <button class="ghost-button" type="button" data-watchlist="${anime.slug}">
              ${icon("heart")} ${saved ? "In My List" : "Add to My List"}
            </button>
            <a class="ghost-button" href="#details/${anime.slug}">Details</a>
          </div>
          <div class="hero-dots">${heroDots}</div>
        </div>
        <div class="hero-preview">
          <img class="hero-poster" src="${escapeHtml(posterImage)}" alt="${escapeHtml(anime.title)} poster" fetchpriority="high" decoding="async" />
          ${
            firstEpisode.video
              ? `
                <video class="trailer-preview" muted loop autoplay playsinline preload="metadata" poster="${escapeHtml(backdropImage)}">
                  <source src="${escapeHtml(assetUrl(firstEpisode.video, ""))}" />
                </video>
                <form id="commentForm">

  <input
    id="commentInput"
    type="text"
    placeholder="Write comment..."
  />

  <button type="submit">
    Send
  </button>

</form>

<div id="commentsContainer"></div>
              `
              : ""
          }
          <span class="preview-label">${icon("play")} Trailer preview</span>
        </div>
      </div>
    </section>
  `;
}

function renderFilters() {
  const genres = [
  "All",
  ...(state.genres || [])
];
  const genreButtons = genres
    .map(
      (genre) => `
        <button class="pill-button ${genre === state.selectedGenre ? "active" : ""}" type="button" data-genre="${genre}">
          ${escapeHtml(genre)}
        </button>
      `
    )
    .join("");

  return `
    <div class="filter-panel" id="browse">
      <div class="chip-row">
        <span class="filter-label">${icon("filter")} Genres</span>
        ${genreButtons}
      </div>
      <select class="select-control" id="typeSelect" aria-label="Filter by type">
        ${["All", "Series", "Movie"]
          .map(
            (type) =>
              `<option value="${type}" ${type === state.selectedType ? "selected" : ""}>${type}</option>`
          )
          .join("")}
      </select>
    </div>
  `;
}   

function renderCard(anime) {
   const safeEpisodes = anime.episodes || [];
   const episode = safeEpisodes[0];
   const genreTags = (anime.genres || [])
    .slice(0, 3)
    .map((genre) => `<span>${escapeHtml(genre)}</span>`)
    .join("");
   
    if (!episode) {
    return `
      <article class="anime-card">
        <img
          src="${escapeHtml(assetUrl(anime.poster))}"
          alt="${escapeHtml(anime.title)}"
          loading="lazy"
          decoding="async"
        />

        <h3>${escapeHtml(anime.title)}</h3>
        <div class="genre-tags">${genreTags}</div>

        <p>No episodes available yet</p>
      </article>
    `;
  }
    const progress = Math.max(
    ...safeEpisodes.map((item) =>
      progressPercent(item.id)
    ),
    0
  );
  
   return `
    <article class="anime-card">
      <a class="poster-button"
         href="#details/${anime.slug}"
         aria-label="Open ${escapeHtml(anime.title)}">
         <img
          src="${escapeHtml(assetUrl(anime.poster))}"
          alt="${escapeHtml(anime.title)} poster"
          loading="lazy"
          decoding="async"
        />
               <span class="card-badge">
          ${icon("star")} ${anime.rating}
        </span>
      </a>

        <div>
        <h3>${escapeHtml(anime.title)}</h3>
        <div class="genre-tags">${genreTags}</div>
          <p>
          ${anime.type} /
          ${(anime.genres || []).slice(0, 2).join(" / ")}
        </p>
        <p>👁 ${anime.views || 0} views</p>
      </div>
       ${
        progress
          ? `
            <div class="progress-line"
                 aria-label="${progress}% watched"
                 style="--progress: ${progress}%">
              <span></span>
            </div>
          `
          : ""
      }
      <a class="ghost-button"
         href="#watch/${anime.slug}/${episode.id}">
        ${icon("play")} Watch
      </a>
    </article>
  `;
}

function continueWatchingItems() {
  normalizeRuntimeState();
  const entries = Object.values(state.progress)
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return entries
    .map((entry) => {
      const anime = state.anime.find((item) => item.slug === entry.animeSlug);
      if (!anime) return "";
      const episode = (anime.episodes||[]).find((item) => item.id === entry.episodeId);
      if (!episode) return "";
      const progress = progressPercent(episode.id);
      return `
        <article class="anime-card">
          <a class="poster-button" href="#watch/${anime.slug}/${episode.id}" aria-label="Continue ${escapeHtml(anime.title)}">
            <img src="${escapeHtml(assetUrl(anime.poster))}" alt="${escapeHtml(anime.title)} poster" loading="lazy" />
            <span class="card-badge">${icon("clock")} ${progress}%</span>
          </a>
          <div>
            <h3>${escapeHtml(anime.title)}</h3>
            <p>Episode ${episode.number}: ${escapeHtml(episode.title)}</p>
          </div>
          <div class="progress-line" style="--progress: ${progress}%"><span></span></div>
        </article>
      `;
    })
    .filter(Boolean);
}

function renderHome() {
  normalizeRuntimeState();
  const hero = selectedAnime();
  const trending = state.anime.slice(0, 6).map(renderCard).join("");
  const newest = state.anime
    .slice()
    .sort((left, right) => right.year - left.year)
    .map(renderCard)
    .join("");
  const continueItems = continueWatchingItems();
  startHeroSlider();

  app.innerHTML = `
    ${renderHero(hero)}
    <section class="content-band">
      ${renderAiFinder()}
      ${renderFilters()}
      ${
        continueItems.length
          ? `
            <div class="section-heading">
              <div>
                <h2>Continue Watching</h2>
                <p>Your saved progress across episodes.</p>
              </div>
            </div>
            <div class="rail">${continueItems.join("")}</div>
          `
          : ""
      }
      <div class="section-heading">
        <div>
          <h2>Trending Now</h2>
          <p>Fresh picks ranked by popularity.</p>
        </div>
      </div>
      <div class="rail">${trending || '<div class="empty-state"><p>No matches found.</p></div>'}</div>

      <div class="section-heading">
        <div>
          <h2>Browse All</h2>
          <p>Series, movies, cozy stories, action arcs, and new episodes.</p>
        </div>
      </div>
      <div class="grid">${newest || '<div class="empty-state"><p>No matches found.</p></div>'}</div>
    </section>
  `;
}

function renderListEmpty(tab) {
  const copy = {
    watchlist: ["Your Watchlist needs some love.", "Save a title and it will appear here."],
    history: ["Make history with history.", "Start watching to fill this feed."],
    downloads: ["No downloads yet.", "Downloads are a premium-ready placeholder in this build."],
    crunchylists: ["No custom lists yet.", "Create themed lists after you save more titles."]
  };
  const [title, body] = copy[tab] || copy.watchlist;
  return `
    <div class="mobile-empty">
      <div class="mobile-empty-art">${icon(tab === "downloads" ? "bookmark" : "sparkles")}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      <a class="primary-button wide" href="#browse">Browse All</a>
    </div>
  `;
}

function historyItems() {
  const entries = Object.values(state.progress)
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return entries
    .map((entry) => {
      const anime = state.anime.find((item) => item.slug === entry.animeSlug);
      if (!anime) return "";
      const episode = (anime.episodes || []).find((item) => item.id === entry.episodeId);
      return renderCard({ ...anime, episodes: episode ? [episode] : anime.episodes });
    })
    .filter(Boolean)
    .join("");
}

function renderMyList(tab = "watchlist") {
  normalizeRuntimeState();
  const activeTab = tab || "watchlist";
  const items = state.anime.filter((anime) => state.watchlist.includes(anime.slug));
  const tabContent =
    activeTab === "watchlist"
      ? items.map(renderCard).join("")
      : activeTab === "history"
        ? historyItems()
        : "";

  app.innerHTML = `
    <section class="mobile-page mobile-list-page" id="my-list">
      <div class="mobile-page-head">
        <h1>My Lists</h1>
        <div class="mobile-head-actions">
          <a href="#browse" aria-label="Search">${icon("search")}</a>
        </div>
      </div>
      <div class="mobile-tabs">
        <a class="${activeTab === "watchlist" ? "active" : ""}" href="#my-list/watchlist">Watchlist</a>
        <a class="${activeTab === "crunchylists" ? "active" : ""}" href="#my-list/crunchylists">ISKD Lists</a>
        <a class="${activeTab === "history" ? "active" : ""}" href="#my-list/history">History</a>
        <a class="${activeTab === "downloads" ? "active premium" : "premium"}" href="#my-list/downloads">${icon("star")} Downloads</a>
      </div>
      ${tabContent ? `<div class="mobile-poster-grid">${tabContent}</div>` : renderListEmpty(activeTab)}
    </section>
  `;
}

async function searchAnimeDatabase(query) {
  const clean = String(query || "").trim();
  state.animeDbQuery = clean;
  state.animeDbLoading = false;
  state.animeDbError = "";

  const source = asArray(state.anime);
  const words = clean.toLowerCase().split(/\s+/).filter(Boolean);
  state.animeDbResults = source
    .filter((item) => {
      if (!words.length) return true;
      const haystack = [
        item.title,
        item.japaneseTitle,
        item.tagline,
        item.synopsis,
        item.type,
        item.contentCategory,
        item.status,
        ...(item.genres || []),
        ...(item.languages || []),
        ...(item.studios || [])
      ]
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((left, right) => (right.views || 0) - (left.views || 0) || (right.popularity || 0) - (left.popularity || 0));

  if (clean && !state.animeDbResults.length) {
    state.animeDbError = "Tumhare uploaded database me ye title nahi mila. Upload page se Bunny/Cloudinary/YouTube URL add karo.";
  }
  renderBrowsePage("database");
}

function renderAnimeDatabasePanel() {
  const results = asArray(state.animeDbResults.length || state.animeDbQuery ? state.animeDbResults : state.anime);
  return `
    <section class="anime-db-panel">
      <div class="anime-db-copy">
        <p class="eyebrow">ISKD Uploaded Database</p>
        <h2>Search only your own uploaded anime, movies, series, and creator videos.</h2>
        <p class="muted">Ab search wahi content dikhata hai jo tumhare backend/database me video URL ke saath saved hai.</p>
      </div>
      <form class="anime-db-search" id="animeDbSearchForm">
        <input name="query" value="${escapeHtml(state.animeDbQuery)}" placeholder="Search your uploaded movies, anime, series" />
        <button class="primary-button" type="submit">${icon("search")} Search</button>
      </form>
      ${state.animeDbLoading ? '<div class="empty-state"><p>Searching anime database...</p></div>' : ""}
      ${state.animeDbError ? `<div class="empty-state"><p>${escapeHtml(state.animeDbError)}</p></div>` : ""}
      ${
        results.length
          ? `<div class="anime-db-grid">
              ${results
                .map((item) => {
                  const episode = asArray(item.episodes)[0];
                  const hasVideo = Boolean(episode?.video);
                  const target = hasVideo ? `#watch/${item.slug}/${episode.id}` : `#details/${item.slug}`;
                  const genres = asArray(item.genres).slice(0, 4);
                  return `
                    <article class="anime-db-card">
                      <img src="${escapeHtml(assetUrl(item.poster || item.backdrop))}" alt="${escapeHtml(item.title || "Content")} poster" loading="lazy" decoding="async" />
                      <div>
                        <h3>${escapeHtml(item.title || "Untitled")}</h3>
                        <p>${escapeHtml(item.type || item.contentCategory || "Video")} / ${escapeHtml(item.year || "Year N/A")} / ${Number(item.views || 0).toLocaleString()} views</p>
                        <div class="genre-tags">${genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join("")}</div>
                        <p>${escapeHtml(item.synopsis || item.tagline || "Uploaded content from your ISKD database.")}</p>
                        <a class="primary-button" href="${target}">${hasVideo ? `${icon("play")} Watch` : "Open details"}</a>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>`
          : !state.animeDbLoading && !state.animeDbError
            ? '<div class="empty-state"><p>No uploaded content yet. Upload Anime page se video URL add karo.</p></div>'
            : ""
      }
    </section>
  `;
}

function renderBrowsePage(section = "all") {
  normalizeRuntimeState();
  const items = state.anime.slice().sort((left, right) => (right.popularity || 0) - (left.popularity || 0));
  const active = section || "all";
  app.innerHTML = `
    <section class="mobile-page browse-page">
      <div class="mobile-page-head">
        <h1>${active === "simulcasts" ? "Simulcasts" : "Browse"}</h1>
        <div class="mobile-head-actions">
          <a href="#home" aria-label="Search">${icon("search")}</a>
        </div>
      </div>
      <div class="mobile-tabs">
        <a class="${active === "all" ? "active" : ""}" href="#browse/all">All Anime</a>
        <a class="${active === "simulcasts" ? "active" : ""}" href="#simulcasts">Simulcasts</a>
        <a class="${active === "genres" ? "active" : ""}" href="#browse/genres">Anime Genres</a>
        <a class="${active === "database" ? "active" : ""}" href="#browse/database">ISKD Database</a>
        <a class="${active === "music" ? "active" : ""}" href="#browse/music">Music</a>
      </div>
      <div class="browse-sort-row">
        <span>${active === "genres" ? "Genres" : active === "database" ? "ISKD Database" : "Popular"}</span>
        <div>${icon("filter")}</div>
      </div>
      ${
        active === "genres"
          ? `<div class="mobile-chip-cloud">${["Action", "Drama", "Fantasy", "Sci-Fi", "Music", "Movie", "South Movie", "Bollywood", "Hollywood"].map((item) => `<a href="#home" class="pill-button">${item}</a>`).join("")}</div>`
          : active === "database"
            ? renderAnimeDatabasePanel()
          : `<div class="mobile-poster-grid">${items.map(renderCard).join("")}</div>`
      }
    </section>
  `;
  scrollActiveMobileTabIntoView();
}

function scrollActiveMobileTabIntoView() {
  window.requestAnimationFrame(() => {
    const tabs = document.querySelector(".mobile-tabs");
    const active = tabs?.querySelector("a.active");
    if (!tabs || !active) return;
    const targetLeft = Math.max(0, active.offsetLeft - tabs.clientWidth * 0.28);
    tabs.scrollTo({ left: targetLeft, behavior: "auto" });
  });
}

function renderPremiumPage() {
  app.innerHTML = `
    <section class="premium-page">
      <a class="screen-close" href="#home" aria-label="Close">${icon("x")}</a>
      <h1>ISKD Premium</h1>
      <div class="premium-card">
        <span>FIRST YEAR PROMO</span>
        <div class="premium-mascot">${icon("star")}</div>
        <h2>Annual Mega Fan</h2>
        <strong>₹475.00/yr for 1 year</strong>
        <p>Ad-light viewing, early episode access, creator support tools, and premium downloads when enabled.</p>
        <ul>
          <li>No ads placeholder mode</li>
          <li>Unlimited access to your ISKD library</li>
          <li>New uploads and creator analytics</li>
        </ul>
      </div>
      <button class="primary-button wide" type="button" data-premium-demo>Subscribe with Discount</button>
      <a class="skip-link" href="#home">Skip for now</a>
    </section>
  `;
}

function renderAccountPage() {
  const user = state.user || currentLocalUser();
  const name = user ? displayNameFromUser() : "Guest";
  const email = user?.username?.includes("@") ? user.username : `${String(user?.username || "guest").toLowerCase()}@iskd.app`;
  app.innerHTML = `
    <section class="mobile-page account-page">
      <div class="mobile-page-head">
        <h1>My Account</h1>
        <button type="button" aria-label="Cast">${icon("cast")}</button>
      </div>
      <div class="profile-hero">
        ${renderAvatar("account-avatar big", user)}
        <h2>${escapeHtml(name)}</h2>
        <a href="#profiles">Edit profile</a>
      </div>
      <div class="settings-list">
        <a href="#profiles"><span>Switch Profile</span><b>›</b></a>
        <button type="button" data-toggle-demo><span>Profile Pin</span><i></i></button>
        <p>My Profile's Viewing Preferences</p>
        <a href="#premium"><span>Content Restrictions</span><small>U/A 16+</small><b>›</b></a>
        <a href="#account"><span>Audio Language</span><b>›</b></a>
        <a href="#account"><span>Subtitles/CC Language</span><small>English</small><b>›</b></a>
        <button type="button" data-toggle-demo class="on"><span>Closed Captions</span><i></i></button>
        <p>Membership</p>
        <a href="#premium"><span>Subscription</span><small>${isSubscribed() ? "Premium" : "Free"}</small><b>›</b></a>
        <a href="#account"><span>Email</span><small>${escapeHtml(email)}</small><b>›</b></a>
        <a href="#account"><span>Stream Using Cellular</span><i class="on"></i></a>
        <a href="#account"><span>Need Help?</span><b>›</b></a>
        ${user ? '<button type="button" data-logout-account><span>Log Out</span></button>' : '<a href="#login"><span>Log In</span><b>›</b></a>'}
      </div>
    </section>
  `;
}

function renderProfilesPage() {
  const user = state.user || currentLocalUser();
  const profileName = user ? displayNameFromUser() : "My Profile";
  app.innerHTML = `
    <section class="profile-page">
      <div class="screen-header">
        <a class="back-arrow" href="#account" aria-label="Back">&larr;</a>
        <h1>Edit Profile</h1>
      </div>
      <div class="profile-edit-hero">
        <label class="profile-photo-picker">
          ${renderAvatar("account-avatar big", user)}
          <input id="profilePhotoInput" type="file" accept="image/*" />
          <span>Edit photo</span>
        </label>
        <h2>${escapeHtml(profileName)}</h2>
      </div>
      <form class="profile-form" id="profileForm">
        <label>Profile Name<input name="profileName" value="${escapeHtml(profileName)}" /></label>
        <label>Username<input name="username" value="${escapeHtml(user?.username || "creator")}" /></label>
        <button class="primary-button wide" type="submit">Save</button>
      </form>
    </section>
  `;
  document.querySelector("#profilePhotoInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    setProfilePhoto(dataUrl);
    toast("Profile photo updated.");
    renderProfilesPage();
    updateAccountButton();
  });
  document.querySelector("#profileForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") || "").trim();
    if (username && state.user) {
      state.user.username = username;
      const stored = currentLocalUser();
      if (stored) {
        stored.username = username;
        localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(stored));
      }
    }
    updateAccountButton();
    toast("Profile saved on this device.");
    location.hash = "#account";
  });
}

function logoutAccount() {
  state.token = "";
  state.user = null;
  state.watchlist = [];
  state.progress = {};
  localStorage.removeItem("isdk_aime_token");
  closeAccountMenu();
  updateAccountButton();
  route();
}

function renderAuthFeaturePanel() {
  const feature = AUTH_FEATURES[state.authFeature] || AUTH_FEATURES.cloud;
  return `
    <article class="auth-feature-panel">
      <div>
        <p class="eyebrow">Live feature</p>
        <h2>${escapeHtml(feature.title)}</h2>
        <p class="muted">${escapeHtml(feature.body)}</p>
      </div>
      <a class="ghost-button" href="${feature.href}">${escapeHtml(feature.action)}</a>
    </article>
  `;
}

function renderAuthPage() {
  const isRegister = state.authMode === "register";
  const authImages = state.anime.length ? state.anime.slice(0, 5) : DEFAULT_ANIME.slice(0, 5);
  const imageSlides = authImages
    .map(
      (anime, index) =>
        `<span style="--auth-slide: url('${escapeHtml(assetUrl(anime.backdrop || anime.poster))}'); --slide-index: ${index};"></span>`
    )
    .join("");
  const posterWall = authImages
    .map(
      (anime, index) => `
        <img
          src="${escapeHtml(assetUrl(anime.poster || anime.backdrop))}"
          alt="${escapeHtml(anime.title)}"
          style="--poster-index: ${index};"
          loading="eager"
          decoding="async"
        />
      `
    )
    .join("");
  app.innerHTML = `
    <section class="auth-page mobile-auth-screen">
      <div class="auth-slideshow" aria-hidden="true">${imageSlides}</div>
      <div class="screen-header">
        <a class="back-arrow" href="#home" aria-label="Back">&larr;</a>
        <img class="auth-logo" src="/assets/logo.svg" alt="ISKD Anime" />
      </div>
      <div class="auth-cinema-panel" aria-hidden="true">
        <div class="auth-poster-wall">${posterWall}</div>
        <div class="auth-brand-copy">
          <p>AI powered OTT universe</p>
          <h2>Anime, movies, series and creator videos in one cinematic world.</h2>
          <div>
            <span>4K ready</span>
            <span>Bunny Stream</span>
            <span>Creator Studio</span>
          </div>
        </div>
      </div>
      <form class="auth-card" id="pageAuthForm">
        <h1>${isRegister ? "Create Account" : "Sign In"}</h1>
        <label>
          Email or Username
          <input name="username" required minlength="3" autocomplete="username" placeholder="you@example.com" />
        </label>
        <label>
          Password
          <input name="password" required minlength="6" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" placeholder="Minimum 6 characters" />
        </label>
        <button class="primary-button glow-button wide" type="submit">${isRegister ? "Create Account" : "Sign In"}</button>
        <button class="text-switch" type="button" data-page-auth-mode="${isRegister ? "login" : "register"}">
          ${isRegister ? "Already have an account? SIGN IN" : "New here? SIGN UP"}
        </button>
        <p class="firebase-note">By continuing you agree to ISKD Anime terms and privacy rules. Login works on web, localhost, and APK fallback.</p>
        <p id="pageAuthMessage" class="form-message" role="status"></p>
      </form>
    </section>
  `;
  bindAuthPage();
}

function bindAuthPage() {
  const form = document.querySelector("#pageAuthForm");
  const message = document.querySelector("#pageAuthMessage");
  const modeButtons = Array.from(document.querySelectorAll("[data-page-auth-mode]"));
  const featureButtons = Array.from(document.querySelectorAll("[data-auth-feature]"));

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.authMode = button.dataset.pageAuthMode;
      renderAuthPage();
    });
  });

  featureButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.authFeature = button.dataset.authFeature || "cloud";
      renderAuthPage();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = state.authMode === "register" ? "Creating account..." : "Signing in...";

    const formData = new FormData(form);
    const payload = {
      username: formData.get("username"),
      password: formData.get("password")
    };

    try {
      const data = await api.post(`/api/auth/${state.authMode}`, payload);
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("isdk_aime_token", data.token);
      await loadUserState();
      toast(`Signed in as ${state.user.username}.`);
      updateAccountButton();
      location.hash = "#home";
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

async function renderSubscribePage(section = "earn") {
  const stats = subscriptionStats();
  const overview = await loadStudioOverview();
  const totals = overview.totals || {};
  const users = asArray(overview.users);
  const topAnime = asArray(overview.topAnime);
  const recentComments = asArray(overview.recentComments);
  const storage = overview.storage || localStudioOverview().storage;
  const status = effectiveMonetizationStatus(stats);
  const statusClass = status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const channelMonetized = status === "Monetized" || status === "Live";
  const canApply = stats.meetsAudienceRequirements;
  const canGoLive = canApply && channelMonetized;
  const subscriberPercent = Math.min(100, Math.round((stats.subscribers / stats.subscriberGoal) * 100));
  const viewPercent = Math.min(100, Math.round((stats.views / stats.viewGoal) * 100));
  const primaryReviewLabel = status === "Live"
    ? "Monetization live"
    : status === "Monetized"
      ? "Turn on monetization"
      : status === "Under review"
        ? "Approve channel monetization"
        : "Apply for review";
  const lockedMessage =
    "Monetization unlocks only after 1,000 subscribers, 2,000,000 views, and channel approval.";
  const activeSection = ["earn", "content", "audience", "analytics", "settings"].includes(section)
    ? section
    : "earn";
  const sectionTitles = {
    earn: ["Channel monetization", "Earn", "YouTube Studio style monetization page. Pehle eligibility complete hogi, phir review, phir channel monetized, uske baad revenue live hoga."],
    content: ["Channel content", "Content", "Apne uploaded anime, episodes, views, likes aur monetization readiness yahan manage karo."],
    audience: ["Channel audience", "Audience", "Subscribers, returning viewers, engagement aur channel growth yahan track hoti hai."],
    analytics: ["Channel analytics", "Analytics", "Views, likes, watch hours aur locked/live revenue ka studio overview."],
    settings: ["Studio settings", "Settings", "Monetization policy, review status aur channel setup controls."]
  };
  const [eyebrow, title, description] = sectionTitles[activeSection];
  const animeRows = state.anime.slice(0, 8);
  const studioBody = activeSection === "earn"
    ? `
        <div class="studio-tabs" role="tablist" aria-label="Monetization sections">
          <button class="active" type="button">Overview</button>
          <button type="button">Watch page ads</button>
          <button type="button">Supers</button>
          <button type="button">Memberships</button>
        </div>

        <div class="eligibility-grid">
          <article class="eligibility-card">
            <div class="eligibility-head">
              <h2>Subscribers</h2>
              <strong>${subscriberPercent}%</strong>
            </div>
            <div class="goal-bar" style="--progress: ${subscriberPercent}%"><span></span></div>
            <p>${stats.subscribers.toLocaleString()} of ${stats.subscriberGoal.toLocaleString()} subscribers</p>
          </article>
          <article class="eligibility-card">
            <div class="eligibility-head">
              <h2>Public views</h2>
              <strong>${viewPercent}%</strong>
            </div>
            <div class="goal-bar" style="--progress: ${viewPercent}%"><span></span></div>
            <p>${stats.views.toLocaleString()} of ${stats.viewGoal.toLocaleString()} views</p>
          </article>
        </div>

        <div class="studio-steps">
          <article>
            <span class="step-number">1</span>
            <div>
              <h3>Build audience</h3>
              <p>Reach 1,000 subscribers and 2,000,000 views before monetization opens.</p>
            </div>
            <strong>${stats.meetsAudienceRequirements ? "Done" : "Locked"}</strong>
          </article>
          <article>
            <span class="step-number">2</span>
            <div>
              <h3>Channel review</h3>
              <p>Apply only after eligibility. Review approval marks the channel as monetized.</p>
            </div>
            <strong>${channelMonetized ? "Approved" : status === "Under review" ? "In review" : "Pending"}</strong>
          </article>
          <article>
            <span class="step-number">3</span>
            <div>
              <h3>Turn on monetization</h3>
              <p>Revenue stays locked until channel is approved and monetization is turned on.</p>
            </div>
            <strong>${status === "Live" ? "Live" : "Locked"}</strong>
          </article>
        </div>
      `
    : activeSection === "content"
      ? `
          <div class="studio-panel">
            <div class="panel-head">
              <div>
                <h2>Channel content</h2>
                <p class="muted">${Number(totals.anime || animeRows.length).toLocaleString()} titles in your catalog. Data source: ${escapeHtml(storage.mode)}.</p>
              </div>
              <a class="primary-button" href="#add-anime">Upload Anime</a>
            </div>
            <div class="studio-table">
              ${animeRows
                .map(
                  (anime) => `
                    <a class="studio-row" href="#details/${anime.slug}">
                      <img src="${escapeHtml(assetUrl(anime.poster))}" alt="${escapeHtml(anime.title)} poster" loading="lazy" decoding="async" />
                      <span>
                        <strong>${escapeHtml(anime.title)}</strong>
                        <small>${anime.type} / ${(anime.genres || []).slice(0, 2).join(" / ")}</small>
                      </span>
                      <span>${Number(anime.views || 0).toLocaleString()} views</span>
                      <span>${Number(anime.likes || 0).toLocaleString()} likes</span>
                      <span>${anime.createdBy ? "Creator" : "Catalog"}</span>
                    </a>
                  `
                )
                .join("")}
            </div>
          </div>
        `
      : activeSection === "audience"
        ? `
            <div class="eligibility-grid">
              <article class="eligibility-card">
                <div class="eligibility-head">
                  <h2>Subscribers</h2>
                  <strong>${stats.subscribers.toLocaleString()}</strong>
                </div>
                <div class="goal-bar" style="--progress: ${subscriberPercent}%"><span></span></div>
                <p>${stats.subscriberGoal.toLocaleString()} needed for monetization.</p>
              </article>
              <article class="eligibility-card">
                <div class="eligibility-head">
                  <h2>Engagement</h2>
                  <strong>${stats.likes.toLocaleString()}</strong>
                </div>
                <p>Total likes across your anime catalog.</p>
              </article>
            </div>
            <div class="studio-panel">
              <div class="panel-head">
                <div>
                  <h2>Users using app</h2>
                  <p class="muted">${users.length ? `${users.length} account(s) found.` : "No signed-in users found on this storage yet."}</p>
                </div>
                <a class="ghost-button" href="#subscribe/settings">Data location</a>
              </div>
              <div class="studio-table">
                ${
                  users.length
                    ? users
                        .map(
                          (item) => `
                            <div class="studio-row user-row">
                              <span class="user-avatar">${escapeHtml(String(item.username || "U").slice(0, 1).toUpperCase())}</span>
                              <span>
                                <strong>${escapeHtml(item.username || "Unknown user")}</strong>
                                <small>${escapeHtml(item.id || "")}</small>
                              </span>
                              <span>${Number(item.watchlistCount || 0)} saved</span>
                              <span>${Number(item.progressCount || 0)} progress</span>
                              <span>${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "New"}</span>
                            </div>
                          `
                        )
                        .join("")
                    : '<div class="empty-state compact-empty"><p>Login/signup hone ke baad users yahan dikhenge.</p></div>'
                }
              </div>
            </div>
            <div class="studio-panel">
              <h2>Audience growth</h2>
              <p class="muted">Channel subscribers badhane ke liye naye anime upload karo, player share karo, aur audience ko watchlist/like ke liye guide karo.</p>
              <div class="action-row">
                <a class="ghost-button" href="#add-anime">Upload content</a>
                <a class="ghost-button" href="#watch/neon-ronin/neon-ronin-01">Preview watch page</a>
              </div>
            </div>
          `
        : activeSection === "analytics"
          ? `
              <div class="creator-metrics studio-wide-metrics">
                <article><span>Views</span><strong>${Number(totals.views || stats.views).toLocaleString()}</strong><small>Total catalog views</small></article>
                <article><span>Users</span><strong>${Number(totals.users || users.length).toLocaleString()}</strong><small>Signed-in accounts</small></article>
                <article><span>Likes</span><strong>${Number(totals.likes || stats.likes).toLocaleString()}</strong><small>Total likes</small></article>
                <article><span>Revenue</span><strong>${status === "Live" ? `Rs ${stats.estimate.toLocaleString()}` : "Locked"}</strong><small>${status === "Live" ? "Live" : "Eligibility required"}</small></article>
              </div>
              <div class="studio-panel">
                <h2>Analytics summary</h2>
                <p class="muted">Revenue tab locked rahega jab tak channel 1,000 subscribers, 2,000,000 views aur approval complete nahi karta.</p>
              </div>
              <div class="studio-panel">
                <h2>Top anime</h2>
                <div class="studio-table">
                  ${
                    topAnime.length
                      ? topAnime
                          .map(
                            (item) => `
                              <a class="studio-row analytics-row" href="#details/${item.slug}">
                                <span class="rank-dot">${Number(item.views || 0).toLocaleString()}</span>
                                <span>
                                  <strong>${escapeHtml(item.title || item.slug)}</strong>
                                  <small>${escapeHtml(item.createdByName || "Catalog")}</small>
                                </span>
                                <span>${Number(item.views || 0).toLocaleString()} views</span>
                                <span>${Number(item.likes || 0).toLocaleString()} likes</span>
                                <span>Open</span>
                              </a>
                            `
                          )
                          .join("")
                      : '<div class="empty-state compact-empty"><p>No analytics yet.</p></div>'
                  }
                </div>
              </div>
            `
          : `
              <div class="studio-panel">
                <h2>Monetization settings</h2>
                <div class="settings-list">
                  <label><input type="checkbox" checked disabled /> Public watch page enabled</label>
                  <label><input type="checkbox" ${stats.meetsAudienceRequirements ? "checked" : ""} disabled /> Eligibility requirements complete</label>
                  <label><input type="checkbox" ${channelMonetized ? "checked" : ""} disabled /> Channel review approved</label>
                  <label><input type="checkbox" ${status === "Live" ? "checked" : ""} disabled /> Monetization turned on</label>
                </div>
                <button class="primary-button" type="button" ${canApply ? "data-monetization-review" : "data-eligibility-details"}>
                  ${canApply ? primaryReviewLabel : "Need 1K subs + 2M views"}
                </button>
              </div>
              <div class="studio-panel">
                <h2>Data location</h2>
                <div class="data-location">
                  <p><strong>Mode:</strong> ${escapeHtml(storage.mode || "unknown")}</p>
                  <p><strong>Database:</strong> ${escapeHtml(storage.dbPath || "")}</p>
                  <p><strong>Uploads:</strong> ${escapeHtml(storage.uploadDir || "")}</p>
                  <p><strong>Note:</strong> ${escapeHtml(storage.note || "")}</p>
                </div>
              </div>
              <div class="studio-panel">
                <h2>Recent comments</h2>
                <div class="studio-table">
                  ${
                    recentComments.length
                      ? recentComments
                          .map(
                            (item) => `
                              <div class="studio-row comment-row">
                                <span class="user-avatar">${escapeHtml(String(item.user || "U").slice(0, 1).toUpperCase())}</span>
                                <span>
                                  <strong>${escapeHtml(item.user || "Unknown")}</strong>
                                  <small>${escapeHtml(item.body || "")}</small>
                                </span>
                                <span>${escapeHtml(item.episodeId || "")}</span>
                                <span>${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</span>
                                <span>Comment</span>
                              </div>
                            `
                          )
                          .join("")
                      : '<div class="empty-state compact-empty"><p>No comments yet.</p></div>'
                  }
                </div>
              </div>
            `;

  app.innerHTML = `
    <section class="studio-monetization">
      <aside class="studio-sidebar" aria-label="Studio navigation">
        <strong>ISKD Studio</strong>
        <a class="${activeSection === "earn" ? "active" : ""}" href="#subscribe/earn">Earn</a>
        <a class="${activeSection === "content" ? "active" : ""}" href="#subscribe/content">Content</a>
        <a class="${activeSection === "audience" ? "active" : ""}" href="#subscribe/audience">Audience</a>
        <a class="${activeSection === "analytics" ? "active" : ""}" href="#subscribe/analytics">Analytics</a>
        <a class="${activeSection === "settings" ? "active" : ""}" href="#subscribe/settings">Settings</a>
      </aside>

      <div class="studio-workspace">
        <div class="studio-topbar">
          <div>
            <p class="eyebrow">${escapeHtml(eyebrow)}</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="muted">${escapeHtml(description)}</p>
          </div>
          <button class="primary-button" type="button" ${canApply ? "data-monetization-review" : "data-eligibility-details"}>
            ${canApply ? primaryReviewLabel : "Not eligible yet"}
          </button>
        </div>

        <div class="studio-alert ${canGoLive ? "ready" : "locked"}">
          <span class="status-dot ${statusClass}"></span>
          <div>
            <strong>${escapeHtml(status)}</strong>
            <p>${status === "Live" ? "Your channel monetization is active for your own content." : lockedMessage}</p>
          </div>
        </div>

        <div class="creator-metrics">
          <article>
            <span>Subscribers</span>
            <strong>${stats.subscribers.toLocaleString()}</strong>
            <small>${stats.subscriberGoal.toLocaleString()} required</small>
          </article>
          <article>
            <span>Total views</span>
            <strong>${stats.views.toLocaleString()}</strong>
            <small>${stats.viewGoal.toLocaleString()} required</small>
          </article>
          <article>
            <span>Review status</span>
            <strong>${channelMonetized ? "Approved" : status === "Under review" ? "In review" : "Pending"}</strong>
            <small>${channelMonetized ? "Channel monetized" : "Not monetized yet"}</small>
          </article>
          <article>
            <span>Estimated revenue</span>
          <strong>${status === "Live" ? `Rs ${stats.estimate.toLocaleString()}` : "Locked"}</strong>
          <small>${status === "Live" ? "Live earnings" : "Eligibility required"}</small>
        </article>
      </div>

        ${studioBody}

        <div class="creator-tools">
          <article>
            <h3>Eligibility Checklist</h3>
            <label><input type="checkbox" ${stats.subscribers >= stats.subscriberGoal ? "checked" : ""} disabled /> 1,000 subscribers required (${stats.subscribers.toLocaleString()}/${stats.subscriberGoal.toLocaleString()})</label>
            <label><input type="checkbox" ${stats.views >= stats.viewGoal ? "checked" : ""} disabled /> 2,000,000 views required (${stats.views.toLocaleString()}/${stats.viewGoal.toLocaleString()})</label>
            <label><input type="checkbox" ${channelMonetized ? "checked" : ""} disabled /> Channel monetized / approved</label>
            <label><input type="checkbox" ${status === "Live" ? "checked" : ""} disabled /> Monetization live</label>
          </article>
          <article>
            <h3>Creator Actions</h3>
            <a class="ghost-button" href="#add-anime">Upload Anime</a>
            <a class="ghost-button" href="#watch/neon-ronin/neon-ronin-01">Test Player</a>
            <button class="primary-button" type="button" ${canApply ? "data-monetization-review" : "data-eligibility-details"}>
              ${canApply ? primaryReviewLabel : "Need 1K subs + 2M views"}
            </button>
          </article>
        </div>
      </div>
    </section>
  `;
}

function renderAddAnime() {
  app.innerHTML = `
    <section class="content-band add-anime-page">
      <div class="section-heading">
        <div>
          <h2>Add Your Content</h2>
          <p>${state.user ? `Upload anime, South movie, Bollywood, Hollywood, web series, or your own videos as ${escapeHtml(state.user.username)}.` : "Sign in first, then add your own content."}</p>
        </div>
        ${!state.user ? '<button class="primary-button" type="button" data-open-auth>Sign in</button>' : ""}
      </div>
      ${
        state.user
          ? `
            <form class="creator-form" id="addAnimeForm">
              <div class="form-grid">
                <label>
                  Content title
                  <input name="title" required maxlength="90" placeholder="Example: Shadow School, Action Movie" />
                </label>
                <label>
                  Alternate title
                  <input name="japaneseTitle" maxlength="90" placeholder="Optional" />
                </label>
                <label>
                  Content category
                  <select name="contentCategory">
                    <option value="Anime">Anime</option>
                    <option value="South Movie">South Movie</option>
                    <option value="Bollywood">Bollywood</option>
                    <option value="Hollywood">Hollywood</option>
                    <option value="Web Series">Web Series</option>
                    <option value="Shorts">Shorts</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label>
                  Type
                  <select name="type">
                    <option value="Series">Series</option>
                    <option value="Movie">Movie</option>
                  </select>
                </label>
                <label>
                  Year
                  <input name="year" type="number" min="1950" max="2100" value="2026" />
                </label>
                <label>
                  Maturity
                  <select name="maturity">
                    <option>All</option>
                    <option>10+</option>
                    <option selected>13+</option>
                    <option>16+</option>
                    <option>18+</option>
                  </select>
                </label>
                <label>
                  Languages
                  <input name="languages" placeholder="Sub, Dub" value="Sub" />
                </label>
                <label>
                  Studio name
                  <input name="studio" maxlength="60" placeholder="${escapeHtml(state.user.username)} Studio" />
                </label>
                <label>
                  Genres / tags
                  <input name="genres" required placeholder="Action, Comedy, Drama, Hindi, Dubbed" />
                </label>
                <label>
                  Poster image path
                  <input type="file" id="posterFile" accept="image/*" />
                </label>
                <label>
                  Backdrop image path
                  <input type="file" id="backdropFile" accept="image/*" />
                </label>
              </div>
              <label>
                Tagline
                <input name="tagline" maxlength="160" placeholder="One sharp line for your anime" />
              </label>
              <label>
                Synopsis
                <textarea name="synopsis" required rows="5" maxlength="900" placeholder="Write the story summary"></textarea>
              </label>
              <div class="form-grid">
                <label>
                  Episode 1 title
                  <input name="episodeTitle" required maxlength="100" placeholder="The Beginning" />
                </label>
                <label>
                  Episode length in minutes
                  <input name="episodeDurationMinutes" type="number" min="1" max="180" value="24" />
                </label>
              </div>
              <label>
                Video URL (Bunny / Cloudinary / YouTube / Google Drive)
                <input name="episodeVideoUrl" placeholder="https://vz-xxxx.b-cdn.net/video-id/playlist.m3u8" />
              </label>
              <div class="form-grid">
                <label>
                  1080p video URL
                  <input name="episodeVideo1080" placeholder="Optional 1080p MP4/HLS URL" />
                </label>
                <label>
                  720p video URL
                  <input name="episodeVideo720" placeholder="Optional 720p MP4/HLS URL" />
                </label>
                <label>
                  480p video URL
                  <input name="episodeVideo480" placeholder="Optional 480p MP4/HLS URL" />
                </label>
              </div>
              <label>
                Upload MP4 video
                <input type="file" id="videoFile" accept="video/mp4,video/*" />
              </label>

<label>
  Episode 1 synopsis

  <textarea
    name="episodeSynopsis"
    rows="3"
    maxlength="400"
    placeholder="What happens in the first episode?"
  ></textarea>

</label>

<div id="episodesContainer"></div>

<button
  type="button"
  class="ghost-button"
  id="addEpisodeBtn"
>
  + Add Episode
</button>

<button class="primary-button" type="submit">
  Publish Anime
</button>
              
              <p id="creatorMessage" class="form-message" role="status"></p>
            </form>
          `
          : '<div class="empty-state"><p>Create or login to an account, then your anime will be saved into the catalog.</p></div>'
      }
    </section>
  `;

  bindAddAnimeForm();
}

function bindAddAnimeForm() {
  const form = document.querySelector("#addAnimeForm");
  const episodesContainer =
  document.querySelector("#episodesContainer");

const addEpisodeBtn =
  document.querySelector("#addEpisodeBtn");
  addEpisodeBtn?.addEventListener("click", () => {

  episodeCount++;

  const html = `
  
    <div class="extra-episode">

      <h3>
        Episode ${episodeCount}
      </h3>

      <input
        name="episodeTitle${episodeCount}"
        placeholder="Episode title"
      />

      <input
        type="file"
        id="videoFile${episodeCount}"
        accept="video/mp4"
      />

      <textarea
        name="episodeSynopsis${episodeCount}"
        placeholder="Episode synopsis"
      ></textarea>

    </div>
  `;

  episodesContainer.insertAdjacentHTML(
    "beforeend",
    html
  );

});

let episodeCount = 1;
  const message = document.querySelector("#creatorMessage");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Publishing...";

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const posterFile =
  document.querySelector("#posterFile").files[0];

const backdropFile =
  document.querySelector("#backdropFile").files[0];

let posterPath = "";
let backdropPath = "";
let posterPublicId = "";
let backdropPublicId = "";
let posterStorage = "";
let backdropStorage = "";

if (posterFile) {
  try {
    const uploaded = await uploadCreatorFile("/api/upload-image", "image", posterFile);
    posterPath = uploaded.path;
    posterPublicId = uploaded.publicId || "";
    posterStorage = uploaded.storage || "";
  } catch {
    posterPath = await fileToDataUrl(posterFile);
  }
}

if (backdropFile) {
  try {
    const uploaded = await uploadCreatorFile("/api/upload-image", "image", backdropFile);
    backdropPath = uploaded.path;
    backdropPublicId = uploaded.publicId || "";
    backdropStorage = uploaded.storage || "";
  } catch {
    backdropPath = await fileToDataUrl(backdropFile);
  }
}




const videoFile =
  document.querySelector("#videoFile").files[0];

let videoPath = String(payload.episodeVideoUrl || "").trim();
let videoPublicId = "";
let videoStorage = videoPath ? (isHlsUrl(videoPath) ? "bunny-hls" : "external-url") : "";

if (!videoPath && videoFile) {
  try {
    message.textContent = "Uploading video...";
    const uploaded = await uploadCreatorFile("/api/upload-video", "video", videoFile);
    videoPath = uploaded.path;
    videoPublicId = uploaded.publicId || "";
    videoStorage = uploaded.storage || "";
  } catch (error) {
    message.textContent = error.message || "Video upload failed.";
    return;
  }
}
 payload.poster = posterPath;
payload.backdrop = backdropPath;
payload.episodeVideo = videoPath;
payload.video = videoPath;
payload.episodeVideoQualities = [
  { label: "1080p", url: String(payload.episodeVideo1080 || "").trim() },
  { label: "720p", url: String(payload.episodeVideo720 || "").trim() },
  { label: "480p", url: String(payload.episodeVideo480 || "").trim() }
].filter((item) => item.url);
payload.posterPublicId = posterPublicId;
payload.backdropPublicId = backdropPublicId;
payload.episodeVideoPublicId = videoPublicId;
payload.posterStorage = posterStorage;
payload.backdropStorage = backdropStorage;
payload.episodeVideoStorage = videoStorage;

    try {
      const data = await api.post("/api/anime", payload);
      await loadAnime();
      const genres = await api.get("/api/genres");
      state.genres = asArray(genres.genres);
      toast("Anime published.");
      location.hash = `#details/${data.anime.slug}`;
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

async function renderDetails(slug) {
  await incrementAnimeView(slug);

  const anime = state.anime.find(item => item.slug === slug);

  if (!anime) {
    app.innerHTML = "<h1>Anime not found</h1>";
    return;
  }

  const safeEpisodes = anime.episodes || [];
  const firstEpisode = safeEpisodes[0];

  const saved = state.watchlist.includes(anime.slug);

  app.innerHTML = `
    <section class="content-band">
      <div class="detail-layout">
        <img class="detail-poster" src="${escapeHtml(assetUrl(anime.poster))}" alt="${escapeHtml(anime.title)} poster" />
        <div class="detail-copy">
          <p class="eyebrow">${anime.status} / ${(anime.studios || []).join(", ")}</p>
          <h1>${escapeHtml(anime.title)}</h1>
          <div class="meta-row">${renderMeta(anime)}</div>
          <p class="hero-tagline">${escapeHtml(anime.tagline)}</p>
          <p class="muted">${escapeHtml(anime.synopsis)}</p>
          <div class="chip-row">
            ${anime.genres.map((genre) => `<span class="pill-button">${escapeHtml(genre)}</span>`).join("")}
          </div>
          <div class="action-row">
            <a class="primary-button" href="#watch/${anime.slug}/${firstEpisode?.id || ''}">
              ${icon("play")} Watch episode 1
            </a>
            <button class="ghost-button" type="button" data-watchlist="${anime.slug}">
              ${icon("heart")} ${saved ? "In My List" : "Add to My List"}
            </button>
            <button class="ghost-button" type="button" data-like="${anime.slug}">
              ${userLiked(anime) ? "Unlike" : "Like"} (${anime.likes || 0})
            </button>

            <button
  class="danger-button"
  type="button"
  onclick="deleteAnime('${anime.slug}')"
>
  Delete Anime
</button>
          </div>
          <div class="section-heading">
            <div>
              <h2>Episodes</h2>
              <p>${(anime.episodes || []).length} available</p>
            </div>
          </div>
          <div class="episode-list">
            ${safeEpisodes
              .map(
                (episode) => `
                  <article class="episode-row">
                    <span class="episode-number">${episode.number}</span>
                    <div>
                      <h3>${escapeHtml(episode.title)}</h3>
                      <p>${escapeHtml(episode.synopsis)}</p>
                    </div>
                    <a class="ghost-button" href="#watch/${anime.slug}/${episode.id}">${icon("play")} Watch</a>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

async function renderWatch(slug, episodeId) {
  await incrementAnimeView(slug);
  const { anime } = await api.get(`/api/anime/${slug}`);
  const safeEpisodes = anime.episodes || [];
  const episode = (anime.episodes||[]).find((item) => item.id === episodeId) || anime.episodes[0];
  const savedProgress = state.progress[episode.id] || {
    position: 0,
    duration: episode.duration
  };
  const comments = await api.get(`/api/comments/${episode.id}`).catch(() => ({ comments: [] }));
  const watchPoster = assetUrl(anime.backdrop || anime.poster);
  const watchVideo = assetUrl(episode.video, "");
  const watchEmbed = embedVideoUrl(watchVideo);
  const qualityOptions = episodeQualityOptions(episode);

  app.innerHTML = `
    <section class="watch-layout">
      <div class="player-panel">
        <button class="watch-back-button" type="button" data-watch-back aria-label="Back">
          <span>&larr;</span>
        </button>
        <div class="player">
          ${
            episode.video
              ? watchEmbed
                ? `
      <iframe
        class="anime-video embed-video"
        src="${escapeHtml(watchEmbed)}"
        title="${escapeHtml(episode.title)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
              `
              : `
      <video
  id="animePlayer"
  class="anime-video"
  playsinline
  webkit-playsinline
  preload="metadata"
  poster="${escapeHtml(watchPoster)}"
  data-video-src="${escapeHtml(watchVideo)}"
  disablePictureInPicture
  controlsList="nodownload noplaybackrate"
></video>
                <button class="seek-zone seek-left" id="seekLeftBtn" type="button" aria-label="Back 10 seconds">
                  <span>-10s</span>
                </button>
                <button class="seek-zone seek-right" id="seekRightBtn" type="button" aria-label="Forward 10 seconds">
                  <span>+10s</span>
                </button>
                <button class="video-center-play" id="centerPlayBtn" type="button" aria-label="Play video">
                  ${icon("play")}
                </button>
                <div class="player-quick-controls" data-quick-video-controls>
                  <button id="quickBackBtn" type="button" aria-label="Back 10 seconds">-10</button>
                  <button class="quick-play" id="quickPlayBtn" type="button" aria-label="Play video">${icon("play")}</button>
                  <button id="quickForwardBtn" type="button" aria-label="Forward 10 seconds">+10</button>
                  <button id="quickFullBtn" type="button" aria-label="Fullscreen">Full</button>
                </div>
                <div class="custom-controls" data-video-controls>
                  <input class="video-progress" id="videoProgress" type="range" min="0" max="${episode.duration}" value="${Math.floor(savedProgress.position)}" aria-label="Video progress" />
                  <div class="control-row">
                    <button id="playPauseBtn" type="button" aria-label="Play or pause">${icon("play")}</button>
                    <button id="backwardBtn" type="button" aria-label="Back 10 seconds">-10s</button>
                    <button id="forwardBtn" type="button" aria-label="Forward 10 seconds">+10s</button>
                    <button id="muteBtn" type="button" aria-label="Mute video">Vol</button>
                    <span class="video-time" id="overlayTimeLabel">${formatDuration(savedProgress.position)} / ${formatDuration(episode.duration)}</span>
                    <button class="subscribe-control" id="subscribeBtn" type="button">${isSubscribed() ? "Subscribed" : "Subscribe"}</button>
                    <select class="quality-select" id="qualitySelect" aria-label="Video quality">
                      ${qualityOptions.map((item, index) => `<option value="${index}">${escapeHtml(item.label)}</option>`).join("")}
                    </select>
                    <button id="captionBtn" type="button" aria-label="Captions">CC</button>
                    <button id="settingsBtn" type="button" aria-label="Settings">Set</button>
                    <button id="wideBtn" type="button" aria-label="Wide view">Wide</button>
                    <button id="fullscreenBtn" type="button" aria-label="Fullscreen">Full</button>
                  </div>
                </div>
              `
              : `
                <img src="${escapeHtml(watchPoster)}" alt="${escapeHtml(anime.title)} scene" />
                <div class="player-overlay">
                  <button class="play-large" type="button" aria-label="Preview unavailable">
                    ${icon("play")}
                  </button>
                </div>
              `
          }
        </div>
        <div class="player-controls">
          <button class="ghost-button" type="button" data-save-progress>${icon("clock")} Save progress</button>
          <input class="range" id="progressRange" type="range" min="0" max="${episode.duration}" value="${Math.floor(savedProgress.position)}" />
          <span id="timeLabel">${formatDuration(savedProgress.position)} / ${formatDuration(episode.duration)}</span>
        </div>
        <div class="watch-copy">
          <p class="eyebrow">${anime.title} / Episode ${episode.number}</p>
          <h1>${escapeHtml(episode.title)}</h1>
          <div class="meta-row">${renderMeta(anime)}</div>
          <div class="action-row">
            <button class="ghost-button" type="button" data-like="${anime.slug}">
              ${userLiked(anime) ? "Unlike" : "Like"} (${anime.likes || 0})
            </button>
          </div>
          <p class="muted">${escapeHtml(episode.synopsis)}</p>
        </div>
        <section class="comment-panel">
          <h2>Episode Talk</h2>
          ${
            state.user
              ? `
                <form class="comment-form" id="commentForm">
                  <textarea name="body" rows="3" maxlength="280" placeholder="Share a quick reaction"></textarea>
                  <button class="primary-button" type="submit">Post comment</button>
                </form>
              `
              : '<button class="primary-button" type="button" data-open-auth>Sign in to comment</button>'
          }
          <div class="comments" id="commentsList">
            ${renderComments(comments.comments)}
          </div>
        </section>
      </div>
      <aside class="sidebar-panel">
        <h2>Episodes</h2>
        <div class="compact-episodes">
          ${safeEpisodes
            .map(
              (item) => `
                <a class="compact-episode ${item.id === episode.id ? "active" : ""}" href="#watch/${anime.slug}/${item.id}">
                  <strong>${item.number}. ${escapeHtml(item.title)}</strong>
                  <span class="muted">${formatDuration(item.duration)}</span>
                </a>
              `
            )
            .join("")}
        </div>
      </aside>
    </section>
  `;

  bindWatchControls(episode);
  
}

function renderComments(comments) {
  if (!comments.length) {
    return '<div class="empty-state"><p>No comments yet.</p></div>';
  }

  return comments
    .map(
      (comment) => `
        <article class="comment">
          <strong>${escapeHtml(comment.user)}</strong>
          <p>${escapeHtml(comment.body)}</p>
          <small>${new Date(comment.createdAt).toLocaleString()}</small>
        </article>
      `
    )
    .join("");
}

function bindWatchControls(episode) {
  const range = document.querySelector("#progressRange");
  const label = document.querySelector("#timeLabel");
  const video = document.querySelector("#animePlayer");
  const overlayProgress = document.querySelector("#videoProgress");
  const overlayLabel = document.querySelector("#overlayTimeLabel");
  const save = document.querySelector("[data-save-progress]");
  const form = document.querySelector("#commentForm");
  const centerPlayBtn = document.querySelector("#centerPlayBtn");
  const player = document.querySelector(".player");
  const customControls = document.querySelector("[data-video-controls]");
  const seekLeftBtn = document.querySelector("#seekLeftBtn");
  const seekRightBtn = document.querySelector("#seekRightBtn");
  const playPauseBtn = document.querySelector("#playPauseBtn");
  const backwardBtn = document.querySelector("#backwardBtn");
  const forwardBtn = document.querySelector("#forwardBtn");
  const muteBtn = document.querySelector("#muteBtn");
  const subscribeBtn = document.querySelector("#subscribeBtn");
  const qualitySelect = document.querySelector("#qualitySelect");
  const captionBtn = document.querySelector("#captionBtn");
  const settingsBtn = document.querySelector("#settingsBtn");
  const wideBtn = document.querySelector("#wideBtn");
  const fullscreenBtn = document.querySelector("#fullscreenBtn");
  const quickControls = document.querySelector("[data-quick-video-controls]");
  const quickBackBtn = document.querySelector("#quickBackBtn");
  const quickPlayBtn = document.querySelector("#quickPlayBtn");
  const quickForwardBtn = document.querySelector("#quickForwardBtn");
  const quickFullBtn = document.querySelector("#quickFullBtn");
  const progressInputs = [range, overlayProgress].filter(Boolean);
  const qualityOptions = episodeQualityOptions(episode);
  let isScrubbing = false;
  let selectedQualityUrl = String(episode.video || "").trim();

  const getDuration = () => {
    if (video && Number.isFinite(video.duration)) return Math.round(video.duration);
    return episode.duration;
  };

  const setLabels = (value) => {
    const text = `${formatDuration(value)} / ${formatDuration(getDuration())}`;
    if (label) label.textContent = text;
    if (overlayLabel) overlayLabel.textContent = text;
  };

  const syncProgress = (value) => {
    const duration = getDuration();
    progressInputs.forEach((input) => {
      input.max = duration;
      input.value = Math.min(duration, Math.max(0, value));
    });
    setLabels(Math.min(duration, Math.max(0, value)));
  };

  const seekTo = (value) => {
    if (!video) return;
    const duration = getDuration();
    const next = Math.min(duration, Math.max(0, Number(value) || 0));

    try {
      if (typeof video.fastSeek === "function") {
        video.fastSeek(next);
      } else {
        video.currentTime = next;
      }
    } catch {
      video.currentTime = next;
    }

    syncProgress(next);
  };

  const valueFromPointer = (input, event) => {
    const rect = input.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, ratio)) * getDuration());
  };

  const updatePlayUi = () => {
    if (!video) return;
    if (playPauseBtn) {
      playPauseBtn.innerHTML = video.paused ? icon("play") : "II";
      playPauseBtn.setAttribute("aria-label", video.paused ? "Play video" : "Pause video");
    }
    if (centerPlayBtn) {
      centerPlayBtn.classList.remove("is-hidden");
      centerPlayBtn.classList.toggle("is-playing", !video.paused);
      centerPlayBtn.innerHTML = icon("play");
      centerPlayBtn.setAttribute("aria-label", video.paused ? "Play video" : "Pause video");
    }
    if (quickPlayBtn) {
      quickPlayBtn.innerHTML = video.paused ? icon("play") : "II";
      quickPlayBtn.setAttribute("aria-label", video.paused ? "Play video" : "Pause video");
      quickPlayBtn.classList.toggle("playing", !video.paused);
    }
  };

  const seekBy = (seconds) => {
    if (!video) return;
    const duration = getDuration();
    seekTo(Math.min(duration, Math.max(0, video.currentTime + seconds)));
  };

  const togglePlayback = async () => {
    if (!video) return;
    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
      updatePlayUi();
    } catch (error) {
      toast(error.message || "Video could not play.");
    }
  };

  const loadSelectedQuality = async (url, label = "Auto") => {
    if (!video || !url) return;
    const wasPaused = video.paused;
    const position = Number(video.currentTime || range?.value || overlayProgress?.value || 0);
    selectedQualityUrl = url;
    await setupVideoSource(video, url);
    video.addEventListener(
      "loadedmetadata",
      () => {
        seekTo(Math.min(position, getDuration()));
        if (!wasPaused) video.play().catch(() => {});
      },
      { once: true }
    );
    toast(`Quality ${label}.`);
  };

  window.clearInterval(state.currentTimer);
  state.currentTimer = null;

  centerPlayBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePlayback();
  });
  playPauseBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePlayback();
  });
  quickPlayBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePlayback();
  });
  seekLeftBtn?.addEventListener("dblclick", () => seekBy(-10));
  seekRightBtn?.addEventListener("dblclick", () => seekBy(10));
  backwardBtn?.addEventListener("click", () => seekBy(-10));
  forwardBtn?.addEventListener("click", () => seekBy(10));
  quickBackBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    seekBy(-10);
  });
  quickForwardBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    seekBy(10);
  });

  ["click", "pointerdown", "pointerup", "touchstart", "touchend"].forEach((eventName) => {
    customControls?.addEventListener(eventName, (event) => event.stopPropagation());
    quickControls?.addEventListener(eventName, (event) => event.stopPropagation());
  });
  player?.addEventListener("click", (event) => {
    if (!video) return;
    if (event.target.closest("button, input, [data-video-controls]")) return;
    player.classList.toggle("controls-hidden");
  });

  muteBtn?.addEventListener("click", () => {
    if (!video) return;
    video.muted = !video.muted;
    muteBtn.textContent = video.muted ? "Mute" : "Vol";
  });

  subscribeBtn?.addEventListener("click", () => {
    subscribeBtn.textContent = toggleSubscribe() ? "Subscribed" : "Subscribe";
  });

  qualitySelect?.addEventListener("change", () => {
    if (qualitySelect.dataset.mode === "manual-hls") {
      if (qualitySelect.value === "manual-hls-auto") {
        loadSelectedQuality(episode.video, "Auto").catch(() => {});
        return;
      }
      if (qualitySelect.value.startsWith("manual-hls-")) {
        const index = Number(qualitySelect.value.replace("manual-hls-", ""));
        const item = asArray(window.__iskdHlsVariants)[index];
        if (item?.url) {
          loadSelectedQuality(item.url, item.label).catch((error) => {
            toast(error.message || "Quality switch failed.");
          });
        }
        return;
      }
    }
    if (qualitySelect.dataset.mode === "hls" && window.__iskdHls) {
      if (qualitySelect.value === "hls-auto") {
        window.__iskdHls.currentLevel = -1;
        toast("Quality Auto.");
        return;
      }
      if (qualitySelect.value.startsWith("hls-")) {
        const level = Number(qualitySelect.value.replace("hls-", ""));
        if (Number.isFinite(level)) {
          window.__iskdHls.currentLevel = level;
          toast(`Quality ${qualitySelect.selectedOptions[0]?.textContent || "selected"}.`);
        }
        return;
      }
    }
    const item = qualityOptions[Number(qualitySelect.value)];
    if (!item) return;
    loadSelectedQuality(item.url, item.label).catch((error) => {
      toast(error.message || "Quality switch failed.");
    });
  });

  captionBtn?.addEventListener("click", () => {
    captionBtn.classList.toggle("active");
    toast(captionBtn.classList.contains("active") ? "Captions on." : "Captions off.");
  });

  settingsBtn?.addEventListener("click", () => {
    if (!video) return;
    const speeds = [1, 1.25, 1.5, 2];
    const currentIndex = speeds.indexOf(video.playbackRate);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    video.playbackRate = nextSpeed;
    settingsBtn.textContent = `${nextSpeed}x`;
    toast(`Speed ${nextSpeed}x.`);
  });

  wideBtn?.addEventListener("click", () => {
    document.querySelector(".watch-layout")?.classList.toggle("wide-player");
  });

  fullscreenBtn?.addEventListener("click", async () => {
    const player = document.querySelector(".player");
    if (!player) return;
    if (!document.fullscreenElement) {
      await player.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  });
  quickFullBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const player = document.querySelector(".player");
    if (!player) return;
    if (!document.fullscreenElement) {
      await player.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  });

  progressInputs.forEach((input) => {
    ["click", "pointerdown", "pointerup", "touchstart", "touchend"].forEach((eventName) => {
      input.addEventListener(eventName, (event) => event.stopPropagation());
    });
    input.addEventListener("pointerdown", (event) => {
      isScrubbing = true;
      seekTo(valueFromPointer(input, event));
    });
    input.addEventListener("pointermove", (event) => {
      if (!isScrubbing) return;
      seekTo(valueFromPointer(input, event));
    });
    input.addEventListener("pointerup", (event) => {
      seekTo(valueFromPointer(input, event));
      isScrubbing = false;
    });
    input.addEventListener("pointercancel", () => {
      isScrubbing = false;
    });
    input.addEventListener("input", () => {
      isScrubbing = true;
      seekTo(input.value);
    });
    input.addEventListener("change", () => {
      seekTo(input.value);
      isScrubbing = false;
    });
  });

  if (video) {
    setupVideoSource(video, selectedQualityUrl || video.dataset.videoSrc || episode.video).catch((error) => {
      toast(error.message || "Streaming player failed to load.");
    });

    video.addEventListener("error", () => {
      player?.classList.add("video-load-error");
      if (centerPlayBtn) {
        centerPlayBtn.innerHTML = "!";
        centerPlayBtn.setAttribute("aria-label", "Video failed to load");
      }
      toast("Video file nahi mila ya stream load nahi hui. Bunny/HLS URL check karo.");
    });

    video.addEventListener("loadedmetadata", () => {
      player?.classList.remove("video-load-error");
      const start = Math.min(Number(range?.value || overlayProgress?.value || 0), getDuration());
      video.currentTime = start;
      syncProgress(start);
    });

    video.addEventListener("timeupdate", () => {
      if (isScrubbing) return;
      const value = Math.round(video.currentTime);
      syncProgress(value);
    });

    video.addEventListener("play", updatePlayUi);
    video.addEventListener("pause", updatePlayUi);
  }

  syncProgress(Number(range?.value || overlayProgress?.value || 0));
  updatePlayUi();

  save?.addEventListener("click", async () => {
    if (!state.user) {
      openAuthModal();
      return;
    }

    const data = await api.post(`/api/progress/${episode.id}`, {
      position: Number(range?.value || overlayProgress?.value || video?.currentTime || 0),
      duration: getDuration()
    });
      state.progress = asObject(data.progress);
    toast("Progress saved.");
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = new FormData(form).get("body");
    const data = await api.post(`/api/comments/${episode.id}`, { body });
    form.reset();
    document.querySelector("#commentsList").innerHTML = renderComments(data.comments);
  });
}



async function toggleWatchlist(slug) {
  if (!state.user) {
    openAuthModal();
    return;
  }

  const isSaved = state.watchlist.includes(slug);
  const data = isSaved
    ? await api.delete(`/api/watchlist/${slug}`)
    : await api.post(`/api/watchlist/${slug}`);
  state.watchlist = asArray(data.slugs);
  toast(isSaved ? "Removed from My List." : "Added to My List.");
  await route();
}

function openAuthModal() {
  const template = document.querySelector("#authTemplate");
  modalRoot.innerHTML = "";
  modalRoot.append(template.content.cloneNode(true));
  bindAuthModal();
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function bindAuthModal() {
  const form = document.querySelector("#authForm");
  const message = document.querySelector("#authMessage");
  const modeButtons = Array.from(document.querySelectorAll("[data-auth-mode]"));

  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === state.authMode);
    button.addEventListener("click", () => {
      state.authMode = button.dataset.authMode;
      bindAuthModal();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Working...";
    const formData = new FormData(form);
    const payload = {
      username: formData.get("username"),
      password: formData.get("password")
    };

    try {
      const data = await api.post(`/api/auth/${state.authMode}`, payload);
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("isdk_aime_token", data.token);
      await loadUserState();
      closeModal();
      toast(`Signed in as ${state.user.username}.`);
      updateAccountButton();
      await route();
    } catch (error) {
      message.textContent = error.message;
    }
  });
}

async function route() {
  const [view, slug, episodeId] = location.hash.replace(/^#\/?/, "").split("/");
  document.querySelector("#app")?.focus({ preventScroll: true });
  document.body.classList.toggle(
    "auth-mode",
    view === "login" || view === "signup" || view === "premium" || view === "profiles"
  );
  document.body.classList.toggle("watch-mode", view === "watch");
  updateMobileTabs();
  if (view && view !== "home") {
    window.clearInterval(state.heroTimer);
    state.heroTimer = null;
  }

  try {
    if (view === "add-anime") {
      renderAddAnime();
      return;
    }

    if (view === "login" || view === "signup") {
      state.authMode = view === "signup" ? "register" : "login";
      renderAuthPage();
      return;
    }

    if (view === "details" && slug) {
      await renderDetails(slug);
      return;
    }

    if (view === "watch" && slug) {
      await renderWatch(slug, episodeId);
      return;
    }

    if (view === "my-list") {
      renderMyList(slug || "watchlist");
      return;
    }

    if (view === "browse") {
      renderBrowsePage(slug || "all");
      return;
    }

    if (view === "simulcasts") {
      renderBrowsePage("simulcasts");
      return;
    }

    if (view === "account") {
      renderAccountPage();
      return;
    }

    if (view === "profiles") {
      renderProfilesPage();
      return;
    }

    if (view === "premium") {
      renderPremiumPage();
      return;
    }

    if (view === "subscribe") {
      renderSubscribePage(slug || "earn");
      return;
    }

    renderHome();
  } catch (error) {
    app.innerHTML = `<section class="content-band"><div class="empty-state"><p>${escapeHtml(error.message)}</p></div></section>`;
  }
}

function bindGlobalEvents() {
  searchInput.addEventListener("input", async (event) => {
    state.search = event.target.value.trim();
    await loadAnime();
    const [view, section] = location.hash.replace(/^#\/?/, "").split("/");
    if (view === "browse" && section === "database") {
      searchAnimeDatabase(state.search);
      return;
    }
    if (view === "browse" || view === "simulcasts") {
      renderBrowsePage(view === "simulcasts" ? "simulcasts" : section || "all");
      return;
    }
    if (!view || view === "home") {
      renderHome();
    }
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    state.animeDbQuery = query;
    location.hash = "#browse/database";
    searchAnimeDatabase(query);
  });

  authButton.addEventListener("click", () => {
    if (state.user) {
      state.accountMenuOpen = !state.accountMenuOpen;
      renderAccountMenu();
      return;
    }
    location.hash = "#login";
  });

  document.addEventListener("click", async (event) => {
    const watchlistButton = event.target.closest("[data-watchlist]");
    if (watchlistButton) {
      await toggleWatchlist(watchlistButton.dataset.watchlist);
      return;
    }

    const accountRoute = event.target.closest("[data-account-route]");
    if (accountRoute) {
      event.preventDefault();
      const href = accountRoute.getAttribute("href") || "#home";
      closeAccountMenu();
      location.hash = href;
      return;
    }

    if (event.target.closest("[data-logout-account]")) {
      logoutAccount();
      return;
    }

    if (event.target.closest("[data-watch-back]")) {
      event.preventDefault();
      if (window.history.length > 1) {
        window.history.back();
      } else {
        location.hash = "#home";
      }
      return;
    }

    if (event.target.closest("[data-premium-demo]")) {
      localStorage.setItem(SUBSCRIBE_KEY, "1");
      toast("Premium enabled for demo.");
      location.hash = "#account";
      return;
    }

    const toggleDemo = event.target.closest("[data-toggle-demo]");
    if (toggleDemo) {
      toggleDemo.classList.toggle("on");
      toast(toggleDemo.classList.contains("on") ? "Setting enabled." : "Setting disabled.");
      return;
    }

    if (
      state.accountMenuOpen &&
      !event.target.closest("#accountMenu") &&
      !event.target.closest("#authButton")
    ) {
      closeAccountMenu();
    }

    const likeButton = event.target.closest("[data-like]");
    if (likeButton) {
      await toggleAnimeLike(likeButton.dataset.like);
      return;
    }

    const heroSlideButton = event.target.closest("[data-hero-slide]");
    if (heroSlideButton) {
      state.heroIndex = Number(heroSlideButton.dataset.heroSlide || 0);
      renderHome();
      return;
    }

    const eligibilityButton = event.target.closest("[data-eligibility-details]");
    if (eligibilityButton) {
      const stats = subscriptionStats();
      const subscriberLeft = Math.max(0, stats.subscriberGoal - stats.subscribers);
      const viewLeft = Math.max(0, stats.viewGoal - stats.views);
      toast(`Not eligible: ${subscriberLeft.toLocaleString()} subscribers aur ${viewLeft.toLocaleString()} views abhi baaki hain.`);
      if (location.hash.replace(/^#\/?/, "").split("/")[0] === "subscribe") {
        await renderSubscribePage("settings");
      } else {
        location.hash = "#subscribe/settings";
      }
      return;
    }

    const reviewButton = event.target.closest("[data-monetization-review]");
    if (reviewButton) {
      const stats = subscriptionStats();
      const status = effectiveMonetizationStatus(stats);
      if (reviewButton.disabled) {
        toast("Need 1,000 subscribers and 2,000,000 views first.");
        return;
      }
      if (!stats.meetsAudienceRequirements) {
        toast("Monetization locked until 1K subscribers and 2M views.");
        return;
      }
      if (status === "Live") {
        toast("Monetization is already live.");
      } else if (status === "Monetized") {
        setMonetizationStatus("Live");
      } else if (status === "Under review") {
        setMonetizationStatus("Monetized");
      } else {
        setMonetizationStatus("Under review");
      }
      await renderSubscribePage(location.hash.replace(/^#\/?/, "").split("/")[1] || "earn");
      return;
    }

    const genreButton = event.target.closest("[data-genre]");
    if (genreButton) {
      state.selectedGenre = genreButton.dataset.genre;
      await loadAnime();
      renderHome();
      return;
    }

    if (event.target.closest("[data-open-auth]")) {
      openAuthModal();
      return;
    }

    if (event.target.matches("[data-close-modal]")) {
      closeModal();
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.matches("#typeSelect")) {
      state.selectedType = event.target.value;
      await loadAnime();
      renderHome();
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.matches("#animeDbSearchForm")) {
      event.preventDefault();
      const query = String(new FormData(event.target).get("query") || "").trim();
      searchAnimeDatabase(query);
      return;
    }

    if (event.target.matches("#aiFinderForm")) {
      event.preventDefault();
      state.aiQuery = String(new FormData(event.target).get("query") || "").trim();
      renderHome();
    }
  });

  window.addEventListener("hashchange", route);
}

async function init() {
  app.innerHTML = renderSkeletonShell();
  document.body.classList.add("auth-mode", "booting");
  const genres = await api.get("/api/genres");
  state.genres = asArray(genres.genres);
  await loadAnime();
  await loadUserState();
  normalizeRuntimeState();
  updateAccountButton();
  bindGlobalEvents();
  await new Promise((resolve) => window.setTimeout(resolve, 850));
  document.body.classList.remove("booting");
  const firstView = currentRouteView();
  if (!state.user && !["login", "signup"].includes(firstView)) {
    location.hash = "#login";
    return;
  }
  await route();
}

init().catch((error) => {
  app.innerHTML = `<section class="content-band"><div class="empty-state"><p>${escapeHtml(error.message)}</p></div></section>`;
});
