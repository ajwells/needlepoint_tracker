# Session log

Handover notes for future working sessions. Covers the build from 2026-10-31 to 2026-11-03, up to commit `b333064`. For what the app does and how to run it, see `README.md`. This file records how it got here and why.

This repo has a GitHub remote, so keep personal data out of this file: no network addresses, passwords, or spreadsheet contents.

## Current state

- All requested work is finished and pushed. `master` matches `origin/master`.
- **Next step:** nothing is pending. See [Open items](#open-items) for optional follow-ups.
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
