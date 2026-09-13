import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fork } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const names = { padel: 'Padel Jules Ladoumègue', tennis: 'Edouard Pailleron' }
const ids = { padel: 4830, tennis: 4400 }
const catalog = { features: Object.entries(names).map(([sport, name], i) => ({ properties: {
  general: { _id: i + 1, _nomSrtm: name, _arrondissement: 19 },
  courts: [{ _airId: ids[sport], _airNom: sport === 'padel' ? 'Padel n°01' : 'Court n°01', _formattedAirNum: 1 }],
} })) }

// Exercise the real entry point against a local site, with no account or network service.
const runFixture = async (t, { padel = true, tennis = true, dryRun = false, brokenHold = false, uncertainSubmit = false, padelPrice = 'Gratuité' } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'tennis-browser-fallback-'))
  const observed = { searches: [], holds: [], submissions: [], aborts: 0 }
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture')
    const sport = url.searchParams.get('sport') || 'padel'
    let html = ''
    if (url.pathname.endsWith('abortBooking')) { observed.aborts++; res.end('ok'); return }
    if (url.pathname === '/login') html = '<div class="main-informations">Connected</div>'
    else if (url.searchParams.get('view') === 'start') html = '<button id="button_suivi_inscription">Login</button><form id="form-login" action="/login"><input id="username"><input id="password"><button>Connect</button></form>'
    else if (url.searchParams.get('page') === 'recherche') html = `<script>var tennis = ${JSON.stringify(catalog)};</script>
      <form action="/results"><input class="tokens-input-text"><input type="hidden" name="sport" id="sport">
      <div class="tokens-suggestions-list-element">${Object.entries(names).map(([kind, name]) => `<button type="button" onclick="document.querySelector('#sport').value='${kind}'">${name}</button>`).join('')}</div>
      <button type="button" id="when" onclick="document.querySelector('.date-picker').style.display='block'">Date</button>
      <div class="date-picker" style="display:none"><button type="button" dateiso="21/09/2026" onclick="this.parentElement.style.display='none'">21</button></div>
      <button id="rechercher">Search</button></form>`
    else if (url.pathname === '/results') {
      observed.searches.push(sport)
      html = (sport === 'padel' ? padel : tennis)
        ? `<div class="row tennis-court"><div class="price-description">${sport === 'padel' ? padelPrice : 'Gratuité'}<br>Couvert</div><a courtid="${ids[sport]}" datedeb="2026/09/21 20:00:00" href="/hold?sport=${sport}">Book</a></div>`
        : '<div>No slots</div>'
    } else if (url.pathname === '/hold' || url.pathname === '/partners') {
      if (url.pathname === '/hold') observed.holds.push(sport)
      html = brokenHold ? '<div>Hold failed</div>' : `<div class="order-steps-infos"><h2>1 / 3 - Validation du court</h2></div>
        <form action="/payment"><input type="hidden" name="sport" value="${sport}"><input name="player1"><input name="player1"><button>Continue</button></form>
        <button id="btnCancelBooking" onclick="fetch('/tennis/rest/abortBooking',{method:'POST'})">Cancel</button>`
    } else if (url.pathname === '/payment') html = `<div class="order-steps-infos"><h2>2 / 3 - Mode de paiement</h2></div>
      <div class="priceTable"><button class="price-item" paymentMode="free">Gratuité</button></div>
      <a id="previous" href="/partners?sport=${sport}">Previous</a><div class="step-two"><a id="submit" href="/confirm?sport=${sport}">Confirm</a></div>`
    else if (url.pathname === '/confirm') {
      observed.submissions.push(sport)
      html = uncertainSubmit ? '<div>No confirmation received</div>' : `<div class="confirmReservation">Confirmed</div><div class="address">${names[sport]}</div><div class="date">21/09/2026 à 20h</div><div class="court">${sport} 1</div>`
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(root, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${server.address().port}`
  // Only URLs and timeouts change; the selection, checkout, IPC and cancellation code stays intact.
  const source = readFileSync('index.js', 'utf8')
    .replaceAll('https://tennis.paris.fr', origin)
    .replace(/from '(\.\/[^']+)'/g, (_, path) => `from '${pathToFileURL(resolve(path)).href}'`)
    .replace('headed: HEADED_MODE, debug:', 'timeoutMs: 1000, headed: HEADED_MODE, debug:')
    .replace('page.setDefaultTimeout(90000)', 'page.setDefaultTimeout(2000)')
  writeFileSync(join(root, 'index.mjs'), source)
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'))
  const configPath = join(root, 'config.json')
  writeFileSync(configPath, JSON.stringify({
    account: { email: 'fixture@example.invalid', password: 'fixture' }, ai: { enable: false }, ntfy: { enable: false },
    sport: 'padel', date: '21/09/2026', locations: [names.padel], hours: ['20'], courtType: ['Couvert'], priceType: ['Gratuité'],
    players: [{ firstName: 'Test', lastName: 'Partner' }], fallbacks: [{ sport: 'tennis', locations: [names.tennis] }],
  }))
  const child = fork(join(root, 'index.mjs'), dryRun ? ['--dry-run'] : [], {
    cwd: root, silent: true, env: { ...process.env, TENNIS_CONFIG_PATH: configPath, NTFY_TOPIC: '', GITHUB_ACTIONS: '' },
  })
  t.after(() => child.kill())
  let output = ''
  const outcomes = []
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  child.on('message', message => outcomes.push(message.status))
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 20000)
  const [code] = await once(child, 'exit')
  clearTimeout(watchdog)
  return { ...observed, outcomes, code, output, ics: existsSync(join(root, 'event.ics')) ? readFileSync(join(root, 'event.ics'), 'utf8') : '' }
}

test('available padel stops before the tennis fallback and produces a padel ICS', async t => {
  const result = await runFixture(t)
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(result.searches, ['padel'])
  assert.deepEqual(result.submissions, ['padel'])
  assert.deepEqual(result.outcomes, ['submitted', 'confirmed'])
  assert.match(result.ics, /SUMMARY:Réservation Padel/)
})
test('missing padel falls back to tennis exactly once and produces a tennis ICS', async t => {
  const result = await runFixture(t, { padel: false })
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(result.searches, ['padel', 'tennis'])
  assert.deepEqual(result.holds, ['tennis'])
  assert.deepEqual(result.submissions, ['tennis'])
  assert.match(result.ics, /SUMMARY:Réservation Tennis/)
})
test('incompatible padel price falls back and dry-run cancels tennis without submitting', async t => {
  const result = await runFixture(t, { padelPrice: 'Tarif plein', dryRun: true })
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(result.searches, ['padel', 'tennis'])
  assert.deepEqual(result.holds, ['tennis'])
  assert.deepEqual(result.submissions, [])
  assert.equal(result.aborts, 1)
  assert.deepEqual(result.outcomes, ['dry-run-cancelled'])
})
test('no availability exhausts the choices without holding or submitting', async t => {
  const result = await runFixture(t, { padel: false, tennis: false })
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(result.searches, ['padel', 'tennis'])
  assert.deepEqual(result.holds, [])
  assert.deepEqual(result.submissions, [])
  assert.deepEqual(result.outcomes, [])
})
test('an error after holding padel releases it and never attempts tennis', async t => {
  const result = await runFixture(t, { brokenHold: true })
  assert.equal(result.code, 1, result.output)
  assert.deepEqual(result.searches, ['padel'])
  assert.deepEqual(result.submissions, [])
  assert.equal(result.aborts, 1)
})
test('an uncertain padel confirmation never falls back or aborts the submitted booking', async t => {
  const result = await runFixture(t, { uncertainSubmit: true })
  assert.equal(result.code, 1, result.output)
  assert.deepEqual(result.searches, ['padel'])
  assert.deepEqual(result.submissions, ['padel'])
  assert.deepEqual(result.outcomes, ['submitted'])
  assert.equal(result.aborts, 0)
})
