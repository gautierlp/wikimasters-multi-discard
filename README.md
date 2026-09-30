<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![Python][python-shield]][python-url]
[![uv][uv-shield]][uv-url]
[![License: MIT][license-shield]][license-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/gautierlp/wikimasters-cli">
    <img src="docs/assets/icon.svg" alt="WikiMasters CLI" width="120" height="120">
  </a>

  <h1 align="center">WikiMasters CLI</h1>

  <p align="center">
    List and discard the cards in your WikiMasters collection from the terminal.
    <br />
    <a href="#usage"><strong>See the usage »</strong></a>
    <br />
    <br />
    <a href="docs/superpowers/specs/2026-09-30-python-cli-design.md">Read the design spec</a>
    &middot;
    <a href="https://github.com/gautierlp/wikimasters-cli/issues/new">Report Bug</a>
    &middot;
    <a href="https://github.com/gautierlp/wikimasters-cli/issues/new">Request Feature</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About the project</a></li>
    <li><a href="#disclaimer">Disclaimer</a></li>
    <li><a href="#getting-started">Getting started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About the project

On [WikiMasters](https://www.wiki-masters.com), you discard cards one at a time,
with a confirmation for each. `wm` lists your whole collection in the terminal
and discards any number of cards with one confirmation, through the same API the
site uses when you discard a card by hand.

A discard cannot be undone, so `wm` refuses anything it is not sure about:

* **Starred cards and cards in a pending trade are refused**, and so is any id
  that is not in your collection. `wm` checks all of them before it sends a
  single discard.
* **It checks again after you confirm.** Your collection may change while the
  prompt is open, so `wm` reloads it and refuses again if a card became starred
  or traded.
* **It stops at the first card that fails.** The site answers some requests
  with a server error at random. `wm` retries those (after 2, 5, then 10 s for a
  discard). A card that still fails stops the run and is named in the error.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- DISCLAIMER -->
## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
supported by WikiMasters.

Automating actions in an online game may break its terms of service and could put
your account at risk. Read the WikiMasters terms and decide for yourself before
you use this. Discards are permanent. `wm` cannot bring a card back, and neither
can the author. Use it at your own risk.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting started

You need Python 3.12 or newer and [uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/gautierlp/wikimasters-cli.git
cd wikimasters-cli
uv sync
```

**Log in once.** The site knows you by a session cookie. Copy it from Chrome:
open your collection page, press Cmd+Option+I, open the Network tab, right-click
the `my-collection` request, choose "Copy as cURL", then:

```sh
pbpaste | uv run wm login
```

`wm` keeps the session in `~/.config/wikimasters/session.json` (mode 600) and
refreshes it on its own. After the first refresh, Chrome may ask you to log in
again, once. After that the two sessions live apart.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE -->
## Usage

```sh
uv run wm collection                 # every card: id, rarity, count, flags, title
uv run wm collection --rarity SR     # one rarity: C, PC, R, SR, UR, L
uv run wm collection --json          # raw rows
uv run wm discard <id> [<id>...]     # asks first; -y skips the question
```

Flags in the list: `*` starred, `T` in a pending trade. The id to pass to
`discard` is the first column.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- HOW IT WORKS -->
## How it works

`wm` calls two endpoints on `https://www.wiki-masters.com`, with your session
cookie and nothing else:

* `GET /api/my-collection?sort=rarity&page=N` returns one page of 50 cards, plus
  the ids of cards in pending trades. `wm` reads pages until one comes back short.
* `POST /api/user-cards/<id>/discard` discards one card.

The code lives in `wikimasters/`:

| File | Role |
| --- | --- |
| `auth.py` | Reads the pasted cookie, stores the session, refreshes it |
| `models.py` | The shapes of the API answers |
| `client.py` | The two endpoints, with retries on server errors |
| `main.py` | The `wm` commands |

It sends nothing anywhere else.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTRIBUTING -->
## Contributing

Contributions are welcome. This project follows TDD: write the test first, watch
it fail, then implement. Run the suite before opening a PR.

```sh
uv run pytest -q
```

Two rules for this repo:

* **Never commit personal data.** No account ids (not even partial ones), email
  addresses, cookies, tokens, or copied request headers. Tests use invented data
  such as `uc-1` and `https://img.test/1.png`.
* **Fail safe.** When `wm` cannot be sure a discard is wanted and allowed, it
  refuses. Keep it that way.

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

Project Link: [https://github.com/gautierlp/wikimasters-cli](https://github.com/gautierlp/wikimasters-cli)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [Claude Code](https://claude.com/claude-code)
* [Typer](https://typer.tiangolo.com/), [httpx](https://www.python-httpx.org/), [Pydantic](https://docs.pydantic.dev/)
* [Shields.io](https://shields.io)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[python-shield]: https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white
[python-url]: https://www.python.org/
[uv-shield]: https://img.shields.io/badge/uv-managed-DE5FE9?style=for-the-badge&logo=uv&logoColor=white
[uv-url]: https://docs.astral.sh/uv/
[license-shield]: https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge
[license-url]: #license
