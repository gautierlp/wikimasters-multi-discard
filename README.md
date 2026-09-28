<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![JavaScript][js-shield]][js-url]
[![Chrome MV3][chrome-shield]][chrome-url]
[![Vitest][vitest-shield]][vitest-url]
[![License: MIT][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/gautierlp/wikimasters-multi-discard">
    <img src="docs/assets/icon.svg" alt="WikiMasters Multi-Discard" width="120" height="120">
  </a>

  <h1 align="center">WikiMasters Multi-Discard</h1>

  <p align="center">
    A Chrome extension that lets you tick a pile of cards in your WikiMasters collection and discard them with one confirmation.
    <br />
    <a href="#usage"><strong>Explore the usage »</strong></a>
    <br />
    <br />
    <a href="docs/superpowers/specs/2026-09-28-multi-discard-extension-design.md">Read the design spec</a>
    &middot;
    <a href="https://github.com/gautierlp/wikimasters-multi-discard/issues/new">Report Bug</a>
    &middot;
    <a href="https://github.com/gautierlp/wikimasters-multi-discard/issues/new">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li><a href="#disclaimer">Disclaimer</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#how-it-works">How It Works</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

On [WikiMasters](https://www.wiki-masters.com), you discard cards one at a time.
With a few hundred duplicates and commons that you do not want, that means a few
hundred clicks and confirmations.

This extension adds a checkbox to each card on your collection page. Tick the
cards you want gone, click **Discard**, confirm once, and it discards them for
you through the same API the game uses when you discard a card by hand.

A discard cannot be undone, so when in doubt the extension does nothing:

* **Protected cards cannot be selected.** Starred cards and cards in a pending
  trade show a lock instead of a checkbox.
* **No guessing.** A checkbox only appears on a card that the extension can match
  to your collection data by its image and its title, or by its title alone for
  cards that have no image. If two copies of a card differ (one shiny, one
  starred), neither gets a checkbox.
* **One confirmation, then a checked queue.** Right before it starts, the
  extension loads the page again and drops any selected card that was starred or
  traded in the meantime. It then discards one card every 400 ms and stops at the
  first error, telling you which card failed and why.

It uses your existing login session. It needs no Chrome permissions beyond
access to wiki-masters.com.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![JavaScript][js-shield]][js-url] (plain ES modules, no framework)
* [![Chrome MV3][chrome-shield]][chrome-url] content script
* [esbuild](https://esbuild.github.io/) to bundle the content script
* [![Vitest][vitest-shield]][vitest-url] with [jsdom](https://github.com/jsdom/jsdom) for the test suite

The extension has no runtime dependencies. Everything in `package.json` is for
building and testing.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- DISCLAIMER -->
## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
supported by WikiMasters.

Automating actions in an online game may break its terms of service and could put
your account at risk. Read the WikiMasters terms and decide for yourself before
you use this. Discards are permanent. The extension cannot bring a card back, and
neither can the author. Use it at your own risk.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

The extension is not on the Chrome Web Store. You build it locally and load it
into Chrome as an unpacked extension.

### Prerequisites

* [Node.js](https://nodejs.org/) 20 or newer, with npm
* Google Chrome (or another Chromium browser that supports Manifest V3)
* A WikiMasters account, signed in on `https://www.wiki-masters.com`

### Installation

1. Clone the repo
   ```sh
   git clone https://github.com/gautierlp/wikimasters-multi-discard.git
   cd wikimasters-multi-discard
   ```
2. Install the build and test tools
   ```sh
   npm install
   ```
3. Build the content script into `extension/dist/`
   ```sh
   npm run build
   ```
4. Load it in Chrome
   1. Open `chrome://extensions` and turn on **Developer mode**.
   2. Click **Load unpacked** and select the `extension/` folder.

After each `npm run build`, click the reload icon on the extension's card in
`chrome://extensions`, then reload the WikiMasters tab.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->
## Usage

1. Open your collection at `https://www.wiki-masters.com/collection`.
2. Wait a few seconds for the checkboxes to appear in the top-left corner of each card.
   Starred cards and cards in a pending trade show a 🔒 instead.
3. Tick the cards you want to discard. A bar at the bottom of the page shows how
   many are selected.
4. Click **Discard**, then confirm in the dialog. **Cancel** changes nothing.
5. Watch the bar count up (`Discarded 3 of 12...`). Each discarded card disappears
   from the grid.

When it finishes, the bar reports the result:

```
Discarded 12 cards.
Discarded 7. Stopped at card <id>: the server refused the discard. Reload the page before you try again.
Nothing to discard: 2 card(s) are now starred, in a trade, or gone.
```

Changing page in the collection clears your selection, because the grid replaces
its cards.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- HOW IT WORKS -->
## How It Works

The collection page shows each card's image and title, but not the id that the
discard call needs. The extension gets that id from the same data the page loads.

1. **Follow the page.** When the site loads a page of your collection
   (`GET /api/my-collection?...`), the extension sees the request and loads the
   same page once. It does not load the rest of your collection, so a collection of
   1,000 pages costs the same as one of 7. If it sees no such request within 3 seconds, it falls
   back to loading every page. If a page fails to load, that page gets no
   checkboxes and the bar asks you to reload.
2. **Match cards to data.** Each card on screen is matched to one row of that
   data by its image and title (`extension/src/select.js`). One row can back only one card,
   and a card whose image or title changes loses its checkbox.
3. **Protect.** Rows that are starred, or whose id appears in the page's pending
   trades, get a lock instead of a checkbox.
4. **Re-check, then discard.** After you confirm, the extension reloads the pages
   that hold your selected cards, drops anything now protected or missing, then
   calls `POST /api/user-cards/<id>/discard` for each card, one at a time
   (`extension/src/queue.js`).

The code lives in `extension/src/`:

| File | Role |
| --- | --- |
| `api.js` | The two endpoints: load collection pages, discard one card |
| `pages.js` | Keeps loaded pages, one per URL, and re-checks them before a discard |
| `select.js` | Protection rules and card-to-row matching |
| `ui.js` | Finds the grid, adds checkboxes and locks, tracks the selection |
| `queue.js` | Discards one card at a time and stops at the first failure |
| `content.js` | Wires it all to the live page: the bar, the dialog, the observers |

The extension only ever calls those two same-origin endpoints, with your existing
session cookie. It sends nothing anywhere else and stores nothing.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ROADMAP -->
## Roadmap

- [x] Bulk selection and discard with one confirmation
- [x] Lock on starred and pending-trade cards
- [x] Re-check protection right before discarding
- [x] Load only the collection pages you view
- [ ] Select across several pages
- [ ] Filters and search inside the selection
- [ ] A one-click "select all duplicates" button
- [ ] Chrome Web Store release

See the [open issues](https://github.com/gautierlp/wikimasters-multi-discard/issues)
for the full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are welcome. This project follows TDD: write the test first, watch it
fail, then implement. Run the suite and the build before opening a PR.

```sh
npm test
npm run build
```

Two rules for this repo:

* **Never commit personal data.** No account ids (not even partial ones), email
  addresses, cookies, tokens, or copied request headers. Tests use invented data
  such as `uc-1` and `https://img.test/1.png`.
* **Fail safe.** When the extension cannot be sure which card is which, it shows
  no checkbox. Keep it that way.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feat/amazing-feature`)
3. Commit your Changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the Branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- LICENSE -->
## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Gautier Le Poher - [@gautierlp](https://github.com/gautierlp)

Project Link: [https://github.com/gautierlp/wikimasters-multi-discard](https://github.com/gautierlp/wikimasters-multi-discard)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Claude Code](https://claude.com/claude-code)
* [esbuild](https://esbuild.github.io/)
* [Vitest](https://vitest.dev/)
* [Shields.io](https://shields.io)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[js-shield]: https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[js-url]: https://developer.mozilla.org/en-US/docs/Web/JavaScript
[chrome-shield]: https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white
[chrome-url]: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
[vitest-shield]: https://img.shields.io/badge/Vitest-tested-6E9F18?style=for-the-badge&logo=vitest&logoColor=white
[vitest-url]: https://vitest.dev/
[license-shield]: https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge
[license-url]: #license
