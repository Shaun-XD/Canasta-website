import { evaluateShowEligibility } from './showEligibility'
import { EMPTY_HAND_FOUL_PENALTY, isIllegalEmptyHand } from './emptyHandFoul'
import { shouldClaimPozzettoOnDiscard, shouldClaimPozzettoOnMeldEmpty } from './pozzetto'
import { scoreRound } from './scoring'
import {
  actionRetainFloor,
  planAiAppends,
  planAiDraw,
  planAiMelds,
  pickAiDiscard,
  type AiPlayContext,
} from './aiPlayer'
import {
  appendCardFromHand,
  attemptMeldAction,
  createMeldFromHand,
  getNextPlayerId,
  performDrawFromStock,
  topDiscardMustBePlayed,
} from './turnEngine'
import { sortHand } from '../lib/deck'
import type {
  CardPlayEvent,
  CardPlayKind,
  GameState,
  PlayerId,
  RoomState,
  Team,
  TeamId,
} from '../types/game'

function cardPlay(
  actorId: PlayerId,
  kind: CardPlayKind,
  extra: Partial<Pick<CardPlayEvent, 'cardIds' | 'fromDiscardIds' | 'count'>> = {},
): CardPlayEvent {
  return {
    at: Date.now(),
    actorId,
    kind,
    cardIds: extra.cardIds ?? [],
    fromDiscardIds: extra.fromDiscardIds ?? [],
    count: extra.count ?? 0,
  }
}

function withTeam(room: RoomState, teamId: TeamId, updater: (team: Team) => Team): RoomState {
  return { ...room, teams: room.teams.map((t) => (t.id === teamId ? updater(t) : t)) }
}

function findTeam(room: RoomState, playerId: PlayerId): Team | undefined {
  return room.teams.find((t) => t.playerIds.includes(playerId))
}

function advanceTurn(game: GameState, room: RoomState, fromPlayerId: PlayerId): GameState['turn'] {
  const playerIds = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.id)
  return {
    activePlayerId: getNextPlayerId(playerIds, fromPlayerId),
    phase: 'draw',
    turnNumber: game.turn.turnNumber + 1,
    hasDrawnThisTurn: false,
    startedAt: Date.now(),
    isPaused: false,
    pausedAt: null,
  }
}

function tryClaim(
  game: GameState,
  team: Team,
  playerId: PlayerId,
  hand: GameState['hands'][string],
  trigger: 'discard' | 'meld-empty',
  handSizeBeforeAction: number,
): { hand: GameState['hands'][string]; pozzettoStacks: GameState['pozzettoStacks']; pozzetto: Team['pozzetto'] } {
  const shouldClaim =
    trigger === 'discard'
      ? shouldClaimPozzettoOnDiscard(handSizeBeforeAction, team.pozzetto.claimed)
      : shouldClaimPozzettoOnMeldEmpty(handSizeBeforeAction, team.pozzetto.claimed)
  if (!shouldClaim) {
    return { hand, pozzettoStacks: game.pozzettoStacks, pozzetto: team.pozzetto }
  }
  const reserve = game.pozzettoStacks[team.id] ?? []
  return {
    hand: sortHand([...hand, ...reserve]),
    pozzettoStacks: { ...game.pozzettoStacks, [team.id]: [] },
    pozzetto: { claimed: true, claimedByPlayerId: playerId, activated: team.pozzetto.activated },
  }
}

function endRound(
  room: RoomState,
  game: GameState,
  endingType: 'show' | 'sudden-death',
  showingTeamId: TeamId | null,
): { room: RoomState; game: GameState } {
  const [teamA, teamB] = room.teams as [Team, Team]
  const handsByTeam: Record<TeamId, GameState['hands'][string]> = {
    'team-a': teamA.playerIds.flatMap((pid) => game.hands[pid] ?? []),
    'team-b': teamB.playerIds.flatMap((pid) => game.hands[pid] ?? []),
  }
  const result = scoreRound(game.round, endingType, [teamA, teamB], handsByTeam, showingTeamId)
  const teams = room.teams.map((t) => ({
    ...t,
    score: t.score + result.teams[t.id].total,
    hasGoneOut: endingType === 'show' && t.id === showingTeamId,
  }))
  const gameOverTeamId = teams.find((t) => t.score >= room.matchTargetScore)?.id ?? null
  return {
    room: { ...room, teams, status: gameOverTeamId ? 'game-end' : 'round-end' },
    game: {
      ...game,
      lastRoundScores: result,
      roundScoresHistory: [...game.roundScoresHistory, result],
      gameOverTeamId,
    },
  }
}

