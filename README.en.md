# ProfitMR

[Português](README.md) · **English**

[ProfitMR website](https://profitmr.vercel.app) · [Install on Firefox](https://addons.mozilla.org/en-US/firefox/addon/profitmr/)

ProfitMR is a Manifest V3 extension for Chrome, Chromium-based browsers (including Opera), and Firefox. The calculator works independently of the website; optional lookup reads costs shown on Microsoft Rewards gift card pages. This is an independent project and is not affiliated with or endorsed by Microsoft.

<a id="chrome-manual-install"></a>
## Manual installation in Chrome

The extension is not distributed through the Chrome Web Store. Manual installation uses Chrome Developer mode and does not receive automatic updates.

1. [Download the latest source code (.zip)](https://github.com/pdrots/profitmr-extension/archive/refs/heads/main.zip).
2. Extract the ZIP file to a permanent folder on your computer.
3. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder containing `manifest.json`.
5. Keep that folder on your computer; Chrome loads the extension directly from it.

To update, download and extract the latest version, replace the files in the extension folder, and select **Reload** on `chrome://extensions`. Chrome may display warnings because the extension was loaded in Developer mode.

## Install for development

### Edge and Opera

1. Open `edge://extensions` or `opera://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this project folder.
4. Open the extension from the browser toolbar.

The main manifest uses a service worker for Chrome, Edge, and Opera. The official Firefox version is available from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/profitmr/); `manifest.firefox.json` contains browser-specific settings, and `build-firefox.ps1` generates test files without changing the Chromium manifest.

The Firefox manifest declares support for Firefox desktop and Android starting with version 142. The main interface and flows still need to be tested on Android before that platform is described as ready for users.

After changing files, return to the browser's extensions page and select **Reload**. Close and reopen the popup to check the changes.

The popup includes a link to the [ProfitMR website](https://profitmr.vercel.app), which opens in a new tab.

## Using the calculator

Enter the price of a game or app and your points balance. The extension has light and dark themes, supports Portuguese, English, and Spanish, and includes gift cards for Brazil (BRL), the United States (USD), and Spain (EUR). Values are saved separately for each region. In any region, open **Update costs automatically** and select **Read costs from Rewards** to look up cards in background tabs. You must already be signed in to Rewards; review the detected values before using them.

The custom card cost corresponds to the selected reference amount. Changing that amount clears the previous points value. The automatic lookup also checks the region's maximum amount; with both quotes, the calculator interpolates costs for other amounts. Without the maximum quote, it keeps estimating proportionally from the reference amount. Results are estimates: always confirm the exact cost on Rewards before redeeming.

If a lookup gets stuck, select **Unlock / restart scan**. This closes tabs opened by the lookup and preserves saved costs. Lookup depends on the content rendered by the website and may not find every value; review the results and try again if needed.

## Data and permissions

Calculator values and lookup state are saved in the extension's local storage. The extension accesses gift card pages at `https://rewards.bing.com/redeem/sku/` to read visible costs. It does not read or store passwords or cookies.

The permissions declared in the manifest are:

- `storage`: save values and lookup progress locally.
- `alarms`: stop lookups that exceed the time limit.
- access to Microsoft Rewards gift card pages: open the cards and read their rendered content.

## Files

- `manifest.json`: extension manifest.
- `popup.html`, `popup.css`, `popup.js`, `popup-data.js`: interface, calculator, and translations.
- `regions.js`: currencies, denominations, limits, and SKUs used by the popup and lookup scripts.
- `background.js`: background lookup and persistent state.
- `content.js`: reads visible costs from Rewards pages.
- `icon-*.png`: extension icons in different sizes.
- `store-assets/`: icon source files and AMO demo screenshots; screenshots use fictitious values.
