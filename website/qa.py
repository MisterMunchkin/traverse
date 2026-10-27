"""Optional repository-only Chrome QA. Start npm run site:preview first."""
import json
import os
import pathlib
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / '.checks/site/browser'
URL = 'http://127.0.0.1:4173'
OUT.mkdir(parents=True, exist_ok=True)
checks = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'),
        headless=True, args=['--no-sandbox'],
    )
    context = browser.new_context(permissions=['clipboard-read', 'clipboard-write'], reduced_motion='reduce')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    response = page.goto(URL)
    assert response.status == 200
    for width in [320, 390, 768, 1024, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Horizontal page overflow at {width}'
        assert page.locator('h1').is_visible()
        for node in page.locator('[data-route]').all():
            box = node.bounding_box()
            assert box['width'] >= 44 and box['height'] >= 44
            assert 0 <= box['x'] and box['x'] + box['width'] <= width
        for name in ['Main navigation']:
            assert page.get_by_role('navigation', name=name).is_visible()
        checks.append(f'{width}px: no horizontal overflow; navigation, heading and graph targets visible')
        if width in [390, 1440]:
            page.screenshot(path=str(OUT / f'{"mobile" if width == 390 else "desktop"}.png'), full_page=True)

    # Keyboard-only entry, graph selection, visible focus and disclosure controls.
    page.goto(URL)
    page.keyboard.press('Tab')
    assert page.get_by_role('link', name='Skip to content').evaluate('(element) => element === document.activeElement')
    page.keyboard.press('Enter')
    assert page.evaluate('location.hash') == '#main'
    home = page.get_by_role('button', name='Home')
    home.focus()
    assert home.evaluate('(element) => getComputedStyle(element).outlineStyle') == 'solid'
    page.keyboard.press('Enter')
    assert home.get_attribute('aria-pressed') == 'true'
    assert page.locator('#route-source').inner_text() == 'app/index.tsx'
    page.keyboard.press('Tab')
    page.keyboard.press('Space')
    assert page.locator('[data-route="notes"]').get_attribute('aria-pressed') == 'true'
    assert page.locator('[aria-pressed="true"]').count() == 1
    first_summary = page.locator('summary').first
    first_summary.focus()
    page.keyboard.press('Enter')
    assert page.locator('#model-setup').get_attribute('open') is not None
    page.keyboard.press('Space')
    assert page.locator('#model-setup').get_attribute('open') is None
    checks.append('Keyboard: skip link, visible focus, Enter/Space graph selection and disclosure open/close pass')

    page.locator('[data-copy="install-code"]').click()
    page.wait_for_function('document.querySelector("#copy-status").textContent.includes("copied")')
    assert page.evaluate('navigator.clipboard.readText()') == page.locator('#install-code').inner_text()
    page.locator('[data-copy="graph-code"]').click()
    assert page.evaluate('navigator.clipboard.readText()') == page.locator('#graph-code').inner_text()
    checks.append('Both copy buttons copy the exact displayed command block')

    for anchor in ['#how-it-works', '#compatibility', '#guides', '#quick-start', '#model-setup', '#top']:
        page.locator(f'a[href="{anchor}"]').first.click()
        assert page.evaluate('location.hash') == anchor
        assert page.locator(anchor).is_visible()
    assert page.locator('#model-setup').get_attribute('open') is not None
    page.goto(URL + '/#model-setup')
    assert page.locator('#model-setup').get_attribute('open') is not None
    checks.append('All section destinations and direct model-setup deep link work')
    assert page.evaluate('getComputedStyle(document.documentElement).scrollBehavior') == 'auto'
    checks.append('Reduced motion disables smooth scrolling')
    assert not errors, errors
    checks.append('No browser console errors or uncaught JavaScript exceptions')

    no_js = browser.new_context(java_script_enabled=False, viewport={'width': 390, 'height': 844})
    plain = no_js.new_page()
    plain.goto(URL)
    assert plain.get_by_role('heading', level=1).is_visible()
    assert plain.locator('#install-code').is_visible()
    assert not plain.locator('[data-copy]').first.is_visible()
    assert plain.locator('noscript').is_visible()
    plain.locator('summary').first.click()
    assert plain.locator('#model-setup').get_attribute('open') is not None
    checks.append('No JavaScript: content, commands and native disclosures remain available; copy buttons hidden')
    browser_version = browser.version
    browser.close()

receipt = {
    'testedAt': datetime.now(timezone.utc).isoformat(),
    'browser': f'Chromium {browser_version}',
    'url': URL,
    'checks': checks,
    'screenshots': ['desktop.png', 'mobile.png'],
    'limitations': 'Emulated viewports in headless Chromium on Linux; no physical device, screen reader, Safari or Firefox testing. This validates the website, not Traverse live UI driving.',
}
(OUT / 'results.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt, indent=2))
