# Jìyì – Chinese flashcards

Flashcards with FSRS-5 scheduling, Azure neural Mandarin voices, offline use, and sync through a private GitHub gist.

## Files

Upload all of these to the root of the repository:

- `index.html`: the page
- `app.js`: the app
- `speech-sdk.js`: Microsoft's Speech SDK 1.52.0 for browsers (redistributable, see `speech-sdk-LICENSE.txt`)
- `sw.js`: offline cache
- `manifest.webmanifest`, `icon-180.png`, `icon-192.png`, `icon-512.png`: home-screen icon and name

## 1. Put it on GitHub Pages

1. On github.com, create a new repository, for example `jiyi`. It can be public. Your cards are never stored in the repository.
2. In the repository, choose **Add file → Upload files**, drag in every file above, and commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute or two the page is live at `https://<your-username>.github.io/jiyi/`.

## 2. Install it on your iPhone

1. Open the address in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. From now on, open Jìyì from the home-screen icon only.

The home-screen app and Safari keep separate storage. Cards you add in a Safari tab won't show up in the home-screen app.

## 3. Move your cards from the Claude version

1. In the Claude version: **Options → Export backup**, then save the file to Files.
2. In the home-screen app: **Options → Import backup** and pick that file.

## 4. Azure neural voices

1. Sign in at portal.azure.com. A new account asks for a card to verify identity; the free tier never charges it.
2. Search for **Speech service** and choose **Create**.
3. Pick any resource group (create one called `jiyi` if needed), region **East Asia**, any name, and pricing tier **Free F0**. Create it.
   - F0 gives 500,000 characters of neural speech a month and simply stops at the limit instead of billing you.
   - You can only have one F0 Speech resource per subscription.
4. Open the resource, then **Keys and Endpoint**. Copy **KEY 1** and the **Location/Region** (for example `eastasia`).
5. In the app: **Options → Azure neural voices**, paste both, and tap **Save and test**. You should hear a sentence.

Audio for every word and sentence is generated once, saved on the phone and played offline from then on. New cards get their audio when you save them.

## 5. Sync between devices

1. Go to github.com/settings/tokens → **Generate new token (classic)**.
2. Give it a note like "Jìyì sync", pick an expiration, tick **only `gist`**, and generate it. Copy the token (`ghp_…`).
3. In the app: **Options → Sync**, paste the token, tap **Connect**. The app creates a secret gist called "Jìyì flashcards deck".
4. On another device, paste the same token. The app finds the existing deck and merges it with whatever is on that device.

How it syncs: a few seconds after you add or edit a card, within a minute while you're reviewing, every minute while the app is open, and when you switch away from it. Changes merge card by card using each card's last-change time, so two devices don't overwrite each other.

Notes:

- A secret gist is unlisted, not encrypted. Anyone with its exact link could read your flashcards; nobody can change them without your token.
- Every sync adds a revision to the gist, so its history works as an automatic backup.
- When the token expires, the sync icon turns red. Disconnect, create a new token and connect again.

## Using it from mainland China

- GitHub, GitHub Pages and Azure may need a VPN. After the first launch the app itself opens offline, and saved audio plays offline.
- Google Fonts loads without blocking. If it's unreachable, the phone's built-in fonts are used.

## Updating the app

When you change any file, open `sw.js` and bump `VERSION` (for example `jiyi-v2`), then upload the changed files. Phones switch to the new version the next time the app is opened after it has fetched the update, so you may need to open it twice.