function tryAutoShow(
  room: RoomState,
  game: GameState,
  team: Team,
  playerId: PlayerId,
): { ended: true; room: RoomState; game: GameState } | { ended: false } {
  const handSize = game.hands[playerId]?.length ?? 0
  const elig = evaluateShowEligibility(team, handSize)
  if (!elig.eligible) return { ended: false }
  const nextRoom = withTeam(room, team.id, (t) => ({
    ...t,
    pozzetto: { ...t.pozzetto, activated: true },
  }))
  return { ended: true, ...endRound(nextRoom, game, 'show', team.id) }
}

function aiContext(room: RoomState, game: GameState, team: Team, handSize: number): AiPlayContext {
  const opp = room.teams.find((t) => t.id !== team.id)
  const elig = evaluateShowEligibility(team, handSize)
  return {
    teamId: team.id,
    ownMelds: team.melds,
    opponentMelds: opp?.melds ?? [],
    discardPile: game.discardPile.cards,
    pozzettoClaimed: team.pozzetto.claimed,
    mayEmptyForShow: elig.reserveActivated && elig.canastaWinCondition,
    handSize,
  }
}

/**
 * Play one bot seat to completion (draw → optional melds → discard / show).
 * No DOM / animation — the online bridge applies this, then broadcasts.
 */
