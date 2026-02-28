use passwords::{build_rocket, db};

#[rocket::main]
async fn main() -> Result<(), anyhow::Error> {
    // Load .env if present (not required — CI provides env vars directly).
    if let Ok(path) = dotenv::dotenv() {
        println!("{}", path.display());
    }
    db::connect().await?;

    let _rocket = build_rocket().launch().await?;

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
