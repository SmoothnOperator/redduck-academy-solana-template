use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::{ENTRY_SEED, RAFFLE_SEED, VAULT_SEED};
use crate::error::RaffleError;
use crate::state::{Entry, Raffle};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [RAFFLE_SEED],
        bump = raffle.bump,
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(
        init,
        payer = entrant,
        space = 8 + Entry::INIT_SPACE,
        seeds = [ENTRY_SEED, raffle.entry_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub entry: Account<'info, Entry>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = raffle.vault_bump,
        token::mint = mint,
        token::authority = raffle,
        token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = entrant,
        token::token_program = token_program,
    )]
    pub entrant_token_account: Account<'info, TokenAccount>,

    #[account(address = raffle.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub entrant: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, RaffleError::ZeroAmount);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp < ctx.accounts.raffle.draw_time, RaffleError::RaffleEnded);
    require!(!ctx.accounts.raffle.randomness_requested, RaffleError::RandomnessAlreadyRequested);

    // 1. Transfer tokens from entrant to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.entrant_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.entrant.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. Record entry with ticket range [range_start, range_end)
    let range_start = ctx.accounts.raffle.total_deposited;
    let range_end = range_start.checked_add(amount).ok_or(RaffleError::MathOverflow)?;

    let entry = &mut ctx.accounts.entry;
    entry.entry_index = ctx.accounts.raffle.entry_count;
    entry.entrant = ctx.accounts.entrant.key();
    entry.amount = amount;
    entry.range_start = range_start;
    entry.range_end = range_end;
    entry.bump = ctx.bumps.entry;

    // 3. Update cumulative state
    let raffle = &mut ctx.accounts.raffle;
    raffle.total_deposited = range_end;
    raffle.entry_count = raffle.entry_count.checked_add(1).ok_or(RaffleError::MathOverflow)?;

    Ok(())
}
