# Dwarfer GIF — Chrome Extension

Pick and view GIFs inline in YouTube comments via [dwarfer.link](https://dwarfer.link).

> **Experimental research project** — not affiliated with YouTube or Google.

---

## What it does

- Adds a **GIF button** next to the emoji icon in any YouTube comment box
- Opens a searchable GIF picker (powered by Giphy via dwarfer.link)
- Inserts a short `dwarfer.link` reference into your comment
- **Renders GIFs inline** for anyone else who has the extension — no external image embeds, just a short link that expands automatically

---

## Installation (Developer Mode)

The extension is not yet on the Chrome Web Store. Install it manually in a few steps.

### 1. Download the extension

Clone or download this repository:

```bash
git clone https://github.com/YevheniiKliahin/dwarfer-gif-extension.git
```

Or click **Code → Download ZIP** on GitHub and unzip it.

### 2. Open Chrome Extensions

Go to `chrome://extensions` in your browser address bar.

### 3. Enable Developer Mode

Toggle **Developer mode** on in the top-right corner of the Extensions page.

![Developer mode toggle](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89a6acf_1920.png)

### 4. Load the extension

Click **Load unpacked** and select the folder you downloaded (the one containing `manifest.json`).

The Dwarfer GIF icon will appear in your Chrome toolbar.

### 5. Sign in

Click the Dwarfer GIF toolbar icon and sign in with your Google account via [dwarfer.link](https://dwarfer.link).

---

## How to use

1. Go to any YouTube video
2. Click a comment box to start writing
3. Click the **GIF** button that appears next to the emoji icon
4. Search or browse trending GIFs
5. Click a GIF — it inserts a short tag into your comment
6. Post the comment — anyone with the extension sees the GIF inline

---

## Updating

When a new version is released, repeat steps 1–4: download the latest version and reload the unpacked extension (click the refresh icon on the extension card in `chrome://extensions`).

---

## Requirements

- Google Chrome (or any Chromium-based browser)
- A free [dwarfer.link](https://dwarfer.link) account (sign in via Google)

---

## Privacy

- The extension only activates on `youtube.com`
- GIF short links are resolved via `dwarfer.link` — no data is sent to third parties directly
- Your Google account is used solely for authentication with dwarfer.link
- See [dwarfer.link/privacy](https://dwarfer.link/privacy) for the full privacy policy
