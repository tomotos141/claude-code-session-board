import { expect, mock, test } from 'claude-code/testing'

import { bootstrapSections, CREATE_SECTION_TOOL, isOverviewUpdate, MOVE_TOOL, PUSH_TOOL, SECTIONS, SECTIONS_TOOL, resetBootstrapForTests, TITLE_TOOL } from './register'

const OVERVIEW = 'mcp__overview__update'

test('both spellings of overview update are recognised', () => {
  expect(isOverviewUpdate('mcp__overview__update')).toBe(true)
  expect(isOverviewUpdate('mcp__plugin_overview_overview__update')).toBe(true)
  expect(isOverviewUpdate('mcp__linear__update')).toBe(false)
  expect(isOverviewUpdate('mcp__overview__updater')).toBe(false)
})

test('the rule joins the system prompt only for a main conversation with the tool', async ($, on) => {
  on('prompt.compose', async () => ({ sections: [{ id: 'intro', text: 'i', scope: 'shared' }] }) as never)
  const compose = (surfaces: readonly 'desktop'[], tools: readonly string[], traits: readonly never[] = []) =>
    $.prompt.compose({ model: 'm', promptModel: 'm', outputStyle: null, surfaces, tools, traits })
  const watched = await compose(['desktop'], [TITLE_TOOL])
  expect(watched.sections.map(s => s.id)).toEqual(['intro', 'session-board:rule'])
  const text = watched.sections[1]?.text ?? ''
  for (const place of ['確認待ち', '作業中', '外部待ち', '保留', '完了']) expect(text).toContain(`「${place}」`)
  expect(text).toContain(PUSH_TOOL)
  expect(text).toContain(MOVE_TOOL)
  expect(text).toContain('issue key・状態は入れない')
  // The desktop's surface is away at some renders; the rule must not go with it.
  expect((await compose([], [TITLE_TOOL])).sections.map(s => s.id)).toEqual(['intro', 'session-board:rule'])
  // The shape measured in a desktop session on 2.1.295: no surface, and the print trait.
  const desktop = ['lean', 'print', 'skills'] as never[]
  expect((await compose([], [TITLE_TOOL], desktop)).sections.map(s => s.id)).toEqual(['intro', 'session-board:rule'])
  expect((await compose(['desktop'], ['Bash'])).sections.map(s => s.id)).toEqual(['intro'])
  expect((await compose(['desktop'], [TITLE_TOOL], ['teammate' as never])).sections.map(s => s.id)).toEqual(['intro'])
  expect((await compose([], [TITLE_TOOL], ['bare' as never])).sections.map(s => s.id)).toEqual(['intro'])
})

test('the rename, move and sections tools are kept in front; rename and move carry the rule', async ($, on) => {
  on('tool.describe', async () => ({ description: 'own', isDeferred: true }) as never)
  const title = await $.tool.describe({ tool: TITLE_TOOL, description: 'd' } as never)
  expect(title.isDeferred).toBe(false)
  expect(title.description).toContain('only when the work itself changes')
  const move = await $.tool.describe({ tool: MOVE_TOOL, description: 'd' } as never)
  expect(move.isDeferred).toBe(false)
  expect(move.description).toContain('確認待ち')
  const sections = await $.tool.describe({ tool: SECTIONS_TOOL, description: 'd' } as never)
  expect(sections.isDeferred).toBe(false)
  expect(sections.description).toBe('own')
  // PushNotification is in CLI sessions too, where nothing asks for it.
  for (const tool of [PUSH_TOOL, 'mcp__other__x']) {
    const d = await $.tool.describe({ tool, description: 'd' } as never)
    expect(d.isDeferred).toBe(true)
    expect(d.description).toBe('own')
  }
})

