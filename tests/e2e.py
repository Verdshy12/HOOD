# End-to-end test in headless Chromium (software WebGL). Usage: python3 tests/e2e.py http://localhost:8099
import sys, time
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8099'
fails = 0


def ok(name, condition, info=''):
    global fails
    print(('PASS' if condition else 'FAIL') + '  ' + name + (f'  [{info}]' if info else ''))
    fails += not condition


def check_mode_menu():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=[
            '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
            '--no-sandbox', '--ignore-gpu-blocklist'
        ])
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.goto(base + '/index3.html')
        page.locator('#homeRaceTab').wait_for(state='visible', timeout=30000)
        race_panel = page.locator('#homeRacePanel')
        ok('Race menu offers Free Drive and planned Multiplayer',
           race_panel.locator('[data-mode-choice="free-drive"]').count() == 1
           and race_panel.locator('button:disabled').count() == 1)

        page.locator('#homeEventsTab').click()
        event_modes = page.locator('#homeEventsPanel [data-mode-choice]').evaluate_all(
            'buttons => buttons.map(button => button.dataset.modeChoice)'
        )
        ok('Events menu offers Career, Sprint, and Circuit',
           event_modes == ['career', 'sprint', 'circuit'], event_modes)

        page.locator('[data-mode-choice="circuit"]').click()
        routes = page.locator('#route-list .route-card')
        routes.first.wait_for(state='visible', timeout=90000)
        ok('Circuit selection opens the existing route catalogue', routes.count() > 0, routes.count())
        routes.first.click()
        page.wait_for_function(
            'document.getElementById("launch-game") && !document.getElementById("launch-game").disabled',
            timeout=30000
        )
        ok('Circuit selection continues to the existing shared garage',
           page.locator('#garage-view').is_visible())
        previews = page.locator('#garage-list .garage-card img')
        page.wait_for_function(
            'Array.from(document.querySelectorAll("#garage-list .garage-card img"))'
            '.every(image => image.complete && image.naturalWidth > 0)',
            timeout=30000
        )
        ok('garage previews all six stored car images without loading game models',
           previews.count() == 6
           and not page.evaluate(
               'performance.getEntriesByType("resource").some(resource => resource.name.endsWith(".glb"))'
           ))
        ok('garage presents the six cars in a horizontal carousel',
           page.evaluate('''(() => {
               const list = document.querySelector("#garage-list");
               return list.scrollWidth > list.clientWidth
                   && document.querySelectorAll("#garage-list .garage-card").length == 6;
           })()''')
           and page.locator('#garage-scroll-left').count() == 1
           and page.locator('#garage-scroll-right').count() == 1)
        page.locator('#garage-scroll-right').click()
        page.wait_for_function('document.querySelector("#garage-list").scrollLeft > 0')
        ok('right carousel control scrolls cars while NEXT stays available',
           page.locator('#garage-view').is_visible() and page.locator('#launch-game').is_enabled())
        page.locator('#garage-scroll-left').click()
        page.wait_for_function('document.querySelector("#garage-list").scrollLeft < 1')
        ok('garage has a single BACK button',
           page.locator('#setup-screen button').filter(has_text='BACK').count() == 1)

        page.locator('#garage-list [data-car-id="subaru"]').click()
        page.locator('#launch-game').click()
        page.wait_for_url('**/index.html?*', timeout=15000)
        page.wait_for_function(
            'performance.getEntriesByType("resource").some(resource => '
            'resource.name.includes("subaru-wrx-sti.glb"))',
            timeout=30000
        )
        page.wait_for_function('document.body.classList.contains("driving")', timeout=90000)
        ok('circuit HUD hides route-distance and sprint-only items',
           page.locator('#routeRemainingRow').is_hidden()
           and page.locator('#routeEtaRow').is_hidden()
           and page.locator('#sprintHud').is_hidden()
           and page.locator('#circuitHud').is_visible())
        ok('compact driving instrument exposes speed and a nitro icon',
           page.locator('#compactSpeed').count() == 1
           and page.locator('.boost-icon').count() == 1)
        ok('nitro level is integrated into the speedometer arc',
           page.locator('.tachometer #boostFill').count() == 1
           and page.locator('.tachometer #boostPercent').count() == 1
           and page.locator('.boost-panel').count() == 0)
        page.keyboard.down('ArrowUp')
        page.keyboard.down('Shift')
        page.wait_for_function(
            'window.__game.sim.boosting && '
            'window.__game.carRoot.children.find(object => object.name === "nitroBodyGlow")'
            '.material.opacity > 0.3',
            timeout=10000
        )
        nitro_glow = page.evaluate('''(() => {
            const glow = window.__game.carRoot.children.find(object => object.name === "nitroBodyGlow");
            return { opacity: glow.material.opacity, depthTest: glow.material.depthTest };
        })()''')
        page.keyboard.up('ArrowUp')
        page.keyboard.up('Shift')
        ok('nitro illuminates the lower body while boosting',
           nitro_glow['opacity'] > 0.3 and not nitro_glow['depthTest'], nitro_glow)
        loaded_models = page.evaluate(
            'performance.getEntriesByType("resource")'
            '.filter(resource => resource.name.endsWith(".glb"))'
            '.map(resource => resource.name)'
        )
        ok('only the selected car model starts loading after NEXT',
           len(loaded_models) == 1 and 'subaru-wrx-sti.glb' in loaded_models[0],
           loaded_models)
        browser.close()


