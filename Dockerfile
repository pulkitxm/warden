FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends git nodejs npm && rm -rf /var/lib/apt/lists/*
RUN mkdir /play && printf '{\n  "name": "play",\n  "private": true\n}\n' > /play/package.json
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build
ENV PATH="/app/dist:$PATH"
WORKDIR /work
ENTRYPOINT ["/app/dist/warden"]
