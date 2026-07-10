# ISKD Anime — Database Schema

Purpose: implement YouTube-like multi-creator schema on top of the existing JSON store. Use this as the source of truth for backend endpoints and migrations.

Tables / Collections

1. Users
- id (string) — `usr_<uuid>`
- email (string, optional)
- username (string)
- passwordHash (string)
- phoneNumber (string, optional)
- displayName (string, optional)
- photoURL (string, optional)
- firebaseUid (string, optional)
- createdAt (ISO string)

2. Channels
- id (string) — `ch_<uuid>`
- userId (string) — FK to Users.id (owner)
- slug (string, unique)
- name (string)
- username (string)
- profilePicture (string)
- banner (string)
- about (string)
- socialLinks (array)
- website (string)
- country (string)
- joinDate (ISO string)
- creatorBadge (bool)
- verified (bool)
- subscribers (number)
- totalViews (number)
- totalWatchTime (number, minutes)
- totalRevenue (number)
- totalVideos (number)
- totalLikes (number)
- totalComments (number)
- monetizationStatus (string)
- verificationStatus (string)
- isActive (bool)
- createdAt (ISO string)

3. Anime (Videos)
- id (string) — `ani_<uuid>` or `supabase_<id>`
- channelId (string) — FK to Channels.id
- slug (string)
- title (string)
- poster, backdrop, video, episode list
- episodes (array of episode objects: id, number, title, duration, video)
- views (number)
- likes (number)
- likedBy (array of userId/clientId)
- createdAt

4. Subscribers
- id (string)
- channelId (string)
- subscriberId (string) — User.id
- createdAt

Constraint: unique(channelId, subscriberId) — one subscription per user per channel

5. WatchHistory
- id
- userId
- animeId
- episodeId (optional)
- watchTime (number, seconds)
- completed (bool)
- createdAt

6. Revenue
- id
- channelId
- month (YYYY-MM)
- adsRevenue (number)
- membershipRevenue (number)
- superThanks (number)
- totalRevenue (computed)

7. Comments
- id
- animeId or episodeId
- userId
- username (cached)
- body
- createdAt

8. Likes
- id
- animeId
- userId or clientId
- createdAt

Other runtime stores (derived)
- cloudStats: mapping of animeSlug -> { views, likes, likedBy }

Migration notes
- Create a Channel for every existing user (if not exists) and link anime.createdBy -> userId when possible.
- Recompute channel totals by summing anime metrics.
- Convert `db.subscribers` object into `subscribers` array of rows.

API mapping (examples)
- POST /api/channels/:slug/subscribe -> create/delete subscriber row and update channel.subscribers
- POST /api/anime/:slug/view -> insert/update WatchHistory, increment anime views and channel totalViews, add watchTime
- GET /api/channels/:slug/analytics -> return channel metrics filtered to that channel only

Security & Notes
- Keep `data/db.json` as a dev/local fallback. For production move to Postgres/Supabase.
- Use token-based auth (existing JWT-like `createToken`) for API calls.