def run(route_id, pick_text):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=[
            '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader',
            '--no-sandbox',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required'
        ])
        page = browser.new_page(viewport={'width': 1100, 'height': 700})
        errors = []
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/index.html?debug')
        page.wait_for_function('window.__game && (window.__game.ready || window.__game.error)', timeout=90000)
        ok(f'[{route_id}] engine ready (car + routes + music preloaded)',
           page.evaluate('__game.ready'), page.evaluate('__game.error'))
        ok('music cache filled', page.evaluate('window.HOODMusicCache.size()') == 3,
           page.evaluate('window.HOODMusicCache.size()'))
        frame = page.frame_locator('#splash-frame')
        frame.locator('#startGameBtn').wait_for(state='visible', timeout=30000)
        ok('"Ready to play?" shows after the sponsor animation',
           'READY' in frame.locator('#next-screen h1').inner_text())
        page.screenshot(path=f'/tmp/e2e_{route_id}_1_ready.png')
        frame.locator('#startGameBtn').click()
        frame.locator('.route-card').first.wait_for(state='visible', timeout=10000)
        cards = frame.locator('.route-card')
        ok('picker shows 2 live + 4 locked cards',
           cards.count() == 6 and frame.locator('.route-card:disabled').count() == 4,
           cards.count())
        page.screenshot(path=f'/tmp/e2e_{route_id}_2_routes.png')
        cards.filter(has_text=pick_text).first.click()
        page.wait_for_function('window.__game.routeLoading === true', timeout=10000)
        time.sleep(0.4)
        page.screenshot(path=f'/tmp/e2e_{route_id}_3_loading.png')
        page.wait_for_function(
            'window.__game.started === true || window.__game.error', timeout=90000
        )
        game_state = page.evaluate(
            '({started:__game.started, error:__game.error, route:__game.route && __game.route.id, hash:location.hash})'
        )
        ok('route loaded and driving started',
           game_state['started'] and game_state['route'] == route_id, game_state)
        ok('loading indicator completes instead of remaining at 0%',
           page.locator('.boot-meter').get_attribute('aria-valuenow') == '100'
           and page.locator('#boot-percent').inner_text().strip() == '100%')
        ok('URL carries #/drive/<route>', game_state['hash'] == '#/drive/' + route_id,
           game_state['hash'])
        time.sleep(1.0)
        ok('splash dismissed',
           page.evaluate("getComputedStyle(document.getElementById('splash-overlay')).visibility") == 'hidden')
        spawn = page.evaluate('({x:__game.sim.x,z:__game.sim.z,psi:__game.sim.psi})')
        route_spawn = page.evaluate('__game.route.spawn')
        ok('car starts at the route spawn',
           abs(spawn['x'] - route_spawn['x']) < 1 and abs(spawn['z'] - route_spawn['z']) < 1,
           spawn)
        stats = page.evaluate('__game.stats')
        ok('draw calls < 60', 0 < stats['calls'] < 60, stats['calls'])
        page.keyboard.down('ArrowUp')
        start_time = page.evaluate('__game.loop.simTime')
        page.wait_for_function('__game.loop.simTime - %f > 5' % start_time, timeout=120000)
        page.keyboard.up('ArrowUp')
        driving = page.evaluate('''({
            speed:__game.sim.speed*3.6,
            x:__game.sim.x,
            z:__game.sim.z,
            finite:[__game.sim.x,__game.sim.z].every(Number.isFinite),
            left:document.getElementById("routeLeft").textContent
        })''')
        ok('accelerates and state stays finite', driving['speed'] > 40 and driving['finite'], driving)
        ok('route HUD counts down', driving['left'] not in ('', '—'), driving['left'])
        page.screenshot(path=f'/tmp/e2e_{route_id}_4_driving.png')
        page.keyboard.press('Escape')
        page.wait_for_function("document.getElementById('pauseOverlay').hidden === false")
        pause = page.evaluate('''({
            route: document.getElementById('pauseTitle').textContent,
            car: document.getElementById('pauseCarName').textContent,
            mode: __game.circuit ? 'circuit' : __game.race ? 'sprint' : 'free-drive',
            primary: document.getElementById('pausePrimaryLabel').textContent,
            secondary: document.getElementById('pauseSecondaryLabel').textContent,
            values: [
                document.getElementById('pausePrimaryValue').textContent,
                document.getElementById('pauseSecondaryValue').textContent
            ]
        })''')
        ok('pause panel identifies the route and vehicle',
           pause['route'] and pause['car'], pause)
        expected_labels = {
            'circuit': ('LAST LAP TIME', 'BEST LAP TIME'),
            'sprint': ('CHECKPOINT', 'ELAPSED'),
            'free-drive': ('DISTANCE', 'ACTIVE TIME')
        }[pause['mode']]
        ok('pause panel shows stats for the active mode',
           (pause['primary'], pause['secondary']) == expected_labels
           and all(value not in ('', '—') for value in pause['values']), pause)
        ok('no console errors', not [error for error in errors if 'favicon' not in error], errors[:3])
        browser.close()


check_mode_menu()
run('state-house-eastbound', 'Eastbound')
run('state-house-westbound', 'Westbound')
sys.exit(1 if fails else 0)
