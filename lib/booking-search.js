import { parseClubCatalog, resolveClub } from './clubs.js'
import { selectClubCourts } from './sport.js'
import { selectBookingDate, submitBookingSearch, setSearchTimeout, readPriceDescription, waitForSearchPage } from './booking-page.js'

const targetKey = target => JSON.stringify([target.sport, target.location, target.courtId || null, target.courtNumbers || [], target.hours])
let preparationSequence = 0

const markPreparedForm = async page => {
  const marker = `${Date.now()}-${++preparationSequence}`
  await page.evaluate(value => {
    const form = globalThis.document.querySelector('#rechercher')?.form
    if (form) form.dataset.bookingPreparation = value
  }, marker)
  return marker
}

const isPreparedFormCurrent = async (page, marker) => {
  try {
    return await page.evaluate(value => globalThis.document.querySelector('#rechercher')?.form?.dataset.bookingPreparation === value, marker)
  } catch {
    return false
  }
}

const prepareSearchForm = async (page, { target, date, deadline, polling, captchaOptions, searchUrl }) => {
  const remaining = () => deadline ? Math.max(1, deadline - Date.now()) : 90000
  page.setDefaultTimeout(Math.min(90000, remaining()))
  await page.goto(searchUrl)
  await waitForSearchPage(page, { ...captchaOptions, timeoutMs: Math.min(captchaOptions.headed ? 300000 : 90000, remaining()) })
  const catalog = parseClubCatalog(await page.content())
  const location = resolveClub(catalog, target.location).name
  const courtIds = selectClubCourts(catalog, location, { sport: target.sport, courtNumbers: target.courtNumbers })
  setSearchTimeout(page, deadline)
  await page.locator('.tokens-input-text').pressSequentially(`${location} `)
  setSearchTimeout(page, deadline)
  await page.locator('.tokens-suggestions-list-element').getByText(location, { exact: true }).click()
  const dateSelected = await selectBookingDate(page, date.format('DD/MM/YYYY'), { allowUnavailable: !!polling, deadline })
  const formMarker = await markPreparedForm(page)
  return { location, courtIds, dateSelected, targetKey: targetKey(target), dateKey: date.format('DD/MM/YYYY'), formMarker }
}

// Warm up the authenticated booking page without triggering a search or holding a slot.
export const prepareBookingTarget = async (page, options) => prepareSearchForm(page, {
  ...options,
  // Before opening, the requested date may legitimately not be exposed yet.
  polling: options.polling || true,
})

export const searchBookingTarget = async (page, { target, date, deadline, polling, priceTypes, captchaOptions, searchUrl, prepared, debugLog = () => {} }) => {
  const matchesPrepared = prepared
    && !prepared.consumed
    && prepared.targetKey === targetKey(target)
    && prepared.dateKey === date.format('DD/MM/YYYY')
    && prepared.dateSelected
  // A prepared form is single-use once handed to a search, including failed submissions.
  if (matchesPrepared) prepared.consumed = true
  const canSubmitPrepared = matchesPrepared && await isPreparedFormCurrent(page, prepared.formMarker)
  const form = canSubmitPrepared
    ? prepared
    : await prepareSearchForm(page, { target, date, deadline, polling, captchaOptions, searchUrl })
  const { location, courtIds } = form
  if (!form.dateSelected) return { location, dateSelectable: false, candidates: [] }
  await submitBookingSearch(page, { deadline })
  if (deadline && Date.now() >= deadline) return { location, dateSelectable: true, candidates: [] }
  debugLog(`search-results-ready slots=${await page.locator('[courtid][datedeb]').count()}`)
  const candidates = []
  for (const hour of target.hours) {
    const dateDeb = `[datedeb="${date.format('YYYY/MM/DD')} ${hour}:00:00"]`
    for (const slot of await page.locator(dateDeb).all()) {
      const courtId = await slot.getAttribute('courtid')
      if (!courtIds.has(courtId) || (target.courtId && courtId !== target.courtId)) continue
      const selector = `[courtid="${courtId}"]${dateDeb}`
      const { priceType, courtType } = await readPriceDescription(page.locator(`.row.tennis-court:has(${selector}) .price-description`))
      if (!target.courtType.includes(courtType) || (priceTypes && !priceTypes.includes(priceType))) continue
      candidates.push({ courtId, hour, selector, priceType, courtType, key: `${courtId}/${date.format('YYYY-MM-DD')}/${hour}` })
    }
  }
  return { location, dateSelectable: true, candidates }
}

export const clickBookingCandidate = async (page, location, candidate) => {
  if (await page.locator(candidate.selector).isHidden()) await page.locator(`#head${location.replaceAll(' ', '')}${candidate.hour}h .panel-title`).click()
  await page.locator(candidate.selector).click()
}
