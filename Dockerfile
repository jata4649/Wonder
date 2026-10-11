# おとぎアリーナ：クライアント（ビルド済み）＋ 対戦サーバー（WebSocket /ws）を1コンテナで配信。
# 1コンテナ＝複数ルーム。水平スケールはコンテナを増やし、ロードバランサでスティッキーに振り分ける。
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build
ENV PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
