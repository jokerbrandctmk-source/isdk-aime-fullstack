# ISKD Anime Live Phone Setup

## Why phone APK is different from localhost

Localhost website uses this computer's Node server and `data/db.json`.
The APK on another phone cannot read this computer's `data/db.json`.
For every user's phone to see the same uploaded videos, the app must use one live backend URL.

## Final platform map

- Videos: Bunny.net Stream
- Posters/backdrops/profile images: Cloudinary
- Login/signup: Firebase Authentication
- Database/content list: Supabase or the deployed Node backend
- Web/API hosting: Render
- APK: Capacitor Android

## Bunny.net video steps

1. Open Bunny.net dashboard.
2. Go to Stream.
3. Create video library named `ISDK Anime`.
4. Upload an episode video.
5. Copy the HLS URL, usually like:

```text
https://vz-xxxx.b-cdn.net/video-id/playlist.m3u8
```

6. Open the app.
7. Tap `+ Upload`.
8. Paste that URL in `Bunny/HLS video URL`.
9. Publish.

## Make uploads visible on every phone

1. Deploy this project backend to Render.
2. Copy your Render URL, for example:

```text
https://iskd-anime.onrender.com
```

3. Open `public/config.js`.
4. Set:

```js
window.ISKD_CONFIG = {
  apiBaseUrl: "https://iskd-anime.onrender.com",
  cloudinaryCloudName: "YOUR_CLOUD_NAME",
  cloudinaryUploadPreset: "YOUR_UNSIGNED_PRESET",
  cloudinaryFolder: "iskd-anime"
};
```

5. Rebuild the APK.
6. Install the new APK on phones.

Now every phone will load the same anime list, posters, comments, likes, progress, and Bunny video links from the live backend.

## Important

If `apiBaseUrl` is empty, the APK uses offline/local fallback. That means videos uploaded on one phone will not automatically appear on other phones.
