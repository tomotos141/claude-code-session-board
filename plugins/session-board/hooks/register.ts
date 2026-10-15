import type { EngineInterface, PromptComposeInput, PromptComposeSection, Register } from 'claude-code'

// The name only tells sessions apart; the state goes in the sidebar's sections. A state word in the name
// rewrote the name at every state change and was cut off at the end of a long name (measured 2026-10-14).
// The rule lives in AGENTS.md too, yet the model forgets it at the moment the state changes: the tools wait
// behind ToolSearch and nothing points at them then. This mod keeps them in front, puts the rule in the
// system prompt, and rides on overview's update result, which the model calls at each state change anyway.
export const TITLE_TOOL = 'mcp__ccd_session_mgmt__set_session_title'
export const MOVE_TOOL = 'mcp__ccd_sidebar__move_sessions'
export const SECTIONS_TOOL = 'mcp__ccd_sidebar__list_sections'
export const CREATE_SECTION_TOOL = 'mcp__ccd_sidebar__create_section'
export const PUSH_TOOL = 'PushNotification'
export const SECTIONS = ['確認待ち', '作業中', '外部待ち', '保留', '完了'] as const

// overview registers its tool as mcp__overview__update, or mcp__plugin_overview_overview__update when installed.
export const isOverviewUpdate = (tool: string): boolean => /^mcp__(?:plugin_)?overview(?:_overview)?__update$/.test(tool)

const PLACES = SECTIONS.map(s => `「${s}」`).join('・')

export const rule = (): PromptComposeSection => ({
  id: 'session-board:rule',
  scope: 'session',
  text: [
    `このセッションの名前（サイドバーの看板）は、作業を始めたときに ${TITLE_TOOL}（session_id: "self"）で1回だけ付ける。`,
    '名前は、ほかのセッションと見分けるのに要る名詞だけを10〜15字で書き、issue key・状態は入れない。期限がある作業だけ頭に `M/D ` を付ける。',
    '付け直すのは、作業の中身が別のものに変わったときだけ。患者・スタッフの情報、秘密、内部 URL は入れない。例: `入社手続きチェックリスト`、`10/31 月次評価のコピー化`。',
    `状態はサイドバーのセクション ${PLACES} で見せる。次に動くのが誰かで決める。`,
    'ユーザー（承認・判断・答え）なら確認待ち、Claude（作業がしばらく続く）なら作業中、ほかの人や時間（返事・レビュー・CI・日時）なら外部待ち、誰も動かない（寝かせる）なら保留、もう無い（閉じてよい）なら完了。',
    `置き場所が変わるときだけ ${MOVE_TOOL}（session_ids: ["self"]）で移し、毎ターンは移さない。section_id は ${SECTIONS_TOOL} で名前の完全一致で引き（「外部待ち」と「確認待ち」を取り違えない）、無ければ作らずに移さない。`,
    '返答中かどうかはアプリが示すので、そのためだけに作業中へ移さない。',
    `確認待ちへ移したときだけ、${PUSH_TOOL}（後ろに隠れていれば ToolSearch で読む）で何に答えればよいかを1行で知らせる。`,
  ].join(' '),
})

export const nudge = (): string =>
  `Overview を更新した。次に動くのが誰かが変わったなら、このセッションを ${MOVE_TOOL} で${PLACES}のうち合うセクションへ移し、確認待ちへ移したときは ${PUSH_TOOL} で知らせる。変わっていなければ何もしない。まだ名前が無ければ付け、あれば作業の中身が変わったときだけ付け直す。`

// Only a render that offers the rename tool, the desktop app's own: not a teammate, not --bare.
// Not asked of e.surfaces: the desktop's surface is away at some renders (measured on 2.1.295, ['desktop'] in
// one turn and [] in the next in the same session), and the rule went with it.
// Not asked of the 'print' trait either: the desktop session itself carries it (same measurement).
// Subagents are not told apart here (the input names no agent); in one measurement a section a mod added did
// not reach an Agent-tool subagent, and session.append below leaves them out by agentId.
export const isWatchedMain = (e: Pick<PromptComposeInput, 'tools' | 'traits'>): boolean =>
  e.tools.includes(TITLE_TOOL) && !e.traits.includes('teammate') && !e.traits.includes('bare')

// Their own descriptions read against the rule: renaming "when clearly stale", moving as the user files sessions.
const RULES: Record<string, string> = {
  [TITLE_TOOL]: "This user's rule: name this session (session_id \"self\") once when the work starts, with only the work's name (no issue key, no state), and rename it only when the work itself changes.",
  [MOVE_TOOL]: `This user's rule: keep this session ("self") in the section for whoever moves next (${SECTIONS.join(' / ')}), moving it only when that changes.`,
}
// PushNotification stays where it is: it exists outside the desktop too, and tool.describe cannot tell the sessions apart.
const FRONT = new Set([TITLE_TOOL, MOVE_TOOL, SECTIONS_TOOL])

