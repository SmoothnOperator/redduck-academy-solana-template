use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Entry {
    /// The index of this entry (0, 1, 2, ...).
    pub entry_index: u64,
    /// The public key of the entrant.
    pub entrant: Pubkey,
    /// The token amount deposited for this entry.
    pub amount: u64,
    /// The starting ticket number in the cumulative range [range_start, range_end).
    pub range_start: u64,
    /// The ending ticket number in the cumulative range [range_start, range_end).
    pub range_end: u64,
    /// Bump seed for this entry PDA.
    pub bump: u8,
}
