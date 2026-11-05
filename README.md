# V8 Engine Plant Twin

V8 エンジン組立ラインから車両の最終組立までを再現した、デモ用の工場デジタルツインです。
**BOM（部品表）と工程表（BOP）を 1 つのデータ（`data/plant.json`）にまとめ、そのデータで工場全体を動かします。**
同じデータで、ブラウザ版と Isaac Sim 版の 2 つが動きます。

| | ブラウザ版 `web/` | Isaac Sim 版 `isaac/` |
|---|---|---|
| 動く場所 | どの PC・スマホのブラウザでも | NVIDIA RTX GPU のマシン（クラウド VM 可） |
| 3D モデル | 手続き生成の簡易モデル | **NVIDIA SimReady（OpenUSD）** の実モデル ＋ 簡易モデル |
| ロボット | 24 台（独自の簡易 IK） | **Comau N-220-27 ×14、FANUC CRX-10iA ×8**（USD の関節定義から IK を計算） |
| 用途 | デモ・共有 | 物理シミュレーション、レイアウト検討 |

## デモの見どころ
- **V8 組立ライン**: 周回パレット 24 台。ST10 ブロック投入 → ST20 クランク → ST30/40 ピストン → ST50/60 ヘッド → ST70 インテーク → ST80 カバー・オイルパン → ST90 ビジョン検査 → ST100 払出し
- **ホットテスト**: 完成エンジンを始動して空ぶかし（ブラウザ版は回転数とエンジン音が連動）
- **車体ライン**: 溶接 → クロージャー取付（ドア 4 枚）→ 塗装 → マリッジ（エンジン搭載）→ タイヤ → ガラス → 完成検査 → 完成車ヤード
- **📋 工程 / BOM / ラインバランス**（ブラウザ版のパネル）
  - 工程: 各ステーションの作業内容・設備・作業時間と、今の状態
  - BOM: 工程ごとに組み付ける部品と数量。🎯追従中は、エンジン 1 基と車両 1 台の組付け進捗（例: 83 点中 37 点）
  - ラインバランス: 工程別の作業時間とタクト 54 秒、ボトルネック、編成効率
- **🎯 追従**: 1 基のエンジンを、ブロック投入から車両に搭載されて完成車ヤードに着くまで追いかける

データは実在のメーカー・車種・工場のものではなく、デモ用の代表値です。アニメーションは実時間の 6 倍速で再生します。

> **姉妹デモ: [`mini4wd/`](mini4wd/README.md)** — 1/32 4WD レーサー（ミニ四駆タイプ）の設計開発事務所と製造ライン。デザインスタジオ、ブラウザ内 CFD、APQP・FMEA・PPAP・MRP・原価企画・バックオフィスまでを 1 ページで再現。

---

## 1. ブラウザ版
`web/index.html` を開くだけで動きます（three.js を CDN から読み込むため、ネット接続が必要です）。
```bash
python3 -m http.server -d web 8000   # → http://localhost:8000
```
編集は `data/plant.json`、`web/main.js`、`web/template.html` で行い、`python3 web/build.py` を実行すると `index.html` が再生成されます。

## 2. Isaac Sim 版（GPU 環境でクローンして実行）
ノート PC では動きません。RTX GPU のある Linux マシンかクラウド VM（NVIDIA Brev、AWS g5/g6 など）で実行し、映像はストリーミングで手元の PC から見ます。

```bash
git clone https://github.com/yoshi2210/simple-manufacture-3d.git && cd simple-manufacture-3d
./scripts/run_docker.sh --livestream    # クラウド GPU（ヘッドレス）→ WebRTC で視聴
./scripts/run_docker.sh                 # GPU 付きデスクトップで GUI 表示
```
起動時に次の処理を自動で行います。
1. Isaac Sim コンテナを起動する（既定は `nvcr.io/nvidia/isaac-sim:5.1.0`。6.x を試すときは `ISAAC_SIM_IMAGE=nvcr.io/nvidia/isaac-sim:6.1.0`）
2. `tools/fetch_simready.py` で、使う SimReady パッケージ 45 個だけを Hugging Face からダウンロードする
3. `isaac/build_v8_factory.py` で工場を組み立て、ロボットの配置と動作を計算してライブで動かす（ロボット動作の計算は初回だけ数分かかり、2 回目以降はキャッシュを使う）

Isaac Sim をインストール済みの場合は、Docker を使わずに `ISAAC_SIM_PATH=~/isaacsim ./scripts/run_local.sh` でも実行できます。