// Reading the sections back: list_sections answers with its rows as JSON text, so the names come out of
// whatever shape parses. A listing that does not parse answers undefined, not an empty list: "no name here"
// and "cannot tell what is here" must not be the same answer, or an unreadable listing would read as an
// empty sidebar and the five would be created over sections that are already standing.
export const sectionNames = (text: string): readonly string[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(text)
    const rows = Array.isArray(parsed) ? parsed : (parsed as { sections?: unknown })?.sections
    if (!Array.isArray(rows)) return undefined
    // Normalised, because a section typed on a Mac may arrive decomposed and would not match the five
    // otherwise; the five would then be created beside it, which is the duplication the guard forbids.
    const named = rows.flatMap(r => {
      const n = (r as { name?: unknown })?.name
      return typeof n === 'string' && n.trim() !== '' ? [n.normalize('NFC').trim()] : []
    })
    // Rows that are there but carry no readable name are the same "cannot tell": were the field ever to be
    // spelled otherwise, every row would drop out and an occupied sidebar would read as an empty one.
    return rows.length > 0 && named.length === 0 ? undefined : named
  } catch {
    return undefined
  }
}

// The five are created only when not one of them exists. The mod looks sections up by exact name and never
// creates a missing one: that is what keeps a renamed section from being quietly duplicated. "Not one of the
// five is there" means nobody has made them yet, so there is nothing to duplicate and the guard still holds.
// Once any one exists the person's own naming is in play, and this does nothing for the rest of the session.
let bootstrapped = false

// Only for the tests, which exercise several sidebars in one load of the module. Not API.
export const resetBootstrapForTests = (): void => {
  bootstrapped = false
}

// A result the call answered. The union's refusal arm carries `deny` and leaves `isError` undefined, so
// reading isError alone takes a refusal for a success: `result` is the one field only an answer sets.
const answered = (r: { result?: unknown; isError?: boolean; deny?: string }): boolean =>
  r.deny === undefined && r.isError !== true && r.result !== undefined

const STORE_KEY = 'bootstrap.created'
const canonical = (s: string): string => s.normalize('NFC').trim()

// The record is a JSON file of the mod's own that the person can open and hand-edit, so it is validated
// rather than cast: a bare string would otherwise become a Set of its characters, and a number or an object
// would throw on `new Set`, out through the swallowed catch, killing the bootstrap with no trace at all.
// Anything malformed is read as no record, which falls back to not resuming, the safe answer.
const recorded = async ($: Pick<EngineInterface, 'store' | 'ui'>): Promise<ReadonlySet<string>> => {
  const raw: unknown = await $.store.get(STORE_KEY)
  if (raw === undefined) return new Set()
  if (!Array.isArray(raw)) {
    say($, 'the record of what it made was not readable; ignoring it')
    return new Set()
  }
  return new Set(raw.filter((v): v is string => typeof v === 'string').map(canonical))
}

// Normalised and deduplicated on the way in, so the record and the sidebar's listing are always compared
// through the same spelling, and a section created again across stalled runs is written down once.
const remember = ($: Pick<EngineInterface, 'store'>, names: readonly string[]): Promise<void> =>
  $.store.set(STORE_KEY, [...new Set(names.map(canonical))])

const forget = async ($: Pick<EngineInterface, 'store' | 'ui'>, why: string | undefined): Promise<void> => {
  await $.store.delete(STORE_KEY)
  if (why !== undefined) say($, `forgot the record: ${why}`)
}

// The log is the only trace the bootstrap leaves: every way it can fail shows up to the person as "sessions
// are named but never move", with nothing to say why, so what it did and why it stopped belongs on the record.
const say = ($: Pick<EngineInterface, 'ui'>, text: string): void => {
  // In a try, not only a .catch: ui.log is synchronous, so a throw of its own happens while the argument is
  // evaluated and would never reach a promise's catch. Logging must not be able to break the bootstrap.
  try {
    void Promise.resolve($.ui.log(`session-board: ${text}`, { to: 'debug' })).catch(() => undefined)
  } catch {
    // Nothing to do: there is no second place to report that reporting failed.
  }
}

