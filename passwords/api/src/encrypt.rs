use crate::db::{OID, OID_LEN};
use data_encoding::{DecodeError, HEXUPPER};
use passwords_gen::PasswordGenerator;
use ring::{
    digest::{digest, SHA1_FOR_LEGACY_USE_ONLY, SHA512_OUTPUT_LEN},
    pbkdf2::{self, Algorithm, PBKDF2_HMAC_SHA512},
    rand,
    rand::SecureRandom,
};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;
use std::sync::LazyLock;

pub const N_ITER: u32 = 100_000;
pub const PASSWORD_LEN: usize = 15;
pub static PBKDF2_ALGO: Algorithm = PBKDF2_HMAC_SHA512;
pub const SHA256_SALT_LENGTH: usize = SHA512_OUTPUT_LEN / 4;

static PASSWORD_GENERATOR: LazyLock<PasswordGenerator> = LazyLock::new(|| {
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

/// Credentials extracted from request headers.
pub struct Credentials {
    pub username: String,
    pub password: String,
}

fn generate_salt() -> Result<String, CryptoError> {
    let mut salt = [0u8; SHA256_SALT_LENGTH];
    let rng = rand::SystemRandom::new();
    rng.fill(&mut salt)
        .map_err(|_| CryptoError::UnspecifiedRingError)?;
    Ok(HEXUPPER.encode(&salt))
}

/// Represents a master key before hashing. Cannot be stored or verified against.
/// Must be converted to [MasterKey] via [encrypt()] before use.
pub struct UnencryptedMasterKey<'a> {
    password: &'a str,
    salt: String,
}

impl<'a> UnencryptedMasterKey<'a> {
    pub fn new(password: &'a str) -> Result<Self, CryptoError> {
        Ok(Self {
            password,
            salt: generate_salt()?,
        })
    }

    /// Consumes self and returns an encrypted [MasterKey].
    /// The plaintext password is hashed with PBKDF2 and cannot be recovered.
    pub fn encrypt(self) -> Result<MasterKey, CryptoError> {
        let mut pbkdf2_hash = [0u8; SHA512_OUTPUT_LEN];
        pbkdf2::derive(
            PBKDF2_ALGO,
            NonZeroU32::new(N_ITER).unwrap(),
            &HEXUPPER.decode(self.salt.as_bytes())?,
            self.password.as_bytes(),
            &mut pbkdf2_hash,
        );
        Ok(MasterKey {
            master_pw: HEXUPPER.encode(&pbkdf2_hash),
            salt: self.salt,
        })
    }
}

/// Represents an encrypted master key. Safe to store and serialize.
/// Can only be created from [UnencryptedMasterKey::encrypt()] or deserialization.
/// Intentionally does not derive [Clone] so that the key cannot be copied.
#[derive(Serialize, Deserialize, Debug)]
pub struct MasterKey {
    pub master_pw: String,
    pub salt: String,
}

impl MasterKey {
    /// Creates an encrypted [MasterKey] from a plaintext password.
    /// Internally creates an [UnencryptedMasterKey] and encrypts it.
    pub fn new(password: &str) -> Result<MasterKey, CryptoError> {
        UnencryptedMasterKey::new(password)?.encrypt()
    }

    /// Verifies the given `password` hashes to the stored `master_pw` using the stored `salt`.
    pub fn verify(&self, password: &str) -> Result<(), CryptoError> {
        pbkdf2::verify(
            PBKDF2_ALGO,
            NonZeroU32::new(N_ITER).unwrap(),
            &HEXUPPER.decode(self.salt.as_bytes())?,
            password.as_bytes(),
            &HEXUPPER.decode(self.master_pw.as_bytes())?,
        )
        .map_err(|_| CryptoError::UnspecifiedRingError)
    }
}

pub fn generate_password() -> Result<String, CryptoError> {
    PASSWORD_GENERATOR
        .generate_one()
        .map_err(|e| CryptoError::PasswordError { error_msg: e })
}

pub fn user2oid(user: &str) -> OID {
    let full_hash = digest(&SHA1_FOR_LEGACY_USE_ONLY, user.as_bytes());
    OID::from_bytes(full_hash.as_ref()[..OID_LEN].try_into().unwrap())
}

/* These crypto functions will be implemented in the frontend */

// /// Encrypts the generated [password] with AES256-GCM using a 256-bit key generated (somehow tbd) from the [master_key]
// pub fn encrypt_password(master_key: String, password: String) -> Result<String, CryptoError> {

// }

// /// Decrypts the [encrypted_password] with AES256-GCM using a 256-bit key generated (somehow tbd) from the [master_key]
// pub fn decrypt_password(master_key: String, encrypted_pw: String) -> Result<String, CryptoError> {

// }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unencrypted_master_key_new_stores_password() {
        let password = "test_password";
        let uk = UnencryptedMasterKey::new(password).unwrap();
        
        assert_eq!(uk.password, password);
        assert!(!uk.salt.is_empty());
        // Salt should be hex-encoded, so length should be SHA256_SALT_LENGTH * 2
        assert_eq!(uk.salt.len(), SHA256_SALT_LENGTH * 2);
    }

    #[test]
    fn test_unencrypted_master_key_generates_unique_salts() {
        let uk1 = UnencryptedMasterKey::new("test_password").unwrap();
        let uk2 = UnencryptedMasterKey::new("test_password").unwrap();
        
        // Each key should have a unique salt
        assert_ne!(uk1.salt, uk2.salt);
    }

    #[test]
    fn test_unencrypted_master_key_encrypt_produces_hashed_key() {
        let password = "test_password";
        let uk = UnencryptedMasterKey::new(password).unwrap();
        let original_salt = uk.salt.clone();
        
        let mk = uk.encrypt().unwrap();
        
        // Encrypted key should have different master_pw (it's now a hash)
        assert_ne!(mk.master_pw, password);
        // Encrypted password should be hex-encoded SHA512, so length is 128
        assert_eq!(mk.master_pw.len(), SHA512_OUTPUT_LEN * 2);
        // Salt should be preserved
        assert_eq!(mk.salt, original_salt);
    }

    #[test]
    fn test_master_key_new_returns_encrypted_key() {
        let password = "test_password";
        let mk = MasterKey::new(password).unwrap();
        
        assert_ne!(mk.master_pw, password);
        assert_eq!(mk.master_pw.len(), SHA512_OUTPUT_LEN * 2);
    }

    #[test]
    fn test_master_key_verify_succeeds_with_correct_password() {
        let password = "correct_password";
        let mk = MasterKey::new(password).unwrap();
        
        let result = mk.verify(password);
        
        assert!(result.is_ok());
    }

    #[test]
    fn test_master_key_verify_fails_with_incorrect_password() {
        let mk = MasterKey::new("correct_password").unwrap();
        
        let result = mk.verify("wrong_password");
        
        assert!(result.is_err());
    }

    #[test]
    fn test_master_key_verify_with_various_passwords() {
        let long_password = "a".repeat(1000);
        let test_passwords = vec![
            "simple",
            "with spaces",
            "With!@#$%Special^&*Chars",
            "日本語パスワード",
            long_password.as_str(),
            "",
        ];

        for password in test_passwords {
            let mk = MasterKey::new(password).unwrap();
            
            assert!(
                mk.verify(password).is_ok(),
                "Failed for password: {:?}",
                password
            );
            
            if !password.is_empty() {
                assert!(
                    mk.verify("different").is_err(),
                    "Should fail for wrong password when original was: {:?}",
                    password
                );
            }
        }
    }

    #[test]
    fn test_generate_password_returns_correct_length() {
        let password = generate_password().unwrap();
        
        assert_eq!(password.len(), PASSWORD_LEN);
    }

    #[test]
    fn test_generate_password_contains_required_characters() {
        // Generate multiple passwords to increase probability of hitting all character types
        for _ in 0..10 {
            let password = generate_password().unwrap();
            
            let has_lowercase = password.chars().any(|c| c.is_ascii_lowercase());
            let has_uppercase = password.chars().any(|c| c.is_ascii_uppercase());
            let has_digit = password.chars().any(|c| c.is_ascii_digit());
            let has_symbol = password.chars().any(|c| !c.is_alphanumeric() && !c.is_whitespace());
            
            // Since strict mode is on, each generated password should have all types
            assert!(has_lowercase, "Password should contain lowercase: {}", password);
            assert!(has_uppercase, "Password should contain uppercase: {}", password);
            assert!(has_digit, "Password should contain digit: {}", password);
            assert!(has_symbol, "Password should contain symbol: {}", password);
        }
    }

    #[test]
    fn test_generate_password_no_spaces() {
        for _ in 0..20 {
            let password = generate_password().unwrap();
            assert!(!password.contains(' '), "Password should not contain spaces: {}", password);
        }
    }

    #[test]
    fn test_generate_password_generates_unique_passwords() {
        let passwords: Vec<String> = (0..100)
            .map(|_| generate_password().unwrap())
            .collect();
        
        let unique_count = passwords.iter().collect::<std::collections::HashSet<_>>().len();
        
        // All 100 passwords should be unique
        assert_eq!(unique_count, 100, "Generated passwords should be unique");
    }

    #[test]
    fn test_user2oid_deterministic() {
        let username = "testuser".to_string();
        
        let oid1 = user2oid(&username);
        let oid2 = user2oid(&username);
        
        assert_eq!(oid1, oid2);
    }

    #[test]
    fn test_user2oid_different_users_different_oids() {
        let user1 = "alice".to_string();
        let user2 = "bob".to_string();
        
        let oid1 = user2oid(&user1);
        let oid2 = user2oid(&user2);
        
        assert_ne!(oid1, oid2);
    }

    #[test]
    fn test_user2oid_returns_valid_objectid() {
        let username = "testuser".to_string();
        let oid = user2oid(&username);
        
        // ObjectId should be 12 bytes when serialized
        let bytes = oid.bytes();
        assert_eq!(bytes.len(), OID_LEN);
    }

    #[test]
    fn test_master_key_serialization_roundtrip() {
        let password = "test_password";
        let mk = MasterKey::new(password).unwrap();
        
        let serialized = serde_json::to_string(&mk).unwrap();
        let deserialized: MasterKey = serde_json::from_str(&serialized).unwrap();
        
        assert_eq!(deserialized.master_pw, mk.master_pw);
        assert_eq!(deserialized.salt, mk.salt);
        
        // The deserialized key should still verify the original password
        assert!(deserialized.verify(password).is_ok());
    }
}
