#!/bin/bash
# Fetch 10 famous Go games from Go Game Guru commented-go-games (GitHub)
# Run from project root: ./scripts/fetch-games.sh

BASE="https://raw.githubusercontent.com/gogameguru/commented-go-games/master"
GAMES_DIR="games"
mkdir -p "$GAMES_DIR"

fetch() {
  local url="$1"
  local out="$2"
  echo "Fetching $out..."
  curl -sL "$url" -o "$GAMES_DIR/$out"
}

fetch "$BASE/2016/05/20160309-Lee-Sedol-vs-AlphaGo-Commentary-An-Younggil.sgf" "alphago-lee-sedol.sgf"
fetch "$BASE/2016/01/Fan-Hui-vs-AlphaGo-20151009-Commentary-An-Younggil.sgf" "fan-hui-alphago.sgf"
fetch "$BASE/2015/07/Takemiya-Masaki-vs-Cho-Chikun-20150711-Commentary-An-Younggil.sgf" "takemiya-cho-chikun.sgf"
fetch "$BASE/2015/08/Lee-Sedol-vs-Chen-Yaoye-20131008-Commentary-An-Younggil.sgf" "lee-sedol-chen-yaoye.sgf"
fetch "$BASE/2015/06/Gu-Li-vs-Zhou-Ruiyang-20150603-Commentary-An-Younggil.sgf" "gu-li-zhou-ruiyang.sgf"
fetch "$BASE/2015/08/Cho-Chikun-vs-Cho-Hunhyun-20150726-Commentary-An-Younggil-8p.sgf" "cho-chikun-cho-hunhyun.sgf"
fetch "$BASE/2015/08/Yamashita-Keigo-vs-Iyama-Yuta-20150629-Commentary-An-Younggil.sgf" "yamashita-iyama.sgf"
fetch "$BASE/2015/09/Tang-Weixing-vs-Lee-Sedol-20150901-Commentary-An-Younggil.sgf" "tang-weixing-lee-sedol.sgf"
fetch "$BASE/2015/06/An-Jungki-vs-Chen-Yaoye-20150608-Commentary-An-Younggil.sgf" "an-jungki-chen-yaoye.sgf"
fetch "$BASE/2015/06/Mi-Yuting-vs-Gu-Li-20131202-Commentary-An-Younggil.sgf" "mi-yuting-gu-li.sgf"

echo "Done. Games saved in $GAMES_DIR/"
