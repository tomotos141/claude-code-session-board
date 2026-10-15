import type { PromptComposeInput, PromptComposeSection, Register } from 'claude-code'

// The name only tells sessions apart; the state goes in the sidebar's sections. A state word in the name
// rewrote the name at every state change and was cut off at the end of a long name (measured 2026-10-14).
// The rule lives in AGENTS.md too, yet the model forgets it at the moment the state changes: the tools wait
// behind ToolSearch and nothing points at them then. This mod keeps them in front, puts the rule in the
// system prompt, and rides on overview's update result, which the model calls at each state change anyway.
export const TITLE_TOOL = 'mcp__ccd_session_mgmt__set_session_title'
export const MOVE_TOOL = 'mcp__ccd_sidebar__move_sessions'
export const SECTIONS_TOOL = 'mcp__ccd_sidebar__list_sections'
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

export const register: Register = on => {
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
