# ISDK Aime Anime Full-Stack App

ISDK Aime is a self-contained anime streaming style app inspired by modern OTT workflows: browsing, search, genre filters, detail pages, watch pages, progress saving, comments, auth, and a user watchlist.

It uses original placeholder anime titles and generated SVG artwork. It does not copy Crunchyroll branding, copyrighted artwork, or real show data.

## Run

```powershell
npm start
```

Then open:

```text
http://localhost:3000
```

No package install is required because the backend uses only Node.js built-in modules.

## Cloudinary Video Storage

For phone/APK builds, keep MP4 files online instead of inside the APK. Add these environment variables before starting the server:

```powershell
$env:CLOUDINARY_CLOUD_NAME="your_cloud_name"
$env:CLOUDINARY_API_KEY="your_api_key"
$env:CLOUDINARY_API_SECRET="your_api_secret"
$env:CLOUDINARY_FOLDER="iskd-anime"
npm start
```

When these values are set, uploaded videos and images go to Cloudinary and the app saves the Cloudinary streaming URL. If they are not set, uploads fall back to `public/uploads`.

For APK direct upload without a Node backend, create an unsigned Cloudinary upload preset and fill `public/config.js`:

```js
window.ISKD_CONFIG = {
  apiBaseUrl: "",
  cloudinaryCloudName: "your_cloud_name",
  cloudinaryUploadPreset: "your_unsigned_preset",
  cloudinaryFolder: "iskd-anime"
};
```

For a live backend, set `apiBaseUrl` to your deployed server URL, for example `https://iskd-anime.onrender.com`.

## Features

- Node.js API server with static frontend hosting
- JSON file data store in `data/db.json`
- Register/login with salted password hashes
- Token-based session auth
- Anime catalog API with search, genre, and type filters
- Watchlist add/remove
- Episode progress tracking
- Episode comments
- Creator anime upload form
- Responsive anime streaming UI
- Server-generated poster and backdrop SVG visuals

## Project Structure

```text
.
|-- data/
|   |-- db.json
|   `-- seed.js
|-- public/
|   |-- app.js
|   |-- index.html
|   `-- styles.css
|-- package.json
|-- README.md
`-- server.js
```

## API

```text
GET    /api/health
GET    /api/genres
GET    /api/anime
POST   /api/anime
GET    /api/anime/:slug
DELETE /api/anime/:slug
POST   /api/upload-video
POST   /api/upload-image
POST   /api/auth/register
POST   /api/auth/login
GET    /api/me
GET    /api/watchlist
POST   /api/watchlist/:slug
DELETE /api/watchlist/:slug
GET    /api/progress
POST   /api/progress/:episodeId
GET    /api/comments/:episodeId
POST   /api/comments/:episodeId
GET    /media/posters/:slug.svg
GET    /media/backdrops/:slug.svg
```

## Notes

This is production-shaped demo code, not a production streaming platform. Real deployments should add HTTPS, a database, server-side validation hardening, rate limits, secure secret management, real video storage/transcoding, and licensed media content.
