# syntax=docker/dockerfile:1
# source: plugins/house-rules/test/fixtures/languages/dockerfile.dockerfile (adapted for strip-safety probe)
# strip-safety: removed=17
#
# Builds a small Go HTTP service with a multi-stage Dockerfile.
# Stage 1 compiles the binary; Stage 2 produces a minimal runtime image.

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM golang:1.22-bookworm AS builder

WORKDIR /app

# Copy dependency manifests before source so the module download layer is cached.
COPY go.mod go.sum ./

# Download declared modules; this layer is invalidated only when go.mod or go.sum change.
RUN go mod download

# Copy the remaining source tree into the build context.
COPY . .

# Compile a fully static binary suitable for a scratch or distroless runtime image.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    # Strip embedded build paths so the binary is reproducible across machines.
    -trimpath \
    # Write the output binary to a fixed path for easy COPY in the next stage.
    -o /out/svc \
    ./cmd/svc

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

# Install only the CA bundle; no other runtime dependency is needed.
RUN apt-get update \
    # Remove cached index immediately to keep the layer small.
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from the builder stage into the runtime image.
COPY --from=builder /out/svc /usr/local/bin/svc

# Expose the port the service listens on so Docker Desktop shows it in the UI.
EXPOSE 8080

# Drop to an unprivileged user to reduce blast radius of a container escape.
USER nobody

ENTRYPOINT ["/usr/local/bin/svc"]
