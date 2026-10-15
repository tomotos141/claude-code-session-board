# claude-code-session-board

A Claude Code plugin for the desktop app. It asks Claude to name each session once, then to keep that session in the sidebar section for **whoever moves next** — you, Claude, someone else, nobody, or no one at all.

A list of sessions then answers the only question a list of sessions needs to answer: which of these is waiting for me?

The sidebar needs five sections, named `確認待ち` / `作業中` / `外部待ち` / `保留` / `完了`. **If your sidebar has none of them, the plugin creates all five itself** and there is nothing to set up. If it already has some of them, the plugin creates none, and the ones you are missing are yours to add — it only ever moves a session to a section it finds under its exact name. The rule it adds is written in Japanese.

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

The plugin looks each section up by exact name, and **never creates one that is missing**. That is deliberate: if you rename `保留` to something of your own, it finds no `保留` and simply does not move the session there, rather than putting a second section beside yours. The cost is that a section you are missing is a section the plugin will never use, silently.

The one exception is a sidebar with **none of the five**. At the start of each session the plugin reads the sections, and only in that case creates all five, in the order above. Nothing of yours can be duplicated when nothing of yours is there, so the rule above still holds.

So: an untouched sidebar needs nothing from you. A sidebar where you have renamed or removed some of the five is yours to arrange — add back any you want the plugin to use, under these exact names.

## What it actually does

- Adds one rule to Claude's system prompt: how to name the session, and which section matches which answer to "who moves next".
- Keeps three tools at hand — `set_session_title`, `move_sessions`, `list_sections` — so none of them needs a tool search first, and repeats the relevant half of the rule in the rename and move tools' own descriptions. `list_sections` is only brought forward; its description is left alone.
- Reads the sidebar's sections once when a session starts, and if not one of the five is there, creates all five. So deleting all five and opening a new session brings them back — though the check runs once per load of the plugin, which is usually but not always once per session, so a restart of the app is the reliable way to ask for them again.
- If a run is stopped or refused partway, it writes down which of the five it made, and a later session finishes only those. Before it acts on that record at all, every section named in it has to still be standing: rename or delete one and the record is dropped and nothing is created, so it cannot put `作業中` back beside the name you chose for it. Only then does it look at what stands — and if any of the five is there that the record does not claim, that one is yours, and the set is never completed around it. So adding one of the five by hand after a partial run also stops it, leaving the rest to you. A record you have hand-edited into something it cannot read is ignored rather than acted on.
- Asks permission for every call it is about to make — the listing, and each section by name — before making the first, and stops quietly unless all of them are allowed outright. Where your permission rules do not look at arguments, that means it never raises a dialog at session start; where they do, it stops rather than getting halfway.
- It is not waited on, and a sidebar that is slow, absent or refuses cannot hold up or fail the session's start. Outside the desktop app, where the sidebar's tools do not exist, it does nothing.
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

Then start a new session. If your sidebar has none of the five, they appear on their own. If it already has some, add the rest yourself under those exact names: Claude will name sessions but never move them to a section it cannot find, and nothing will say why.

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

サイドバーには `確認待ち` / `作業中` / `外部待ち` / `保留` / `完了` の5つのセクションが要ります。**サイドバーに5つのどれも無ければ、plugin が5つまとめて作ります**。そのときは入れるだけで動きます。すでにいくつかあるときは1つも作らないので、足りない分はご自分で足してください。plugin は名前の完全一致で見つけたセクションへしか移しません。

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

plugin はセクションを名前の完全一致で引き、**無いセクションは作りません**。これは意図した線です。`保留` をご自分の名前に変えたなら、plugin は `保留` を見つけられず、そこへ移さないだけで済みます。あなたのセクションの隣に同じ意味のものを作ったりしません。代わりに、足りないセクションは plugin が使わないまま黙って残ります。

例外は、5つのどれも無いサイドバーだけです。plugin はセッションのはじめにセクションを読み、そのときだけ上の順に5つ作ります。あなたのものが1つも無ければ重複させる相手もいないので、上の線はそのまま保たれます。

まとめると、手を付けていないサイドバーには何も要りません。5つのうちいくつかを変えたり消したりしたサイドバーは、あなたの管理です。plugin に使わせたいセクションは、この名前どおりに足してください。

### 実際にしていること

- Claude の system prompt にルールを1つ足す。名前の付け方と、「次に動くのは誰か」の答えがどのセクションに対応するか。
- `set_session_title`・`move_sessions`・`list_sections` の3つを手前に置き、ツール検索を先にしなくても使えるようにする。名前を変えるツールと移すツールの説明には、該当部分のルールも書き足す。`list_sections` は手前に置くだけで、説明はそのままです。
- セッションが始まるときにサイドバーのセクションを1度読み、5つのどれも無ければ5つ作る。5つ全部を消して新しいセッションを開けば、また現れます。ただしこの確かめは plugin の読み込みごとに1度で、通常はセッションごとですが必ずとは限らないので、確実に頂きたいときはアプリを再起動してください。
- 途中で止められたり拒まれたりしたときは、作った分を書き留め、あとのセッションがその残りだけを作る。その記録に従う前に、記録にあるセクションがすべて今もあることを確かめます。ひとつでも改名したり消したりしていたら、記録を捨てて何も作りません。あなたが選んだ名前の隣に `作業中` を戻すことはありません。そのうえで、記録に無い5つのいずれかがあれば、それはあなたのものとして、その周りを埋めることはしません。途中まで作られたあとに5つのいずれかをあなたが手で追加した場合も同じで、残りはあなたに委ねて止まります。手で書き換えて読めなくなった記録は、従わずに無視します。
- 呼ぶつもりの呼び出しをすべて、最初の1つを呼ぶ前に許可を確かめる。一覧の取得と、作るセクションそれぞれの名前です。すべてが許可されていなければ静かにやめます。許可設定が引数を見ないなら、セッション開始時に確認が並ぶことはありません。見る設定なら、途中まで進むではなく最初からやめます。
- 待ち合わせはしないので、サイドバーが遅くても、無くても、拒んでも、セッションの開始を止めたり失敗させたりしません。サイドバーのツールが無いデスクトップアプリの外では何もしません。
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

そのあと新しいセッションを開いてください。サイドバーに5つのどれも無ければ、5つは自然に現れます。すでにいくつかあるときは、残りをこの名前どおりにご自分で足してください。見つけられないセクションへは、名前は付くのに移動だけが起きず、理由もどこにも出ません。

`overview` は必須ではありません。無くてもルールは効き、更新後のひと押しだけが無くなります。

### 注意

- ご自分で付けた名前を Claude が変えるときは、アプリが確認を出します。bypass permissions モードでは出ません。これはアプリ側の挙動で、名前を変えるツールの説明にそう書かれています。
- 次に動くのが誰かが変わったかどうかは Claude の判断です。毎ターン移さないよう、また返答中というだけで作業中へ移さないよう伝えてあります（それはアプリが示すので）。
- `prompt.compose` イベントが要ります。このイベントを知らないビルドでは module が読み込まれません。Claude Code 2.1.295 と 2.1.300 で動かしています。
- 同梱のテストは `claude-code/testing` を import します。これは Claude Code が実行時に渡す module なので、Claude Code の runner の外（単体の `bun test` など）では解決できず、テストは走りません。

### ライセンス

MIT
