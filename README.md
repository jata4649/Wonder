# おとぎアリーナ（仮称）

横画面スマホ向け・3レーン MOBA のプロトタイプ。仕様は [SPEC.md](./SPEC.md)。Vite + TypeScript + Canvas2D。

盤面は縦長のまま（自陣が下・敵陣が上、3本の縦レーンが左・中央・右）。横画面では**フィールド幅＝画面幅**で表示し、
カメラは上下（y）だけに追従・パンする（世界は回転しない。SPEC 1.1）。
縦持ちでも遊べる（「端末を横にしてください」を閉じればそのまま縦画面レイアウトで動く）。

```bash
npm install
npm run dev        # http://localhost:5173 （スマホは同一LANのIPで）
npm test           # vitest（シミュレーションの自己テスト＋AI 4v4 フルマッチ）
npm run build
```

デバッグ用 URL パラメータ：`?c=<casterId>` タイトルを飛ばして開始 / `&d=easy|normal|hard` / `&fps=1` FPS表示 / `&stress=1` 負荷テスト。

## 構成（sim と render を分離）

```
src/
  config/   map.ts balance.ts casters.ts giants.ts assists.ts types.ts settings.ts
  sim/      world.ts bases.ts minions.ts combat.ts gauge.ts xp.ts soul.ts giants.ts effects.ts trails.ts grid.ts
            units/hero.ts  projectiles/drawshot.ts bolt.ts
  ai/       heroAI.ts laneAssign.ts nav.ts setup.ts
  render/   renderer.ts background.ts camera.ts hud.ts minimap.ts effects.ts
  input/    touch.ts virtualStick.ts drawGesture.ts
  ui/       cards.ts controls.ts result.ts screens/title.ts
  game.ts main.ts
```

`sim/` は DOM に依存せず、ヘッドレスで 7 分の試合を回せる（`tests/match.test.ts`）。
プレイヤーも AI も同じ `Command`（ss/ds/evade/skill/ws）を発行し、sim 側で検証する。

## 画像（SPEC 7・`ASSETS.md`）

受領した画像は `public/assets/` に配置済み。マニフェストは `src/config/assets.ts`（受領物そのまま）。
差し替えるときはこのファイルのパスだけ書き換えればよい。**空文字のキーはベクター描画に自動で戻る**。

| 用途 | 使う画像 |
|---|---|
| フィールドのキャスト駒 | `casters[id].sprite`（**背景抜きは未提供なので現在はベクター描画**。パスを入れると自動で画像に切り替わる） |
| HUD・選択画面の小枠 | `casters[id].icon`（丸アイコン） |
| 選択画面の説明欄 | `casters[id].bust`（無ければ `portrait`） |
| 兵士 | `minions.small/large`（自軍/敵軍）。攻撃直後・突撃中は `_alt` を2コマ目に。大=1.0、小≈0.6倍 |
| 拠点・城 | `bases.*`（下端中央で接地）。両軍共通の絵なので足元に陣営色の台座を敷く |
| 刻の門 | `gates.sekkina / yuukyu`。開門は左右に割れるマスクで抜く |
| 巨人 | `giants[t].sprite` があれば駒に。無ければ `art`（背景付き）を**丸く切り抜いたメダリオン**で描く。`support` は未受領→ベクター |
| 経験値・ソウル・ピング | `ui.soulStar` / `ui.spiritOrb` / `ui.icon*` |
| スキルカード枠 | `ui.panelFrame` |
| 背景 | `bg/map_tile_v.png` をレーン間隔に合わせて縦に敷く（道の中心＝レーン x）。`_h` は使わない |

- 読み込みは非同期＋キャッシュ、`premultiplyAlpha: 'none'` でデコード、ロード失敗のキーだけフォールバック。
- DPR 2 以上では `xxx@2x.png` を先に試し、無ければ等倍（`resolveAsset()`）。

## 操作

- 画面左46%：触れた場所に仮想スティック（上に倒すと画面の上＝敵陣方向）
- 画面右54%：触れた瞬間に構え → なぞって離すとドローショット。短タップでオート照準、短く素早いフリックでその方向へストレートショット
- 自キャストに指を戻して離す／「避」ボタンでキャンセル。描線長を超えると自動発動
- 同じ側に2本目の指でカメラパン（横画面は縦送りのみ。3秒で自動復帰）。ミニマップはタップで拡大／もう一度タップで戻す
- 横画面：カードは右下に横1列、回避はその上。左上にレーン状況（盤面と同じ向きで奥／門／手前）とソウルゲージ、右上に縦長ミニマップ、左下に自キャスト情報
- PC：WASD 移動・Space 回避・マウスで右半分をドラッグ

## 仮定（SPEC で未確定だった点）

- 刹那門12秒/悠久門65秒は「手前拠点が壊れてから開くまでの時間」と解釈。閉門中は奥拠点へのダメージ0、敵の兵士・キャストは門を通れない。
- 奥拠点は開門まで兵士を出さない（開門時6体、以降5体）。城は壊れず、受けたダメージ量がそのままゲージ減少。拠点・城は攻撃してこない。
- ゲージ量：拠点破壊 通常10（小6・大15・特大22）、全耐久分のダメージで通常5、キャスト撃破2.5。`config/assets.ts` のコメントにある hp/gauge の数値は参考として扱い、数値は `balance.ts` を正とした。
- 横画面のカメラ：フィールド幅＝画面幅（左右に20pxの余白）、自キャストを画面中央より少し下に置き進行方向を広く見せる。縦画面は従来どおり x・y とも追従。
- 横画面ロックは出撃時に `screen.orientation.lock`（全画面化が必要なブラウザが多い）を試し、失敗は無視。
- 単独クロスは描線長が最長のネムリヒメに付与（SPEC 5.1 の表に該当キャストがないため）。複数弾（シチニン）の威力 40 は1発ごとの値。
- 減衰の実測値（×0.305 等）は読み方が曖昧なため、「ファイター最終≈6割／他4〜5割」の既定配列を維持。
- キャストID は画像のファイル名に合わせて `garasunokutsu` / `onryou` に変更。
- 巨人の原画は背景付きのため、フィールドでは丸く切り抜いて使う（四角い背景を見せない）。
- 追加キャスト枠（`castersExtra`）の画像は配置のみで、ゲームにはまだ登場しない。
- ディレクトリ構成は既存のまま（`sim/gates.ts`・`ai/difficulty.ts`・`config/bases.ts` は既存ファイルに含まれる）。

## 未検証（実機でしか確認できない点）

- ミッドレンジ Android での 60fps（ヘッドレスでは兵士多数＋巨人6体で JS 約2.5ms/フレーム）。
- 実機での横画面ロック・全画面化、ノッチ（safe-area）付き端末での配置、親指の届きやすさ。
- 実際のマルチタッチ（ヘッドレスでは合成 PointerEvent で確認）。
