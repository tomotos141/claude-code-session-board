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

// The log is the only trace the bootstrap leaves: every way it can fail shows up to the person as "sessions
// are named but never move", with nothing to say why, so what it did and why it stopped belongs on the record.
const say = ($: Pick<EngineInterface, 'ui'>, text: string): void => {
  void Promise.resolve($.ui.log(`session-board: ${text}`, { to: 'debug' })).catch(() => undefined)
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
  for (const tool of [SECTIONS_TOOL, CREATE_SECTION_TOOL]) {
    const { decision } = await $.tool.check({ tool, input: { name: SECTIONS[0] } })
    if (decision !== 'allow') {
      say($, `${tool} is not allowed outright (${decision}); leaving the sidebar alone`)
      return []
    }
  }
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
  // for good and in silence. The record only ever covers sections the mod made itself, so finishing the set
  // still duplicates nothing of the person's.
  const made = new Set(((await $.store.get('bootstrap.created')) as readonly string[] | undefined) ?? [])
  const mine = SECTIONS.filter(s => existing.has(s)).every(s => made.has(s))
  if (SECTIONS.some(s => existing.has(s)) && !mine) return []
  const owing = SECTIONS.filter(s => !existing.has(s))
  if (owing.length === 0) {
    await $.store.delete('bootstrap.created')
    return []
  }
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
    const owed = created.length < owing.length
    await $.store.set('bootstrap.created', [...made, ...created])
    if (!owed && SECTIONS.every(s => existing.has(s) || created.includes(s))) await $.store.delete('bootstrap.created')
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