const row = (tool: string, isError = false, agentId?: string) =>
  ({
    door: 'tool-result',
    origin: { kind: 'tool', tool },
    uuid: 'u1',
    ...(agentId === undefined ? {} : { agentId }),
    message: { type: 'user', role: 'user', isMeta: false, content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Updated the pane.', is_error: isError }] },
  }) as never

const texts = (r: { message: { content: readonly { type: string; text?: string }[] } } | undefined) =>
  (r?.message.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '')

// The text blocks of the row as stored after appending it.
const reminders = async ($: { session: { append: (r: never) => Promise<unknown> } }, session: ReturnType<typeof mock.session>, r: never) => {
  await $.session.append(r)
  return texts(session.appended().at(-1) as never)
}

test('an overview update result from the main conversation carries the reminder', async ($, on) => {
  const session = mock.session(on)
  const reminder = (await reminders($, session, row(OVERVIEW))).join(' ')
  expect(reminder).toContain(MOVE_TOOL)
  expect(reminder).toContain(PUSH_TOOL)
  expect((await reminders($, session, row('mcp__plugin_overview_overview__update'))).length).toBe(1)
})

test('other results, failed updates and subagent updates carry no reminder', async ($, on) => {
  const session = mock.session(on)
  expect(await reminders($, session, row('Bash'))).toEqual([])
  expect(await reminders($, session, row(OVERVIEW, true))).toEqual([])
  expect(await reminders($, session, row(OVERVIEW, false, 'a1'))).toEqual([])
})

// A stand-in for the sidebar: what list_sections answers, the create calls it records, the store the
// bootstrap carries unfinished work in, and the debug lines it leaves.
const sidebar = (opts: {
  existing?: readonly string[]
  listed?: string
  listFails?: boolean
  listDenied?: boolean
  createFails?: boolean
  createDenied?: boolean
  createThrowsAt?: number
  without?: readonly string[]
} = {}) => {
  const created: string[] = []
  const tools = [SECTIONS_TOOL, CREATE_SECTION_TOOL].filter(t => !(opts.without ?? []).includes(t))
  const text = opts.listed ?? JSON.stringify((opts.existing ?? []).map((name, i) => ({ id: `g${i}`, kind: 'manual', name })))
  let creates = 0
  const $ = {
    tool: {
      list: async () => tools.map(name => ({ name })),
      call: async (input: { tool: string; name?: string }) => {
        if (input.tool === SECTIONS_TOOL) {
          if (opts.listDenied === true) return { deny: 'refused' }
          return opts.listFails === true ? { isError: true, result: 'no' } : { result: { text }, text }
        }
        if (input.tool !== CREATE_SECTION_TOOL) throw new Error(`unexpected ${input.tool}`)
        creates += 1
        if (opts.createThrowsAt === creates) throw new Error('the call was aborted')
        // A refusal carries `deny` and leaves isError unset: taking that for a success is the bug this covers.
        if (opts.createDenied === true) return { deny: 'the user said no' }
        if (opts.createFails === true) return { isError: true, result: 'refused' }
        created.push(input.name ?? '')
        return { result: { id: 'new' }, text: '{"id":"new"}' }
      },
    },
  }
  return { $: $ as never, created, calls: () => creates }
}

// bootstrapSections remembers that it ran for the life of the module, so each case clears that first.
const fresh = () => {
  resetBootstrapForTests()
  return bootstrapSections
}

test('with no section at all, the five are created in the order the rule reads them', async () => {
  const boot = fresh()
  const { $, created } = sidebar({ existing: [] })
  expect(await boot($)).toEqual([...SECTIONS])
  expect(created).toEqual(['確認待ち', '作業中', '外部待ち', '保留', '完了'])
})

test('one of the five already there means none is created', async () => {
  for (const existing of [['完了'], ['確認待ち'], SECTIONS, ['作業中', 'Inbox']]) {
    const boot = fresh()
    const { $, created } = sidebar({ existing })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('sections under other names are left alone and do not block the five', async () => {
  const boot = fresh()
  const { $, created } = sidebar({ existing: ['Inbox', 'Later'] })
  expect(await boot($)).toEqual([...SECTIONS])
  expect(created.length).toBe(5)
})

test('it runs once per load, and a second call creates nothing', async () => {
  const boot = fresh()
  const first = sidebar({ existing: [] })
  expect((await boot(first.$)).length).toBe(5)
  const second = sidebar({ existing: [] })
  expect(await boot(second.$)).toEqual([])
  expect(second.created).toEqual([])
})

test('a listing it cannot read creates nothing, rather than guessing the sidebar is empty', async () => {
  for (const listed of ['not json', '{"sections":"x"}', '[]garbage']) {
    const boot = fresh()
    const { $, created } = sidebar({ listed })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('a listing that fails creates nothing', async () => {
  const boot = fresh()
  const { $, created } = sidebar({ listFails: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})

test('a refused creation stops there instead of carrying on', async () => {
  const boot = fresh()
  const { $, created } = sidebar({ existing: [], createFails: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})

test('without the sidebar tools, as outside the desktop app, nothing is called', async () => {
  for (const without of [[SECTIONS_TOOL], [CREATE_SECTION_TOOL], [SECTIONS_TOOL, CREATE_SECTION_TOOL]]) {
    const boot = fresh()
    const { $, created } = sidebar({ existing: [], without })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('an empty sidebar is read from either shape list_sections may answer with', async () => {
  for (const listed of ['[]', '{"sections":[]}']) {
    const boot = fresh()
    const { $, created } = sidebar({ listed })
    expect((await boot($)).length).toBe(5)
    expect(created.length).toBe(5)
  }
})

// Driving the real hook: the plugin's session.start sits above whatever answers tool.list beneath it, so a
// sidebar that throws or never answers is reached through the hook itself, not by calling bootstrapSections.
const startsWith = async (
  $: { session: { start: (i: never) => Promise<{ cwd: string }> } },
  on: (e: string, h: (...a: never[]) => Promise<unknown>) => void,
  list: () => Promise<never>,
) => {
  resetBootstrapForTests()
  on('session.start', async (_$: never, e: never) => ({ cwd: (e as { cwd: string }).cwd }))
  on('tool.list', list)
  return $.session.start({ cwd: '/w', surface: null, isInteractive: false } as never)
}

test('a sidebar that throws cannot fail the session start', async ($, on) => {
  const started = await startsWith($, on as never, async () => {
    throw new Error('the sidebar is gone')
  })
  expect(started.cwd).toBe('/w')
})

test('a sidebar that never answers cannot hold up the session start', async ($, on) => {
  // Were the bootstrap awaited, this start would never resolve and the test would time out.
  const started = await startsWith($, on as never, () => new Promise<never>(() => undefined))
  expect(started.cwd).toBe('/w')
})

test('rows with no readable name read as "cannot tell", not as an empty sidebar', async () => {
  for (const listed of ['[{"id":"g0","kind":"manual"}]', '[{"id":"g0","name":null},{"id":"g1"}]']) {
    const boot = fresh()
    const { $, created } = sidebar({ listed })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('a refused creation stops at once instead of asking four more times', async () => {
  const boot = fresh()
  const { $, created, calls } = sidebar({ existing: [], createDenied: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
  // The refusal arm leaves isError unset; only one call may go out.
  expect(calls()).toBe(1)
})

test('a refused listing creates nothing', async () => {
  const boot = fresh()
  const { $, created } = sidebar({ listDenied: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})

test('a creation stopped partway stays stopped, and the next session does not finish it', async () => {
  // Nothing is remembered, so what the sidebar shows is the whole truth. Two of the five stand, which means
  // the rule below - create only when not one of them is there - declines for good. That is the trade the
  // record used to buy off, and the record is what kept breaking; the person finishes the set instead.
  const boot = fresh()
  const { $, created } = sidebar({ existing: [], createThrowsAt: 3 })
  await expect(boot($)).rejects.toThrow('aborted')
  expect(created).toEqual(['確認待ち', '作業中'])
  // A later session, reading that half-built sidebar fresh: two of the five stand, so it leaves them be.
  const again = fresh()
  const second = sidebar({ existing: ['確認待ち', '作業中'] })
  expect(await again(second.$)).toEqual([])
  expect(second.created).toEqual([])
  expect(second.calls()).toBe(0)
})

test('a creation refused partway keeps what it made and asks for no more', async () => {
  const boot = fresh()
  const { $, created, calls } = sidebar({ existing: [], createFails: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
  expect(calls()).toBe(1)
})

test('a section typed in another normal form is not duplicated', async () => {
  const boot = fresh()
  // 「保留」 decomposed, as a Mac may hand it over; it must still count as one of the five.
  const decomposed = '保留'.normalize('NFD')
  const { $, created } = sidebar({ listed: JSON.stringify([{ id: 'g0', name: decomposed }]) })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})

test('a section whose name is blank or padded does not stand in for one of the five', async () => {
  const boot = fresh()
  // A padded 「保留」 is that section; a blank name is no section at all and must not read as one.
  const { $, created } = sidebar({ listed: JSON.stringify([{ id: 'g0', name: '  保留  ' }, { id: 'g1', name: 'x' }]) })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})
