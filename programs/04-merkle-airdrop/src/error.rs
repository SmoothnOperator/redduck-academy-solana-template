use anchor_lang::prelude::*;

#[error_code]
pub enum MerkleAirdropError {
    #[msg("Invalid Merkle proof")]
    InvalidProof,
    #[msg("Ed25519 signature verification failed")]
    SignatureVerificationFailed,
    #[msg("Airdrop allocation already claimed")]
    AlreadyClaimed,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
}
