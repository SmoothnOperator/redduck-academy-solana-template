use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, Token2022, TokenAccount};

use crate::constants::{CONFIG_SEED, LOCK_DURATION_SECONDS, STAKE_SEED};
use crate::error::StakingError;
use crate::state::{Config, StakePosition};

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct Claim<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [STAKE_SEED, user.key().as_ref(), index.to_le_bytes().as_ref()],
        bump,
        has_one = user @ StakingError::Unauthorized
    )]
    pub stake_position: Account<'info, StakePosition>,

    #[account(
        mut,
        address = config.vrddk_mint
    )]
    pub vrddk_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = vrddk_mint,
        token::authority = user,
        token::token_program = token2022_program,
    )]
    pub user_vrddk_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token2022_program: Program<'info, Token2022>,
}

pub fn claim(ctx: Context<Claim>, _index: u64) -> Result<()> {
    let stake_position = &mut ctx.accounts.stake_position;
    require!(!stake_position.is_claimed, StakingError::AlreadyClaimed);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= stake_position.staked_at + LOCK_DURATION_SECONDS,
        StakingError::LockNotExpired
    );

    stake_position.is_claimed = true;

    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token2022_program.to_account_info(),
            token_interface::MintTo {
                mint: ctx.accounts.vrddk_mint.to_account_info(),
                to: ctx.accounts.user_vrddk_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        stake_position.amount,
    )?;

    Ok(())
}
