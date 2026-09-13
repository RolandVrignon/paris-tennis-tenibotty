import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import { normalizePolling } from './search-window.js'
import { mergeConfig } from './config.js'
import { normalizeSport, validateSportPlayers } from './sport.js'

dayjs.extend(customParseFormat)
dayjs.extend(utc)
dayjs.extend(timezone)

export const PARIS_TIMEZONE = 'Europe/Paris'
export const BOOKING_LEAD_DAYS = 6
export const PREPARATION_HOUR = 7
export const PREPARATION_MINUTE = 55

const allowedRequestKeys = new Set([
  'sport',
  'fallbacks',
  'polling',
  'date',
  'locations',
  'hours',
  'courtType',
  'players',
  'dryRun',
])

const assertString = (value, label, maxLength = 120) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.trim().length > maxLength) throw new Error(`${label} is too long`)
  return value.trim()
}

const parseParisDate = (value) => {
  const parsed = dayjs(value, ['D/M/YYYY', 'DD/MM/YYYY'], true)
  if (!parsed.isValid()) throw new Error('date must use D/M/YYYY format')
  return dayjs.tz(parsed.format('YYYY-MM-DD'), 'YYYY-MM-DD', PARIS_TIMEZONE)
}

const normalizeLocations = (locations) => {
  if (Array.isArray(locations)) {
    if (locations.length === 0) throw new Error('locations must contain at least one club')
    return locations.map((location, index) => assertString(location, `locations[${index}]`))
  }

  if (!locations || typeof locations !== 'object') throw new Error('locations must be an array or an object')
  const entries = Object.entries(locations)
  if (entries.length === 0) throw new Error('locations must contain at least one club')
  return Object.fromEntries(entries.map(([location, courts]) => {
    const name = assertString(location, 'location')
    if (!Array.isArray(courts) || courts.some(court => !Number.isInteger(court) || court <= 0)) {
      throw new Error(`Court numbers for ${name} must be positive integers`)
    }
    return [name, [...new Set(courts)]]
  }))
}

const normalizeHours = (hours) => {
  if (!Array.isArray(hours) || hours.length === 0) throw new Error('hours must contain at least one hour')
  return [...new Set(hours.map((hour, index) => {
    const value = typeof hour === 'number' ? String(hour) : assertString(hour, `hours[${index}]`, 5)
    if (!/^\d{1,2}$/.test(value) || Number(value) < 0 || Number(value) > 23) {
      throw new Error(`Invalid hour: ${value}`)
    }
    return value.padStart(2, '0')
  }))]
}

const normalizeCourtTypes = (courtTypes) => {
  if (!Array.isArray(courtTypes) || courtTypes.length === 0) throw new Error('courtType must contain at least one value')
  const allowed = new Set(['Couvert', 'Découvert'])
  return [...new Set(courtTypes.map((courtType, index) => {
    const value = assertString(courtType, `courtType[${index}]`, 20)
    if (!allowed.has(value)) throw new Error(`Unsupported court type: ${value}`)
    return value
  }))]
}

const normalizePlayers = (players) => {
  if (!Array.isArray(players) || players.length === 0 || players.length > 3) {
    throw new Error('players must contain between one and three partners')
  }
  return players.map((player, index) => {
    if (!player || typeof player !== 'object') throw new Error(`players[${index}] must be an object`)
    return {
      lastName: assertString(player.lastName, `players[${index}].lastName`, 80),
      firstName: assertString(player.firstName, `players[${index}].firstName`, 80),
    }
  })
}

