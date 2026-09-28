# WikiMasters Multi-Discard

Adds checkboxes to your My Collection page so you can discard many cards at once.
Starred cards and cards in a pending trade show a lock and cannot be selected.

## Build

    npm install
    npm run build

## Load in Chrome

1. Open `chrome://extensions` and turn on Developer mode.
2. Click "Load unpacked" and pick the `extension/` folder.
3. After each `npm run build`, click the reload icon on the extension card.

Discarding is permanent. The extension asks once before it starts, then
discards one card every 400 ms. It retries a card after a server error, and
stops at the first card that still fails.

The extension loads the same collection pages the site shows, one request per
page you view. Before a discard it loads that page again to make sure no
selected card was starred or put in a trade in the meantime.
