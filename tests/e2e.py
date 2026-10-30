# End-to-end test in headless Chromium (software WebGL). Usage: python3 tests/e2e.py http://localhost:8099
# v1.2.2: walks the REAL flow: splash -> Start driving -> pick a route -> route loading -> driving.
import sys, time
from playwright.sync_api import sync_playwright
base = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8099'
fails = 0
def ok(n, c, i=''):
    global fails; print(('PASS' if c else 'FAIL') + '  ' + n + (('  [' + str(i) + ']') if i != '' else '')); fails += (not c)

def run(route_id, pick_text):
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page(viewport={'width': 1100, 'height': 700}); errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(base + '/index.html?debug')
        pg.wait_for_function('window.__game && (window.__game.ready || window.__game.error)', timeout=90000)
        ok(f'[{route_id}] engine ready (car + routes + music preloaded)', pg.evaluate('__game.ready'), pg.evaluate('__game.error'))
        ok('music cache filled', pg.evaluate('window.HOODMusicCache.size()') == 3, pg.evaluate('window.HOODMusicCache.size()'))
        fr = pg.frame_locator('#splash-frame')
        fr.locator('#startGameBtn').wait_for(state='visible', timeout=30000)
        ok('"Ready to play?" shows after the sponsor animation', 'READY' in fr.locator('#next-screen h1').inner_text())
        pg.screenshot(path=f'/tmp/e2e_{route_id}_1_ready.png')
        fr.locator('#startGameBtn').click()
        fr.locator('.route-card').first.wait_for(state='visible', timeout=10000)
        cards = fr.locator('.route-card'); ok('picker shows 2 live + 4 locked cards', cards.count() == 6 and fr.locator('.route-card:disabled').count() == 4, cards.count())
        pg.screenshot(path=f'/tmp/e2e_{route_id}_2_routes.png')
        cards.filter(has_text=pick_text).first.click()
        pg.wait_for_function('window.__game.routeLoading === true', timeout=10000); time.sleep(0.4)
        pg.screenshot(path=f'/tmp/e2e_{route_id}_3_loading.png')
        pg.wait_for_function('window.__game.started === true || window.__game.error', timeout=90000)
        g = pg.evaluate('({started:__game.started, error:__game.error, route:__game.route && __game.route.id, hash:location.hash})')
        ok('route loaded and driving started', g['started'] and g['route'] == route_id, g)
        ok('URL carries #/drive/<route>', g['hash'] == '#/drive/' + route_id, g['hash'])
        time.sleep(1.0)
        ok('splash dismissed', pg.evaluate("getComputedStyle(document.getElementById('splash-overlay')).visibility") == 'hidden')
        s0 = pg.evaluate('({x:__game.sim.x,z:__game.sim.z,psi:__game.sim.psi})')
        r = pg.evaluate('__game.route.spawn')
        ok('car starts at the route spawn', abs(s0['x'] - r['x']) < 1 and abs(s0['z'] - r['z']) < 1, s0)
        st = pg.evaluate('__game.stats'); ok('draw calls < 60', 0 < st['calls'] < 60, st['calls'])
        pg.keyboard.down('ArrowUp'); t0 = pg.evaluate('__game.loop.simTime')
        pg.wait_for_function('__game.loop.simTime - %f > 5' % t0, timeout=120000); pg.keyboard.up('ArrowUp')
        s1 = pg.evaluate('({speed:__game.sim.speed*3.6, x:__game.sim.x, z:__game.sim.z, finite:[__game.sim.x,__game.sim.z].every(Number.isFinite), left:document.getElementById("routeLeft").textContent})')
        ok('accelerates and state stays finite', s1['speed'] > 40 and s1['finite'], s1)
        ok('route HUD counts down', s1['left'] not in ('', '—'), s1['left'])
        pg.screenshot(path=f'/tmp/e2e_{route_id}_4_driving.png')
        ok('no console errors', not [e for e in errs if 'favicon' not in e], errs[:3])
        b.close()

run('state-house-eastbound', 'Eastbound')
run('state-house-westbound', 'Westbound')
sys.exit(1 if fails else 0)
