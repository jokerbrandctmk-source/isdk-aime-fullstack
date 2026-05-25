

const SUPABASE_URL =
  "https://twdlpukkgdkviwxywbkl.supabase.co";

const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3ZGxwdWtrZ2Rrdml3eHl3YmtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTc0ODIsImV4cCI6MjA5NTEzMzQ4Mn0.yFHt4zm-Li-373miMb8kslPvBNgedRLkeCTRSymPzxM";

export async function fetchAnime() {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/anime?select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const data = await response.json();

    return data.map((anime) => ({
      id: anime.id,

      slug: anime.title
        .toLowerCase()
        .replace(/\s+/g, "-"),

      title: anime.title,

      japaneseTitle: anime.title,

      tagline: anime.genre,

      synopsis: anime.description,

      type: "Movie",

      status: "Released",

      year: 2026,

      rating: Number(anime.rating || 4.5),

      genres: [anime.genre || "Action"],

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

          video: anime.video,
        },
      ],
    }));
  } catch (error) {
    console.error("Supabase Fetch Error:", error);

    return [];
  }
}
export async function addComment(
  animeId,
  username,
  comment
) {

  await fetch(
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
}

export async function fetchComments(
  animeId
) {

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/comments?anime_id=eq.${animeId}&select=*`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    }
  );

  return await response.json();
}
const commentForm =
  document.querySelector("#commentForm");

const commentInput =
  document.querySelector("#commentInput");

const commentsContainer =
  document.querySelector("#commentsContainer");

async function loadComments(animeId) {

  const comments =
    await fetchComments(animeId);

  commentsContainer.innerHTML =
    comments.map(comment => `

      <div class="comment-card">

        <h4>${comment.username}</h4>

        <p>${comment.comment}</p>

      </div>

    `).join("");
}
const CURRENT_ANIME_ID = "global-anime";

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

   await loadComments(CURRENT_ANIME_ID);
  }
);
loadComments(CURRENT_ANIME_ID);