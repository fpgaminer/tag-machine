# Build Rust API
FROM rust:slim-bullseye as builder

WORKDIR /usr/src/rust-api
COPY src ./src
COPY Cargo.* ./
COPY tag_blacklist20231201.txt ./
COPY tag_deprecations20231201.txt ./
COPY tag_aliases000000000000.json ./
COPY tag_implications000000000000.json ./
COPY .sqlx ./.sqlx

RUN cargo install --path .


# Build the final image
FROM debian:bullseye-slim

WORKDIR /root

COPY --from=builder /usr/local/cargo/bin/rust-api /usr/local/bin/rust-api

EXPOSE 8086

CMD ["rust-api", "--ip", "0.0.0.0"]