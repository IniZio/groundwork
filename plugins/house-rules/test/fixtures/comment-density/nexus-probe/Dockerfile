# SPIKE ONLY — not production. See README.md.
#
# Packages the nexus HOST daemon (nexus binary + cloud-hypervisor + guest
# kernel + virtiofsd) into an image that can boot Cloud Hypervisor microVMs
# from inside a non-privileged Kubernetes pod on our self-hosted cluster.
#
# Shape and most of the pinning below are lifted directly from nexus's own
# `examples/nexus-in-docker/Dockerfile` (IniZio/nexus, read-only reference at
# /tmp/nexus — see deploy/nexus-probe/README.md for exact citations). That
# example already proves "nexus doctor" and a full build+boot round trip
# inside `docker run` with --device /dev/kvm --cap-add NET_ADMIN --cap-add
# SYS_ADMIN. This Dockerfile adapts it for a k8s pod that additionally must
# run as a non-root, non-privileged UID (our cluster's verified pod spec:
# runAsUser 1000, capabilities drop ALL add NET_ADMIN only — no SYS_ADMIN).
#
# HARD CONSTRAINT: this file must never modify github.com/IniZio/nexus. nexus
# source is fetched read-only at build time from a pinned ref; nothing here
# writes back to that checkout or to /tmp/nexus.
#
# Build (from your machine — this sandbox cannot reach GitHub):
#   docker buildx build --platform linux/amd64 \
#     --build-arg NEXUS_REF=<pinned-sha-or-tag> \
#     -t registry.oursky.dev/nexus-probe:TAG \
#     -f deploy/nexus-probe/Dockerfile \
#     --push deploy/nexus-probe
#
# NEXUS_REF should be a commit SHA (not a floating branch) so the probe image
# is reproducible. Find the current main SHA with:
#   git ls-remote https://github.com/IniZio/nexus main

# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — fetch nexus @ NEXUS_REF and build the host binary from source
#
# nexus ships no released host-daemon binary/image for this use case (the
# herdr-plugin install path downloads a client CLI, not the driver-capable
# host binary), so building from source at a pinned ref is the documented
# path — same as examples/nexus-in-docker/Dockerfile's go-builder stage.
# ─────────────────────────────────────────────────────────────────────────
FROM golang:1.26-bookworm AS nexus-src

ARG NEXUS_REF
RUN test -n "$NEXUS_REF" || { echo "NEXUS_REF build-arg is required (a commit SHA on IniZio/nexus)"; exit 1; }

WORKDIR /src
# Shallow, ref-pinned clone. `git init` + `fetch <ref>` (rather than `clone
# --branch`) works for both branch names and raw commit SHAs.
RUN git init -q . \
 && git remote add origin https://github.com/IniZio/nexus \
 && git fetch --depth 1 origin "$NEXUS_REF" \
 && git checkout -q FETCH_HEAD \
 && git rev-parse HEAD > /nexus-rev.txt

FROM golang:1.26-bookworm AS go-builder
WORKDIR /src
# go.mod has a local replace directive for third_party/gvisor-tap-vsock, so
# that directory must be present before `go mod download` can resolve it
# (mirrors examples/nexus-in-docker/Dockerfile:22-27).
COPY --from=nexus-src /src/go.mod /src/go.sum ./
COPY --from=nexus-src /src/third_party/ third_party/
RUN go mod download
COPY --from=nexus-src /src/cmd/      cmd/
COPY --from=nexus-src /src/internal/ internal/
COPY --from=nexus-src /src/proto/    proto/
COPY --from=nexus-src /src/plugins/  plugins/
RUN CGO_ENABLED=1 go build -trimpath -o /out/nexus ./cmd/nexus
# `nexus run <oci-ref>` injects the guest agent (PID 1) on an image-cache miss
# and finds it ONLY via exec.LookPath("nexus-agent")
# (/tmp/nexus/internal/cli/cmd_run.go:112-118 — no fallback to the kernel dir,
# unlike `sandbox create` at cmd_sandbox.go:1005-1008). Build it from the SAME
# pinned ref as the host binary so host/guest protocol cannot skew, with the
# exact flags nexus uses (Makefile install-agent / images/kernel/rebuild-base.sh).
COPY --from=nexus-src /nexus-rev.txt /nexus-rev.txt
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
        -ldflags "-X main.agentBuildTag=probe-$(cut -c1-7 /nexus-rev.txt)" \
        -o /out/nexus-agent ./cmd/nexus-agent

