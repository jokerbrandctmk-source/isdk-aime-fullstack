const rootWindow = typeof window !== "undefined" ? window : globalThis;

function getConfiguredApiBaseUrl() {
  const configuredBase = String(rootWindow.ISKD_CONFIG?.apiBaseUrl || "").trim();
  if (configuredBase) {
    return configuredBase.replace(/\/+$/, "");
  }

  const currentOrigin = String(rootWindow.location?.origin || "").trim();
  return currentOrigin && !/^about:|^chrome-extension:/i.test(currentOrigin)
    ? currentOrigin
    : "";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeAnimeEntry(anime) {
  const title = String(anime?.title || anime?.name || "Untitled Anime").trim();
  const slug = String(anime?.slug || slugify(title) || "anime").trim();

  return {
    id: anime?.id || slug,
    slug,
    title,
    japaneseTitle: anime?.japaneseTitle || title,
    tagline: anime?.tagline || anime?.genre || "Anime",
    synopsis: anime?.synopsis || anime?.description || "",
    type: anime?.type || "Series",
    status: anime?.status || "Released",
    year: Number(anime?.year || new Date().getFullYear()),
    rating: Number(anime?.rating || 4.5),
    genres: Array.isArray(anime?.genres)
      ? anime.genres.filter(Boolean)
      : [anime?.genre || "Action"].filter(Boolean),
    poster: anime?.poster || anime?.image || "/assets/anime/ff-image.jpg",
    backdrop: anime?.backdrop || anime?.poster || anime?.image || "/assets/anime/ff-image.jpg",
    logo: anime?.logo || anime?.poster || anime?.image || "/assets/anime/ff-image.jpg",
    views: Number(anime?.views || 0),
    likes: Number(anime?.likes || 0),
    likedBy: Array.isArray(anime?.likedBy) ? anime.likedBy : [],
    popularity: Number(anime?.popularity || 0),
    episodes: Array.isArray(anime?.episodes)
      ? anime.episodes.map((episode, index) => ({
          id: episode?.id || `${slug}-${index + 1}`,
          title: episode?.title || `${title} Episode ${index + 1}`,
          number: Number(episode?.number || index + 1),
          duration: episode?.duration || 1440,
          thumbnail: episode?.thumbnail || anime?.poster || "/assets/anime/ff-image.jpg",
          video: episode?.video || ""
        }))
      : []
  };
}



// =========================
// FETCH ANIME
// =========================

export async function fetchAnime() {

  try {

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/anime?select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();

    return data.map((anime) => ({

      id: anime.id,

      slug: anime.title
        .toLowerCase()
        .replace(/\s+/g, "-"),

      title: anime.title,

      japaneseTitle: anime.title,

      tagline: anime.genre || "Anime",

      synopsis: anime.description || "",

      type: "Movie",

      status: "Released",

      year: 2026,

      rating: Number(anime.rating || 4.5),

      genres: [
        anime.genre || "Action"
      ],

      poster:
        anime.poster ||
        "https://res.cloudinary.com/dapefcqud/image/upload/v1/default-anime.jpg",

      backdrop:
        anime.poster ||
        "https://res.cloudinary.com/dapefcqud/image/upload/v1/default-anime.jpg",

      logo:
        anime.poster ||
        "https://res.cloudinary.com/dapefcqud/image/upload/v1/default-anime.jpg",

      views: 0,

      likes: 0,

      likedBy: [],

      episodes: [
        {
          id: `${anime.id}-ep1`,

          title: anime.title,

          number: 1,

          duration: "24:15",

          thumbnail: anime.poster,

          video: anime.video
        }
      ]

    }));

  } catch (error) {

    console.error(
      "Supabase Fetch Error:",
      error
    );

    return [];
  }
}



// =========================
// ADD COMMENT
// =========================

export async function addComment(
  animeId,
  username,
  comment
) {

  try {

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/comments`,
      {
        method: "POST",

        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },

        body: JSON.stringify({
          anime_id: animeId,
          username,
          comment
        })
      }
    );

    if (!response.ok) {

      const err =
        await response.text();

      console.error(err);

      throw new Error(err);
    }

  } catch (error) {

    console.error(
      "Add Comment Error:",
      error
    );
  }
}



// =========================
// FETCH COMMENTS
// =========================

export async function fetchComments(
  animeId
) {

  try {

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/comments?anime_id=eq.${animeId}&select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return await response.json();

  } catch (error) {

    console.error(
      "Fetch Comments Error:",
      error
    );

    return [];
  }
}



// =========================
// LOAD COMMENTS UI
// =========================

const commentForm =
  document.querySelector("#commentForm");

const commentInput =
  document.querySelector("#commentInput");

const commentsContainer =
  document.querySelector("#commentsContainer");

const CURRENT_ANIME_ID =
  "global-anime";



async function loadComments(
  animeId
) {

  const comments =
    await fetchComments(animeId);

  if (!commentsContainer) return;

  commentsContainer.innerHTML =
    (comments || []).map(comment => `

      <div class="comment-card">

        <h4>${comment.username}</h4>

        <p>${comment.comment}</p>

      </div>

    `).join("");
}



// =========================
// COMMENT SUBMIT
// =========================

commentForm?.addEventListener(
  "submit",
  async (e) => {

    e.preventDefault();

    const username =
      localStorage.getItem("username")
      || "Anime Fan";

    const comment =
      commentInput.value.trim();

    if (!comment) return;

    await addComment(
      CURRENT_ANIME_ID,
      username,
      comment
    );

    commentInput.value = "";

    await loadComments(
      CURRENT_ANIME_ID
    );
  }
);



// =========================
// INITIAL LOAD
// =========================

loadComments(
  CURRENT_ANIME_ID
);