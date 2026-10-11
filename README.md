# おとぎアリーナ（仮称）

スマホ向け・縦型3レーン MOBA のプロトタイプ。仕様は [SPEC.md](./SPEC.md)。Vite + TypeScript + Canvas2D。

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

## 操作

- 画面左半分：触れた場所に仮想スティック
- 画面右半分：触れた瞬間に構え → なぞって離すとドローショット。短タップでオート照準のストレートショット
- 自キャストに指を戻して離す／「避」ボタンでキャンセル。描線長を超えると自動発動
- 同じ側に2本目の指でカメラパン（3秒で自動復帰）。ミニマップはタップで拡大／もう一度タップで戻す
- PC：WASD 移動・Space 回避・マウスで右半分をドラッグ

## 仮定（SPEC で未確定だった点）

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