export function applyBotTurn(
  room: RoomState,
  game: GameState,
  playerId: PlayerId,
): { room: RoomState; game: GameState } {
  if (game.turn.activePlayerId !== playerId) return { room, game }
  if (room.status !== 'in-progress') return { room, game }

  let nextRoom = room
  let nextGame = game
  const teamOf = () => findTeam(nextRoom, playerId)

  if (!nextGame.turn.hasDrawnThisTurn) {
    const team = teamOf()
    if (!team) return { room, game }
    const hand = nextGame.hands[playerId] ?? []
    const drawPlan = planAiDraw(hand, team.melds, nextGame.discardPile.cards, team.id)
    let drew = false

    if (drawPlan.source === 'top-touch' && nextGame.discardPile.cards.length > 0) {
      const discardPile = nextGame.discardPile.cards
      const topCard = discardPile[discardPile.length - 1]
      const selectedDiscardIds = (() => {
        const ids =
          drawPlan.selectedDiscardIds.length > 0 ? [...drawPlan.selectedDiscardIds] : [topCard.id]
        if (!ids.includes(topCard.id)) ids.push(topCard.id)
        return ids
      })()
      const gate = topDiscardMustBePlayed(discardPile, selectedDiscardIds)
      if (gate.ok) {
        const result = attemptMeldAction({
          hand,
          team,
          selectedHandCardIds: drawPlan.handCardIds,
          targetMeldId: drawPlan.targetMeldId,
          topTouch: { discardPile, selectedDiscardIds },
        })
        const playedTop = result.ok && result.usedDiscardCards.some((c) => c.id === topCard.id)
        if (result.ok && playedTop) {
          const usedIds = new Set(result.usedDiscardCards.map((c) => c.id))
          const restOfPile = discardPile.filter((c) => !usedIds.has(c.id))
          const meldsAfter =
            result.kind === 'append'
              ? team.melds.map((m) => (m.id === result.meld.id ? result.meld : m))
              : [...team.melds, result.meld]
          let combinedHand = sortHand([...result.hand, ...restOfPile])
          const claim = tryClaim(nextGame, { ...team, melds: meldsAfter }, playerId, combinedHand, 'meld-empty', combinedHand.length)
          combinedHand = claim.hand
          nextRoom = withTeam(nextRoom, team.id, (t) => ({
            ...t,
            melds: meldsAfter,
            pozzetto: claim.pozzetto,
          }))
          nextGame = {
            ...nextGame,
            hands: { ...nextGame.hands, [playerId]: combinedHand },
            discardPile: { cards: [] },
            pozzettoStacks: claim.pozzettoStacks,
            turn: { ...nextGame.turn, phase: 'action', hasDrawnThisTurn: true },
            lastAcquired: {
              playerId,
              cardIds: [...result.usedDiscardCards.map((c) => c.id), ...restOfPile.map((c) => c.id)],
              at: Date.now(),
            },
            lastPlay: cardPlay(playerId, 'top-touch', {
              cardIds: result.usedDiscardCards.map((c) => c.id),
              fromDiscardIds: result.usedDiscardCards.map((c) => c.id),
              count: restOfPile.length,
            }),
          }
          drew = true
        }
      }
    }

    if (!drew && nextGame.stock.length > 0) {
      const drawResult = performDrawFromStock(nextGame.stock, nextGame.hands[playerId] ?? [])
      nextGame = {
        ...nextGame,
        stock: drawResult.stock,
        hands: { ...nextGame.hands, [playerId]: sortHand(drawResult.hand) },
        turn: { ...nextGame.turn, phase: 'action', hasDrawnThisTurn: true },
        lastAcquired: drawResult.drawnCard
          ? { playerId, cardIds: [drawResult.drawnCard.id], at: Date.now() }
          : nextGame.lastAcquired,
        lastPlay: cardPlay(playerId, 'draw-stock', { count: drawResult.drawnCard ? 1 : 0 }),
      }
    } else if (!drew) {
      nextGame = { ...nextGame, turn: { ...nextGame.turn, phase: 'action', hasDrawnThisTurn: true } }
    }
  }

  const runAppends = (): boolean => {
    const team = teamOf()
    if (!team) return false
    let claimed = false
    let hand = nextGame.hands[playerId] ?? []
    const plans = planAiAppends(hand, team.melds, aiContext(nextRoom, nextGame, team, hand.length)).plans
    for (const plan of plans) {
      const live = teamOf()
      if (!live) break
      hand = nextGame.hands[playerId] ?? []
      const meld = live.melds.find((m) => m.id === plan.meldId)
      if (!meld || !hand.some((c) => c.id === plan.cardId)) continue
      if (hand.length - 1 < actionRetainFloor(aiContext(nextRoom, nextGame, live, hand.length))) continue
      const result = appendCardFromHand(hand, plan.cardId, meld, 'top', live)
      if (!result.ok) continue
      hand = result.hand
      const melds = live.melds.map((m) => (m.id === meld.id ? result.meld : m))
      let pozzetto = live.pozzetto
      let stacks = nextGame.pozzettoStacks
      if (hand.length === 0 && !live.pozzetto.claimed) {
        const claim = tryClaim(nextGame, { ...live, melds }, playerId, hand, 'meld-empty', 0)
        hand = claim.hand
        stacks = claim.pozzettoStacks
        pozzetto = claim.pozzetto
        if (claim.pozzetto.claimed) claimed = true
      }
      nextRoom = withTeam(nextRoom, live.id, (t) => ({ ...t, melds, pozzetto }))
      nextGame = {
        ...nextGame,
        pozzettoStacks: stacks,
        hands: { ...nextGame.hands, [playerId]: sortHand(hand) },
        lastPlay: cardPlay(playerId, 'meld', { cardIds: [plan.cardId] }),
      }
    }
    return claimed
  }

  const runNewMelds = (): boolean => {
    const team = teamOf()
    if (!team) return false
    let claimed = false
    let hand = nextGame.hands[playerId] ?? []
    const plans = planAiMelds(hand, team.id, team.melds, aiContext(nextRoom, nextGame, team, hand.length)).plans
    for (const plan of plans) {
      const live = teamOf()
      if (!live) break
      hand = nextGame.hands[playerId] ?? []
      if (plan.cardIds.some((id) => !hand.some((c) => c.id === id))) continue
      if (hand.length - plan.cardIds.length < actionRetainFloor(aiContext(nextRoom, nextGame, live, hand.length))) {
        continue
      }
      const built = createMeldFromHand(hand, plan.cardIds, plan.kind, live.id)
      if (!built.ok) continue
      hand = built.hand
      const melds = [...live.melds, built.meld]
      let pozzetto = live.pozzetto
      let stacks = nextGame.pozzettoStacks
      if (hand.length === 0 && !live.pozzetto.claimed) {
        const claim = tryClaim(nextGame, { ...live, melds }, playerId, hand, 'meld-empty', 0)
        hand = claim.hand
        stacks = claim.pozzettoStacks
        pozzetto = claim.pozzetto
        if (claim.pozzetto.claimed) claimed = true
      }
      nextRoom = withTeam(nextRoom, live.id, (t) => ({ ...t, melds, pozzetto }))
      nextGame = {
        ...nextGame,
        pozzettoStacks: stacks,
        hands: { ...nextGame.hands, [playerId]: sortHand(hand) },
        lastPlay: cardPlay(playerId, 'meld', { cardIds: plan.cardIds }),
      }
    }
    return claimed
  }

  for (let cycle = 0; cycle < 2; cycle += 1) {
    const a = runAppends()
    const m = runNewMelds()
    const b = runAppends()
    if (!(a || m || b)) break
  }

  {
    const team = teamOf()
    const hand = nextGame.hands[playerId] ?? []
    if (team && hand.length === 0 && !team.pozzetto.claimed) {
      const claim = tryClaim(nextGame, team, playerId, hand, 'meld-empty', 0)
      nextRoom = withTeam(nextRoom, team.id, (t) => ({ ...t, pozzetto: claim.pozzetto }))
      nextGame = {
        ...nextGame,
        hands: { ...nextGame.hands, [playerId]: sortHand(claim.hand) },
        pozzettoStacks: claim.pozzettoStacks,
      }
      if (claim.hand.length > 0) {
        runAppends()
        runNewMelds()
        runAppends()
      }
    }
  }

  const team = teamOf()
  const hand = nextGame.hands[playerId] ?? []
  if (team && hand.length > 0) {
    const discardCard = pickAiDiscard(hand, aiContext(nextRoom, nextGame, team, hand.length)) ?? hand[0]
    const discarded = performDiscard(hand, discardCard.id, nextGame.discardPile.cards)
    if (discarded) {
      const wasClaimed = team.pozzetto.claimed
      const claim = tryClaim(
        nextGame,
        team,
        playerId,
        discarded.hand,
        'discard',
        discarded.handSizeBeforeDiscard,
      )
      const pozzetto = {
        ...claim.pozzetto,
        activated: wasClaimed ? true : claim.pozzetto.activated,
      }
      nextRoom = withTeam(nextRoom, team.id, (t) => ({ ...t, pozzetto }))
      nextGame = {
        ...nextGame,
        hands: { ...nextGame.hands, [playerId]: sortHand(claim.hand) },
        discardPile: { cards: discarded.discardPile },
        pozzettoStacks: claim.pozzettoStacks,
        lastPlay: cardPlay(playerId, 'discard', { cardIds: [discardCard.id] }),
        pendingSlide: null,
      }
      const teamAfter = findTeam(nextRoom, playerId)!
      const autoShow = tryAutoShow(nextRoom, nextGame, teamAfter, playerId)
      if (autoShow.ended) return autoShow
      if (isIllegalEmptyHand(teamAfter, claim.hand.length)) {
        const prev = nextGame.emptyHandFoulByTeam ?? { 'team-a': 0, 'team-b': 0 }
        nextGame = {
          ...nextGame,
          emptyHandFoulByTeam: {
            ...prev,
            [team.id]: (prev[team.id] ?? 0) + EMPTY_HAND_FOUL_PENALTY,
          },
        }
      }
      nextGame = { ...nextGame, turn: advanceTurn(nextGame, nextRoom, playerId) }
      return { room: nextRoom, game: nextGame }
    }
  }

  if (team) {
    const autoShow = tryAutoShow(nextRoom, nextGame, team, playerId)
    if (autoShow.ended) return autoShow
  }
  nextGame = { ...nextGame, turn: advanceTurn(nextGame, nextRoom, playerId) }
  return { room: nextRoom, game: nextGame }
}

/** Keep playing mock seats until a human must act, the round ends, or pause. */
export function playBotsUntilHuman(
  room: RoomState,
  game: GameState,
): { room: RoomState; game: GameState } {
  let nextRoom = room
  let nextGame = game
  for (let i = 0; i < 8; i += 1) {
    if (nextRoom.status !== 'in-progress') break
    if (nextGame.turn.isPaused) break
    const active = nextRoom.players.find((p) => p.id === nextGame.turn.activePlayerId)
    if (!active?.isMock) break
    const beforeTurn = nextGame.turn.turnNumber
    const stepped = applyBotTurn(nextRoom, nextGame, active.id)
    nextRoom = stepped.room
    nextGame = stepped.game
    if (nextGame.turn.turnNumber === beforeTurn && nextRoom.status === 'in-progress') break
  }
  return { room: nextRoom, game: nextGame }
}
