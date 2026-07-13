FROM oven/bun:1
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build
ENV PATH="/app/dist:$PATH"
WORKDIR /work
ENTRYPOINT ["/app/dist/warden"]
