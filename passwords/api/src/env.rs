use std::sync::LazyLock;

/// All environment variables required by the application, read once on first access.
pub struct EnvVars {
    pub mongo_user: String,
    pub mongo_pw: String,
    pub mongo_endpoint: String,
    pub users_db_name: String,
    pub frontend_origin: String,
}

static ENV: LazyLock<EnvVars> = LazyLock::new(|| EnvVars {
    mongo_user: std::env::var("MONGO_USER").expect("Need MONGO_USER env variable"),
    mongo_pw: std::env::var("MONGO_PW").expect("Need MONGO_PW env variable"),
    mongo_endpoint: std::env::var("MONGO_ENDPOINT").expect("Need MONGO_ENDPOINT env variable"),
    users_db_name: std::env::var("USERS_DB_NAME").expect("Need USERS_DB_NAME env variable"),
    frontend_origin: std::env::var("FRONTEND_ORIGIN").expect("Need FRONTEND_ORIGIN env variable"),
});

impl EnvVars {
    /// Get a reference to the environment variables, initializing them on first call.
    /// Panics if any required variable is missing.
    pub fn get() -> &'static EnvVars {
        &ENV
    }
}
