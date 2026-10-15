# claude-code-session-board

A Claude Code plugin for the desktop app. It asks Claude to name each session once, then to keep that session in the sidebar section for **whoever moves next** — you, Claude, someone else, nobody, or no one at all.

A list of sessions then answers the only question a list of sessions needs to answer: which of these is waiting for me?

**Before it can do anything:** create five sections in the app's sidebar, named `確認待ち` / `作業中` / `外部待ち` / `保留` / `完了`. The plugin looks them up by exact name and will not create a missing one. The rule it adds is written in Japanese.

## Why the state is not in the name

An earlier version wrote the state into the session's name. Two things went wrong: the name was rewritten at every state change, and on a long name the state was cut off at the end — exactly where it mattered.

So the two things are split by what they are. The **name** says which work it is, and changes only when the work itself changes. The **section** says who moves next, and changes as often as that does. The name is the board's label; the section is where on the board it sits.

## The five sections

| Section | Reads as | Who moves next |
|---|---|---|
| 確認待ち | waiting on you | You — an approval, a decision, an answer |
| 作業中 | working | Claude — the work continues for a while |
| 外部待ち | waiting on the outside | Someone else, or a time — a reply, a review, CI, a date |
| 保留 | parked | Nobody — put to sleep on purpose, not finished |
| 完了 | done | Nobody — it can be closed |

The names are Japanese and fixed in the source; there is no setting for them. `外部待ち` ("waiting on the outside") is deliberately not `待ち`, which read too much like `確認待ち` at a glance.

**You create the sections yourself**, in the app's sidebar, with these exact names. The plugin looks each one up by exact name and is told not to create one that is missing — so a typo means it will not move the session rather than scatter new sections.

## What it actually does

