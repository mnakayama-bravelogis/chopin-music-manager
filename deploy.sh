#!/bin/bash
set -e  # エラーが発生したらそこで止める設定

echo "---------------------------------------------------"
echo "🎹 Chopin Manager Deployment Tool"
echo "---------------------------------------------------"

# 1. ツールが入っているか確認
if ! command -v git &> /dev/null; then
    echo "❌ Gitが見つかりません。"
    exit 1
fi

# 2. まだGit設定がされていない場合（初回のみ）
if [ ! -d ".git" ]; then
    echo "🔰 初回セットアップを開始します..."
    
    if ! git init; then
        echo ""
        echo "❌ エラー: Gitの初期化に失敗しました。"
        echo "⚠️ 画面に『コマンドラインデベッパーツールのインストール』等のポップアップが出ていませんか？"
        echo "インストールが完了してからもう一度実行してください。"
        exit 1
    fi

    git branch -M main
    
    echo ""
    echo "GitHubのリポジトリURLを入力してください"
    echo "（例: https://github.com/あなたのユーザー名/chopin-music-manager.git）"
    printf "> "
    read REPO_URL
    
    if [ -z "$REPO_URL" ]; then
        echo "❌ URLが入力されませんでした。中止します。"
        exit 1
    fi
    
    # 既存のリモートがあれば削除して再登録（安全策）
    git remote remove origin 2>/dev/null || true
    if ! git remote add origin "$REPO_URL"; then
         echo "⚠️ リモート登録に失敗しました"
    fi
    
    echo "✅ リポジトリを登録しました！"
fi

# 3. 更新・送信処理
echo "🚀 GitHubへアップロード中..."

git add .
git commit -m "Update via deploy script: $(date)" || echo "⚠️ 変更がないためコミットスキップ"

# 【重要変更】 -f (force) オプションを追加
# これにより、GitHub上の古い履歴があっても、手元のPCの内容で強制的に上書きします。
# 個人開発ではこれが最も手っ取り早い解決策です。
if ! git push -f -u origin main; then
    echo ""
    echo "❌ アップロードに失敗しました。"
    echo "考えられる原因:"
    echo "1. GitHubとの認証が切れている（ブラウザでログインが必要かも）"
    echo "2. URLが間違っている"
    echo "3. 入力したトークンやパスワードが間違っている"
    exit 1
fi

echo ""
echo "🎉 完了しました！Netlifyが自動的に検知してサイトを更新します。"
