use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::{RAFFLE_SEED, RANDOMNESS_SEED, VAULT_SEED};
use crate::state::{Raffle, Randomness};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Raffle::INIT_SPACE,
        seeds = [RAFFLE_SEED],
        bump
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(
        init,
        payer = payer,
        space = 8 + Randomness::INIT_SPACE,
        seeds = [RANDOMNESS_SEED],
        bump
    )]
    pub randomness: Account<'info, Randomness>,

    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED],
        bump,
        token::mint = mint,
        token::authority = raffle,
        token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, draw_time: i64, oracle: Pubkey) -> Result<()> {
    let raffle = &mut ctx.accounts.raffle;
    raffle.mint = ctx.accounts.mint.key();
    raffle.vault = ctx.accounts.vault.key();
    raffle.oracle = oracle;
    raffle.draw_time = draw_time;
    raffle.deadline = draw_time;
    raffle.total_deposited = 0;
    raffle.entry_count = 0;
    raffle.randomness_requested = false;
    raffle.claimed = false;
    raffle.bump = ctx.bumps.raffle;
    raffle.vault_bump = ctx.bumps.vault;

    let randomness = &mut ctx.accounts.randomness;
    randomness.oracle = oracle;
    randomness.value = [0u8; 32];
    randomness.fulfilled = false;

    Ok(())
}
