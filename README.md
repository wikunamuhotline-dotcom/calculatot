# ChatSite

Hidden calculator unlocks a mobile-first realtime chat app.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5174`, type `7749`, then press `=`.

## Required Environment Variables

Copy `.env.example` to `.env` and fill:

- `MONGODB_URI`
- `GOOGLE_CLIENT_ID`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `JWT_SECRET`
- `APP_BASE_URL`

## Render Deploy

1. Push this folder to GitHub.
2. In Render, create a new Blueprint from `render.yaml`, or create a Web Service from the repo.
3. Add the environment variables from `.env.example`.
4. After Render gives the site URL, set `APP_BASE_URL` to that URL.
5. Set Google OAuth authorized JavaScript origin to the Render URL.

Recommended Render values if creating a Web Service manually:

- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`
- Plan: `Free`

## Google OAuth

Create a Google OAuth Web Client in Google Cloud Console.

Authorized JavaScript origins:

- Local: `http://127.0.0.1:5174`
- Production: your Render URL, for example `https://chatsite.onrender.com`

Copy the Web Client ID into `GOOGLE_CLIENT_ID`.

## Android APK

After the website is hosted and `npm install` works:

```bash
npm run android:prepare
npm run android:open
```

In Android Studio, build the APK from `Build > Build Bundle(s) / APK(s) > Build APK(s)`.
