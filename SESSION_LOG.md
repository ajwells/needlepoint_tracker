# Session log

Handover notes for future working sessions. Covers the build from 2026-10-31 to 2026-11-04, up to commit `0edd07a`, plus the uncommitted thread color table. For what the app does and how to run it, see `README.md`. This file records how it got here and why.

This repo has a GitHub remote, so keep personal data out of this file: no network addresses, passwords, or spreadsheet contents.

## Current state

- Committed work is pushed. `public/thread-colors.json`, the app changes that read it, and this update are not committed yet.
- **Next step:** the automatic retailer collection stopped on 2026-11-05 with only Essentials page 1 collected. All nine Flying Needles lines are in the table, from pages the user saved into `scripts/thread-colors/saved-pages/`. Milan 1xxx and 2xxx differ only by package type and yardage, as the user confirmed, so the table gives each 2xxx code the same color as its 1xxx code, keeping both numbers. Merge any later pages with `merge-retailer.mjs`. See [Thread color table](#thread-color-table).
- The user commits and pushes their own work. Only commit when asked.
- During this session the server ran from a Claude Code background task with `ALLOW_SIGNUP=false`. Such a task ends with its session, so check whether a server is running on 5173 before starting one.

## Environment

- **OS:** Windows, with PowerShell and Git Bash available.
- **Node:** not on PATH, and the user asked that it not be added. Use `%APPDATA%\JetBrains\WebStorm2026.2\node\versions\26.13.0\node.exe`, with npm in the `node_modules` folder beside it.
- **Reloading:** the server reads `public/` from disk, so client changes only need a page reload. Changes to `index.js` or environment variables need a server restart.

## Architecture

| Area | Approach |
| --- | --- |
| Client | Plain HTML and CSS, plus one classic-script IIFE in `public/app.js`. No build step or framework. |
| Server | `index.js`, zero dependencies. Serves `public/` and a JSON API. |
| API | `GET /api/session`, `POST /api/register`, `POST /api/login`, `POST /api/logout`, `GET /api/data`, and `POST /api/batch` for atomic writes. |
| Accounts | scrypt password hashes. Sessions are stored as sha256(token) and last 30 days, in an HttpOnly, SameSite=Lax cookie `np_session`. Login is throttled per IP, with a 15-minute window. |
| Server storage | `DATA_DIR/users.json`, `sessions.json`, and `db/<userId>.json`, written atomically. |
| Client storage | `dbLoad` and `dbWrite` dispatch on `useServer`: the API for accounts, IndexedDB (`idbGetAll`, `idbWrite`) for guests and `file://`. |
| Photos | Resized to at most 1600px by `imageToDataUrl` and stored inline as data URLs. The request body limit is 100 MB. |

### localStorage keys

- `needlepoint-guest`: this browser is in guest mode.
- `needlepoint-list-layout`: the Table or Cards choice for read-only canvas lists.
- `needlepoint-thread-stand-in`: what threads without a photo show, `color` (approximate color, the default) or `picture` (example picture). Set from the "No photo" menu on the Threads page.

### Data model

```text
Thread: id, createdAt, updatedAt, brand, material, sizes[], colorFamily, color, code, picture,
        lots: [{ id, dyeLot, amountLeft, amountUnit }]

Canvas: id, createdAt, updatedAt, name, status, designer, shopName, meshSize, datePurchased, price,
        yearFinished, finishType, giftedTo, picture, finishedPicture, finishedBackPicture, notes,
        threads: [{ colorDescription, itemDescription, stitchType, strands, threadId, dyeLots[] }],
        cording: [{ strands, bundles, threadId, dyeLots[] }]
```

### Names that differ from the UI

- `finishedPicture` is labelled **Finished canvas front**. The key was kept so saved photos still load.
- `stitchType` is labelled **Specialty stitch type**.
- Row `dyeLots[]` holds lot IDs, not lot numbers.

### Migrations

These run when data loads, in `normalizeThread` and `normalizeCanvas`, and also cover imported backups. Migrated values reach server storage only when the item is next saved.

- Old single `dyeLot` and amount fields become a one-item `lots` list, with the stable lot ID `${t.id}-lot`.
- A yards-only amount becomes an amount with a `yards` unit.
- Numeric thread codes and dye lots become text.
- Old numeric thread sizes move into the material, so "Pearl cotton" with size 5 becomes "Pearl cotton #5".
- A canvas with no status becomes `finished` if it has a year, otherwise `in_progress`.
- A canvas's old `shopUrl` isn't migrated. It's ignored, and dropped when that canvas is next saved.

## Feature history

Dates are commit dates. The commit column is blank for work that went into a broader commit.

| Date | Feature | Commit |
| --- | --- | --- |
| 10-31 | Thread and canvas CRUD, search, sort, automatic "used in" links, dark mode | `d35b0d5` |
| 10-31 | Thread amount in yards or % of skein/card | |
| 10-31 | Six-stage canvas status stepper and filter chips | |
| 10-31 | CSV converter for the canvases and wish list spreadsheets | |
| 10-31 | Login with a per-user database on the server | `4ccc87f` |
| 10-31 | Thread sizes become multi-select: 13, 18, strandable | `6e9ef9b` |
| 10-31 | Existing items open read-only until **Edit** | `42d4d71` |
| 10-31 | Whole photo shown when an item is open | `eee21f7` |
| 11-01 | Guest mode with warnings | `e41e6d2` |
| 11-01 | Guest banner hides signup when `ALLOW_SIGNUP=false` | `cd9e1f9` |
| 11-01 | In stash / Out of stock filter | `89d1b0a` |
| 11-01 | Export menu with CSV options | |
| 11-01 | Cording bundles and total size | `ff6ca7e` |
| 11-01 | Table / Cards toggle in read-only view, Table by default | `fe0e97d` |
| 11-01 | Gifted to and Finish type fields | `99dd5d7` |
| 11-01 | Stitch type renamed to Specialty stitch type | `a194ca6` |
| 11-01 | Dye lot lists on threads, multi-lot selection on canvas rows, Replace all import | `87e204f` |
| 11-01 | Shop website field removed | `2068e66` |
| 11-01 | Finished canvas front and back pictures | `6b30c7b` |
| 11-01 | README | `b333064` |
| 11-03 | Search and new thread creation in canvas thread lists | `0edd07a` |

The temporary `public/downloads/` page for moving import files to a phone was later deleted by the user.

## Decisions

### Set by the user

- A thread with an empty amount counts as in stock. It's out of stock only when set to 0. With dye lots, this became: it has lots, and all of them are exactly 0.
- Total cording size is the sum of strands × bundles per row.
- A canvas counts as gifted when "Gifted to" is filled in. "gifted" is searchable.
- Read-only view defaults to the table layout, which suits phones.
- Guest data stays in the browser. Sharing it means Export and Import.

### Made during the build

| Decision | Why |
| --- | --- |
| Zero-dependency server | Keeps the app simple to run. It also meets the original request for a plain JavaScript app. |
| Keep `file://` and IndexedDB support | The app still works with no server, and it's how browser data moves into a new account. |
| `offerLocalUpload` runs only when the account is empty | Avoids merging local data into an account that already has data. |
| Yards and percentages are never added together | They aren't comparable, so totals read like "15.5 yd + 150%". "Least left" lists yard-based threads first, then percent-based. |
| Thread codes and dye lots are text | Real codes and lots contain letters, such as "B5200" and "512B". This replaced the whole numbers in the original spec. |
| An empty bundle count means 1 | Keeps totals correct for older cording rows. The total line says when a bundle is blank. |
| Choosing Finished fills in the current year only if the year is empty | Saves a step without overwriting a value. |
| New canvases start at Purchased | Most new entries are canvases already owned. |
| Canvas thumbnails use the finished front, then the canvas picture | The back is shown only when a canvas is open. |
| List cards crop photos, open items don't | Keeps the grid even while still showing the whole photo on demand. |
| CSV exports leave out photos, and only JSON can be imported | Photos don't fit in a spreadsheet cell, and CSV can't round-trip the full data. |
| CSV values starting with `=`, `+`, `-` or `@` get a leading `'` | Stops spreadsheets running them as formulas. A code like `-12` also gains the apostrophe. |
| Replace all is one atomic write, with a confirmation showing current counts | A failure can't leave data half deleted, and counts are read fresh in case another device changed the data. |
| Converter IDs are deterministic | Re-importing updates records instead of duplicating them. It also overwrites edits made in the app. |
| Spreadsheets, import files, `scripts/` and `data/` are ignored by git | They hold personal purchase data. |

### Converter guesses

- **Status:** a year means Finished, "(stitching)" means Stitched, threads with no year means Kitted, and otherwise Purchased.
- **Color family and material:** filled in only when clear from the text. 53 threads have no family.
- **Thread sizes:** only DMC floss is marked Strandable. The rest are blank.
- **Notes:** discount text and the original stitch and cording text are kept in the canvas notes, so nothing is lost if a row is misread.
- **Output:** 92 canvases, 269 threads and 164 dye lots from the canvases file, plus 31 canvases from the wish list. The converter prints notes for rows it had to interpret.

## Bugs found and fixed

| Bug | Cause or fix |
| --- | --- |
| Canvas wouldn't save with a shop address like `example.com` | The field required `https://`. Since removed along with the field. |
| `+` icon oversized on the empty-state button | The empty-state icon rule also matched the button's icon. |
| Black color swatch hard to see in dark mode | Styled so it stays visible. |
| Stepper line ran through the numbered circles | Circles layered above the line. |
| Converter didn't recognize the "Essenials" typo | Added to the converter. |
| Previous user's cards stayed hidden in the page after logout | Lists are cleared on logout. |
| Empty login boxes showed red error borders | They now look normal until submitted. |
| Hidden radio dots and lot checkboxes appeared in read-only view | `.viewing .field input` and `.viewing .cell input` matched them. Fixed with `:not([type=checkbox]):not([type=radio])`. |
| Photos cropped or clipped in the open item | `height:100%` didn't resolve in the grid. Now absolutely positioned with `object-fit: contain`; read-only frames take the photo's shape. |
| Export menu ran off the screen on phones | Pinned to the screen width below the button. |
| Wrong cording totals on two imported canvases | The converter folded bundles into strands. They're now separate fields. |
| Longer stitch heading cramped the read-only table | Columns rebalanced and headings kept on one line. |
| Guest signup link led to a rejected signup when signups were off | Link hidden when the server reports signups are off. |
| Merge import after the dye lot change left duplicates (433 threads, not 269) | Not a merge bug: the converter's thread IDs changed. Replace all import was added for this. |

## Known limitations

- The server uses plain HTTP and listens on all interfaces. Use HTTPS or a VPN on untrusted networks.
- There is no password reset and no account management UI.
- Searching "gifted" also matches notes. Some imported notes use "Gifted" as a discount, so results can include canvases not marked as gifted.
- Long linked-thread names can be cut off with "…" in the read-only table. Hovering on desktop shows the full name.
- One imported canvas has blank cording bundles, because its spreadsheet entry gives "3 bundles" across 2 colors without saying how they split. The converter's output flags it.
- `npm run convert-csv` and `convert-wishlist` fail on a fresh clone, because the converter and spreadsheets are ignored by git.

## Thread color table

`public/thread-colors.json` gives an approximate color by brand and code, for threads with no photo. It lists whole product lines, not just owned threads, so future additions are covered.

The app loads it at startup with `loadColorTable` and reads it with `tableColor` in `public/app.js`. Cards use the photo, then the table color with an "Approx. color" badge, then the family color, then the spool icon. An open thread with a table color and no photo shows a note under its picture. The file is optional, so `file://` and failed loads fall back to family colors.

Not built yet from the original plan: a manual color field, and word matching on a thread's own name or canvas description.

The file's `meta` block holds the lookup rules and sources. It has 2,246 entries, and 2,061 have a color. That count includes alias entries: 90 for Very Velvet's Petite numbering and 17 for Kreinik codes without their `-01` style suffix.

### Sources by brand

| Brand or line | Source | What it provides | Method | Status |
| --- | --- | --- | --- | --- |
| DMC | `github.com/makebead/craft-color-codes`, `data/json/dmc-floss.json` | Hex by code, 489 colors | `dataset` | Done. CC BY 4.0, so keep the attribution |
| Vineyard Silk | `vineyardsilk.com/photo-galleries/vineyard-silk-classic-gallery/` and `vineyard-silk-tone-gallery/` | Photo for each code, with code and name in the filename | `photo` | 226 done. Other prefixes aren't in these galleries |
| Kreinik | `kreinik.com/store/Tapestry-12-Braid.html` | Photo for each code, no names parsed | `photo` | #12 Braid only. Other sizes have codes this page lacks |
| Silk & Ivory | `brownpaperpackages.com/Silk-and-Ivory/?family=...`, then `subfamilies.asp?sub=...` | Caption `Name (#N)` followed by its photo | `photo` | 250 done, 7 with no color. Its terms restrict reproduction, so store colors only |
| Splendor, Very Velvet, Neon Rays, Silk Lame Braid, Entice, Fuzzy Stuff | `rainbowgallery.com/product/<slug>/` | Code and name lists. Photos show whole cards | `name` | Done. Colors are rough |
| Petite Very Velvet | Rainbow Gallery's Very Velvet page | Maker's rule: V201 becomes V601 | `name` | V2xx codes only |
| Essentials, Pepper Pot, Milan, Planet Earth, Bella Lusso, Petite Sparkle Rays, Neon Rays+, Silk Lame Plus | `theflyingneedles.com/collections/<handle>` | Photo per color. Filename holds code and name, such as `essentials-501-black` | `photo`, from pages the user saved. 57 photos that misled the calculation were redone from hand-marked areas | Blocked by rate limits, see below |
| Snow, Waterlilies | Caron, `caron-net.com` | Charts by code range | Not collected | Caron's `robots.txt` blocks Anthropic crawlers, so stay off it |

Flying Needles collection handles: `essentials`, `pepper-pot`, `milan`, `planet-earth-wool`, `planet-earth-silk-ply`, `bella-lusso-wool-1`, `neon-rays-plus`, `petite-sparkle-rays`, `silk-lame-plus`. Other retailers checked: Stitching Fox (Rainbow Gallery variant titles give code and name, such as `S872-MIDNIGHT BLUE`) and Morgan Julia Designs (per-color Milan products).

### Issues

- **Shopify rate limits:** The Flying Needles, Stitching Fox and Morgan Julia all returned 429. At The Flying Needles, both `products.json` and normal collection pages at one per 30 seconds were limited, and waits grew from 120 to 240 seconds. All three being on Shopify suggests a shared limit by IP address, but that's unconfirmed. Single requests sometimes succeed. A 6-minute pace was still refused. So was `slow-collect.mjs` at 20 minutes per page with waits growing to 2 hours: Essentials page 2 got 6 refusals in a row between 9:10pm and 5:10am on 2026-11-04 and 05, and the run stopped. More slowing down is unlikely to help. Don't disguise requests to look like a person. Use another source, pages saved by the user, or ask the shop. `merge-retailer.mjs` reads `fn-pages/<handle>-<page>.html`, and the Shopify image host wasn't refused at one image per 15 seconds. Pages saved with Ctrl+S, "Webpage, Complete", work: copy the page to `fn-pages/<handle>-<page>.html` and the images in its `_files` folder to `fn-images/`, so nothing is downloaded. Those images are small thumbnails but give good colors. Some are named `.webp` but are really JPEG, which the script now accepts. 583 Limoncello came out a dull olive, which the user confirmed is correct. Import saved pages with `scripts/thread-colors/import-saved.mjs <savedDir> <workDir> <checkDir>`, which names them `<handle>-<page>.html` and copies their pictures, then check with `merge-retailer.mjs --sheet-all`, which shows every color in filename order and writes `fn-sheet.txt` listing each position. Pepper Pot 158 Enamel, 262 Pewter and 263 Elderberry came out wrong (a small skein on a card, and labelled skeins), so they have names but no color. Pepper Pot Silk Variegated files (`pepper-pot-silk-variegated-<code>`) share codes and names with the solid colors and are skipped. A saved page can repeat the previous page's pictures, which is harmless.

#### Saved pages, all lines (2026-11-05)

- Use `scripts/thread-colors/merge-saved.mjs <savedDir> <workDir> <tablePath> [--sheet] [--write] [--only=Brand,...]`. It reads each product card's picture and alt text, such as "Milan 1584 Grapefruit", so filenames don't matter. Milan, Petite Sparkle Rays and Silk Lame Plus pictures have no code in their names. It only adds codes the table doesn't have, and `--sheet` writes `saved-sheet.png` and `saved-sheet.txt` in table order. Split tall sheets with a small script before viewing.
- Don't trust the `collection_viewed` product list in a saved page. When the shopper moves between pages without a reload, it still lists the first page. The cards are right.
- Browser file names vary, such as "Milan – Page 3 – The Flying Needles" and "Essentials - The Flying Needles – Page 2".
- The color calculation is in `color-extract.mjs`, shared by both merge scripts. Small skeins on white now use pixels across the whole photo, keeping the 60% least like the backdrop. Pale and white skeins on white still come out light grey.
- Photos that misled it, later fixed by hand-marked boxes (see below): pale threads on Rainbow Gallery style cards (Essentials 833–836, 842, 861), small skeins on wooden tables (most Planet Earth 6 Ply V13xx, and 1225–1232), labelled skeins where the label dominates (Bella Lusso 278, 563, 723, 967; Pepper Pot 158, 262, 263), and a few others (Pepper Pot 247, Neon Rays+ NP47 and NP300, Planet Earth Silk 1041, 1155, V1005–V1117). The user confirmed Essentials 583 Limoncello's olive is right.
- Left out: Pepper Pot Silk Variegated, which reuses the solid colors' codes and names.
- Milan's names match Essentials, one number apart: Milan 1584 Grapefruit is Essentials 584 Grapefruit.
- **Hand-marked boxes:** `thread-boxes.mjs <savedDir> <workDir> <tablePath> --grid` draws every colorless saved photo with a 10% grid. Write a box per photo as fractions, `"Brand|CODE": [x0, y0, x1, y1]`, then run it with the boxes file to get `boxes-sheet.png`, and add `--write` once the sheet matches. It ignores pixels like the box's border, so a thin box along a skein on wood works. The 57 boxes used are in `scripts/thread-colors/marked-boxes.json`. Very pale skeins on wood still come out slightly grey.
- **Caron:** `robots.txt` names ClaudeBot, anthropic-ai and Claude-Web under `Disallow: /`, although its general rule allows others. Check `robots.txt` before crawling a new site, and read rules by user agent, not just the `Disallow` lines.
- **Planet Earth's site:** `www.planetearthfiber.com` fails with a security certificate error, and the name without `www` failed too.
- **Silk & Ivory photos:** the skein sits on a grey backdrop of varying brightness, with a tag at the left. Averaging washed the colors out. The script now takes colored pixels first, then pixels clearly lighter or darker than the backdrop. Dark neutrals can still land on the backdrop, so these results are set to no color. Spot-check any new photo source against its photos.
- **Silk & Ivory filenames:** they come in several patterns, and the number can disagree with the caption. Use the caption's `(#N)`.
- **Zero padding and prefixes:** codes can differ between the table and saved threads, such as `02` and `2`, or Kreinik's `12/001` and `001`. See `meta.lookupNotes`.
- **Milan numbering:** owned cards use 2xxx, while retailers also list 1xxx with the same names, such as 2561 and 1561 Crawfish. The difference isn't confirmed, so check before treating them as the same color.
- **Very Velvet codes:** some saved Very Velvet threads use Petite numbers (V6xx), so they may be Petite Very Velvet.
- **Not usable as a source:** `nuts-about-needlepoint.com` pages now show gambling spam.
- **Metallics:** one flat color only approximates them.

### Example pictures

- The user asked for a second table of pictures and a Threads page option to show either the approximate color or an example picture. They chose small copies kept with the app over linking to the shops' sites, and later chose to commit them.
- `scripts/thread-colors/build-pictures.mjs <savedDir> <workDir> public [marked-boxes.json]` writes a 200×200 JPEG per code to `public/thread-pictures/<brand>/<CODE>.jpg` and an index at `public/thread-pictures.json`. The user chose to keep both in git so the app can be deployed straight from the repo, knowing the repo is public and the photos belong to the shops and makers. Rebuild after adding brands or saved pages. It takes about a minute.
- Sources: Vineyard Silk, Kreinik and Silk & Ivory from the download cache (`imgcache/`, named after each address), Flying Needles lines from the saved pages, and Essentials page 1 from `fn-images/`. Milan 2xxx reuses the 1xxx file. DMC and the Rainbow Gallery lists have no per-code photo, so they keep the approximate color. 2,586 codes, about 21 MB.
- Source sizes limit sharpness. Kreinik serves only 100x40 strips (`product_variant/100.x`; other sizes return 403 or 404), so each strip is repeated down the square, flipping every other copy. Milan's originals are 500x334 with the skein about 40 pixels thick, and the shop has nothing larger, so the zoom stops at a 130-pixel square.
- Crops: a hand-marked box if there is one, else the area that stands out from the border color. For a long, thin skein, five spots along it are tried and the one closest to the table color is kept, which skips labels in the middle.
- The app loads `thread-pictures.json` beside `thread-colors.json`. Without it, the picture setting falls back to the approximate color. Cards show an "Example" badge, and the thread window shows a small copy with a note. The server now serves `.jpg`.

### Adding a brand

1. Check `robots.txt`, then look for a maker page with a photo per code. Retailer photos are the fallback, and whole-card photos can't be split by code.
2. Add the source to `catalog.mjs`, then run `catalog.mjs`, `build.mjs`, `validate.mjs` and `finalize.mjs`. They're in `scripts/thread-colors/`, which git ignores, so they exist only on this machine. `build.mjs` needs `jpeg-js`, `pngjs` and `omggif` in an `imgtool` folder beside it. Downloads are cached and not kept in the repo.
3. Look at the photo and swatch sheet from `validate.mjs`. Store only calculated colors, never the photos.

## Importing the spreadsheets

Order matters, because each file holds only part of the data:

1. **Import → Replace all data** with `Needlepoint - Canvases.import.json`.
2. **Import → Add to my data** with `Needlepoint - Wish List.import.json`.

Using Replace for both wipes out the first file. Either way, Replace discards edits made in the app, so export a backup first.

## Testing

There is no automated test suite in the repo. Changes were checked with throwaway scripts that drive headless Edge over the Chrome DevTools Protocol, kept in the session's temporary folder, so they may no longer exist.

- **Approach:** start `msedge.exe --headless=new --remote-debugging-port=<port>` with a fresh profile, run steps through `Runtime.evaluate`, set files with `DOM.setFileInputFiles`, and take screenshots at desktop and 390px widths. Record `Runtime.exceptionThrown` to catch script errors.
- **Protecting real data:** test in guest mode on the live server, or start a throwaway server with `PORT=5199` and `DATA_DIR` pointing at a temporary folder.

### Pitfalls

- Fresh Edge profiles open IndexedDB slowly, so wait before asserting.
- Headless Edge can fail to read files from some paths. Copy them to a temporary folder first.
- Long inline Bash heredocs and `sed` with backslashes broke repeatedly. Use the Write tool for test scripts.
- Use a unique username per run against a test server that keeps its data.

### Not verified

- Front and back pictures were tested in guest mode only, not on a logged-in account. Storage is otherwise shared with other fields.
- The README's commands weren't run as written.

## Open items

None of these were requested. Each was offered or noticed along the way:

- A **Gifted** filter chip that shows only canvases marked as gifted, avoiding the notes matches above.
- Showing whole photos on list cards too.
- Committing `scripts/csv-to-backup.mjs` so the npm scripts work on a clone. It's written around the user's own spreadsheet columns.
- It's unknown whether the user's account has been refreshed with the regenerated import files. Older imported data still works: threads act as one-lot threads, and cording rows have no bundle counts.