# ─────────────────────────────────────────────────────────────────────────
# Stage 2 — pinned cloud-hypervisor static binary
#
# Same pin as examples/nexus-in-docker/Dockerfile (verified there against a
# real boot on 2026-08, docker 29.5.3). Bump both ARGs together if a newer
# release is needed; re-verify the sha256 from the GitHub release page.
# ─────────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS downloader
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG CH_VERSION=v52.0
ARG CH_SHA256=829af01ff075bb96c4f183905134c453a88d68cbabdc6b87df21098842581ee9

RUN curl -fsSL \
        "https://github.com/cloud-hypervisor/cloud-hypervisor/releases/download/${CH_VERSION}/cloud-hypervisor-static" \
        -o /usr/local/bin/cloud-hypervisor \
    && echo "${CH_SHA256}  /usr/local/bin/cloud-hypervisor" | sha256sum -c - \
    && chmod +x /usr/local/bin/cloud-hypervisor

# ─────────────────────────────────────────────────────────────────────────
# Stage 3 — runtime image
#
# Guest kernel (images/kernel/vmlinux-x86_64) and the base-image agent
# (images/kernel/nexus-agent) are COMMITTED BINARY ARTIFACTS in the nexus
# repo (see /tmp/nexus/images/kernel/PINNED.md and images/README.md) — they
# are copied verbatim from the pinned checkout, not rebuilt. This avoids
# needing a kernel build toolchain and libkrunfw bootstrap in this image.
#
# virtiofsd: Debian bookworm does NOT ship a virtiofsd package (verified by
# this file's own CI failure: "E: Unable to locate package virtiofsd" —
# bookworm's src:virtiofsd never made it into the archive/security mirror
# this build uses). GitLab's virtio-fs/virtiofsd project ships only source
# tarballs, so — per the fallback this comment block already named — we
# cargo-install virtiofsd 1.13.3 from crates.io in a dedicated Rust builder
# stage (same pin nexus's own example verified, see README.md point 6) and
# copy just the resulting binary into the runtime stage, same shape as
# nexus's own examples/nexus-in-docker/Dockerfile. virtiofsd is required by
# nexus's OWN image-build path (the builder VM mounts its build context via
# virtiofs — see docs/site/sandboxes/images.md "Build path" diagram), not
# only by `--mount`.
# ─────────────────────────────────────────────────────────────────────────
FROM rust:1-bookworm AS virtiofsd-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config \
        libcap-ng-dev \
        libseccomp-dev \
    && rm -rf /var/lib/apt/lists/*

RUN cargo install virtiofsd --version 1.13.3 --locked --root /out

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        e2fsprogs \
        iproute2 \
        iptables \
        ca-certificates \
        libcap-ng0 \
        libseccomp2 \
        curl \
        util-linux \
        libcap2-bin \
        procps \
    && rm -rf /var/lib/apt/lists/*

COPY --from=go-builder        /out/nexus                       /usr/local/bin/nexus
COPY --from=go-builder        /out/nexus-agent                 /usr/local/bin/nexus-agent
COPY --from=downloader        /usr/local/bin/cloud-hypervisor   /usr/local/bin/cloud-hypervisor
COPY --from=virtiofsd-builder /out/bin/virtiofsd                /usr/local/bin/virtiofsd
COPY --from=nexus-src         /src/images/kernel/vmlinux-x86_64 /opt/nexus/images/kernel/vmlinux-x86_64
COPY --from=nexus-src         /src/images/kernel/nexus-agent    /opt/nexus/images/kernel/nexus-agent
COPY --from=nexus-src         /nexus-rev.txt                    /opt/nexus/NEXUS_REV

# Sanity check: fail the build here (fast) rather than at `nexus doctor`
# time if the cargo-installed binary is broken/wrong-arch.
RUN virtiofsd --version \
 && command -v nexus-agent \
 && command -v ps

# Probe kit: our own Containerfile for a "toolchain" guest image (g++,
# rustc, zig) plus the probe script itself. Neither is nexus source.
COPY toolchain/ /opt/nexus-probe/toolchain/
COPY probe.sh   /usr/local/bin/probe.sh
RUN chmod +x /usr/local/bin/probe.sh

# nexus resolves the kernel via this env var (explicit override always wins
# — see internal/cli/kernel_preflight.go resolveKernelPath, search order #1).
ENV NEXUS_KERNEL_PATH=/opt/nexus/images/kernel/vmlinux-x86_64
ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

# HOME/XDG_* are set here to a sane default for a `docker run` smoke test;
# the k8s pod specs override HOME/TMPDIR/XDG_RUNTIME_DIR explicitly because
# the pod runs as UID 1000 or 0 with emptyDir-backed state (see
# pod-root.yaml / pod-nonroot.yaml and README.md "Four portability gotchas").
ENV HOME=/home/nexus
RUN mkdir -p /home/nexus && chmod 0777 /home/nexus

ENTRYPOINT ["/usr/local/bin/probe.sh"]
CMD []
