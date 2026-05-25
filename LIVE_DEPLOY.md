# ISKD Anime Live Deploy

## Recommended: Render Web Service

This app needs a Node web service because it has API routes, login, comments,
watchlist, progress, and upload endpoints. Static hosting alone will not run all
features.

1. Push this project to GitHub.
2. On Render, create a new Blueprint from the repo.
3. Render will read `render.yaml`.
4. Wait for deploy to finish.
5. Open the generated `https://...onrender.com` URL.

The included `render.yaml` creates:

- Node web service
- `npm install` build command
- `npm start` start command
- `/api/health` health check
- Persistent disk for `data/db.json` and uploaded videos/images
- Generated `APP_SECRET`

## Cloudinary For Videos

For APK/phone playback, use Cloudinary so videos stream from a real media CDN.
In Render dashboard, add these environment variables:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_FOLDER=iskd-anime
```

After this, new uploads will save Cloudinary URLs in `data/db.json`. Deleting a title from the app will also ask Cloudinary to delete its stored video when the public id is available.

## APK Connect To Live Server

If the APK should use your live website database, edit `public/config.js` before building APK:

```js
window.ISKD_CONFIG = {
  apiBaseUrl: "https://your-live-site.onrender.com",
  cloudinaryCloudName: "",
  cloudinaryUploadPreset: "",
  cloudinaryFolder: "iskd-anime"
};
```

If you do not have live backend yet, use a Cloudinary unsigned upload preset in the same file so APK uploads videos directly to Cloudinary.

## Important

Do not push very large local MP4 files to GitHub. GitHub blocks files over
100 MB, and hosts can deploy slowly with huge media in the repo. Upload anime
videos from the app after it is live, or use Cloudinary for external video storage.

## Local Test

```powershell
npm start
```

Open:

```text
http://localhost:3000
```
