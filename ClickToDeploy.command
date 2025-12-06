#!/bin/bash
cd "$(dirname "$0")" || exit 1

sh deploy.sh

echo ""
echo "---------------------------------------------------"
echo "✅ 完了しました！自動的に閉じます..."
echo "---------------------------------------------------"
sleep 2

# Terminalウィンドウを閉じるためのAppleScript
osascript -e 'tell application "Terminal" to close first window' & exit
