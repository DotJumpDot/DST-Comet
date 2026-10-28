/** Teammate-release persistence contract: plugin records must stay loadable. */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendPluginRecord,
  KNOWN_SESSION_EVENT_TYPES,
  Session,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { teamProjectionDefinition } from '../../agent-team/src/projection.ts'
import { TeamId } from '../../agent-team/src/types.ts'

const rootId = SessionId('lead-1')
const teamId = TeamId(rootId)
const header = {
  version: 4,
  id: rootId,
  createdAt: 0,
  isSeeded: false,
} as unknown as SessionHeader

const memberOf = (id: string, name: string, phase: 'provisioning' | 'active'): { version: 2; teamId: typeof teamId; member: { id: ReturnType<typeof SessionId>; name: string; description: string; provider: string; context: 'fresh'; phase: 'provisioning' | 'active' } } => ({
  version: 2,
  teamId,
  member: {
    id: SessionId(id),
    name,
    description: 'lane',
    provider: 'spawn',
    context: 'fresh',
    phase,
  },
})

const init = (): ReturnType<typeof teamProjectionDefinition.init> => teamProjectionDefinition.init(header)
const fold = (events: readonly SessionEvent[]) => events.reduce(teamProjectionDefinition.apply, init())

test('release records commit as ignorable plugin records a stock harness can still read', () => {
  const session = Session.create(rootId)
  session.append('team/member', memberOf('m-1', 'scout', 'provisioning'))
  appendPluginRecord(session, 'plugin:agent-team/member-released', {
    version: 2,
    teamId,
    memberId: SessionId('m-1'),
  })
  const events = session.snapshotEvents()
  const release = events.find(event => (event as { type: string }).type === 'plugin:agent-team/member-released')
  assert.ok(release !== undefined, 'the release record committed to the log')
  // The regression this guards: the type is outside the released catalog, so
  // the envelope ignorable marker is the only thing that keeps the log
  // loadable by a harness that does not know the type.
  assert.equal(KNOWN_SESSION_EVENT_TYPES.has('plugin:agent-team/member-released'), false)
  assert.equal((release as { ignorable?: true }).ignorable, true)
})

test('a plugin release record removes the member from the projected roster', () => {
  const session = Session.create(rootId)
  session.append('team/member', memberOf('m-1', 'scout', 'provisioning'))
  session.append('team/member', memberOf('m-1', 'scout', 'active'))
  session.append('team/member', memberOf('m-2', 'lane-b', 'provisioning'))
  appendPluginRecord(session, 'plugin:agent-team/member-released', {
    version: 2,
    teamId,
    memberId: SessionId('m-1'),
  })
  const state = fold(session.snapshotEvents())
  assert.equal(state.failure, undefined)
  assert.deepEqual(state.members.map(member => member.name), ['lane-b'])
})

test('repaired legacy release events (ignorable team/member/released) still apply', () => {
  const session = Session.create(rootId)
  session.append('team/member', memberOf('m-1', 'scout', 'provisioning'))
  session.append('team/member', memberOf('m-1', 'scout', 'active'))
  const legacy = {
    type: 'team/member/released',
    seq: 2,
    time: 0,
    ignorable: true,
    data: { version: 2, teamId, memberId: SessionId('m-1') },
  } as unknown as SessionEvent
  const state = fold([...session.snapshotEvents(), legacy])
  assert.equal(state.failure, undefined)
  assert.deepEqual(state.members.map(member => member.name), [])
})

test('duplicate and malformed release records are skipped without failing the fold', () => {
  const session = Session.create(rootId)
  session.append('team/member', memberOf('m-1', 'scout', 'provisioning'))
  session.append('team/member', memberOf('m-1', 'scout', 'active'))
  appendPluginRecord(session, 'plugin:agent-team/member-released', {
    version: 2,
    teamId,
    memberId: SessionId('m-1'),
  })
  appendPluginRecord(session, 'plugin:agent-team/member-released', {
    version: 2,
    teamId,
    memberId: SessionId('m-1'),
  })
  appendPluginRecord(session, 'plugin:agent-team/member-released', {
    version: 2,
    teamId,
  } as { version: 2; teamId: typeof teamId; memberId: ReturnType<typeof SessionId> })
  const state = fold(session.snapshotEvents())
  assert.equal(state.failure, undefined)
  assert.deepEqual(state.members.map(member => member.name), [])
})

test('a release record for another team leaves the roster untouched', () => {
  const session = Session.create(rootId)
  session.append('team/member', memberOf('m-1', 'scout', 'provisioning'))
  session.append('team/member', memberOf('m-1', 'scout', 'active'))
  appendPluginRecord(session, 'plugin:agent-team/member-released', {
    version: 2,
    teamId: TeamId('other-root'),
    memberId: SessionId('m-1'),
  })
  const state = fold(session.snapshotEvents())
  assert.equal(state.failure, undefined)
  assert.deepEqual(state.members.map(member => member.name), ['scout'])
})
