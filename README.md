# Jìyì – Chinese flashcards

A free flashcard app for learning Mandarin, made for speaking and listening. It runs in the browser, installs on your phone's home screen and works offline.

- **FSRS-5 scheduling**, the memory model built into Anki.
- **Starter decks:** HSK 1 and HSK 2 (2025 syllabus), plus topic decks: survival phrases, food and ordering, getting around, shopping and money, daily life in China, meeting people, and health and emergencies. Every word has pinyin, a meaning, an example sentence and notes on common traps.
- **Automatic pinyin** from the hanzi as you type, for words and example sentences, with 一/不 tone changes and neutral tones. It can be turned off in Options.
- **Tone colors**, and pinyin typed with tone numbers turns into marks (ni3 hao3 → nǐ hǎo).
- **Azure neural voices** with audio saved on the device, or the device's own voice.
- **Speaking practice:** with an Azure key, say a word or sentence and get a pronunciation score for each character.
- **Folders**, a picker to choose which words you practice, bulk add, and vocabulary stats.
- **Import** from Anki (Notes in Plain Text), Pleco (Export Cards as text) or a CSV file.
- **Sync** between devices through a private GitHub gist.

## Files

The setup steps below are for running the official copy of Jìyì. Hosting your own copy needs permission (see [License](#license)).

Upload all of these to the root of the repository:

- `index.html`: the page
- `app.js`: the app
- `decks.js`: the starter decks
- `pinyin-pro.js`: pinyin-pro 3.29.5 (MIT, see `pinyin-pro-LICENSE.txt`), used for automatic pinyin
- `pinyin-auto.js`: word list and rules that make automatic pinyin more accurate
- `speech-sdk.js`: Microsoft's Speech SDK 1.52.0 for browsers (redistributable, see `speech-sdk-LICENSE.txt`)
- `sw.js`: offline cache
- `manifest.webmanifest`, `icon-180.png`, `icon-192.png`, `icon-512.png`: home-screen icon and name
- `LICENSE`, `pinyin-pro-LICENSE.txt`, `complete-hsk-vocabulary-LICENSE.txt`: license terms

## 1. Put it on GitHub Pages

1. On github.com, create a new repository, for example `jiyi`. It can be public. Your cards are never stored in the repository.
2. In the repository, choose **Add file → Upload files**, drag in every file above, and commit.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute or two the page is live at `https://<your-username>.github.io/jiyi/`.

## 2. Install it on your phone

1. Open the address in **Safari** (iPhone) or **Chrome** (Android).
2. iPhone: tap **Share → Add to Home Screen**. Android: tap **⋮ → Add to Home screen**.
3. From now on, open Jìyì from the home-screen icon.

On iPhone the home-screen app and Safari keep separate storage, so cards you add in a Safari tab won't show up in the home-screen app.

## 3. Get started

Open **Add → Decks** and add a starter deck. New words come in at your daily limit (15 by default, change it in Options). To pick exactly which words you practice, go to **Words → Practicing → Choose words**, and filter by folder.

To bring in your own list, use **Options → Import words**:

- Anki: File → Export, then choose Notes in Plain Text.
- Pleco: Flashcards → Import/Export → Export Cards, as a text file. Pleco categories can become folders.
- Spreadsheet: save as CSV with columns for hanzi, pinyin and meaning.

Words you already have keep their progress.

## 4. Azure neural voices and speaking practice (optional)

1. Sign in at portal.azure.com. A new account asks for a card to verify identity; the free tier never charges it.
2. Search for **Speech service** and choose **Create**.
3. Pick any resource group (create one called `jiyi` if needed), region **East Asia**, any name, and pricing tier **Free F0**. Create it.
   - F0 gives 500,000 characters of neural speech a month and simply stops at the limit instead of billing you.
   - You can only have one F0 Speech resource per subscription.
4. Open the resource, then **Keys and Endpoint**. Copy **KEY 1** and the **Location/Region** (for example `eastasia`).
5. In the app: **Options → Azure neural voices**, paste both, and tap **Save and test**. You should hear a sentence.

Audio for every word and sentence is generated once, saved on the phone and played offline from then on.

With a key, the back of each card also has a **Say it** button. Say the word (or tap the microphone next to an example sentence), and Azure scores your pronunciation character by character. The app needs microphone access for this, and it uses speech recognition on the same Azure resource.

Listening stops by itself when you finish speaking; tap **Stop** to end it early. The microphone stays open while you study and closes after a minute without speaking practice, when you leave Study, or when you switch apps. An app on the iPhone home screen asks for the microphone again after that; in a Safari tab you can set the microphone to **Allow** for the site so it never asks.

## 5. Sync between devices (optional)

1. Go to github.com/settings/tokens → **Generate new token (classic)**.
2. Give it a note like "Jìyì sync", pick an expiration, tick **only `gist`**, and generate it. Copy the token (`ghp_…`).
3. In the app: **Options → Sync**, paste the token, tap **Connect**. The app creates a secret gist called "Jìyì flashcards deck".
4. On another device, paste the same token. The app finds the existing deck and merges it with whatever is on that device.

How it syncs: a few seconds after you add or edit a card, within a minute while you're reviewing, every minute while the app is open, and when you switch away from it. Changes merge card by card using each card's last-change time, so two devices don't overwrite each other. Adding the same starter deck on two devices gives one card per word.

Notes:

- A secret gist is unlisted, not encrypted. Anyone with its exact link could read your flashcards; nobody can change them without your token.
- Every sync adds a revision to the gist, so its history works as an automatic backup.
- When the token expires, the sync icon turns red. Disconnect, create a new token and connect again.

## Using it from mainland China

- GitHub, GitHub Pages and Azure may need a VPN. After the first launch the app itself opens offline, and saved audio plays offline.
- Google Fonts loads without blocking. If it's unreachable, the phone's built-in fonts are used.

## Updating the app

When you change any file, open `sw.js` and bump `VERSION` (for example `jiyi-v6`), then upload the changed files. Phones switch to the new version the next time the app is opened after it has fetched the update, so you may need to open it twice.

## Credits

- Scheduling: FSRS-5 (open-spaced-repetition).
- Automatic pinyin: [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (MIT).
- HSK word lists: [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT), with readings checked against [CC-CEDICT](https://cc-cedict.org/) (CC BY-SA 4.0). Glosses, example sentences and notes were written for Jìyì.
- Voices and speaking practice: Microsoft Azure Speech SDK.

## License

Copyright © 2026 Samuel Kjær Mackie. All rights reserved. You may use the app and read the code, but not copy, modify, host or redistribute it without permission. See [LICENSE](LICENSE) for the details. Third-party parts (the Azure Speech SDK, pinyin-pro, the HSK word lists and data derived from CC-CEDICT) stay under their own licenses, listed in the same file.
