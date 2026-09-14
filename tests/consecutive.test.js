import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consecutiveSearchTarget, findConsecutivePair } from '../lib/consecutive.js'

const target = { sport: 'padel', location: 'Padel Jules Ladoumègue', hours: ['20', '19'] }
const slot = (hour, courtId = '4830') => ({ hour, courtId, courtType: 'Couvert' })

test('pair discovery includes the second hour even if the first hour is absent', () => {
  assert.deepEqual(consecutiveSearchTarget(target).hours, ['20', '21', '19'])
  assert.deepEqual(findConsecutivePair(target, [slot('21')]), {
    sport: target.sport, location: target.location, hour: '20', courtId: '4830', courtType: 'Couvert',
  })
})
test('prefer a complete pair on one court without mixing two courts', () => {
  assert.equal(findConsecutivePair(target, [slot('20', '1'), slot('20', '2'), slot('21', '2')]).courtId, '2')
  assert.equal(findConsecutivePair(target, [slot('20', '1'), slot('21', '2')]).courtId, '1')
})
test('preserve requested starting-hour preference and never invent a different pair', () => {
  assert.equal(findConsecutivePair(target, [slot('19'), slot('20'), slot('21')]).hour, '20')
  assert.equal(findConsecutivePair(target, [slot('19')]).hour, '19')
  assert.equal(findConsecutivePair(target, [slot('22')]), undefined)
  assert.equal(findConsecutivePair(target, []), undefined)
})
