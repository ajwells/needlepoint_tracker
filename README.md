# Needlepoint Tracker

A small web app for keeping track of your needlepoint threads and canvases. Each user logs in to their own database on the server, or uses guest mode to keep data in their browser.

It has no dependencies and no build step: just Node.js and plain HTML, CSS and JavaScript.

## Getting started

You need [Node.js](https://nodejs.org/). There is nothing to install.

```sh
npm start
```

Open http://localhost:5173, then create an account or continue as a guest. When the server starts, it also prints the addresses other devices on your network can use.

## Features

### Threads

- Record the brand, material, sizes (13, 18, strandable), color family, color, code and a picture.
- Keep a list of dye lots, each with its own amount remaining.
- Search, sort, and filter by color family or by In stash / Out of stock. A thread is out of stock only when it has dye lots and all of them are at exactly 0. An empty amount counts as in stock.
- See which canvases use a thread.

### Canvases

- Track status from wish list through purchased, kitted, in progress and stitched to finished.
- Add pictures of the canvas and of the finished front and back.
- Record the designer, shop, mesh size, purchase date, price, year finished, finish type, who it was gifted to, and notes.
- Build a thread list with links to your threads and the dye lots used.
- Build a cording list with a total size: the sum of strands × bundles for each thread. An empty bundle count is treated as 1.
- Search by name, designer, shop, finish type and more. Searching "gifted" finds gifted canvases.

Existing items open read-only until you press **Edit**. In read-only mode, a canvas's thread and cording lists can be shown as a table that scrolls sideways, or as cards.

### Accounts and guest mode

|  | Account | Guest |
| --- | --- | --- |
| Data is stored | On the server | In this browser only (IndexedDB) |
| Available on other devices | Yes | No, unless you export and import it |

Usernames are 3–32 characters (letters, numbers, `_`, `.`, `-`) and passwords are at least 8 characters. There is no password reset.

### Import and export

**Export** offers three formats:

- **Backup (JSON):** everything, including photos. This is the only format you can import.
- **Threads (CSV):** a spreadsheet of your threads, without photos.
- **Canvases (CSV):** a spreadsheet of your canvases and their thread lists, without photos.

**Import** takes a JSON backup and offers two options:

- **Add to my data:** keeps what you have. Items already in your data are updated from the file.
- **Replace all data:** deletes all your threads and canvases, then loads the file.

## Configuration

Set these environment variables when starting the server:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5173` | Port to listen on. |
| `DATA_DIR` | `./data` | Where accounts and databases are stored. |
| `ALLOW_SIGNUP` | enabled | Set to `false` to stop new accounts from being created. |

macOS, Linux or Git Bash:

```sh
ALLOW_SIGNUP=false PORT=8080 npm start
```

PowerShell:

```powershell
$env:ALLOW_SIGNUP = 'false'; $env:PORT = '8080'; npm start
```

## Hosting

The server listens on all network interfaces, so anyone who can reach the port can open the app. It serves plain HTTP, including passwords and session cookies. On anything other than a trusted network, put it behind an HTTPS reverse proxy or a VPN such as Tailscale.

Once your accounts exist, consider setting `ALLOW_SIGNUP=false`.

## Data and backups

```text
data/
├── users.json       accounts, with hashed passwords
├── sessions.json    login sessions, stored hashed
└── db/
    └── <userId>.json    one user's threads and canvases, including photos
```

To back up the server, copy `DATA_DIR`. It is ignored by git. Photos are stored inside the JSON files, so they can grow large.

## Project layout

```text
index.js             server and JSON API
public/index.html    page structure
public/app.js        all client logic
public/styles.css    styles
```

## Converting a spreadsheet

`scripts/csv-to-backup.mjs` converts a canvases or wish list CSV into a backup file you can load with Import. The script and spreadsheets are personal files ignored by git, so a fresh clone won't include them and the `convert-csv` and `convert-wishlist` npm scripts won't work there.

```sh
npm run convert-csv
npm run convert-wishlist
```

The converter generates the same IDs each time, so importing a regenerated file updates existing records instead of duplicating them. This also overwrites any edits you made to those records in the app.
