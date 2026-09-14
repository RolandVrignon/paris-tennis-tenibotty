export const nextHour = hour => String(Number(hour) + 1).padStart(2, '0')

export const consecutiveSearchTarget = target => ({
  ...target,
  hours: [...new Set(target.hours.flatMap(hour => [hour, nextHour(hour)]))],
})

// Preserve start-hour preferences and choose one court for both independent legs.
// Within a preference, prefer a complete pair, but allow either hour on its own.
export const findConsecutivePair = (target, candidates) => {
  for (const hour of target.hours) {
    const first = candidates.filter(candidate => candidate.hour === hour)
    const second = candidates.filter(candidate => candidate.hour === nextHour(hour))
    const candidate = first.find(item => second.some(next => next.courtId === item.courtId)) || first[0] || second[0]
    if (candidate) return { sport: target.sport, location: target.location, hour, courtId: candidate.courtId, courtType: candidate.courtType }
  }
}
