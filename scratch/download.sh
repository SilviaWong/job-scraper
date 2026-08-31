#!/bin/bash
cd "$(dirname "$0")/../libs" || exit

echo "Downloading Vue 3..."
curl -sL "https://registry.npmmirror.com/vue/-/vue-3.4.15.tgz" | tar -xzf - -C /tmp && cp /tmp/package/dist/vue.global.js ./vue.global.js

echo "Downloading Element Plus JS & CSS..."
curl -sL "https://registry.npmmirror.com/element-plus/-/element-plus-2.5.3.tgz" | tar -xzf - -C /tmp && cp /tmp/package/dist/index.full.min.js ./element-plus.js && cp /tmp/package/dist/index.css ./element-plus.css

echo "Cleaning up..."
rm -rf /tmp/package

echo "Download completed!"
ls -lh vue.global.js element-plus.js element-plus.css
