# ISKD Anime Rust Backend

This is the Rust/Axum backend starter for the online version of the app.

Run locally after installing Rust:

```powershell
cd rust-backend
cargo run
```

Default API:

```text
http://localhost:3001
```

Deploy on Render as a Rust web service, then set the frontend API URL in:

```text
public/config.js
```

Example:

```js
window.ISKD_CONFIG = {
  apiBaseUrl: "https://your-iskd-api.onrender.com",
  cloudinaryCloudName: "",
  cloudinaryUploadPreset: "",
  cloudinaryFolder: "iskd-anime"
};
```

APK/web can also save the API URL once by opening:

```text
https://your-site.com/?apiBase=https://your-iskd-api.onrender.com
```

The Rust API keeps the same route shape as the current frontend:

- `GET /api/anime`
- `POST /api/anime`
- `GET /api/anime/:slug`
- `GET /api/genres`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/watchlist`
- `POST /api/watchlist/:slug`
- `DELETE /api/watchlist/:slug`
- `GET /api/progress`
- `POST /api/progress/:episodeId`
- `GET /api/comments/:episodeId`
- `POST /api/comments/:episodeId`
- `GET /api/admin/overview`

Videos should stay on Bunny.net, Cloudinary, S3, or YouTube embed URLs. The database should store URLs, not big MP4 files.
