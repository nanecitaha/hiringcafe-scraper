import json
import csv
import os
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
# Allows the browser console to send requests to this local server. Chrome also asks
# whether a public site (hiringcafe.com) may reach a local one, so say yes to that too.
CORS(app, allow_private_network=True)

def get_csv_path():
    """Reads the CSV file path from config.json"""
    try:
        with open('config.json', 'r') as f:
            config = json.load(f)
            return config.get('extracted_jobs_csv_file_path', 'jobs_extracted.csv')
    except FileNotFoundError:
        print("config.json not found, defaulting to 'jobs_extracted.csv'")
        return 'jobs_extracted.csv'

MISSING_APPLY_URLS = {'', 'Not found'}

def read_saved_urls(csv_path):
    """Returns (apply_urls, full_view_urls) already in the CSV. The CSV is the record of what's saved."""
    apply_urls, full_view_urls = set(), set()
    if not os.path.isfile(csv_path) or os.path.getsize(csv_path) == 0:
        return apply_urls, full_view_urls
    with open(csv_path, newline='', encoding='utf-8') as file:
        for row in csv.DictReader(file):
            if row.get('Apply URL', '') not in MISSING_APPLY_URLS:
                apply_urls.add(row['Apply URL'])
            if row.get('Full View URL'):
                full_view_urls.add(row['Full View URL'])
    return apply_urls, full_view_urls

@app.route('/api/saved-jobs', methods=['GET'])
def saved_jobs():
    """Lets the scraper skip jobs that are already in the CSV without opening them."""
    apply_urls, full_view_urls = read_saved_urls(get_csv_path())
    return jsonify({"applyUrls": sorted(apply_urls), "fullViewUrls": sorted(full_view_urls)}), 200

@app.route('/api/save-job', methods=['POST'])
def save_job():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Extract the 8 fields exactly as sent by the JavaScript
    company_and_title = data.get('companyAndTitle', '')
    full_view_url = data.get('fullViewUrl', '')
    apply_url = data.get('applyUrl', '')
    responsibilities = data.get('responsibilities', '')
    requirements_summary = data.get('requirementsSummary', '')
    tools = data.get('tools', '')
    full_jd = data.get('fullJD', '')
    timestamp = data.get('timestamp', '')

    csv_path = get_csv_path()

    # Never write the same job twice. Apply URL is the key; Full View URL covers
    # jobs that have no Apply URL.
    saved_apply_urls, saved_full_view_urls = read_saved_urls(csv_path)
    if (apply_url not in MISSING_APPLY_URLS and apply_url in saved_apply_urls) or \
       (full_view_url and full_view_url in saved_full_view_urls):
        print(f"[{timestamp}] Skipped duplicate: {company_and_title}")
        return jsonify({"status": "duplicate"}), 200

    # An existing but empty file still needs the header row
    needs_header = not os.path.isfile(csv_path) or os.path.getsize(csv_path) == 0

    try:
        with open(csv_path, mode='a', newline='', encoding='utf-8') as file:
            # QUOTE_MINIMAL + doubled quotes + CRLF row endings = RFC 4180
            writer = csv.writer(file, quoting=csv.QUOTE_MINIMAL, doublequote=True, lineterminator='\r\n')

            # Write headers if this is a brand new file
            if needs_header:
                writer.writerow([
                    'Company & Title',
                    'Full View URL',
                    'Apply URL',
                    'Responsibilities',
                    'Requirements Summary',
                    'Tools',
                    'Full JD',
                    'Timestamp'
                ])

            # Write the incoming data row
            writer.writerow([
                company_and_title,
                full_view_url,
                apply_url,
                responsibilities,
                requirements_summary,
                tools,
                full_jd,
                timestamp
            ])
            
        print(f"[{timestamp}] Successfully saved: {company_and_title}")
        return jsonify({"status": "saved"}), 200
        
    except Exception as e:
        print(f"Error saving to CSV: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Not port 5000: macOS AirPlay Receiver also listens there and Chrome's requests
    # can land on it (403/503). Must match SERVER_URL in hiringcafe-scraper.js.
    app.run(host='127.0.0.1', port=5055, debug=True)