// The sidebar's tools are the desktop app's own MCP tools: this build declares no types for them, so the
// names, the `name` argument and the JSON shape read back are all measured against the app, not checked by
// the compiler. Measured on Claude Code 2.1.295, 2026-10-15: list_sections answers a JSON array of
// { id, kind, name, ... }, and create_section takes { name }.
export const bootstrapSections = async ($: Pick<EngineInterface, 'tool' | 'store' | 'ui'>): Promise<readonly string[]> => {
  if (bootstrapped) return []
  bootstrapped = true
  // Outside the desktop app the sidebar's tools are not there at all; a call would merely be refused.
  const tools = new Set((await $.tool.list()).map(t => t.name))
  if (!tools.has(SECTIONS_TOOL) || !tools.has(CREATE_SECTION_TOOL)) return []
  // Asked before anything is called: tool.check opens no dialog and runs nothing. Without it the mod's first
  // act in a new session could be six approval dialogs the person never asked for, before the first prompt.
  // Each call is checked with the arguments it will actually carry, since a rule may match on them: asking
  // about an argument the tool never receives answers a question nobody will put.
  const allowed = async (tool: string, input: Record<string, unknown>): Promise<boolean> => {
    const { decision } = await $.tool.check({ tool, input })
    if (decision === 'allow') return true
    say($, `${tool} is not allowed outright (${decision}); leaving the sidebar alone`)
    return false
  }
  if (!(await allowed(SECTIONS_TOOL, {}))) return []
  const listed = await $.tool.call({ tool: SECTIONS_TOOL })
  if (!answered(listed) || listed.text === undefined) {
    say($, 'could not read the sidebar; created nothing')
    return []
  }
  const names = sectionNames(listed.text)
  if (names === undefined) {
    say($, 'could not make out which sections the sidebar has; created nothing')
    return []
  }
  const existing = new Set(names)
  // What an earlier session of this mod created before it was stopped partway. Without it a run that stopped
  // after two would be stuck: one of the five now stands, so the guard below would decline to make the rest,
  // for good and in silence.
  const made = await recorded($)
  // The record must agree with the sidebar in BOTH directions before it licenses a resume: every one of the
  // five now standing has to be the mod's own, AND every one the mod wrote down has to still be standing.
  // Only the first half would take a record entry the person has since renamed or deleted for one that is
  // still owed, and create it beside the name they chose, which is the duplication this design forbids.
  const standing = SECTIONS.filter(s => existing.has(s))
  const resumable = standing.every(s => made.has(s)) && [...made].every(s => existing.has(s))
  if (standing.length > 0 && !resumable) {
    // Their sidebar now, not the mod's half-finished work: let the record go rather than act on it again.
    if (made.size > 0) await forget($, 'the sections it had written down are not the ones standing now')
    return []
  }
  const owing = SECTIONS.filter(s => !existing.has(s))
  if (owing.length === 0) {
    await forget($, undefined)
    return []
  }
  // Every name it is about to create, before it creates the first: an allow for one of them is not an allow
  // for the rest, and stopping halfway through is what leaves the sidebar half-built.
  for (const name of owing) if (!(await allowed(CREATE_SECTION_TOOL, { name }))) return []
  const created: string[] = []
  try {
    // In order, so the sidebar lays them out the way the rule reads them.
    for (const name of owing) {
      const r = await $.tool.call({ tool: CREATE_SECTION_TOOL, name })
      // A refusal answers on the union's deny arm, where isError is unset: stop at the first one rather than
      // record it as made and ask four more times.
      if (!answered(r)) {
        say($, `${CREATE_SECTION_TOOL} did not answer for 「${name}」; made ${created.length} of ${owing.length}, the rest are owed to a later session`)
        return created
      }
      created.push(name)
    }
  } finally {
    // In a finally, because an aborted call rejects out of the loop and leaves the same half-built sidebar:
    // either way what stands is written down, so a later session finishes the set instead of the guard above
    // seeing one of the five and declining to create the rest for good.
    // Guarded on its own, because an exception raised here would replace whatever the loop was doing: it
    // would discard a return, swallow an abort's real cause, and lose the record it is here to keep.
    const owed = created.length < owing.length
    try {
      if (owed) await remember($, [...made, ...created])
      else await forget($, undefined)
    } catch {
      say($, 'could not write down what it made; a later session will read the sidebar afresh')
    }
    say($, owed ? `made ${created.length} of ${owing.length} sections; the rest are owed` : `made all ${owing.length} sections it was missing`)
  }
  return created
}

export const register: Register = on => {
  // Not awaited, and its failure is swallowed: a slow or refused sidebar must not hold up the session's start.
  on('session.start', async ($, e, next) => {
    void bootstrapSections($).catch(() => undefined)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!isWatchedMain(e)) return composed
    return { sections: [...composed.sections.filter(s => s.id !== 'session-board:rule'), rule()] }
  })

  // Listed in front so renaming and moving need no ToolSearch first.
  on('tool.describe', async ($, e, next) => {
    const described = await next(e)
    if (!FRONT.has(e.tool)) return described
    const extra = RULES[e.tool]
    return { ...described, ...(extra === undefined ? {} : { description: `${described.description}\n\n${extra}` }), isDeferred: false }
  })

  // Added where overview's result is stored rather than in tool.call: overview answers that call itself,
  // so a tool.call hook nested inside it would never see the call, and the nesting within a tier is not set.
  // A PostToolUse command hook does not see it either, for the same reason.
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const o = e.origin as { kind?: string; tool?: string }
    const failed = e.message.content.some(b => b.type === 'tool_result' && b.is_error === true)
    if (e.agentId !== undefined || o.kind !== 'tool' || !isOverviewUpdate(o.tool ?? '') || failed) return next(e)
    return next({ ...e, message: { ...e.message, content: [...e.message.content, { type: 'text', text: nudge() }] } })
  })
}
