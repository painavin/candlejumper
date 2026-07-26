import type { PositionEvent } from '../output/events.js'

/**
 * Campaign and close-event statistics.
 *
 * Scaling in and out makes "one trade" genuinely ambiguous — three buys, two
 * partial exits, and a final close is either *one* trade or *six* events — so
 * there are two units, used for different purposes:
 *
 *   - **Campaign**: one flat-to-flat cycle. The unit for win/loss stats, because
 *     it's the unit the player actually *decided*.
 *   - **Close event**: any size reduction that realizes P&L. The unit for streak
 *     ticks, because a campaign can last a hundred bars.
 *
 * A campaign's win/loss is the sign of its **summed** realized P&L across all its
 * close events, not the sign of its final close. So a campaign can contain both
 * winning and losing close events — which is why streak fluctuates within a
 * campaign while win rate updates only when one ends.
 */

export interface Campaign {
  entryBarIndex: number
  exitBarIndex: number
  direction: 'long' | 'short'
  realized: number
  closeEvents: number
  /** Ended by an enforcing stop rather than by the player. */
  stoppedOut: boolean
  /** Force-closed at end of data or by "end run", so it distorts nothing. */
  forceClosed: boolean
  /** Ended in one decisive close-everything rather than a staged exit. */
  flattened: boolean
}

export interface Stats {
  campaigns: Campaign[]
  closeEvents: number
  /** Total realized P&L. Mirrors `Position.realizedPnl`; kept for the summary. */
  realized: number
}

export interface OpenCampaign {
  entryBarIndex: number
  direction: 'long' | 'short'
  realized: number
  closeEvents: number
  stoppedOut: boolean
  forceClosed: boolean
  flattened: boolean
}

export interface StatsState {
  stats: Stats
  open: OpenCampaign | undefined
}

export function emptyStats(): StatsState {
  return { stats: { campaigns: [], closeEvents: 0, realized: 0 }, open: undefined }
}

/** Fold one bar's events into the running statistics. */
export function applyEvents(
  state: StatsState,
  events: readonly PositionEvent[],
  barIndex: number
): StatsState {
  let open = state.open
  const campaigns = state.stats.campaigns
  let closeEvents = state.stats.closeEvents
  let realized = state.stats.realized

  for (const event of events) {
    switch (event.kind) {
      case 'positionOpened':
        open = {
          entryBarIndex: barIndex,
          direction: event.direction,
          realized: 0,
          closeEvents: 0,
          stoppedOut: false,
          forceClosed: false,
          flattened: false,
        }
        break

      case 'positionClosed': {
        closeEvents += 1
        realized += event.realized
        if (open) {
          open.realized += event.realized
          open.closeEvents += 1
          if (event.viaFlatten) open.flattened = true
          if (event.wentFlat) {
            campaigns.push({
              entryBarIndex: open.entryBarIndex,
              exitBarIndex: barIndex,
              direction: open.direction,
              realized: open.realized,
              closeEvents: open.closeEvents,
              stoppedOut: open.stoppedOut,
              forceClosed: open.forceClosed,
              flattened: open.flattened,
            })
            open = undefined
          }
        }
        break
      }

      case 'stoppedOut':
        if (open) open.stoppedOut = true
        break

      case 'forceClosed':
        if (open) open.forceClosed = true
        break

      default:
        break
    }
  }

  return { stats: { campaigns, closeEvents, realized }, open }
}

export interface Summary {
  campaigns: number
  wins: number
  losses: number
  /** 0..1. Excludes force-closed campaigns, which are neither win nor loss. */
  winRate: number
  averageWin: number
  averageLoss: number
  biggestWin: number
  biggestLoss: number
  stoppedOutCampaigns: number
  flattenedCampaigns: number
  /** Reported separately so they don't distort win rate. */
  forceClosedCampaigns: number
  closeEvents: number
  realized: number
}

export function summarize(state: StatsState): Summary {
  const all = state.stats.campaigns
  // A campaign force-closed at end of data is neither a player decision nor a
  // stop; counting it as a normal exit would quietly distort win rate.
  const judged = all.filter((campaign) => !campaign.forceClosed)
  const wins = judged.filter((campaign) => campaign.realized > 0)
  const losses = judged.filter((campaign) => campaign.realized < 0)

  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

  return {
    campaigns: all.length,
    wins: wins.length,
    losses: losses.length,
    winRate: judged.length === 0 ? 0 : wins.length / judged.length,
    averageWin: mean(wins.map((campaign) => campaign.realized)),
    averageLoss: mean(losses.map((campaign) => campaign.realized)),
    biggestWin: wins.length === 0 ? 0 : Math.max(...wins.map((c) => c.realized)),
    biggestLoss: losses.length === 0 ? 0 : Math.min(...losses.map((c) => c.realized)),
    stoppedOutCampaigns: all.filter((campaign) => campaign.stoppedOut).length,
    flattenedCampaigns: all.filter((campaign) => campaign.flattened).length,
    forceClosedCampaigns: all.filter((campaign) => campaign.forceClosed).length,
    closeEvents: state.stats.closeEvents,
    realized: state.stats.realized,
  }
}
