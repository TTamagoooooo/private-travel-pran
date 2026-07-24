# 宿泊台帳

旅程ごとにホテル候補を記録・比較するための個人用Webアプリです。
データの保存先はCloudflare自身が提供する **KV**(シンプルなキーバリューストア)。Notionもスプレッドシートも不要です。

**2026年のCloudflareダッシュボード更新に伴い、「Pages」ではなく統合された「Workers」(静的ファイル配信 + APIが1つのWorkerにまとまった形式)としてデプロイする構成になっています。**

このサイトはパスワードで保護されています(`SITE_PASSWORD` を知らないとログイン画面より先には進めません)。GitHubリポジトリの公開/非公開とは独立した仕組みです。

## 構成

- `public/` — フロントエンド一式(`index.html` / `style.css` / `app.js` / `login.html`)。ビルド不要
- `src/index.js` — メインのWorker。認証チェック → APIルーティング → 該当しなければ`public/`の静的ファイルを返す、という1本のエントリーポイント
- `src/kv.js` — KVへの読み書きの共通処理
- `src/auth.js` — ログインセッション(署名付きCookie)の発行・検証
- `src/search.js` — AIによるホテル自動検索(Anthropic APIのweb検索ツールを使用)
- `wrangler.jsonc` — Workersのデプロイ設定(静的ファイルの場所などを指定)

## セットアップ

### 1. GitHubへpush

```bash
git init
git add .
git commit -m "init"
git remote add origin <あなたのリポジトリURL>
git push -u origin main
```

### 2. Cloudflareでデプロイ

1. Cloudflareダッシュボード → 左メニュー「コンピュート」→「Workers & Pages」(または類似の項目)→「作成」
2. 「Gitに接続」を選び、上記のGitHubリポジトリを選択
3. プロジェクト名はそのままでOK。ビルドコマンドは空欄のまま、デプロイコマンドは `npx wrangler deploy` のままで問題ありません(リポジトリ内の`wrangler.jsonc`が自動的に読み込まれます)
4. 「デプロイ」を押す

これで一旦デプロイされますが、保存機能(KV)とパスワード認証はまだ未接続です。次の手順で繋ぎます。

### 3. KVを作って紐づける

1. Cloudflareダッシュボード →「ストレージとデータベース」(または「KV」)→「名前空間を作成」→ 名前は適当(例: `hotel-ledger`)→ 作成
2. デプロイしたWorkerのプロジェクトページを開く →「設定」→「変数とシークレット」または「Bindings」というタブを探す →「バインディングを追加」
3. 種類は「KV Namespace」、変数名に **`HOTEL_KV`**(この名前は固定です)、Namespaceに手順1で作ったものを選択して保存

### 4. 環境変数(シークレット)を設定する

同じ設定画面で、環境変数(Variables and Secrets)として以下を追加:

| 変数名 | 値 |
|---|---|
| `SITE_PASSWORD` | サイト全体に入るためのパスワード(任意の文字列を決めてください) |
| `SESSION_SECRET` | ログインセッションの署名に使うランダムな文字列。ターミナルで `openssl rand -hex 32` を実行して出てきた文字列を使ってください |
| `ANTHROPIC_API_KEY` | Anthropic Consoleで発行したAPIキー(AI検索機能を使う場合のみ必須。使わない場合は未設定でもOKで、その場合「AIで探す」は失敗しますが「自分で追加」機能は問題なく使えます) |

設定後、再デプロイ(またはGitHubに何か変更をpushして自動再デプロイ)すれば反映されます。

### ローカルでの動作確認(任意)

```bash
npm install
npx wrangler kv namespace create HOTEL_KV   # ローカル/本番用のnamespaceを作る
npx wrangler dev
```

## 注意点

- データはCloudflareのKVに保存されます。ダッシュボードの「ストレージとデータベース」からいつでも中身を確認・削除できます
- 個人利用を想定した簡易的な設計です。認証はパスワード1つのみで、複数ユーザー・権限分けには対応していません
- AI検索は一般的なWeb検索の結果をもとにしているため、価格や距離は目安です。正確な情報は「自分で追加」で実際の予約サイトを見ながら記録することをおすすめします
- Cloudflareのダッシュボードは今後も画面構成が変わる可能性があります。「Workers」「バインディング」「変数とシークレット」といったキーワードで探せば、名称が多少違っていても該当の設定にたどり着けるはずです