// Fallbacks share the account, tariff, partners and target date with the primary choice.
export const getBookingChoices = (input) => {
  const primary = {
    sport: normalizeSport(input.sport),
    locations: normalizeLocations(input.locations),
    hours: normalizeHours(input.hours),
    courtType: normalizeCourtTypes(input.courtType),
  }
  if (input.fallbacks !== undefined && !Array.isArray(input.fallbacks)) throw new Error('fallbacks must be an ordered array')
  const fallbacks = (input.fallbacks || []).map((fallback, index) => {
    if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) throw new Error(`fallbacks[${index}] must be an object`)
    const forbidden = Object.keys(fallback).filter(key => !['sport', 'locations', 'hours', 'courtType'].includes(key))
    if (forbidden.length) throw new Error(`Unsupported fallback fields: ${forbidden.join(', ')}`)
    if (!Object.hasOwn(fallback, 'sport')) throw new Error(`fallbacks[${index}].sport is required`)
    return {
      sport: normalizeSport(fallback.sport),
      locations: normalizeLocations(fallback.locations),
      hours: normalizeHours(fallback.hours === undefined ? primary.hours : fallback.hours),
      courtType: normalizeCourtTypes(fallback.courtType === undefined ? primary.courtType : fallback.courtType),
    }
  })
  for (const choice of [primary, ...fallbacks]) validateSportPlayers(choice.sport, input.players)
  return [primary, ...fallbacks]
}

export const getBookingTargets = input => getBookingChoices(input).flatMap((choice, priority) => {
  const entries = Array.isArray(choice.locations) ? choice.locations.map(name => [name, []]) : Object.entries(choice.locations)
  return entries.map(([location, courtNumbers]) => ({ ...choice, location, courtNumbers, priority }))
})

export const describeBookingChoices = input => getBookingChoices(input).map(choice =>
  `${choice.sport} ${Array.isArray(choice.locations) ? choice.locations.join(', ') : Object.keys(choice.locations).join(', ')} ${choice.hours.join('/')}h`
).join(' → ')

export const normalizeBookingRequest = (input, {
  now = dayjs().tz(PARIS_TIMEZONE),
  allowPastOpening = false,
} = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Booking request must be an object')
  const forbiddenKeys = Object.keys(input).filter(key => !allowedRequestKeys.has(key))
  if (forbiddenKeys.length > 0) throw new Error(`Unsupported booking request fields: ${forbiddenKeys.join(', ')}`)

  if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') throw new Error('dryRun must be a boolean')
  const [primary, ...fallbacks] = getBookingChoices(input)
  const polling = normalizePolling(input.polling)
  const parsedDate = parseParisDate(assertString(input.date, 'date', 10))

  const bookingOpensAt = dayjs(getBookingSchedule({ date: parsedDate.format('DD/MM/YYYY') }).bookingOpensAt)
  if (!allowPastOpening && !bookingOpensAt.isAfter(now)) throw new Error('The booking opening time has already passed')

  return {
    ...primary,
    ...(polling ? { polling } : {}),
    ...(fallbacks.length ? { fallbacks } : {}),
    date: parsedDate.format('DD/MM/YYYY'),
    players: normalizePlayers(input.players),
    dryRun: input.dryRun === true,
  }
}

export const getBookingSchedule = (request) => {
  const targetDate = parseParisDate(request.date).startOf('day')
  const openingDate = targetDate.subtract(BOOKING_LEAD_DAYS, 'day').format('YYYY-MM-DD')
  // Reconstruct each Paris wall time so crossing DST recalculates the offset.
  const bookingOpensAt = dayjs.tz(`${openingDate} 08:00`, PARIS_TIMEZONE)
  const scheduleAt = dayjs.tz(`${openingDate} 0${PREPARATION_HOUR}:${PREPARATION_MINUTE}`, PARIS_TIMEZONE)
  return {
    scheduleAt: scheduleAt.format(),
    bookingOpensAt: bookingOpensAt.format(),
  }
}

export const validateFixedConfig = (fixedConfig) => {
  if (!fixedConfig || typeof fixedConfig !== 'object') throw new Error('Fixed configuration must be an object')
  if (!fixedConfig.account?.email || !fixedConfig.account?.password) throw new Error('Fixed configuration must contain account credentials')
  if (!Array.isArray(fixedConfig.priceType) || fixedConfig.priceType.length === 0) throw new Error('Fixed configuration must contain priceType')
  return fixedConfig
}

export const buildBookingConfig = (fixedConfig, request) => mergeConfig(validateFixedConfig(fixedConfig), request)
