# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

A HiringCafe job scraper. It saves jobs from a HiringCafe search page into a local CSV, one row per job, with:
company and title, apply link, job-page link, responsibilities, requirements, tools, and the full job description.

It has two parts:

- **The extension** (`chrome-extension/`) reads jobs on hiringcafe.com.
- **The server** (`tech_stack_server.py`), a small local Flask app, writes them to the CSV.

The scraper clicks nothing on job cards. It reads the job data the page already holds, and skips jobs already in the CSV.

## Layout

| File | Role |
|---|---|
| `chrome-extension/manifest.json` | Manifest V3. Runs `scraper.js` in the page's own context (`"world": "MAIN"`) and `bridge.js` in the isolated context, on `https://hiringcafe.com/*`. Only permission: `storage`. |
| `chrome-extension/scraper.js` | The scrape loop. Runs in the page context because it reads React data on DOM nodes, which isolated scripts can't see. Has no `chrome.*` APIs. |
| `chrome-extension/bridge.js` | Relays messages between the page (`scraper.js`) and the popup through `window.postMessage` on channel `hc-scraper` (`dir: 'to-page'` / `'to-ext'`). Remembers the last status for a popup that opens later. |
| `chrome-extension/popup.html`, `popup.js` | Choice of job count or until-Stop, Start/Stop, live status, and the server URL. The URL is saved in `chrome.storage.local`; the default is `http://127.0.0.1:5055`. |
| `hiringcafe-scraper.js` | The same scraper as a console-paste script: it asks for the count with `window.prompt` and has the server URL hard-coded. **Keep it in sync with `scraper.js`.** |
| `tech_stack_server.py` | Flask with CORS, on `127.0.0.1:5055`. `GET /api/saved-jobs` returns the links already saved; `POST /api/save-job` adds a row and returns `{"status":"saved"}` or `{"status":"duplicate"}`. Reads the CSV path from `config.json` if present, otherwise uses `jobs_extracted.csv`. |

## How a job is read

- **Cards:** every `[data-quick-job-card]` inside the results area. That's `[data-testid="jobs-content"]` on Talent Agent `/ai-search/...` pages, and `[data-testid="job-results"]` on Classic `/classic?...` pages.
- **The job object:** on the card's React fiber, at `fiber.return.memoizedProps.job`. Fields used: `v5_processed_job_data.company_name`, `job_information.title`, `apply_url`, `v5_processed_job_data.role_activities`, `requirements_summary`, `technical_tools`.
- **Job-page link:** the card's `a[href^="/job/"]`.
- **Full description:** the job page is fetched, and the description is read from its `__NEXT_DATA__` script (`props.pageProps.job.job_information.description`), then converted from HTML to text.
- **Paging:**
  - Talent Agent: `[data-testid="pagination-goto-form"]` ("Page [ ] of N").
  - Classic: `nav[aria-label="Pagination"]` and its "Next page" link.
- **Pacing:** about 1 second between jobs. Don't speed it up.

HiringCafe redesigns from time to time. The selectors and the React internals above are the fragile part. When the
scraper breaks, look there first, using a saved copy of the page's HTML.

## Running it

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python tech_stack_server.py
```

To load the extension:
1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and choose `chrome-extension/`.
3. Reload any HiringCafe tab that was already open.

## Rules

- **Never bypass HiringCafe's protections.** HiringCafe uses a Cloudflare check that blocks headless browsers. Don't try to get around it: no stealth plugins, no faked browser fingerprints, no CAPTCHA solving. Test in a normal Chrome window that the user drives.
- **Keep the pace polite.** Don't remove the waits or run several scrapes in parallel.
- **Never commit personal data.** That means `config.json`, `*.csv` and job lists; `.gitignore` already covers them. Put no real names, emails or local paths in code or docs.
- **Work on a branch.** Every change starts on a new branch. Don't merge or push unless the user says so.
- **Keep the two scrapers in sync.** A change to `scraper.js` usually belongs in `hiringcafe-scraper.js` too.
- **Keep the CSV columns stable.** Other tools read this CSV by its column names. Only rename or reorder columns with the user's OK, and update the README when you do.

## Testing

There's no automated test suite yet. To check a change:
1. Start the server against a throwaway CSV: point `config.json` at a test file, not the user's real CSV.
2. Load the extension and run a small scrape of 2 or 3 jobs on a HiringCafe search page.
3. Check the CSV rows and that a second run reports the same jobs as skipped.
4. For server-only changes, you can test the two routes with `curl` against the throwaway CSV.

If you add tests, use saved HTML fixtures and a mock server. Tests must never hit hiringcafe.com.
