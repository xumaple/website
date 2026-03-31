# Stage 1: Install cargo-chef
FROM rust:1-slim-bookworm AS chef
RUN cargo install cargo-chef
WORKDIR /app

# Stage 2: Prepare dependency recipe
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# Stage 3: Build dependencies then the application
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --bin passwords

# Stage 4: Minimal runtime image
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/passwords /usr/local/bin/passwords
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/passwords"]
