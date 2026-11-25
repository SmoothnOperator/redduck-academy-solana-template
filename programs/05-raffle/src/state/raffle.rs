use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Raffle {
    /// The mint of the token deposited into this raffle.
    pub mint: Pubkey,
    /// The token vault holding the deposits.
    pub vault: Pubkey,
    /// The trusted oracle for randomness.
    pub oracle: Pubkey,
    /// The draw time / deadline timestamp.
    pub draw_time: i64,
    /// Duplicate/alias for deadline (so both draw_time and deadline are stored).
    pub deadline: i64,
    /// Total tokens deposited across all entries.
    pub total_deposited: u64,
    /// Total number of entries created.
    pub entry_count: u64,
    /// Whether VRF randomness has been requested.
    pub randomness_requested: bool,
    /// Whether the prize has been claimed.
    pub claimed: bool,
    /// Bump seed of the raffle PDA.
    pub bump: u8,
    /// Bump seed of the vault PDA.
    pub vault_bump: u8,
}

pub type Config = Raffle;
pub type RaffleConfig = Raffle;
