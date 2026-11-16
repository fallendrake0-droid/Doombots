FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

COPY package*.json .
COPY patches ./patches
# Headless DoomBots does not render a browser camera or use image vision.
# Those native graphics packages are optional, so the low-RAM image avoids
# canvas/X11 build dependencies and remains usable when native prebuilds fail.
RUN npm ci --omit=optional --omit=dev

COPY . .

CMD ["npm", "start"]
