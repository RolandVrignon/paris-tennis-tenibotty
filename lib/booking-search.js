import { parseClubCatalog, resolveClub } from './clubs.js'
import { selectClubCourts } from './sport.js'
import { waitForStep } from './captcha.js'
import { selectBookingDate, submitBookingSearch, setSearchTimeout, readPriceDescription } from './booking-page.js'

export const searchBookingTarget = async (page, { target, date, deadline, polling, priceTypes, captchaOptions, searchUrl, debugLog = () => {} }) => {
  const remaining = () => deadline ? Math.max(1, deadline - Date.now()) : 90000
  page.setDefaultTimeout(Math.min(90000, remaining()))
  await page.goto(searchUrl)
  await waitForStep(page, '.tokens-input-text', { ...captchaOptions, timeoutMs: Math.min(captchaOptions.headed ? 300000 : 90000, remaining()) })
  const catalog = parseClubCatalog(await page.content())
  const location = resolveClub(catalog, target.location).name
  const courtIds = selectClubCourts(catalog, location, { sport: target.sport, courtNumbers: target.courtNumbers })
  setSearchTimeout(page, deadline)
  await page.locator('.tokens-input-text').pressSequentially(`${location} `)
  setSearchTimeout(page, deadline)
  await page.locator('.tokens-suggestions-list-element').getByText(location, { exact: true }).click()
  if (!(await selectBookingDate(page, date.format('DD/MM/YYYY'), { allowUnavailable: !!polling, deadline }))) return { location, dateSelectable: false, candidates: [] }
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
      // The monitoring account may have a different tariff; only the booking account enforces priceTypes.
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
