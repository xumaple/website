use passwords::{build_router, db, RouterConfig};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // Load .env if present (not required — CI provides env vars directly).
    if let Ok(path) = dotenv::dotenv() {
        tracing::info!(path = %path.display(), "loaded .env");
    }
    db::connect().await?;

    let app = build_router(RouterConfig::default()).into_make_service_with_connect_info::<SocketAddr>();
    let listener = TcpListener::bind("0.0.0.0:8000").await?;
    tracing::info!(addr = %listener.local_addr()?, "listening");
    axum::serve(listener, app).await?;

    Ok(())
}

/*
1) Use encrypt_master_key to hash the given mk with salt to store in db, so we don't store naked mk
2) Use verify_master_key to ensure that anytime we get a mk, that it's the right mk
3) APP calls generate_password to get a new pw.
4) APP encrypts new pw with mk, then sends it with tablekey to be stored
5) APP asks for encrypted pw via tablekey, then decrypts locally with mk to use pw.

Q: Which of 3, 4, 5 does APP need to send the mk?
A: 4 and 5, mk is the authentication; not 3 because that just gives a randomly generated iteration
*/
