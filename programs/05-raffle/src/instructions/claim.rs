use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::constants::{ENTRY_SEED, RAFFLE_SEED, RANDOMNESS_SEED, VAULT_SEED};
use crate::error::RaffleError;
use crate::state::{Entry, Raffle, Randomness};

#[derive(Accounts)]
#[instruction(entry_index: u64)]
pub struct ClaimPrize<'info> {
    #[account(
        mut,
        seeds = [RAFFLE_SEED],
        bump = raffle.bump,
    )]
    pub raffle: Account<'info, Raffle>,

    #[account(
        seeds = [RANDOMNESS_SEED],
        bump,
    )]
    pub randomness: Account<'info, Randomness>,

    #[account(
        seeds = [ENTRY_SEED, entry_index.to_le_bytes().as_ref()],
        bump = entry.bump,
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
        token::token_program = token_program,
    )]
    pub destination: Account<'info, TokenAccount>,

    #[account(address = raffle.mint)]
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub winner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn claim(ctx: Context<ClaimPrize>, entry_index: u64) -> Result<()> {
    require!(!ctx.accounts.raffle.claimed, RaffleError::AlreadyClaimed);
    require!(ctx.accounts.randomness.fulfilled, RaffleError::RandomnessNotDelivered);
    require!(ctx.accounts.raffle.total_deposited > 0, RaffleError::NoEntries);

    // Verify winner from delivered randomness in O(1) without looping
    let random_bytes: [u8; 16] = ctx.accounts.randomness.value[0..16]
        .try_into()
        .map_err(|_| RaffleError::MathOverflow)?;
    let random_val = u128::from_le_bytes(random_bytes);
    let winning_ticket = (random_val % (ctx.accounts.raffle.total_deposited as u128)) as u64;

    let entry = &ctx.accounts.entry;
    require!(entry.entry_index == entry_index, RaffleError::InvalidEntryIndex);
    require!(
        winning_ticket >= entry.range_start && winning_ticket < entry.range_end,
        RaffleError::NotWinner
    );

    // Connect winner signer and destination token account to the winning entry
    require_keys_eq!(ctx.accounts.winner.key(), entry.entrant, RaffleError::NotWinner);
    require_keys_eq!(ctx.accounts.destination.owner, entry.entrant, RaffleError::NotWinner);

    // Transfer the entire pot from the vault to the winner
    let prize_amount = ctx.accounts.vault.amount;
    require!(prize_amount > 0, RaffleError::VaultEmpty);

    ctx.accounts.raffle.claimed = true;

    let signer_seeds: &[&[&[u8]]] = &[&[
        RAFFLE_SEED,
        &[ctx.accounts.raffle.bump],
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.raffle.to_account_info(),
            },
            signer_seeds,
        ),
        prize_amount,
    )?;

    Ok(())
}
