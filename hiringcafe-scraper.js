(async function() {
  // Ask how many new jobs to save. Empty = keep going until the Stop button is clicked.
  const answer = window.prompt(
    'How many NEW jobs should I save?\n\n' +
    '• Enter a number (e.g. 50)\n' +
    '• Or leave it empty to keep going until you click "Stop scraping"',
    ''
  );
  if (answer === null) {
    console.log("Cancelled. Nothing was scraped.");
    return;
  }
  let MAX_JOBS = Infinity;
  if (answer.trim() !== '') {
    MAX_JOBS = Number(answer.trim());
    if (!Number.isInteger(MAX_JOBS) || MAX_JOBS < 1) {
      console.warn(`"${answer}" is not a whole number above 0. Run the script again.`);
      return;
    }
  }
  const progress = (n) => MAX_JOBS === Infinity ? `${n} so far` : `${n} of ${MAX_JOBS}`;
  console.log(MAX_JOBS === Infinity
    ? 'Running until you click "Stop scraping" (or the last page is done).'
    : `Will save up to ${MAX_JOBS} new job(s).`);

  // Port 5055, not 5000: macOS AirPlay Receiver also uses 5000.
  const SERVER_URL = 'http://127.0.0.1:5055/api/save-job';
  const SAVED_JOBS_URL = 'http://127.0.0.1:5055/api/saved-jobs';
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function waitFor(fn, timeout = 8000, interval = 150) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = fn();
      if (result) return result;
      await sleep(interval);
    }
    return null;
  }

  // The job description is HTML. Turn it into plain text like the old panel's innerText:
  // a blank line between paragraphs and headings, one line per bullet.
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html'); // inert: nothing in it runs or loads
    const PARAGRAPH = /^(P|H[1-6]|UL|OL|SECTION|ARTICLE|BLOCKQUOTE|TABLE)$/;
    const LINE = /^(DIV|LI|BR|TR)$/;
    let out = '';
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) out += child.textContent.replace(/\s+/g, ' ');
        else if (child.nodeType === Node.ELEMENT_NODE) {
          const gap = PARAGRAPH.test(child.tagName) ? '\n\n' : LINE.test(child.tagName) ? '\n' : '';
          out += gap;
          walk(child);
          out += gap;
        }
      }
    })(doc.body);
    return out.split('\n').map(line => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // The job's own page (/job/<slug>) embeds the full job, description included, as JSON.
  async function fetchFullJD(jobPageUrl) {
    const html = await (await fetch(jobPageUrl)).text();
    const script = new DOMParser().parseFromString(html, 'text/html').getElementById('__NEXT_DATA__');
    const job = script && JSON.parse(script.textContent).props.pageProps.job;
    return htmlToText(job && job.job_information && job.job_information.description);
  }

  // "a,b" or ["a","b"] -> "a, b"
  const asList = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
    .map(item => String(item).trim()).filter(Boolean).join(', ');

  // Everything the CSV needs, read from the job object React attaches to the card.
  // HiringCafe no longer opens a side panel from the results grid, so nothing is clicked.
  async function getJobData(card) {
    const job = getJobFromCard(card);
    if (!job) return null;
    const details = job.v5_processed_job_data || {};
    const info = job.job_information || {};
    const link = card.querySelector('a[href^="/job/"]');
    const fullViewUrl = link ? link.href : '';
    let fullJD = '';
    if (fullViewUrl) {
      try {
        fullJD = await fetchFullJD(fullViewUrl);
      } catch (err) {
        console.warn('[HiringCafe scraper] Could not load the full description:', err);
      }
    }
    return {
      companyAndTitle: `${details.company_name || ''} - ${info.title || details.core_job_title || ''}`,
      fullViewUrl,
      applyUrl: job.apply_url || 'Not found',
      responsibilities: asList(details.role_activities),
      requirementsSummary: details.requirements_summary || '',
      tools: asList(details.technical_tools),
      fullJD,
      timestamp: new Date().toISOString()
    };
  }

  // The component that renders each card receives the same job object (with apply_url)
  // as a prop, so we can recognise a saved job without opening it. It sits just above
  // the card's root element; stay close so we never pick up another card's job.
  function getJobFromCard(card) {
    const fiberKey = Object.keys(card).find(k => k.startsWith('__reactFiber'));
    let fiber = fiberKey && card[fiberKey];
    for (let depth = 0; fiber && depth < 4; depth++) {
      const job = fiber.memoizedProps && fiber.memoizedProps.job;
      if (job && typeof job === 'object') return job;
      fiber = fiber.return;
    }
    return null;
  }

  // Cards live in two grids: "jobs-grid" holds the direct matches, and a second grid
  // without a test id holds "Other jobs you might want to see" (related jobs). Once the
  // matches run out (around page 15-16) only the related grid is left. So take cards from
  // the whole results area, not just "jobs-grid".
  // Talent Agent search puts them in "jobs-content", Classic search in "job-results".
  const getResultsArea = () => document.querySelector('[data-testid="jobs-content"], [data-testid="job-results"]');
  const getLiveCards = () => {
    const area = getResultsArea();
    return area ? area.querySelectorAll('[data-quick-job-card]') : [];
  };

  // No infinite scroll. Talent Agent search has a "Page [ ] of N [Go]" form below the grid;
  // Classic search has numbered page links with a "Next page" arrow.
  const getPagerForm = () => document.querySelector('[data-testid="pagination-goto-form"]');
  const getPagerNav = () => document.querySelector('nav[aria-label="Pagination"]');
  const getNextLink = () => {
    const nav = getPagerNav();
    return nav && nav.querySelector('a[aria-label="Next page"]:not([aria-disabled="true"])');
  };

  // { current, total, hasNext }. On Classic search, total is the highest page link shown (more may follow).
  function getPageInfo() {
    const form = getPagerForm();
    if (form) {
      const input = form.querySelector('input');
      const total = form.innerText.match(/of\s+(\d+)/);
      const current = parseInt(input && input.value, 10) || 1;
      const last = total ? parseInt(total[1], 10) : 1;
      return { current, total: last, hasNext: current < last };
    }
    const nav = getPagerNav();
    if (!nav) return null;
    const currentLink = nav.querySelector('[aria-current="page"]');
    const current = parseInt(currentLink && currentLink.textContent, 10) || 1;
    const numbers = Array.from(nav.querySelectorAll('a')).map(a => parseInt(a.textContent, 10)).filter(Boolean);
    return { current, total: Math.max(current, ...numbers), hasNext: !!getNextLink() };
  }

  // A rough fingerprint of the cards on screen, used to tell when a new page has rendered.
  const gridSignature = () => Array.from(getLiveCards()).slice(0, 3).map(c => c.innerText.slice(0, 120)).join('|');

  async function goToPage(pageNumber) {
    const before = gridSignature();
    const form = getPagerForm();
    const input = form && form.querySelector('input');
    if (input) {
      // React tracks input values internally, so set it through the native setter.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(pageNumber));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();
    } else {
      const next = getNextLink();
      if (!next) return false;
      next.click(); // a client-side link: the page swaps the cards without reloading
    }

    const changed = await waitFor(() => {
      const info = getPageInfo();
      return info && info.current === pageNumber && getLiveCards().length > 0 && gridSignature() !== before;
    }, 15000, 250);
    window.scrollTo({ top: 0 });
    await sleep(1000);
    return !!changed;
  }

  // The CSV is the record of what's already saved; the server reads it for us.
  let savedApplyUrls;
  try {
    const savedJobs = await (await fetch(SAVED_JOBS_URL)).json();
    savedApplyUrls = new Set(savedJobs.applyUrls);
    console.log(`Found ${savedApplyUrls.size} job(s) already in the CSV. Those will be skipped.`);
  } catch (err) {
    console.warn("Could not load saved jobs from the server. Is it running? Halting.", err);
    return;
  }

  let saved = 0;
  let skipped = 0;

  // Floating Stop button. Stopping waits for the current job to finish saving,
  // so a row is never half-written. window.stopScraper() does the same from the console.
  let stopRequested = false;
  const stopButton = document.createElement('button');
  stopButton.textContent = '⏹ Stop scraping';
  Object.assign(stopButton.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: 2147483647,
    padding: '12px 18px', borderRadius: '999px', border: 'none', cursor: 'pointer',
    background: '#dc2626', color: '#fff', font: 'bold 14px system-ui, sans-serif',
    boxShadow: '0 4px 14px rgba(0,0,0,.25)'
  });
  const requestStop = () => {
    if (stopRequested) return;
    stopRequested = true;
    stopButton.textContent = 'Stopping after this job…';
    stopButton.style.background = '#6b7280';
    stopButton.disabled = true;
    console.log("⏹ Stop requested. Finishing the current job, then stopping.");
  };
  stopButton.addEventListener('click', requestStop);
  window.stopScraper = requestStop;
  document.body.appendChild(stopButton);

  scrape:
  while (saved < MAX_JOBS && !stopRequested) {
    const pageInfo = getPageInfo() || { current: 1, total: 1 };
    const cardsOnPage = getLiveCards().length;
    console.log(`\n===== Page ${pageInfo.current} of ${pageInfo.total} (${cardsOnPage} cards) =====`);

    for (let i = 0; i < cardsOnPage && saved < MAX_JOBS && !stopRequested; i++) {
      console.log(`\n--- Page ${pageInfo.current}, card ${i + 1} of ${cardsOnPage} (saved ${progress(saved)}) ---`);

      try {
        // Re-query the grid and the card fresh on every iteration (React redraws them).
        if (!getResultsArea()) {
          console.warn("Could not find the job results! Halting.");
          break scrape;
        }

        const liveCards = getLiveCards();
        if (i >= liveCards.length) {
          console.warn("Card list shrank while processing this page. Moving on.");
          break;
        }

        const card = liveCards[i];

        const cardJob = getJobFromCard(card);
        if (cardJob && cardJob.apply_url && savedApplyUrls.has(cardJob.apply_url)) {
          skipped++;
          console.log("⏭️  Already saved, skipping.");
          continue;
        }

        console.log("1. Reading the job from the card...");
        const jobData = await getJobData(card);
        if (!jobData) {
          console.warn("   -> No job data on this card. Moving to next.");
          continue;
        }
        const { companyAndTitle, applyUrl } = jobData;

        console.log(`2. Sending to server: ${companyAndTitle}`);
        const response = await fetch(SERVER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jobData)
        });

        const result = response.ok ? await response.json() : null;
        if (result && result.status === 'duplicate') {
          skipped++;
          console.log("⏭️  Server says this job is already in the CSV. Not counted.");
        } else if (response.ok) {
          saved++;
          savedApplyUrls.add(applyUrl);
          console.log(`✅ Successfully saved job ${progress(saved)}.`);
        } else {
          console.warn(`❌ Server returned ${response.status}. Halting.`);
          break scrape;
        }

        await sleep(1000);

      } catch (err) {
        console.error(`🚨 Error processing page ${pageInfo.current}, card ${i + 1}:`, err);
        break scrape;
      }
    }

    if (saved >= MAX_JOBS || stopRequested) break;

    const info = getPageInfo();
    if (!info || !info.hasNext) {
      console.warn("Reached the last page. Stopping.");
      break;
    }

    console.log(`\n➡️  Going to page ${info.current + 1}...`);
    if (!(await goToPage(info.current + 1))) {
      console.warn("Next page did not load. Stopping.");
      break;
    }
  }

  stopButton.remove();
  delete window.stopScraper;
  console.log(`🎉 Script finished${stopRequested ? ' (stopped by you)' : ''}! Saved ${saved} new job(s), skipped ${skipped} already saved.`);
})();
