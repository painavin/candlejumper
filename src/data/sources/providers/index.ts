import type { PriceProvider } from './types.js'
import { yahooProvider } from './yahoo.js'
import { stooqProvider } from './stooq.js'

/**
 * Every shipped price provider, in the order the download picker offers them — Yahoo
 * first, because it covers more markets. Order carries no other meaning: nothing falls
 * back from one to the next, since the player selects which to use.
 */
export const PRICE_PROVIDERS: readonly PriceProvider[] = [yahooProvider, stooqProvider]

export type { PriceProvider, ProviderRequest } from './types.js'
export { yahooProvider, YAHOO_BASE_URL, YAHOO_PROVIDER_ID, normalizeSymbol, parseYahooChart, yahooChartUrl } from './yahoo.js'
export { stooqProvider, parseStooqCsv, stooqCsvUrl, stooqSymbol } from './stooq.js'
