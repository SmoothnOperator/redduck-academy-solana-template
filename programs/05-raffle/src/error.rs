use anchor_lang::prelude::*;

#[error_code]
pub enum RaffleError {
    #[msg("the random value did not come from the trusted oracle")]
    UntrustedOracle,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("the raffle has ended")]
    RaffleEnded,
    #[msg("the raffle is still open")]
    RaffleStillOpen,
    #[msg("randomness has already been requested")]
    RandomnessAlreadyRequested,
    #[msg("no entries have been placed in this raffle")]
    NoEntries,
    #[msg("randomness has not been delivered yet")]
    RandomnessNotDelivered,
    #[msg("the prize has already been claimed")]
    AlreadyClaimed,
    #[msg("this entry is not the winner")]
    NotWinner,
    #[msg("invalid entry index")]
    InvalidEntryIndex,
    #[msg("vault is empty")]
    VaultEmpty,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("raffle already initialized")]
    AlreadyInitialized,
}
