import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const VARIABLE_CONFIG_KEYS = Object.freeze([
  'bookingAccount',
  'consecutive',
  'sport',
  'fallbacks',
  'polling',
  'date',
  'locations',
  'hours',
  'courtType',
  'players',
])

export const resolveBookingProfile = (config, id = 'main') => {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(id)) throw new Error('Invalid bookingAccount identifier')
  const account = id === 'main' ? config.account : Object.hasOwn(config.bookingAccounts || {}, id) ? config.bookingAccounts[id] : undefined
  if (!account) throw new Error(`Unknown booking account: ${id}`)
  const priceType = account.priceType ?? (id === 'main' ? config.priceType : undefined)
  if (!Array.isArray(priceType) || !priceType.length || priceType.some(value => !['Gratuité', 'Tarif plein', 'Tarif réduit'].includes(value))) throw new Error(`Account ${id} requires a valid priceType`)
  return { id, name: account.name?.trim() || id, account, priceType, defaultPlayers: account.defaultPlayers }
}

export const assertBookingCredentials = profile => {
  if (![profile.account.email, profile.account.password].every(value => typeof value === 'string' && value.trim())) throw new Error(`Account ${profile.id} requires email and password`)
}

// Only non-secret fields are exposed to Hermes for choosing accounts and defaults.
export const describeBookingAccounts = config => ['main', ...Object.keys(config.bookingAccounts || {}).filter(id => id !== 'main')].map(id => {
  const profile = resolveBookingProfile(config, id)
  return { id, name: profile.name, priceType: profile.priceType, defaultPlayers: profile.defaultPlayers || [], credentialsConfigured: !!profile.account.email && !!profile.account.password }
})

const readJson = (filePath) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Unable to read JSON configuration ${filePath}: ${error.message}`, { cause: error })
  }
}

export const mergeConfig = (fixedConfig, requestConfig) => {
  const merged = { ...fixedConfig }
  for (const key of VARIABLE_CONFIG_KEYS) {
    if (Object.hasOwn(requestConfig, key)) merged[key] = requestConfig[key]
  }
  return merged
}

export const loadConfig = ({
  env = process.env,
  rootDirectory = repositoryDirectory,
} = {}) => {
  if (env.TENNIS_CONFIG_PATH) {
    return readJson(resolve(env.TENNIS_CONFIG_PATH))
  }

  const fixedPath = env.TENNIS_FIXED_CONFIG_PATH
    ? resolve(env.TENNIS_FIXED_CONFIG_PATH)
    : resolve(rootDirectory, 'config.fixed.json')
  const requestPath = env.TENNIS_REQUEST_CONFIG_PATH
    ? resolve(env.TENNIS_REQUEST_CONFIG_PATH)
    : resolve(rootDirectory, 'config.request.json')

  if (existsSync(fixedPath) || existsSync(requestPath)) {
    if (!existsSync(fixedPath)) throw new Error(`Missing fixed configuration: ${fixedPath}`)
    if (!existsSync(requestPath)) throw new Error(`Missing request configuration: ${requestPath}`)
    return mergeConfig(readJson(fixedPath), readJson(requestPath))
  }

  const legacyPath = resolve(rootDirectory, 'config.json')
  if (existsSync(legacyPath)) return readJson(legacyPath)

  throw new Error('No configuration found. Create config.fixed.json and config.request.json.')
}

// Account inspection does not require a booking request configuration.
export const loadAccountConfig = ({ env = process.env, rootDirectory = repositoryDirectory } = {}) => {
  if (env.TENNIS_CONFIG_PATH) return readJson(resolve(env.TENNIS_CONFIG_PATH))
  const fixedPath = resolve(env.TENNIS_FIXED_CONFIG_PATH || resolve(rootDirectory, 'config.fixed.json'))
  if (existsSync(fixedPath)) return readJson(fixedPath)
  if (env.TENNIS_FIXED_CONFIG_PATH) throw new Error(`Missing fixed configuration: ${fixedPath}`)
  return readJson(resolve(rootDirectory, 'config.json'))
}

// An absent or entirely blank optional account preserves the existing single-account flow.
export const loadMonitoringConfig = ({ env = process.env, rootDirectory = repositoryDirectory, bookingConfig } = {}) => {
  const config = bookingConfig || loadAccountConfig({ env, rootDirectory })
  const optional = config.monitoringAccount
  const blank = optional === undefined || optional === null || (typeof optional === 'object' && !Array.isArray(optional) && !optional.email && !optional.password)
  if (blank) return { account: config.account, ai: config.ai, dedicated: false }
  if (typeof optional.email !== 'string' || !optional.email.trim() || typeof optional.password !== 'string' || !optional.password.trim()) throw new Error('monitoringAccount requires both email and password, or an entirely empty block')
  if (config.account?.email?.trim().toLowerCase() === optional.email.trim().toLowerCase()) throw new Error('Monitoring and reservation accounts must be different')
  return { account: { name: optional.name || 'Monitoring', email: optional.email.trim(), password: optional.password }, ai: config.ai, dedicated: true }
}
