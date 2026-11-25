use anchor_lang::prelude::*;

#[error_code]
pub enum StakingError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Stake lock duration has not expired")]
    LockNotExpired,
    #[msg("Stake position already claimed")]
    AlreadyClaimed,
    #[msg("Calculation overflow")]
    CalculationOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
}
