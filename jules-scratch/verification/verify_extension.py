from playwright.sync_api import sync_playwright
import time
import json

def run_verification():
    with sync_playwright() as p:
        extension_path = '/app'

        context = p.chromium.launch_persistent_context(
            '', headless=True,
            args=[
                f'--disable-extensions-except={extension_path}',
                f'--load-extension={extension_path}',
            ]
        )

        # Give the service worker time to start up
        time.sleep(2)

        # --- Get Extension ID from service worker ---
        service_worker = None
        for worker in context.service_workers:
            if "background.js" in worker.url:
                service_worker = worker
                break

        if not service_worker:
             # Fallback for Manifest v2 or if service worker is slow
            background_page = None
            for page in context.background_pages:
                 if "background.js" in page.url:
                    background_page = page
                    break
            if not background_page:
                raise Exception("Could not find the extension's background script.")
            extension_id = background_page.url.split('/')[2]
        else:
            extension_id = service_worker.url.split('/')[2]

        print(f"Found Extension ID: {extension_id}")

        page = context.new_page()

        # --- Screenshot the Popup ---
        popup_url = f'chrome-extension://{extension_id}/popup/popup.html'
        page.goto(popup_url)
        time.sleep(1)
        page.screenshot(path='jules-scratch/verification/popup.png')
        print("Popup screenshot taken.")

        # --- Screenshot the Options Page ---
        options_url = f'chrome-extension://{extension_id}/options/options.html'
        page.goto(options_url)
        time.sleep(1)
        page.screenshot(path='jules-scratch/verification/options.png')
        print("Options page screenshot taken.")

        context.close()

if __name__ == '__main__':
    run_verification()