| オプション | 内容 |
|---|---|
| `--livestream` | ヘッドレスで起動し、WebRTC で配信する |
| `--speed 2` | ラインの速度倍率 |
| `--engine-detail proxy` | エンジン部品を軽量な代替形状にする（GPU が弱いとき） |
| `--robots ur10` | SimReady のロボットの代わりに Isaac 同梱の UR10 を使う |
| `--save plant.usd --headless --frames 1` | 組み上がった工場を USD に書き出して終了する |

### SimReady のロボットをどう動かしているか
SimReady のロボット（Comau、FANUC）には、関節・可動範囲・駆動は定義されていますが、逆運動学（IK）の設定は含まれていません。
`isaac/usd_arm.py` がロボットの USD から関節の並びを直接読み取って IK を解き、関節の駆動目標を書き込みます。
- 各ロボットの実寸リーチに合わせて、立ち位置と台座の高さを自動で決める
- 教示点（部品を取る・置く位置）に加えて経路上の中間点も IK で解き、関節が急に反転しないように動かす
- 結果は `assets/simready/robot_cache.json` に保存され、2 回目以降の起動ではそのまま再利用する

## データ（`data/plant.json`）
- `parts`: 部品マスター。41 品目のうち 21 品目を SimReady のパッケージに対応付け済み（`asset`）
- `lines.v8` / `lines.vehicle`: 各ステーションの作業（内容と秒数）、設備、組み付ける部品と数量（MBOM）
- `ebom`: 車両の部品構成
- `meta`: タクト 54 秒、搬送 13.2 秒、デモ再生 6 倍速

## SimReady アセット
使うアセットは NVIDIA 公式カタログで 1 つずつ確認し、レビュー済みのコミットに固定しています（`tools/fetch_simready.py`）。
何が使えて何が無いか、Isaac Sim で動かせるかの調査結果は [docs/simready-survey.md](docs/simready-survey.md) にあります。
```bash
python tools/fetch_simready.py --list-only            # 取得するパッケージの一覧
python tools/fetch_simready.py --groups robots,engine # グループを指定して取得
```

## GPU なしでできる検証（GitHub Actions で毎回実行）
| ジョブ | 内容 |
|---|---|
| `checks` | BOM・工程表の整合性、USD から読んだロボット運動学と正解計算の照合、合成アセットでの工場全体の組み立て |
| `simready-real` | **本物の SimReady パッケージ 50 個**をダウンロードし、全アセットの寸法・軸・物理設定を一覧化。実際の Comau / FANUC / UR の USD で IK を往復検証し、工場全体を実データで組み立てる |

`simready-real` の結果（2026-11-05）:
- 実データで工場全体の組み立てが最後まで通る（USD プリム 25,285 個）
- ロボット 22 台（Comau N-220-27 ×14、FANUC CRX-10iA ×8）すべてが、部品を取る・置く位置に 1 mm 以内で到達し、関節の急な反転なし
- 実アセットはすべて Z-up・メートル単位。物理の有効／無効は variant で切り替え可能（部品は無効、ロボットは PhysX を有効にして配置）

ローカルで実行する場合:
```bash
pip install usd-core numpy
python tests/test_plant_data.py   # BOM / 工程表の整合性
python tests/test_usd_arm.py      # ロボット運動学
python tests/smoke_build.py       # 工場全体の組み立て（約 3〜4 分）
python tools/fetch_simready.py && python tests/real_assets_check.py   # 実アセットの検査（要ネット接続）
```

## 制限事項
- **GPU 上の Isaac Sim ではまだ動かしていません。** 実データでの組み立てとロボットの動作計算までは確認済みですが、PhysX でのロボット駆動、描画、ライブ配信は、GPU マシンでの初回実行が初めての確認になります。
- コンベア・パレット・車体の移動は、タクトに同期させたキネマティック制御です（物理的な接触による搬送ではありません）。部品の物理は無効化して配置しています。
- SimReady の部品は車種ごとに作られたものではないため、寸法を合わせて配置しています。エンジンブロックは SimReady に無いので簡易形状です。
- SimReady の車体フレームを使った場合、ボディカラーの変化は簡易形状の部品にしか反映されません。
- 最初に公開したブラウザ版は、ブランチ `snapshot/v0.1.0-web-live` に残しています。

## ライセンス
- コード: MIT（`LICENSE`）
- NVIDIA SimReady Assets / OEM パッケージ: CC-BY-4.0。リポジトリには含めず、実行時にダウンロードします（`NOTICE`）
- three.js: MIT
