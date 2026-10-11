# おとぎアリーナ（仮称）

横画面スマホ向け・3レーン MOBA のプロトタイプ。仕様は [SPEC.md](./SPEC.md)。Vite + TypeScript + Canvas2D。

横画面では自陣が左・敵陣が右で、レーンが左右に走る（縦長の盤面を SPEC 1.3 の回転方式で表示）。
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

## 画像の差し替え（SPEC 7）

画像は同梱していない。**画像が1枚もなくても起動して遊べる**（未登録のものはベクター描画）。
差し替えるときは `public/assets/` に画像を置き、`src/config/assets.ts` の該当キーにパスを書くだけ。

```ts
casters: { akazukin: 'assets/casters/akazukin.png', ... }
```

- 読み込みは非同期＋キャッシュ。ロード前・ロード失敗のキーだけベクター描画に戻る。
- DPR 2 以上の端末では `akazukin@2x.png` を先に試し、無ければ等倍を使う。
- 画像は向きに関係なく正立で描かれ、**足元（下端中央）**がユニットの位置に合う。

| 種別 | 置き場所 | 推奨サイズ | アンカー | 備考 |
|---|---|---|---|---|
| キャスト | `casters/<id>.png`（akazukin, tetsukagi, nemurihime, kurousagi, garasu, hoshitsubame, onryo, shichinin） | 256×256 透過PNG | 下端中央 | 円形アイコンにも使うので被写体は中央に |
| 兵士（小） | `minions/ally_small.png` / `enemy_small.png` | 96×96 | 下端中央 | 自軍＝赤系／敵軍＝青系 |
| 兵士（大） | `minions/ally_large.png` / `enemy_large.png` | 160×160 | 下端中央 | 「大」と分かるシルエット |
| 拠点 | `bases/small.png` `normal.png` `large.png` `huge.png` | 256×256 | 下端中央 | 種類の差はスケールとラベル |
| 城 | `bases/castle_ally.png` / `castle_enemy.png` | 512×512 | 下端中央 | 陣営色で2枚 |
| 巨人 | `giants/breaker.png` `whirl.png` `support.png` | 384×384 | 下端中央 | 3種 |

テキストは画像に焼き込まないこと（ラベルはコード側で描く）。

## 操作

- 画面左46%：触れた場所に仮想スティック
- 画面右54%：触れた瞬間に構え → なぞって離すとドローショット。短タップでオート照準、短く素早いフリックでその方向へストレートショット
- 自キャストに指を戻して離す／「避」ボタンでキャンセル。描線長を超えると自動発動
- 同じ側に2本目の指でカメラパン（3秒で自動復帰）。ミニマップはタップで拡大／もう一度タップで戻す
- 横画面：カードは右下に横1列、回避はその上。左上にレーン状況（手前／門／奥）とソウルゲージ、左下に自キャスト情報
- PC：WASD 移動・Space 回避・マウスで右半分をドラッグ

## 仮定（SPEC で未確定だった点）

- 横画面は「既存の縦長盤面を90°回転して描く」方式（SPEC 1.3）で実装。ワールド座標（縦長 2400×3600）とシミュレーション・テストはそのまま。
- 縦持ちでは回転せず従来の縦画面レイアウト。オーバーレイは閉じられる。
- 横画面ロックは `screen.orientation.lock`（全画面化が必要なブラウザが多い）を出撃時に試み、失敗は無視。
- 単独クロスは描線長が最長のネムリヒメに付与（SPEC 5.1 の表に該当キャストがないため）。
- 複数弾（シチニン）の威力 40 は1発ごとの値として扱う。
- SPEC の減衰の実測値（×0.305 等）は表現が曖昧なため、「ファイター最終≈6割／他4〜5割」の既定配列を維持。
- ディレクトリ構成は既存のまま（`sim/gates.ts`・`ai/difficulty.ts`・`config/bases.ts` は既存ファイルに含まれる）。

- 刹那門12秒/悠久門65秒は「手前拠点が壊れてから開くまでの時間」と解釈。閉門中は奥拠点へのダメージ0、敵の兵士・キャストは門を通れない。
- 奥拠点は開門まで兵士を出さない（開門時6体、以降5体）。
- 城は壊れず、受けたダメージ量がそのままゲージ減少になる。拠点・城は攻撃してこない。
- ゲージ量：拠点破壊 通常10（小6・大15・特大22）、全耐久分のダメージで通常5、キャスト撃破2.5。
- 経験値は倒した側のチームだけが回収できる。
- 突撃型の「2回攻撃判定」は「接触時」と「突進終了時の周囲」の2回として実装。
- 単独クロスは原作の該当キャストがいないため、描線長が最長のネムリヒメに付与。
- 巨人は閉じた門を越えられない（破壊型も門前で待つ）。破壊型が城に触れると大ダメージを与えて消える。
- 自軍の建物は通り抜けできる（中央奥の特大拠点脇で詰まるため）。
- 数値はすべてたたき台。AI同士の試合で Lv5≈2〜3分、Lv10≈終盤、巨人は1チーム2体前後になるよう調整済み。

## 未検証（実機でしか確認できない点）

- ミッドレンジ Android での 60fps（ヘッドレスでは兵士多数＋巨人6体で JS 約2.5ms/フレーム）。
- 実機での横画面ロック・全画面化、ノッチ（safe-area）付き端末での配置、親指の届きやすさ。
- 実際のマルチタッチ（ヘッドレスでは合成 PointerEvent で確認）。
