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

// A stand-in for the sidebar: what list_sections answers, and the create calls it records.
const sidebar = (opts: { existing?: readonly string[]; listed?: string; listFails?: boolean; createFails?: boolean; without?: readonly string[] } = {}) => {
  const created: string[] = []
  const tools = [SECTIONS_TOOL, CREATE_SECTION_TOOL].filter(t => !(opts.without ?? []).includes(t))
  const text = opts.listed ?? JSON.stringify((opts.existing ?? []).map((name, i) => ({ id: `g${i}`, kind: 'manual', name })))
  const $ = {
    tool: {
      list: async () => tools.map(name => ({ name })),
      call: async (input: { tool: string; name?: string }) => {
        if (input.tool === SECTIONS_TOOL) return opts.listFails === true ? { isError: true, text: 'no' } : { text }
        if (input.tool !== CREATE_SECTION_TOOL) throw new Error(`unexpected ${input.tool}`)
        if (opts.createFails === true) return { isError: true, text: 'refused' }
        created.push(input.name ?? '')
        return { text: '{"id":"new"}' }
      },
    },
  }
  return { $: $ as never, created }
}

// bootstrapSections remembers that it ran for the life of the module; each case starts from a clean slate.
const fresh = async () => {
  resetBootstrapForTests()
  return { bootstrapSections }
}

test('with no section at all, the five are created in the order the rule reads them', async () => {
  const { bootstrapSections: boot } = await fresh()
  const { $, created } = sidebar({ existing: [] })
  expect(await boot($)).toEqual([...SECTIONS])
  expect(created).toEqual(['確認待ち', '作業中', '外部待ち', '保留', '完了'])
})

test('one of the five already there means none is created', async () => {
  for (const existing of [['完了'], ['確認待ち'], SECTIONS, ['作業中', 'Inbox']]) {
    const { bootstrapSections: boot } = await fresh()
    const { $, created } = sidebar({ existing })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('sections under other names are left alone and do not block the five', async () => {
  const { bootstrapSections: boot } = await fresh()
  const { $, created } = sidebar({ existing: ['Inbox', 'Later'] })
  expect(await boot($)).toEqual([...SECTIONS])
  expect(created.length).toBe(5)
})

test('it runs once per load, and a second call creates nothing', async () => {
  const { bootstrapSections: boot } = await fresh()
  const first = sidebar({ existing: [] })
  expect((await boot(first.$)).length).toBe(5)
  const second = sidebar({ existing: [] })
  expect(await boot(second.$)).toEqual([])
  expect(second.created).toEqual([])
})

test('a listing it cannot read creates nothing, rather than guessing the sidebar is empty', async () => {
  for (const listed of ['not json', '{"sections":"x"}', '[]garbage']) {
    const { bootstrapSections: boot } = await fresh()
    const { $, created } = sidebar({ listed })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('a listing that fails creates nothing', async () => {
  const { bootstrapSections: boot } = await fresh()
  const { $, created } = sidebar({ listFails: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})

test('a refused creation stops there instead of carrying on', async () => {
  const { bootstrapSections: boot } = await fresh()
  const { $, created } = sidebar({ existing: [], createFails: true })
  expect(await boot($)).toEqual([])
  expect(created).toEqual([])
})

test('without the sidebar tools, as outside the desktop app, nothing is called', async () => {
  for (const without of [[SECTIONS_TOOL], [CREATE_SECTION_TOOL], [SECTIONS_TOOL, CREATE_SECTION_TOOL]]) {
    const { bootstrapSections: boot } = await fresh()
    const { $, created } = sidebar({ existing: [], without })
    expect(await boot($)).toEqual([])
    expect(created).toEqual([])
  }
})

test('an empty sidebar is read from either shape list_sections may answer with', async () => {
  for (const listed of ['[]', '{"sections":[]}']) {
    const { bootstrapSections: boot } = await fresh()
    const { $, created } = sidebar({ listed })
    expect((await boot($)).length).toBe(5)
    expect(created.length).toBe(5)
  }
})

test('the session starts even where the sidebar never answers', async ($, on) => {
  resetBootstrapForTests()
  // Beneath the plugin: the sidebar's own tools are absent, as in a terminal session.
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  const started = await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  expect(started.cwd).toBe('/w')
})
