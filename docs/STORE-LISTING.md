# Chrome Web Store listing

Everything the submission form asks for. Copy the fields straight across.

Build the upload first:

```bash
node scripts/package.mjs
```

That writes `dist/series-graph-for-anilist-<version>.zip` — 11 files, ~63 KB, with no
tests, scripts or docs in it. It has been loaded into Chrome from the extracted zip and
verified to inject the panel, so what you upload is what was tested.

---

## Where to publish

**The Chrome Web Store charges a one-time developer registration fee** (US$5). Its own
docs put it plainly: "you must register as a CWS developer and pay a one-time
registration fee." One payment, not a subscription — but it is not optional.

**Microsoft Edge Add-ons is free** and takes this exact zip. Edge is Chromium, the
manifest and code need no changes, and registering costs nothing — a Microsoft account
or a GitHub account is enough. If the fee is the blocker, this is the route:
<https://partner.microsoft.com/dashboard/microsoftedge>. Everything below — the listing
copy, the justifications, the graphics — applies to that form too.

**Free and already working:** load unpacked from `chrome://extensions`. Nothing to
review, nothing to pay. Publishing only buys discoverability and auto-updates.

## The name

Settled: **Episode Ratings for AniList**.

"Series Graph for AniList" was the earlier working title and is the riskier choice —
store policy prohibits listings that imply an affiliation you do not have, and reviewers
do enforce it on "X for Y" names carrying another company's product name. The chosen
name owns nothing, and Series Graph gets credited with a link in the description, which
is the normal pattern for a companion extension. If you ever want the original name,
get written permission from Series Graph first and keep the reply.

**The second thing to weigh.** Every install calls Series Graph's undocumented API. One
person testing is nothing; a thousand installs is traffic they did not sign up for and
cannot see coming. The cache keeps it to one request per show per user per day, which is
about as light as it gets, but it is still their bandwidth. Telling them before you
publish is both the decent thing and the thing that stops the API disappearing on you.

---

## Fields

**Name** (75 max)

```
Episode Ratings for AniList
```

**Distribution** — Public.

**Summary** (132 max — this is the one-liner under the title)

```
Adds a per-episode rating chart to AniList anime pages, so you can see a season's highs and lows at a glance.
```

**Category** — Entertainment
**Language** — English

**Description**

```
AniList tells you how good an anime is. It doesn't tell you which episodes are the good
ones.

This adds a chart to the top of every AniList anime page showing how each episode was
rated, so you can see a season's shape before you start it — where it clicks, where it
sags, and which episode everyone remembers.

• Ratings for every episode, plotted across the season
• Switch between IMDb ratings and Series Graph's own community ratings
• Hover any episode for its title, score, vote count and air date
• Season average, best episode and worst episode at a glance
• Follows your AniList theme — light, dark and high contrast
• Season picker for shows with more than one season

It works out which season an AniList page refers to on its own, which matters more than
it sounds: AniList files each cour as a separate entry while episode databases group
them into one season, so a naive lookup shows you the wrong episodes. This checks the
page's episode count and air dates against each season and picks the one that fits —
correct for all 134 multi-season shows among AniList's 200 most popular anime.

If a show isn't covered, nothing appears. No empty boxes, no error banners.

Ratings come from Series Graph (seriesgraph.com), which draws on IMDb and its own users.
This extension is not affiliated with Series Graph, AniList, IMDb or TMDB.

Open source: <your repo URL>
```

---

## Privacy tab

**Single purpose**

```
Displays per-episode rating charts on AniList anime pages. That is the extension's only
function; it does nothing on any other site.
```

**Permission justifications** — one box per permission, all required.

| Permission | Justification |
|---|---|
| `storage` | Caches rating data locally for 24 hours so revisiting an anime page does not re-request it. Nothing is stored about the user. |
| `https://seriesgraph.com/*` | The source of the episode ratings the extension displays. The extension requests one read-only JSON endpoint, `/api/shows/{id}/season-ratings`. |
| `https://graphql.anilist.co/*` | Reads the episode count and start date of the anime being viewed, from AniList's public API, to determine which season of the show the page refers to. Read-only and unauthenticated. |
| `https://anilist.co/*` (content script) | The extension inserts its chart into AniList anime pages. It reads only the anime ID from the page URL. |

**Are you using remote code?** — No. All code is in the package; nothing is fetched and
executed at runtime.

**Data usage** — tick nothing. Then certify all three:

- Not being sold to third parties
- Not being used or transferred for purposes unrelated to the single purpose
- Not being used or transferred to determine creditworthiness or for lending

The extension sends no user data anywhere. Its two outbound requests contain a TMDB show
ID and an AniList anime ID — both derived from the public page URL — and no identifier,
account, cookie or list data. No privacy policy URL is required when nothing is
collected, but if the form insists, a one-page "this extension collects no data" note on
a repo README will satisfy it.

---

## Graphics

All generated by `node scripts/store-assets.mjs`, into `docs/store/`. They are real
screenshots of the extension running on anilist.co in headless Chrome, not mock-ups.

| Asset | Size | File | Required |
|---|---|---|---|
| Icon | 128×128 | `icons/icon-128.png` | yes |
| Screenshot — dark theme | 1280×800 | `docs/store/screenshot-1-dark.png` | at least 1 |
| Screenshot — light theme | 1280×800 | `docs/store/screenshot-2-light.png` | |
| Screenshot — season picker | 1280×800 | `docs/store/screenshot-3-seasons.png` | |
| Screenshot — community ratings | 1280×800 | `docs/store/screenshot-4-community.png` | |
| Small promo tile | 440×280 | `docs/store/promo-small.png` | no |
| Marquee promo tile | 1400×560 | `docs/store/promo-marquee.png` | no |

Up to five screenshots are allowed. Put the dark one first — it is the one that reads
best as a thumbnail.

---

## Steps

1. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
   — one-time $5 fee, and identity verification for new accounts.
2. **New item** → upload `dist/series-graph-for-anilist-1.0.0.zip`.
3. Fill in the **Store listing** tab from the fields above and upload the graphics.
4. Fill in the **Privacy** tab — single purpose, the four justifications, remote code
   "No", and the data-usage certifications.
5. **Distribution** — Public.
6. Submit. Review usually takes a few days. Extensions that touch third-party APIs
   sometimes get a manual pass, so expect the long end.

For Edge instead, the flow is the same: register free at Partner Center, create a new
extension, upload the same zip, paste the same fields.

For updates: bump `version` in `manifest.json`, re-run `node scripts/package.mjs`, and
upload the new zip as a new package on the existing item. Version must always increase.

The form changes from time to time — treat the field names above as a guide rather than
gospel if something has moved.
