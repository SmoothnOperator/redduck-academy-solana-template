use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};
use anchor_spl::token_interface::{self, Mint as Mint2022, Token2022, TokenAccount as TokenAccount2022};

use crate::constants::{CONFIG_SEED, VAULT_SEED};
use crate::error::StakingError;
use crate::state::Config;

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [VAULT_SEED],
        bump = config.vault_bump,
        token::mint = rddk_mint,
        token::authority = config,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = config.vrddk_mint
    )]
    pub vrddk_mint: InterfaceAccount<'info, Mint2022>,

    #[account(
        mut,
        token::mint = vrddk_mint,
        token::authority = user,
        token::token_program = token2022_program,
    )]
    pub user_vrddk_ata: InterfaceAccount<'info, TokenAccount2022>,

    #[account(
        mut,
        token::mint = rddk_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_rddk_ata: Account<'info, TokenAccount>,

    #[account(address = config.rddk_mint)]
    pub rddk_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub token2022_program: Program<'info, Token2022>,
}

pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
    require!(amount > 0, StakingError::ZeroAmount);

    // 1. Burn vRDDK from user
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token2022_program.to_account_info(),
            token_interface::Burn {
                mint: ctx.accounts.vrddk_mint.to_account_info(),
                from: ctx.accounts.user_vrddk_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. Transfer RDDK from vault to user
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_rddk_ata.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    Ok(())
}
