FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && bun run build
ENV PATH="/app/dist:$PATH"
WORKDIR /work
ENTRYPOINT ["/app/dist/warden"]
