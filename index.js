import { chromium } from 'playwright'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import { mkdirSync, writeFileSync } from 'fs'
import { createEvent } from 'ics'
import { config } from './staticFiles.js'
import { notify } from './lib/ntfy.js'
import { waitForStep } from './lib/captcha.js'
import { parseClubCatalog, resolveClub } from './lib/clubs.js'
import { reportBookingResult } from './lib/booking-result.js'
import { bookingJobOptions } from './lib/booking-job.js'
import { acquireOperationLock } from './lib/operation-lock.js'
import { selectClubCourts } from './lib/sport.js'
import { getBookingTargets } from './lib/booking-request.js'
import { normalizePolling, parseSearchStart, searchAttempts } from './lib/search-window.js'
import { selectBookingDate, readPriceDescription, submitBookingSearch, setSearchTimeout } from './lib/booking-page.js'

dayjs.extend(customParseFormat)

const bookTennis = async () => {
  const targets = getBookingTargets(config)
  const polling = normalizePolling(config.polling)
  const searchStart = parseSearchStart(process.env.TENNIS_SEARCH_START_AT)
  const DRY_RUN_MODE = process.argv.includes('--dry-run')
  const HEADED_MODE = process.argv.includes('--headed')
  const DEBUG_MODE = process.argv.includes('--debug')
  const captchaOptions = { headed: HEADED_MODE, debug: DEBUG_MODE, ai: config.ai }
  const debugLog = (message) => {
    if (DEBUG_MODE) console.log(`${dayjs().format()} - [debug][booking] ${message}`)
  }
  if (DRY_RUN_MODE) {
    console.log('----- DRY RUN START -----')
    console.log('Script lancé en mode DRY RUN. Afin de tester votre configuration, une recherche va être lancé mais AUCUNE réservation ne sera réalisée')
  }

  console.log(`${dayjs().format()} - Starting searching ${[...new Set(targets.map(target => target.sport))].join(' → ')}`)
  const browser = await chromium.launch({
    headless: !HEADED_MODE,
    slowMo: HEADED_MODE ? 250 : 0,
    timeout: 90000,
  })

  console.log(`${dayjs().format()} - Browser started`)
  debugLog(`mode=${DRY_RUN_MODE ? 'dry-run' : 'real'} browser=${HEADED_MODE ? 'headed' : 'headless'} captchaAI=${config.ai?.enable === false ? 'disabled' : 'enabled'}`)
  const page = await browser.newPage()
  if (DEBUG_MODE) {
    page.on('pageerror', error => debugLog(`page-error=${JSON.stringify(error.message)}`))
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        debugLog(`browser-console type=${message.type()} text=${JSON.stringify(message.text())}`)
      }
    })
  }
  let canAbortBooking = false
  let finished = false
  let windowExpired = false
  const reportWindowExpired = () => {
    if (windowExpired) return
    windowExpired = true
    console.log(`${dayjs().format()} - Search window expired; review opening time and availability using the search log`)
    if (process.send && process.connected) process.send({ type: 'tennis-search-expired' })
  }
  page.setDefaultTimeout(90000)
  try {
    await page.goto('https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=tennis&view=start&full=1')

    await page.click('#button_suivi_inscription')
    await page.fill('#username', config?.account?.email || process.env.ACCOUNT_EMAIL)
    await page.fill('#password', config?.account?.password || process.env.ACCOUNT_PASSWORD)
    await page.click('#form-login >> button')

    // wait for login redirection before continue
    await waitForStep(page, '.main-informations', captchaOptions)

    console.log(`${dayjs().format()} - User connected`)

    console.log(`${dayjs().format()} - Connected; search starts at ${new Date(searchStart).toISOString()}${polling ? `, interval ${polling.intervalSeconds}s, window ${polling.durationSeconds}s` : ''}`)
    locationsLoop:
    for await (const { target, attempt, deadline, finalFallback } of searchAttempts(targets, polling, searchStart)) {
      if (finalFallback) reportWindowExpired()
      const { sport, location: requestedLocation, courtNumbers, hours, courtType: courtTypes, priority } = target
      let location = requestedLocation
      const logLocation = process.env.GITHUB_ACTIONS ? `priority ${priority + 1}` : location
      console.log(`${dayjs().format()} - Search ${sport} at ${logLocation} (priority ${priority + 1}, attempt ${attempt})`)
      let allowedCourtIds
      const date = config.date ? dayjs(config.date, 'D/MM/YYYY') : dayjs().add(6, 'days')
      const remaining = () => deadline ? Math.max(1, deadline - Date.now()) : 90000
      page.setDefaultTimeout(Math.min(90000, remaining()))
      try {
        await page.goto('https://tennis.paris.fr/tennis/jsp/site/Portal.jsp?page=recherche&view=recherche_creneau#!')
        debugLog(`search-page-loaded location=${JSON.stringify(logLocation)} title=${JSON.stringify(await page.title())}`)
        await waitForStep(page, '.tokens-input-text', { ...captchaOptions, timeoutMs: Math.min(HEADED_MODE ? 300000 : 90000, remaining()) })
        const catalog = parseClubCatalog(await page.content())
        location = resolveClub(catalog, requestedLocation).name
        allowedCourtIds = selectClubCourts(catalog, location, { sport, courtNumbers })
        setSearchTimeout(page, deadline)
        await page.locator('.tokens-input-text').pressSequentially(`${location} `)
        setSearchTimeout(page, deadline)
        await page.locator('.tokens-suggestions-list-element').getByText(location, { exact: true }).click()
        if (!(await selectBookingDate(page, date.format('DD/MM/YYYY'), { allowUnavailable: !!polling, deadline }))) {
          console.log(`${dayjs().format()} - Requested date not yet selectable for ${logLocation}`)
          continue
        }
        page.setDefaultTimeout(Math.min(90000, remaining()))
        await submitBookingSearch(page, { deadline })
      } catch (error) {
        if (deadline && Date.now() >= deadline && error.name === 'TimeoutError') {
          debugLog('search-deadline-reached during loading')
          continue
        }
        throw error
      }
      if (deadline && Date.now() >= deadline) continue
      debugLog(`search-results-ready attempt=${attempt} slots=${await page.locator('[courtid][datedeb]').count()}`)

      let selectedHour
      hoursLoop:
      for (const hour of hours) {
        const dateDeb = `[datedeb="${date.format('YYYY/MM/DD')} ${hour}:00:00"]`
        if (await page.locator(dateDeb).count()) {
          if (await page.isHidden(dateDeb)) {
            await page.click(`#head${location.replaceAll(' ', '')}${hour}h .panel-title`)
          }

          const slots = await page.locator(dateDeb).all()
          for (const slot of slots) {
            const courtId = await slot.getAttribute('courtid')
            const bookSlotButton = `[courtid="${courtId}"]${dateDeb}`
            if (!allowedCourtIds.has(courtId)) continue

            const { priceType, courtType } = await readPriceDescription(page.locator(`.row.tennis-court:has(${bookSlotButton})`).locator('.price-description'))
            if (!config.priceType.includes(priceType) || !courtTypes.includes(courtType)) {
              continue
            }
            if (deadline && Date.now() >= deadline) break hoursLoop
            selectedHour = hour
            debugLog(`slot-selected location=${JSON.stringify(logLocation)} date=${date.format('YYYY-MM-DD')} hour=${hour} courtId=${JSON.stringify(courtId)} priceType=${JSON.stringify(priceType)} courtType=${JSON.stringify(courtType)}`)
            await page.click(bookSlotButton)
            canAbortBooking = true
            debugLog(`slot-clicked title=${JSON.stringify(await page.title())}`)

            break hoursLoop
          }
        }
      }

      if (!selectedHour) {
        console.log(`${dayjs().format()} - Failed to find reservation for ${logLocation}`)
        continue
      }

      page.setDefaultTimeout(90000)
      await waitForStep(page, '.order-steps-infos h2 >> text="1 / 3 - Validation du court"', captchaOptions)

      for (const [i, player] of config.players.entries()) {
        if (i > 0) {
          await page.click('.addPlayer')
        }
        await page.waitForSelector(`[name="player${i + 1}"]`)
        await page.fill(`[name="player${i + 1}"] >> nth=0`, player.lastName)
        await page.fill(`[name="player${i + 1}"] >> nth=1`, player.firstName)
        debugLog(`player-filled index=${i + 1}`)
      }

      await page.keyboard.press('Enter')
      debugLog('player-step-submitted')

      await waitForStep(page, '.order-steps-infos h2 >> text="2 / 3 - Mode de paiement"', captchaOptions)
      await page.waitForSelector('.priceTable')

      const paymentSummary = await page.locator('.priceTable').innerText()
      const isFreeBooking = paymentSummary.includes('Gratuité')
      debugLog(`payment-step-ready free=${isFreeBooking} summary=${JSON.stringify(paymentSummary.replace(/\s+/g, ' ').trim())}`)

      if (!isFreeBooking) {
        const paymentMode = page.locator('#order_select_payment_form #paymentMode')
        await paymentMode.waitFor({ state: 'attached' })
        await paymentMode.evaluate(el => {
          el.removeAttribute('readonly')
          el.style.display = 'block'
        })
        await paymentMode.fill('existingTicket')
        debugLog('paid-payment-mode-selected value=existingTicket')
      } else {
        console.log(`${dayjs().format()} - Free price detected`)
      }

      if (DRY_RUN_MODE) {
        console.log(`${dayjs().format()} - Fausse réservation faite : ${logLocation}`)
        if (!process.env.GITHUB_ACTIONS) console.log(`pour le ${date.format('YYYY/MM/DD')} à ${selectedHour}h`)
        console.log('----- DRY RUN END -----')
        console.log('Pour réellement réserver un crénau, relancez le script sans le paramètre --dry-run')

        await page.click('#previous')
        const [cancelResponse] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/tennis/rest/abortBooking') && response.request().method() === 'POST'),
          page.click('#btnCancelBooking'),
        ])
        if (!cancelResponse.ok()) throw new Error('Dry-run cancellation failed')
        canAbortBooking = false
        debugLog(`dry-run-cancelled status=${cancelResponse.status()}`)
        finished = true
        reportBookingResult('dry-run-cancelled')

        break locationsLoop
      }

      reportBookingResult('submitted')
      if (isFreeBooking) {
        const freePrice = page.locator('.priceTable .price-item[paymentMode="free"]')
        debugLog(`free-price-options=${await freePrice.count()}`)
        await freePrice.click()
        canAbortBooking = false
        const freeSubmit = page.locator('.step-two #submit:not(.disabled)')
        debugLog(`free-submit-options=${await freeSubmit.count()}`)
        await freeSubmit.click()
      } else {
        const submit = page.locator('#order_select_payment_form #envoyer')
        await submit.evaluate(el => el.classList.remove('hide'))
        canAbortBooking = false
        await submit.click()
      }
      debugLog('payment-step-submitted')

      await page.waitForSelector('.confirmReservation')
      debugLog('reservation-confirmation-visible')
      finished = true
      reportBookingResult('confirmed')

      // Extract reservation details
      const address = (await page.locator('.address').textContent()).trim().replace(/( ){2,}/g, ' ')
      const dateStr = (await page.locator('.date').textContent()).trim().replace(/( ){2,}/g, ' ')
      const court = (await page.locator('.court').textContent()).trim().replace(/( ){2,}/g, ' ')

      if (!process.env.GITHUB_ACTIONS) {
        console.log(`${dayjs().format()} - Réservation faite : ${address}`)
        console.log(`pour le ${dateStr}`)
        console.log(`sur le ${court}`)
      } else {
        console.log('Réservation faite, regardez vos emails ou rendez-vous sur votre compte tennis.paris.fr pour plus de détails sur votre réservation.')
      }

      const [day, month, year] = [date.date(), date.month() + 1, date.year()]
      const hourMatch = dateStr.match(/(\d{2})h/)
      const hour = hourMatch ? Number(hourMatch[1]) : 12
      const start = [year, month, day, hour, 0]
      const duration = { hours: 1, minutes: 0 }
      const event = {
        start,
        duration,
        title: sport === 'padel' ? 'Réservation Padel' : 'Réservation Tennis',
        description: `Court: ${court}\nAdresse: ${address}`,
        location: address,
        status: 'CONFIRMED',
      }

      const createdEvent = createEvent(event)
      if (createdEvent.error) {
        console.log('ICS creation error:', createdEvent.error)
        process.exitCode = 1

        break
      }

      const { value } = createdEvent
      if (!process.env.GITHUB_ACTIONS) {
        writeFileSync('event.ics', value)
      }
      if (config.ntfy?.enable === true || process.env.NTFY_TOPIC) {
        await notify(Buffer.from(value, 'utf8'), 'event.ics',
          `Confirmation pour le ${date.format('DD/MM/YYYY')} - ${hour}h`, {
            domain: config?.ntfy?.domain || process.env.NTFY_DOMAIN,
            topic: config?.ntfy?.topic || process.env.NTFY_TOPIC,
          })
      }

      break
    }
    if (polling && !finished) reportWindowExpired()
  } catch (e) {
    console.log(e)
    process.exitCode = 1
    if (!page.isClosed()) {
      mkdirSync('img', { recursive: true })
      const screenshot = await page.screenshot({ path: 'img/failure.png' })
      debugLog(`failure-screenshot=img/failure.png title=${JSON.stringify(await page.title())}`)

      // Release only this run's temporary hold, never a submitted reservation.
      if (canAbortBooking) {
        try {
          const response = await page.request.post('https://tennis.paris.fr/tennis/rest/abortBooking', { timeout: 10000 })
          console.log(response.ok() ? 'Pending booking abandoned after failure' : 'Could not abandon the pending booking; check your account')
        } catch {
          console.log('Could not abandon the pending booking; check your account')
        }
      }

      if (config.ntfy?.enable === true || process.env.NTFY_TOPIC) {
        await notify(screenshot, 'failure.png', 'Erreur lors de l\'execution du programme.', {
          domain: config?.ntfy?.domain || process.env.NTFY_DOMAIN,
          topic: config?.ntfy?.topic || process.env.NTFY_TOPIC,
        })
      }
    }
  } finally {
    await browser.close()
  }
}

const release = process.send ? () => {} : acquireOperationLock(bookingJobOptions().stateDirectory)
try { await bookTennis() } finally { release() }
