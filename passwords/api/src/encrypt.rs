pub use crate::db::{create_oid, OID, OID_LEN};
pub use data_encoding::{DecodeError, HEXUPPER};
pub use once_cell::sync::Lazy;
pub use passwords::PasswordGenerator;
pub use ring::{
    digest::{digest, SHA1_FOR_LEGACY_USE_ONLY, SHA512_OUTPUT_LEN},
    pbkdf2::{self, Algorithm, PBKDF2_HMAC_SHA512},
    rand,
    rand::SecureRandom,
};
pub use serde::{Deserialize, Serialize};
pub use std::num::NonZeroU32;

pub const N_ITER: u32 = 100_000;
pub const PASSWORD_LEN: usize = 15;
pub static PBKDF2_ALGO: Algorithm = PBKDF2_HMAC_SHA512;
pub const SHA256_SALT_LENGTH: usize = SHA512_OUTPUT_LEN / 4;

static PASSWORD_GENERATOR: Lazy<PasswordGenerator> = Lazy::new(|| {
    PasswordGenerator::new()
        .length(PASSWORD_LEN)
        .numbers(true)
        .lowercase_letters(true)
        .uppercase_letters(true)
        .symbols(true)
        .spaces(false)
        .exclude_similar_characters(true)
        .strict(true)
});

#[derive(thiserror::Error, Debug)]
pub enum CryptoError {
    #[error("Unspecified error while using ring library")]
    UnspecifiedRingError,
    #[error("Error decoding hex bytes")]
    DecodeError(#[from] DecodeError),
    #[error("Error generating password: {error_msg:?}")]
    PasswordError { error_msg: &'static str },
}

/// Intentionally does not derive [Clone] so that the salt cannot be copied
#[derive(Serialize, Deserialize, Debug)]
pub struct MasterKey {
    pub master_pw: String,
    pub salt: String,
    #[serde(skip, default = "MasterKey::default_to_true")]
    encrypted: bool,
}

impl MasterKey {
    pub fn new(password: String) -> Result<MasterKey, CryptoError> {
        Ok(MasterKey {
            master_pw: password.clone(),
            salt: Self::generate_salt()?,
            encrypted: false,
        })
    }

    /// Hashes the unencrypted [master_pw] with the [salt] and replaces it
    pub fn encrypt(&mut self) -> Result<(), CryptoError> {
        if self.encrypted {
            return Ok(());
        }
        let mut pbkdf2_hash = [0u8; SHA512_OUTPUT_LEN];
        pbkdf2::derive(
            PBKDF2_ALGO,
            NonZeroU32::new(N_ITER).unwrap(),
            &HEXUPPER.decode(self.salt.as_bytes())?,
            self.master_pw.as_bytes(),
            &mut pbkdf2_hash,
        );
        self.master_pw = HEXUPPER.encode(&pbkdf2_hash);
        self.encrypted = true;
        Ok(())
    }

    fn generate_salt() -> Result<String, CryptoError> {
        let mut salt = [0u8; SHA256_SALT_LENGTH];
        let rng = rand::SystemRandom::new();
        rng.fill(&mut salt)
            .map_err(|_| CryptoError::UnspecifiedRingError)?;
        Ok(HEXUPPER.encode(&salt))
    }

    // Used for serde to default MasterKey::encrypted to true when deserializing
    fn default_to_true() -> bool {
        true
    }
}

/// Verifies the given [password] with the [mk.salt] in [mk] hashes to [mk.master_pw]
pub fn verify_master_key(password: String, mk: &MasterKey) -> Result<(), CryptoError> {
    pbkdf2::verify(
        PBKDF2_ALGO,
        NonZeroU32::new(N_ITER).unwrap(),
        &HEXUPPER.decode(mk.salt.as_bytes())?,
        password.as_bytes(),
        &HEXUPPER.decode(mk.master_pw.as_bytes())?,
    )
    .map_err(|_| CryptoError::UnspecifiedRingError)
}

pub fn generate_password() -> Result<String, CryptoError> {
    PASSWORD_GENERATOR
        .generate_one()
        .map_err(|e| CryptoError::PasswordError { error_msg: e })
}

pub fn user2oid(user: &String) -> OID {
    let full_hash = digest(&SHA1_FOR_LEGACY_USE_ONLY, user.as_bytes());
    create_oid(&full_hash.as_ref()[..OID_LEN].try_into().unwrap())
}

/* These crypto functions will be implemented in the frontend */

// /// Encrypts the generated [password] with AES256-GCM using a 256-bit key generated (somehow tbd) from the [master_key]
// pub fn encrypt_password(master_key: String, password: String) -> Result<String, CryptoError> {

// }

// /// Decrypts the [encrypted_password] with AES256-GCM using a 256-bit key generated (somehow tbd) from the [master_key]
// pub fn decrypt_password(master_key: String, encrypted_pw: String) -> Result<String, CryptoError> {

// }
