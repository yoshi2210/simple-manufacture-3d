# V8 Engine Plant Twin

V8 エンジン組立ラインと自動車組立工場のデジタルツインです。2 つの形で動きます。

| | ブラウザ版 `web/` | Isaac Sim 版 `isaac/` |
|---|---|---|
| 動く場所 | どのブラウザでも（スマホ可） | NVIDIA RTX GPU のマシン |
| 3D モデル | 手続き生成の簡易モデル | **NVIDIA SimReady（OpenUSD）** + 簡易モデル |
| ロボット | 22 台（独自 IK） | Isaac Sim の UR10（Lula IK） |
| 用途 | 見せる・共有する | シミュレーション、レイアウト検討、拡張 |

両方とも同じレイアウトと同じタイミング（サイクル 9 秒）で動きます。

## 工場の構成
- **V8 組立ライン**: 周回パレット 24 台。ST10 ブロック投入 → ST20 クランク → ST30/40 ピストン → ST50/60 ヘッド → ST70 インテーク → ST80 カバー類 → ST90 ビジョン検査 → ST100 払出し
- **ホットテスト**: 完成エンジンを始動・空ぶかし（ブラウザ版は回転数とエンジン音が連動）
- **エンジン搬送コンベア → マリッジ**: 吊られた車体を下ろしてエンジンを搭載
- **車体ライン**: 溶接ロボット 8 台 → 塗装ブース → オーバーヘッドハンガー → タイヤ・ガラス装着 → 完成検査 → 完成車ヤード 12 区画
- **物流**: AMR 4 台

---

## 1. ブラウザ版
`web/index.html` を開くだけで動きます（three.js を CDN から読み込むため要ネット接続）。

```bash
python3 -m http.server -d web 8000   # → http://localhost:8000
```
編集は `web/main.js` と `web/template.html` で行い、`python3 web/build.py` を実行すると `index.html` が再生成されます。

## 2. Isaac Sim 版（GPU 環境でクローンして実行）

### 必要なもの
- NVIDIA RTX GPU と対応ドライバ（Linux）
- Docker + NVIDIA Container Toolkit
- ネット接続（初回に Hugging Face から SimReady アセットを取得）

### 実行（Docker、1 コマンド）
```bash
git clone https://github.com/yoshi2210/v8-engine-plant-twin.git
cd v8-engine-plant-twin
./scripts/run_docker.sh                 # デスクトップで GUI 表示
./scripts/run_docker.sh --livestream    # クラウド GPU（ヘッドレス）
```
`--livestream` で起動した場合は、手元の PC から **Isaac Sim WebRTC Streaming Client** で接続して見ます。
GPU を持っていない場合は、NVIDIA Brev などで RTX GPU インスタンスを借りて同じコマンドを実行してください。

このスクリプトは次を自動で行います。
1. `nvcr.io/nvidia/isaac-sim:5.1.0` コンテナを起動する（別の版を使うときは `ISAAC_SIM_IMAGE=...` を指定）
2. `tools/fetch_simready.py` で、工場に必要な SimReady アセットだけを `assets/simready/` にダウンロードする
3. `isaac/build_v8_factory.py` で工場を組み立て、ライブで動かす

Isaac Sim をインストール済みの場合は、Docker を使わずに実行できます。
```bash
ISAAC_SIM_PATH=~/isaacsim ./scripts/run_local.sh
```

### 主なオプション（`build_v8_factory.py`）
| オプション | 内容 |
|---|---|
| `--livestream` | ヘッドレスで起動し、WebRTC で配信 |
| `--speed 2` | ラインの速度倍率 |
| `--offline` | オンライン検索を行わない（取得済みの manifest と代替モデルだけで構築） |
| `--save plant.usd --headless --frames 1` | 組み上がった工場を USD に書き出して終了 |
| `--no-axis-fix` | Y-up アセットの自動回転を無効にする |

## SimReady アセットの使い方
データセット全体は約 480 GB あるため、`tools/fetch_simready.py` はカテゴリごとに 1 フォルダだけを選んでダウンロードします。

| カテゴリ | 優先フォルダ（データセット内で確認済み） | 使う場所 |
|---|---|---|
| conveyor | `conveyor_belt_a02` | V8 ラインのコンベアを並べて構成 |
| car_frame | `carFrame_car_frame_assembled_a01` | 車体ライン（ホワイトボディ） |
| crate | `crate_blue_a01` | 各ステーションの部品箱 |
| fence / safety_gate | `barrier_fence_metal_a02` / `barrier_gate_safety_a02` | 安全柵・ゲート |
| cart / box / bin / compressor | `cart_mobile_a01` ほか | 物流・周辺設備 |
| pallet / rack / tire / forklift | 名前パターンで自動選択 | 見つかった場合のみ使用 |

```bash
python tools/fetch_simready.py --list-only   # 何が選ばれるかだけ確認する
python tools/fetch_simready.py --search      # 足りないカテゴリを USD Search でも探す
```
取得したアセットは、単位（cm / m）と上方向の軸（Y-up / Z-up）を自動で補正し、床に接地させて配置します。

## GPU がなくてもできる検証
```bash
pip install usd-core && python tests/smoke_build.py
```
本物の OpenUSD ステージ上で、Isaac Sim の実行部分だけを差し替えて工場の構築処理を最後まで実行します。GitHub Actions でも同じテストを走らせ、さらに Hugging Face 上で SimReady のフォルダが解決できるかも確認します。

## 制限事項
- コンベア・パレット・車体の移動はタクトに同期させたキネマティック制御です（物理接触による搬送ではありません）。
- ロボットの動きは、UR10 なら Lula IK、それ以外のアームでは近似の振り付けです。Isaac Sim 6 で推奨されている cuMotion への移行は今後の課題です。
- SimReady の車体フレームを使った場合、ボディカラーの変化は簡易モデルの部分（フード）にしか反映されません。
- サイクル 9 秒は見やすさのための短縮値です。実ラインのタクトではありません。

## ライセンス
- コード: MIT（`LICENSE`）
- NVIDIA SimReady Assets: CC-BY-4.0（© NVIDIA）。アセットはこのリポジトリに含めず、実行時にダウンロードします。詳細は `NOTICE`
- three.js: MIT
