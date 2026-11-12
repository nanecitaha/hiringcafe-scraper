# HiringCafe Job Scraper

Saves jobs from a HiringCafe search page into a CSV: company and title, apply link, job page link,
responsibilities, requirements, tools, and the full job description. It clicks nothing on the site; it reads
the job data already on the page, and skips jobs already in the CSV.

Two parts work together:

| Part | What it does |
|---|---|
| `chrome-extension/` | Chrome extension. Runs on `hiringcafe.com` and sends each job to the server. |
| `tech_stack_server.py` | Small local server on port 5055. Writes the jobs to the CSV and says which are already saved. |

`hiringcafe-scraper.js` is the same scraper as a script you paste into Chrome's console instead of installing
the extension. Keep the two in sync if you change one.

## Setup

1. **Server** (Python 3.10+):
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   python tech_stack_server.py
   ```
   It writes `jobs_extracted.csv` next to the script. To use another file, copy `config.example.json` to
   `config.json` and change the path.

2. **Extension:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the
   `chrome-extension` folder.

## Use

1. Keep the server running.
2. Open a HiringCafe search (both the Talent Agent `/ai-search/...` page and the Classic `/classic?...` page work).
3. Click the extension, choose how many new jobs to save (or run until Stop), and press **Start**.
4. The popup shows progress. Jobs land in the CSV.

The popup's server address must point at the server (default `http://127.0.0.1:5055`). Port 5055 is used instead
of 5000 because macOS AirPlay Receiver takes 5000.

## Server routes

- `GET /api/saved-jobs`: apply and job-page links already in the CSV, so the scraper skips them.
- `POST /api/save-job`: adds one job. Returns `{"status":"duplicate"}` if it's already there, else `{"status":"saved"}`.

## How it reads a job

Each `[data-quick-job-card]` element carries the job on its React data (`fiber.return.memoizedProps.job`):

| CSV column | Source |
|---|---|
| Company & Title | `v5_processed_job_data.company_name` + ` - ` + `job_information.title` |
| Apply URL | `apply_url` |
| Full View URL | the card's `a[href^="/job/"]` link |
| Responsibilities | `v5_processed_job_data.role_activities` |
| Requirements Summary | `v5_processed_job_data.requirements_summary` |
| Tools | `v5_processed_job_data.technical_tools` |
| Full JD | the job page's `__NEXT_DATA__` description, converted to text |

## Notes

- HiringCafe redesigns now and then. The selectors and React internals are the fragile part.
- Run it in your normal Chrome while signed in as yourself. HiringCafe blocks headless browsers; don't try to
  get around that.