- Adds one rule to Claude's system prompt: how to name the session, and which section matches which answer to "who moves next".
- Keeps three tools at hand — `set_session_title`, `move_sessions`, `list_sections` — so none of them needs a tool search first, and repeats the relevant half of the rule in the rename and move tools' own descriptions. `list_sections` is only brought forward; its description is left alone.
- Adds one line to the result of each successful [`overview`](https://github.com/tomotos141/claude-code-overview) update in the main conversation: if who-moves-next changed, move the session; if it did not, do nothing. Claude calls `overview` at each state change anyway, which is what makes this the right moment to ask. A failed update, and one inside a subagent, are skipped.
- Asks Claude to send one `PushNotification` line when, and only when, it moves the session to 確認待ち — so you learn what you are being asked, not merely that something moved.
- Where the session has no rename tool, such as the terminal, the system-prompt rule is not added. The other two parts are not conditioned on it: a tool description still gains its line where that tool exists, and the reminder is still appended after an `overview` update.
- It makes no network requests and calls no model of its own.

## Install

```bash
claude plugin marketplace add tomotos141/claude-code-session-board
```

```bash
claude plugin install session-board@claude-code-session-board
```

Then start a new session. Create the five sections in the sidebar if you have not already — if they do not exist under those exact names, Claude will name sessions but never move them, and nothing will say why.

`overview` is not required: without it the rule still applies, and only the reminder after each update is missing.

## Notes

- If you named a session yourself, the app asks you before Claude renames it. In bypass permissions mode the app does not ask. This is the app's own behavior, as its rename tool describes it.
- Whether who-moves-next changed is Claude's judgement. It is told not to move the session every turn, and not to move it to 作業中 merely because it is answering — the app already shows that.
- It needs the `prompt.compose` event, so a build that does not know that event will not load the module. Developed against Claude Code 2.1.295 and 2.1.300.
- The bundled test file imports `claude-code/testing`, a module Claude Code supplies at runtime. Outside Claude Code's own runner — with `bun test` on its own, for instance — it cannot be resolved and the tests do not run.

## License

MIT

---

## 日本語

Claude Code デスクトップアプリ向けの plugin です。セッションの名前を作業開始時に1回だけ付けさせ、そのあとは**次に動くのが誰か**でサイドバーのセクションへ置き続けさせます。

セッションの一覧が、一覧として答えるべき唯一の問いに答えるようになります。このうちどれが自分の返事を待っているのか。

**使う前に:** アプリのサイドバーへ `確認待ち` / `作業中` / `外部待ち` / `保留` / `完了` の5つのセクションを作ってください。plugin は名前の完全一致で引き、無いセクションは作りません。

### 状態を名前に入れない理由

以前の版は状態を名前に書いていました。二つ困ったことが起きました。状態が変わるたびに名前が書き換わること、そして長い名前では状態が末尾で切れること。切れるのはいちばん要るところです。

そこで、性質で二つに分けました。**名前**はどの作業かを言い、作業の中身が変わったときだけ変わる。**セクション**は次に動くのが誰かを言い、それが変わるたびに変わる。名前は看板の文字、セクションは看板が板のどこに立っているかです。

### 5つのセクション

| セクション | 次に動くのは |
|---|---|
| 確認待ち | あなた（承認・判断・答え） |
| 作業中 | Claude（作業がしばらく続く） |
| 外部待ち | ほかの人や時間（返事・レビュー・CI・日時） |
| 保留 | 誰も動かない（意図して寝かせる、まだ終わっていない） |
| 完了 | 誰も動かない — 閉じてよい |

セクション名は日本語でソースに固定してあり、設定で差し替える仕組みはありません。`待ち` ではなく `外部待ち` にしてあるのは、`確認待ち` と見分けづらかったためです。

**セクションはご自分でこの名前のとおりに**サイドバーへ作ってください。plugin は名前の完全一致で引き、無いときは作らずに移さないようにしてあります。名前が違えば、勝手にセクションが増えるのではなく、移動しないだけで済みます。

### 実際にしていること

- Claude の system prompt にルールを1つ足す。名前の付け方と、「次に動くのは誰か」の答えがどのセクションに対応するか。
- `set_session_title`・`move_sessions`・`list_sections` の3つを手前に置き、ツール検索を先にしなくても使えるようにする。名前を変えるツールと移すツールの説明には、該当部分のルールも書き足す。`list_sections` は手前に置くだけで、説明はそのままです。
- [`overview`](https://github.com/tomotos141/claude-code-overview) の更新が成功したとき、その結果に1行足す。次に動くのが誰かが変わったなら移す、変わっていなければ何もしない。Claude は状態が変わるたびに `overview` を呼ぶので、そこが訊くべき瞬間になります。失敗した更新と、サブエージェント内の更新は対象外です。
- 確認待ちへ移したときだけ `PushNotification` を1行送らせる。何かが動いたことではなく、何に答えればよいかが届くようにするためです。
- 名前を変えるツールが無いセッション（ターミナルなど）では、system prompt のルールを足しません。残り2つはこれに連動しないので、そのツールがあれば説明への書き足しは起き、`overview` 更新後のひと押しも付きます。
- 通信はしません。自分でモデルを呼ぶこともしません。

### 導入

```bash
claude plugin marketplace add tomotos141/claude-code-session-board
```

```bash
claude plugin install session-board@claude-code-session-board
```

そのあと新しいセッションを開いてください。5つのセクションがまだ無ければ、サイドバーへ作ってください。この名前どおりに無いと、名前は付くのに移動だけが起きず、理由もどこにも出ません。

`overview` は必須ではありません。無くてもルールは効き、更新後のひと押しだけが無くなります。

### 注意

- ご自分で付けた名前を Claude が変えるときは、アプリが確認を出します。bypass permissions モードでは出ません。これはアプリ側の挙動で、名前を変えるツールの説明にそう書かれています。
- 次に動くのが誰かが変わったかどうかは Claude の判断です。毎ターン移さないよう、また返答中というだけで作業中へ移さないよう伝えてあります（それはアプリが示すので）。
- `prompt.compose` イベントが要ります。このイベントを知らないビルドでは module が読み込まれません。Claude Code 2.1.295 と 2.1.300 で動かしています。
- 同梱のテストは `claude-code/testing` を import します。これは Claude Code が実行時に渡す module なので、Claude Code の runner の外（単体の `bun test` など）では解決できず、テストは走りません。

### ライセンス

MIT
